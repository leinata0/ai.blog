import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { BadgeCheck, AlertTriangle } from 'lucide-react'

import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { useUser } from '../contexts/UserContext'
import {
  updateMe,
  changePassword,
  fetchCloudTopics,
  fetchCloudHistory,
  fetchMyComments,
  fetchMyLikes,
  uploadAvatar,
  resendVerification,
  deleteAccount,
} from '../api/user'

const cardStyle = { backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }
const inputStyle = {
  backgroundColor: 'var(--bg-canvas)',
  border: '1px solid var(--border-muted)',
  color: 'var(--text-primary)',
}

export default function AccountPage() {
  const navigate = useNavigate()
  const { user, loading, logout, setUser } = useUser()
  const fileInputRef = useRef(null)

  const [nickname, setNickname] = useState('')
  const [bio, setBio] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [topics, setTopics] = useState([])
  const [history, setHistory] = useState([])
  const [myComments, setMyComments] = useState([])
  const [myLikes, setMyLikes] = useState([])
  const [verifyMsg, setVerifyMsg] = useState('')
  const [avatarMsg, setAvatarMsg] = useState('')

  useEffect(() => {
    document.title = '个人中心 - 极客开发日志'
  }, [])

  useEffect(() => {
    if (user) {
      setNickname(user.nickname || '')
      setBio(user.bio || '')
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    fetchCloudTopics().then(setTopics).catch(() => setTopics([]))
    fetchCloudHistory().then(setHistory).catch(() => setHistory([]))
    fetchMyComments().then(setMyComments).catch(() => setMyComments([]))
    fetchMyLikes().then(setMyLikes).catch(() => setMyLikes([]))
  }, [user])

  const handleProfile = async (event) => {
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

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarMsg('')
    try {
      const updated = await uploadAvatar(file)
      setUser(updated)
      setAvatarMsg('头像已更新')
    } catch (error) {
      setAvatarMsg(String(error?.message || '头像上传失败'))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
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

  const handleResend = async () => {
    setVerifyMsg('')
    try {
      await resendVerification()
      setVerifyMsg('验证邮件已发送，请查收')
    } catch (error) {
      setVerifyMsg(String(error?.message || '发送失败'))
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const handleDeleteAccount = async () => {
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

        {/* Email verification status */}
        {user && !user.email_verified ? (
          <section
            className="mt-6 flex flex-col gap-3 rounded-3xl px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
            style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)' }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} style={{ color: '#ef4444' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                你的邮箱尚未验证。验证后才能评论和点赞。
                {verifyMsg ? <span className="ml-1" style={{ color: 'var(--text-tertiary)' }}>（{verifyMsg}）</span> : null}
              </p>
            </div>
            <button
              type="button"
              onClick={handleResend}
              className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              重发验证邮件
            </button>
          </section>
        ) : user?.email_verified ? (
          <p className="mt-3 inline-flex items-center gap-1 text-sm" style={{ color: '#16a34a' }}>
            <BadgeCheck size={15} /> 邮箱已验证
          </p>
        ) : null}

        {/* Profile */}
        <section className="mt-8 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>资料</h2>
          <div className="mt-4 flex items-center gap-4">
            <div
              className="h-16 w-16 overflow-hidden rounded-full bg-[var(--bg-canvas)]"
              style={{ border: '1px solid var(--border-muted)' }}
            >
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="头像" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="text-sm"
                style={{ color: 'var(--text-secondary)' }}
              />
              {avatarMsg ? <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>{avatarMsg}</p> : null}
            </div>
          </div>
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
            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }} htmlFor="acc-bio">个人简介</label>
              <textarea
                id="acc-bio"
                value={bio}
                onChange={(event) => setBio(event.target.value.slice(0, 300))}
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none resize-none"
                style={inputStyle}
                rows={3}
                maxLength={300}
                placeholder="介绍一下你自己（可选）"
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

        {/* My comments */}
        <section className="mt-6 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>我的评论</h2>
          {myComments.length ? (
            <ul className="mt-4 space-y-3">
              {myComments.map((c) => (
                <li key={c.id} className="rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{c.content}</p>
                  <Link to={`/posts/${c.post_slug}`} className="mt-1 inline-block text-xs" style={{ color: 'var(--accent)' }}>
                    {c.post_title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-faint)' }}>还没有发表过评论。</p>
          )}
        </section>

        {/* My likes */}
        <section className="mt-6 rounded-3xl px-8 py-6" style={cardStyle}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>我的点赞</h2>
          {myLikes.length ? (
            <ul className="mt-4 space-y-2">
              {myLikes.map((l) => (
                <li key={l.post_slug}>
                  <Link to={`/posts/${l.post_slug}`} className="text-sm transition-colors hover:text-[var(--accent)]" style={{ color: 'var(--text-secondary)' }}>
                    {l.post_title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-faint)' }}>还没有点赞过文章。</p>
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

        {/* Danger zone */}
        <section className="mt-6 rounded-3xl px-8 py-6" style={{ ...cardStyle, border: '1px solid var(--danger-border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: '#ef4444' }}>账号安全</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            注销账号将永久删除你的账号及关联的关注、点赞、阅读历史，评论会被匿名保留。
          </p>
          <button
            type="button"
            onClick={handleDeleteAccount}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444', border: '1px solid var(--danger-border)' }}
          >
            注销账号
          </button>
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
