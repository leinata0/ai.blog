import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Heart,
  History,
  LogOut,
  MessageSquare,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react'

import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { useUser } from '../contexts/UserContext'
import {
  updateMe,
  changePassword as changePasswordApi,
  fetchCloudTopics,
  fetchCloudHistory,
  fetchMyComments,
  fetchMyLikes,
  uploadAvatar,
  resendVerification,
  deleteAccount,
  revokeSessions as revokeSessionsApi,
} from '../api/user'

const inputClass = 'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'
const inputStyle = { backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }
const tabs = [
  ['overview', '概览', UserRound],
  ['profile', '个人资料', Settings],
  ['security', '账号安全', ShieldCheck],
  ['topics', '我的关注', BookOpen],
  ['history', '阅读历史', History],
  ['comments', '我的评论', MessageSquare],
  ['likes', '我的点赞', Heart],
]

function Empty({ children }) {
  return <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>{children}</p>
}

function Panel({ title, description, children }) {
  return (
    <section>
      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {description ? <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-tertiary)' }}>{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  )
}

export default function AccountPage() {
  const navigate = useNavigate()
  const userContext = useUser()
  const { user, loading, logout, setUser } = userContext
  const fileInputRef = useRef(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [nickname, setNickname] = useState('')
  const [bio, setBio] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [securityMsg, setSecurityMsg] = useState('')
  const [verifyMsg, setVerifyMsg] = useState('')
  const [topics, setTopics] = useState([])
  const [history, setHistory] = useState([])
  const [myComments, setMyComments] = useState([])
  const [myLikes, setMyLikes] = useState([])

  useEffect(() => { document.title = '账号中心 - AI 资讯观察' }, [])
  useEffect(() => {
    if (!user) return
    setNickname(user.nickname || '')
    setBio(user.bio || '')
    Promise.allSettled([fetchCloudTopics(), fetchCloudHistory(), fetchMyComments(), fetchMyLikes()]).then((results) => {
      setTopics(results[0].status === 'fulfilled' ? results[0].value : [])
      setHistory(results[1].status === 'fulfilled' ? results[1].value : [])
      setMyComments(results[2].status === 'fulfilled' ? results[2].value : [])
      setMyLikes(results[3].status === 'fulfilled' ? results[3].value : [])
    })
  }, [user])

  async function handleProfile(event) {
    event.preventDefault()
    setProfileMsg('')
    try {
      const updated = await updateMe({ nickname, bio })
      setUser(updated)
      setProfileMsg('资料已更新')
    } catch (error) {
      setProfileMsg(String(error?.message || '更新失败'))
    }
  }

  async function handleAvatar(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setProfileMsg('')
    try {
      const updated = await uploadAvatar(file)
      setUser(updated)
      setProfileMsg('头像已更新')
    } catch (error) {
      setProfileMsg(String(error?.message || '头像上传失败'))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handlePassword(event) {
    event.preventDefault()
    setSecurityMsg('')
    try {
      const updater = userContext.updatePassword || changePasswordApi
      const updated = await updater({ old_password: user?.password_set ? oldPassword : undefined, new_password: newPassword })
      if (updated?.email) setUser(updated)
      setOldPassword('')
      setNewPassword('')
      setSecurityMsg(user?.password_set ? '密码已更新，其他旧会话已失效' : '密码已设置')
    } catch (error) {
      setSecurityMsg(String(error?.message || '密码更新失败'))
    }
  }

  async function handleResend() {
    setVerifyMsg('')
    try {
      await resendVerification()
      setVerifyMsg('验证邮件已发送，请查收')
    } catch (error) {
      setVerifyMsg(String(error?.message || '发送失败'))
    }
  }

  async function handleRevokeSessions() {
    if (!window.confirm('确定退出所有设备吗？当前设备也需要重新登录。')) return
    try {
      if (userContext.revokeAllSessions) await userContext.revokeAllSessions()
      else {
        await revokeSessionsApi()
        logout()
      }
      navigate('/login')
    } catch (error) {
      setSecurityMsg(String(error?.message || '操作失败，请稍后重试'))
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm('确定要注销账号吗？此操作不可恢复，你的关注、点赞、阅读历史将被删除。')) return
    try {
      await deleteAccount()
      logout()
      navigate('/')
    } catch (error) {
      window.alert(String(error?.message || '注销失败，请稍后重试'))
    }
  }

  if (loading) {
    return <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}><Navbar /><div role="status" className="mx-auto max-w-6xl px-6 py-16 text-sm" style={{ color: 'var(--text-tertiary)' }}>正在加载账号...</div></main>
  }

  const summary = [
    ['关注主题', topics.length],
    ['阅读记录', history.length],
    ['我的评论', myComments.length],
    ['点赞文章', myLikes.length],
  ]

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10 lg:px-20">
        <header className="flex flex-col gap-5 border-b pb-8 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'var(--border-muted)' }}>
          <div>
            <div className="section-kicker">账号中心</div>
            <h1 className="mt-3 text-3xl font-semibold" style={{ color: 'var(--text-primary)' }}>{user?.nickname || '我的账号'}</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>{user?.email}</p>
          </div>
          <button type="button" onClick={() => { logout(); navigate('/') }} className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}><LogOut size={16} /> 退出登录</button>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="账号中心导航" className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-3 lg:flex lg:flex-col">
            {tabs.map(([value, label, Icon]) => (
              <button key={value} type="button" onClick={() => setActiveTab(value)} aria-current={activeTab === value ? 'page' : undefined} className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-semibold transition-colors" style={{ backgroundColor: activeTab === value ? 'var(--accent-soft)' : 'transparent', color: activeTab === value ? 'var(--accent)' : 'var(--text-secondary)' }}><Icon size={16} /> {label}</button>
            ))}
          </nav>

          <div className="min-w-0 rounded-lg border p-6 sm:p-8" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow-soft)' }}>
            {activeTab === 'overview' ? (
              <Panel title="账号概览" description="查看账号安全状态和已同步的数据。">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {summary.map(([label, value]) => <div key={label} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-canvas)' }}><strong className="block text-2xl" style={{ color: 'var(--text-primary)' }}>{value}</strong><span className="mt-1 block text-xs" style={{ color: 'var(--text-faint)' }}>{label}</span></div>)}
                </div>
                <div className="mt-6 flex flex-wrap gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5" style={{ color: user?.email_verified ? '#16a34a' : '#ef4444' }}>{user?.email_verified ? <BadgeCheck size={15} /> : <AlertTriangle size={15} />}{user?.email_verified ? '邮箱已验证' : '邮箱尚未验证'}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>·</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{user?.password_set ? '已设置密码' : '验证码账号，尚未设置密码'}</span>
                  {user?.last_login_at ? <><span style={{ color: 'var(--text-tertiary)' }}>·</span><span style={{ color: 'var(--text-secondary)' }}>最近登录 {new Date(user.last_login_at).toLocaleString('zh-CN')}</span></> : null}
                </div>
              </Panel>
            ) : null}

            {activeTab === 'profile' ? (
              <Panel title="个人资料" description="昵称会显示在公开评论中，邮箱不会公开。">
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 overflow-hidden rounded-full border" style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-canvas)' }}>{user?.avatar_url ? <img src={user.avatar_url} alt="头像" className="h-full w-full object-cover" /> : null}</div>
                  <input ref={fileInputRef} aria-label="上传头像" type="file" accept="image/*" onChange={handleAvatar} className="max-w-[15rem] text-sm" style={{ color: 'var(--text-secondary)' }} />
                </div>
                <form onSubmit={handleProfile} className="mt-6 space-y-4">
                  <input aria-label="昵称" value={nickname} onChange={(event) => setNickname(event.target.value)} className={inputClass} style={inputStyle} maxLength={50} />
                  <textarea aria-label="个人简介" value={bio} onChange={(event) => setBio(event.target.value.slice(0, 300))} className={`${inputClass} resize-none`} style={inputStyle} rows={4} maxLength={300} placeholder="介绍一下你自己（可选）" />
                  {profileMsg ? <p role="status" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{profileMsg}</p> : null}
                  <button type="submit" className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>保存资料</button>
                </form>
              </Panel>
            ) : null}

            {activeTab === 'security' ? (
              <Panel title="账号安全" description="管理邮箱验证、密码和所有设备上的登录状态。">
                {!user?.email_verified ? <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--danger-border)', backgroundColor: 'var(--danger-soft)' }}><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>邮箱尚未验证。{verifyMsg ? ` ${verifyMsg}` : ''}</p><button type="button" onClick={handleResend} className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>重发验证邮件</button></div> : <p className="inline-flex items-center gap-2 text-sm" style={{ color: '#16a34a' }}><BadgeCheck size={16} /> 邮箱已验证</p>}
                <form onSubmit={handlePassword} className="mt-6 max-w-xl space-y-4">
                  {user?.password_set ? <input aria-label="原密码" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} className={inputClass} style={inputStyle} placeholder="原密码" required /> : null}
                  <input aria-label="新密码" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={inputClass} style={inputStyle} placeholder={user?.password_set ? '新密码（至少 8 位）' : '设置密码（至少 8 位）'} minLength={8} required />
                  {securityMsg ? <p role="status" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{securityMsg}</p> : null}
                  <button type="submit" className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>{user?.password_set ? '更新密码' : '设置密码'}</button>
                </form>
                <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--border-muted)' }}><h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>会话管理</h3><p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>退出全部设备会立即撤销所有现有登录令牌。</p><button type="button" onClick={handleRevokeSessions} className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}>退出全部设备</button></div>
                <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--danger-border)' }}><h3 className="font-semibold" style={{ color: '#ef4444' }}>注销账号</h3><p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>关注、点赞和阅读历史会被删除，评论将匿名保留。</p><button type="button" onClick={handleDeleteAccount} className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold" style={{ borderColor: 'var(--danger-border)', color: '#ef4444', backgroundColor: 'var(--danger-soft)' }}>注销账号</button></div>
              </Panel>
            ) : null}

            {activeTab === 'topics' ? <Panel title="我的关注">{topics.length ? <div className="grid gap-3 sm:grid-cols-2">{topics.map((item) => <Link key={item.topic_key} to={`/topics/${item.topic_key}`} className="rounded-lg border p-4 text-sm font-semibold" style={{ borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}>{item.display_title || item.topic_key}</Link>)}</div> : <Empty>还没有关注的主题。</Empty>}</Panel> : null}
            {activeTab === 'history' ? <Panel title="阅读历史">{history.length ? <div className="space-y-2">{history.map((item) => <Link key={item.slug} to={`/posts/${item.slug}`} className="block rounded-lg px-3 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{item.title || item.slug}</Link>)}</div> : <Empty>还没有阅读记录。</Empty>}</Panel> : null}
            {activeTab === 'comments' ? <Panel title="我的评论">{myComments.length ? <div className="space-y-3">{myComments.map((item) => <article key={item.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--border-muted)' }}><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{item.content}</p><Link to={`/posts/${item.post_slug}`} className="mt-2 inline-block text-xs" style={{ color: 'var(--accent)' }}>{item.post_title}</Link></article>)}</div> : <Empty>还没有发表过评论。</Empty>}</Panel> : null}
            {activeTab === 'likes' ? <Panel title="我的点赞">{myLikes.length ? <div className="space-y-2">{myLikes.map((item) => <Link key={item.post_slug} to={`/posts/${item.post_slug}`} className="block rounded-lg px-3 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{item.post_title}</Link>)}</div> : <Empty>还没有点赞过文章。</Empty>}</Panel> : null}
          </div>
        </div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
