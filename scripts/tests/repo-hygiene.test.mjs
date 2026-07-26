import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')

function repoFile(...segments) {
  return resolve(repoRoot, ...segments)
}

async function readRepoFile(...segments) {
  return readFile(repoFile(...segments), 'utf8')
}

test('.gitignore keeps real .env files and build artifacts out of the index', async () => {
  const gitignore = await readRepoFile('.gitignore')
  const lines = gitignore.split(/\r?\n/).map((line) => line.trim())

  // 任何人从 .env.example 复制出真 .env 后一次 `git add .` 就会提交 Neon/R2/Resend 密钥。
  assert.ok(lines.includes('.env'), '.gitignore must ignore .env')
  assert.ok(lines.includes('.env.*'), '.gitignore must ignore .env.* (.env.local / .env.production)')
  assert.ok(lines.includes('!.env.example'), '.gitignore must keep .env.example tracked')

  assert.ok(lines.includes('uploads/'), '.gitignore must ignore the local uploads dir')
  assert.ok(lines.includes('frontend/output/'), '.gitignore must ignore Lighthouse/Playwright output')
  assert.ok(lines.includes('.claude/settings.local.json'), '.gitignore must ignore personal Claude settings')
  assert.ok(lines.includes('ci-backend-logs/'), '.gitignore must ignore ci-backend-logs/')
  assert.ok(lines.includes('*.log'), '.gitignore must ignore *.log')

  // e2e 视觉回归基线必须继续入库，不能被上面的规则连带忽略。
  assert.equal(
    lines.some((line) => line.startsWith('frontend/e2e')),
    false,
    '.gitignore must not ignore frontend/e2e visual regression baselines',
  )
})

