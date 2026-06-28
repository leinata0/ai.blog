import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { useUser } from '../contexts/UserContext'
import { updateMe, changePassword, fetchCloudTopics, fetchCloudHistory } from '../api/user'

const cardStyle = { backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }
const inputStyle = {
  backgroundColor: 'var(--bg-canvas)',
  border: '1px solid var(--border-muted)',
  color: 'var(--text-primary)',
}

export default function AccountPage() {
  const navigate = useNavigate()
  const { user, loading, logout, setUser } = useUser()

  const [nickname, setNickname] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [topics, setTopics] = useState([])
  const [history, setHistory] = useState([])

  useEffect(() => {
    document.title = '个人中心 - 极客开发日志'
  }, [])

  useEffect(() => {
    if (user) setNickname(user.nickname || '')
  }, [user])

  useEffect(() => {
    if (!user) return
    fetchCloudTopics().then(setTopics).catch(() => setTopics([]))
    fetchCloudHistory().then(setHistory).catch(() => setHistory([]))
  }, [user])

  const handleProfile = async (event) => {
    event.preventDefault()
    setProfileMsg('')
    try {
      const updated = await updateMe({ nickname })
      setUser(updated)
      setProfileMsg('资料已更新')
    } catch (error) {
      setProfileMsg(String(error?.message || '更新失败'))
    }
  }

  const handlePassword = async (event) => {
    event.preventDefault()
    setPwMsg('')
    try {
      await changePassword({ old_password: oldPassword, new_password: newPassword })
      setOldPassword('')
      setNewPassword('')
      setPwMsg('密码已更新')
    } catch (error) {
      setPwMsg(String(error?.message || '修改失败'))
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  if (loading) {
    return (
      <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
        <Navbar />
        <div className="mx-auto max-w-4xl px-6 py-16 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          正在加载...
        </div>
        <Footer />
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-4xl px-6 py-16 sm:px-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>个人中心</h1>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200"
            style={{ border: '1px solid var(--border-muted)', color: 'var(--text-secondary)' }}
          >
            退出登录
          </button>
        </div>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {user?.email}
        </p>

        {/* Profile */}
        <section className="mt-8 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>资料</h2>
          <form onSubmit={handleProfile} className="mt-4 space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }} htmlFor="acc-nickname">昵称</label>
              <input
                id="acc-nickname"
                type="text"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
                style={inputStyle}
                maxLength={50}
              />
            </div>
            {profileMsg ? <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{profileMsg}</p> : null}
            <button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
              保存资料
            </button>
          </form>
        </section>

        {/* Password */}
        <section className="mt-6 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>修改密码</h2>
          <form onSubmit={handlePassword} className="mt-4 space-y-4">
            <input
              type="password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
              style={inputStyle}
              placeholder="原密码"
              required
            />
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
              style={inputStyle}
              placeholder="新密码（至少 8 位）"
              minLength={8}
              required
            />
            {pwMsg ? <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{pwMsg}</p> : null}
            <button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
              更新密码
            </button>
          </form>
        </section>

        {/* Followed topics */}
        <section className="mt-6 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>我的关注（已同步到云端）</h2>
          {topics.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {topics.map((topic) => (
                <Link
                  key={topic.topic_key}
                  to={`/topics/${topic.topic_key}`}
                  className="block rounded-2xl border border-transparent px-4 py-3 text-sm transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {topic.display_title || topic.topic_key}
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-faint)' }}>还没有关注的主题。</p>
          )}
        </section>

        {/* Reading history */}
        <section className="mt-6 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>阅读历史</h2>
          {history.length ? (
            <ul className="mt-4 space-y-2">
              {history.map((item) => (
                <li key={item.slug}>
                  <Link to={`/posts/${item.slug}`} className="text-sm transition-colors hover:text-[var(--accent)]" style={{ color: 'var(--text-secondary)' }}>
                    {item.title || item.slug}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-faint)' }}>还没有阅读记录。</p>
          )}
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
