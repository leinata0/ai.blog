# Codex MCP API Key Checklist

This checklist matches the MCP skeleton planned for the blog workflow.

## Recommended First

### `GITHUB_PAT`

- Used by: GitHub MCP
- Purpose: read repositories, workflow runs, PRs, issues, and logs
- Status: optional now, recommended first
- Notes:
  - prefer a fine-grained PAT instead of a broad classic token
  - limit it to the repositories you want Codex to inspect
  - start with read-only repository access unless you later need write actions
  - useful for debugging auto-blog and deploy failures
  - official setup docs:
    - [Setting up the GitHub MCP Server](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server)
    - [Extending GitHub Copilot coding agent with MCP](https://docs.github.com/copilot/customizing-copilot/using-model-context-protocol/extending-copilot-coding-agent-with-mcp)

### `FIRECRAWL_API_KEY`

- Used by: Firecrawl MCP
- Purpose: scrape source pages, extract readable content, find candidate inline images
- Status: optional now, high priority for research and illustration quality

### `EXA_API_KEY`

- Used by: Exa MCP
- Purpose: find broader web sources, independent blogs, and research context
- Status: optional now, high priority after Firecrawl

## Optional / Later

### `SEMANTIC_SCHOLAR_API_KEY`

- Used by: only if you later choose a Semantic Scholar community MCP or direct API integration
- Purpose: paper lookup and citation enrichment
- Status: not wired in first batch

### `TAVILY_API_KEY`

- Used by: only if you later choose Tavily instead of Exa
- Purpose: general web research
- Status: not wired in first batch

## Suggested Enable Order

1. `GITHUB_PAT`
2. `FIRECRAWL_API_KEY`
3. `EXA_API_KEY`
4. academic research key only after runtime and server choice are settled

## Blog Workflow Mapping

- `GITHUB_PAT`
  - GitHub Actions / workflow debugging
  - repo and PR inspection
- `FIRECRAWL_API_KEY`
  - source extraction
  - source-image picking
  - fallback over weak RSS or Jina output
- `EXA_API_KEY`
  - topic expansion
  - competing viewpoints
  - independent commentary discovery

## Important Defaults

- Do not enable every MCP at once.
- Add one MCP, restart Codex, verify the server loads, then add the next one.
- Keep the academic MCP disabled until you choose a concrete server implementation.