test('backend image ships scripts/config and mirrors the repo layout', async () => {
  const dockerfile = await readRepoFile('backend', 'Dockerfile')

  // cover_art.py / routers/posts.py 用 parents[3] 反查仓库根定位 scripts/config，
  // uploads.py 用 parents[2]。容器内布局必须是 /app/backend/app + /app/scripts/config。
  assert.match(dockerfile, /COPY[^\n]*backend\/app\/ \.\/backend\/app\//)
  assert.match(dockerfile, /COPY[^\n]*scripts\/config\/ \.\/scripts\/config\//)
  assert.match(dockerfile, /COPY backend\/pyproject\.toml backend\/uv\.lock/)
  assert.match(dockerfile, /--app-dir", "backend"/)

  // 显式生产标识，避免非 Render 环境静默启用 dev admin/默认 JWT 密钥。
  assert.match(dockerfile, /APP_ENV=production/)
  assert.match(dockerfile, /uv sync --frozen/)
})

test('root .dockerignore excludes secrets and heavy trees from the build context', async () => {
  const dockerignore = await readRepoFile('.dockerignore')
  const lines = dockerignore.split(/\r?\n/).map((line) => line.trim())

  for (const pattern of ['**/.env', '**/.env.*', '**/node_modules', '.git', 'frontend', '**/tests', 'blog.db']) {
    assert.ok(lines.includes(pattern), `.dockerignore must exclude ${pattern}`)
  }
})

test('render.yaml stays a rebuildable source of truth', async () => {
  const renderYaml = await readRepoFile('render.yaml')

  assert.match(renderYaml, /dockerContext: \.\s*$/m, 'build context must be the repo root')
  assert.match(renderYaml, /dockerfilePath: \.\/backend\/Dockerfile/)

  const declaredKeys = [...renderYaml.matchAll(/^\s*- key: ([A-Z0-9_]+)\s*$/gm)].map((match) => match[1])
  const required = [
    'APP_ENV',
    'DATABASE_URL',
    'SECRET_KEY',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'PUBLIC_SITE_URL',
    'ALLOWED_ORIGINS',
    'TURNSTILE_SECRET_KEY',
    'VERCEL_DEPLOY_HOOK_URL',
    'XAI_API_KEY',
    'SILICONFLOW_BASE_URL',
    'SILICONFLOW_MODEL',
    'IMAGE_GENERATION_TIMEOUT_SECONDS',
    'R2_PUBLIC_BASE_URL',
  ]
  for (const key of required) {
    assert.ok(declaredKeys.includes(key), `render.yaml must declare ${key}`)
  }

  assert.match(renderYaml, /- key: APP_ENV\s*\n\s*value: production/)
  assert.match(renderYaml, /- key: PUBLIC_SITE_URL\s*\n\s*value: https:\/\/www\.563118077\.xyz/)
})

test('smoke-check workflow never sends admin credentials to a caller-supplied host', async () => {
  const workflow = await readRepoFile('.github', 'workflows', 'smoke-check.yml')

  assert.ok(workflow.includes('secrets.ADMIN_PASSWORD'), 'smoke check still needs the admin secret')
  assert.equal(
    workflow.includes('inputs.blog_api_base'),
    false,
    'BLOG_API_BASE must not come from free-text workflow input',
  )
  assert.ok(workflow.includes('vars.BLOG_API_BASE'), 'BLOG_API_BASE must come from repository variables')
  assert.match(workflow, /include_admin[\s\S]*?default: false/, 'admin smoke must be opt-in')
})

test('repair-post-images workflow is gated and fully configured', async () => {
  const workflow = await readRepoFile('.github', 'workflows', 'repair-post-images.yml')

  // 缺失时可信图片 host 集合退化为硬编码域名，已本地化的图片会被重新下载上传。
  assert.ok(workflow.includes('R2_PUBLIC_BASE_URL: ${{ vars.R2_PUBLIC_BASE_URL }}'))
  assert.ok(workflow.includes('Missing ADMIN_USERNAME'), 'ADMIN_USERNAME must be validated too')
  // GitHub 环境名大小写敏感：写错大小写会新建一个没有保护规则的同名环境，审批形同虚设。
  // 所以这里不锁定具体拼写（当前仓库既有环境是 Production），只要求门禁挂在 apply job 上——
  // 挂到只读的 audit job 上是无效的，必须精确到 apply 这一段。
  const applyJob = workflow.split(/^  apply:$/m)[1]
  assert.ok(applyJob, 'workflow must define an apply job')
  assert.match(applyJob, /^\s{4}environment: \S+/m, 'apply must pass an environment approval gate')
  assert.ok(workflow.includes('actions/upload-artifact'), 'audit output must be archived')
  assert.match(workflow, /if: \$\{\{ inputs\.apply \}\}/, 'apply job must be conditional on the apply input')
})

test('daily and weekly pipelines share one concurrency group', async () => {
  const [auto, weekly] = await Promise.all([
    readRepoFile('.github', 'workflows', 'auto-blog.yml'),
    readRepoFile('.github', 'workflows', 'weekly-review.yml'),
  ])

  const groupOf = (source) => source.match(/^concurrency:\s*\n\s*group: (.+)$/m)?.[1]?.trim()
  assert.equal(groupOf(auto), 'content-pipeline')
  assert.equal(groupOf(weekly), 'content-pipeline')
  assert.match(auto, /cancel-in-progress: false/)
  assert.match(weekly, /cancel-in-progress: false/)
})

test('CI installs dependencies reproducibly and does not depend on prod backend for PRs', async () => {
  const ci = await readRepoFile('.github', 'workflows', 'ci-quality.yml')
  assert.match(ci, /uv sync --project backend --extra dev --frozen/)
  assert.match(ci, /SKIP_PRERENDER: \$\{\{ github\.event_name == 'pull_request' && '1' \|\| '' \}\}/)

  for (const name of ['backfill-quality-snapshots.yml', 'backfill-series-covers.yml']) {
    const workflow = await readRepoFile('.github', 'workflows', name)
    assert.equal(workflow.includes('npm install'), false, `${name} must use npm ci, not npm install`)
    assert.ok(workflow.includes('npm ci'), `${name} must use npm ci`)
  }
})

test('dependabot covers every dependency manifest', async () => {
  const dependabot = await readRepoFile('.github', 'dependabot.yml')
  const entries = [...dependabot.matchAll(/package-ecosystem: (\S+)\s*\n\s*directory: (\S+)/g)].map(
    ([, ecosystem, directory]) => `${ecosystem}:${directory}`,
  )

  for (const expected of ['github-actions:/', 'npm:/frontend', 'npm:/scripts', 'pip:/backend']) {
    assert.ok(entries.includes(expected), `dependabot.yml must cover ${expected}`)
  }
})

test('env examples match what the code actually reads', async () => {
  const [frontendEnv, scriptsEnv, backendEnv] = await Promise.all([
    readRepoFile('frontend', '.env.example'),
    readRepoFile('scripts', '.env.example'),
    readRepoFile('backend', '.env.example'),
  ])

  // 全项目 canonical 统一带 www；裸域会产出重复内容。
  assert.match(frontendEnv, /^PUBLIC_SITE_URL=https:\/\/www\.563118077\.xyz$/m)

  // LLM/生图密钥已上收后端，scripts/**/*.mjs 零引用。
  for (const forbidden of ['SILICONFLOW_API_KEY=', 'SILICONFLOW_BASE_URL=', 'SILICONFLOW_MODEL=', 'XAI_API_KEY=']) {
    assert.equal(scriptsEnv.includes(forbidden), false, `scripts/.env.example must not list ${forbidden}`)
  }
  for (const expected of ['VERCEL_DEPLOY_HOOK_URL', 'PUBLIC_SITE_URL', 'R2_PUBLIC_BASE_URL']) {
    assert.ok(scriptsEnv.includes(expected), `scripts/.env.example must document ${expected}`)
  }

  for (const expected of [
    'ENABLE_STARTUP_SCHEMA_SYNC',
    'SILICONFLOW_BASE_URL',
    'SILICONFLOW_MODEL',
    'SITE_URL',
    'TOKEN_ISSUER',
    'TOKEN_AUDIENCE',
    'DB_TIMING_LOG_MIN_MS',
    'ENVIRONMENT',
    'AI_PROVIDER_ALLOWED_BASE_URL_HOSTS',
    'AI_PROVIDER_ALLOWED_KEY_ENV_VARS',
  ]) {
    assert.ok(backendEnv.includes(expected), `backend/.env.example must document ${expected}`)
  }
})

test('docs no longer recommend removed or contradicted settings', async () => {
  const [readme, r2Doc] = await Promise.all([
    readRepoFile('README.md'),
    readRepoFile('docs', 'neon-r2-setup.md'),
  ])

  // frontend/src 零命中，且 api-base.test.js 断言部署态跨域值被丢弃。
  assert.equal(readme.includes('VITE_ALLOW_CROSS_ORIGIN_API'), false)
  assert.equal(readme.includes('`SILICONFLOW_*` · `XAI_API_KEY`'), false)
  assert.ok(readme.includes('PRERENDER_API_BASE'), 'README must name the build-time prerender base')

  assert.ok(r2Doc.includes('PRERENDER_API_BASE'), 'R2 doc must list the required Vercel build var')
  assert.ok(r2Doc.includes('ALLOWED_ORIGINS'))
  assert.ok(r2Doc.includes('ENABLE_STARTUP_SCHEMA_SYNC'))
  assert.match(r2Doc, /fails startup|fails closed/, 'R2 doc must state that incomplete R2 blocks production startup')
})
