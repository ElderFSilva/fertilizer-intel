import { useState, useEffect } from 'react'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'
import Operations from './components/Operations.jsx'
import { supabase, getProfile, signOut } from './supabaseClient.js'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  // Admin works in two environments; remember the last one used on this device.
  const [env, setEnv] = useState(() => {
    try { return localStorage.getItem('fertintel_env') === 'ops' ? 'ops' : 'trading' } catch { return 'trading' }
  })
  function switchEnv(next) {
    setEnv(next)
    try { localStorage.setItem('fertintel_env', next) } catch {}
  }

  // On load, check for an existing session and subscribe to auth changes
  useEffect(() => {
    let active = true

    async function loadProfile(sess) {
      if (!sess) { setProfile(null); return }
      try {
        const p = await getProfile(sess.user.id)
        if (active) setProfile(p)
      } catch {
        if (active) setProfile(null)
      }
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session)
      if (active) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      if (!active) return
      setSession(sess)
      await loadProfile(sess)
    })

    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  async function handleLogout() {
    await signOut()
    setSession(null)
    setProfile(null)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #0e0f0c)', color: 'var(--text3, #888)', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>
        ◌ Loading…
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  const role = profile?.role || 'trader'

  // Ops logins see Operations only. Admin switches between the two.
  if (role === 'ops' || (role === 'admin' && env === 'ops')) {
    return (
      <Operations
        onLogout={handleLogout}
        role={role}
        onSwitchEnv={role === 'admin' ? switchEnv : null}
      />
    )
  }

  return (
    <Dashboard
      onLogout={handleLogout}
      user={session.user}
      profile={profile}
      role={role}
      onSwitchEnv={role === 'admin' ? switchEnv : null}
    />
  )
}
