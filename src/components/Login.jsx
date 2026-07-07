import { useState } from 'react'
import styles from './Login.module.css'
import { signIn } from '../supabaseClient.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      await signIn(email.trim(), pw)
      // On success, App's auth listener swaps to the Dashboard automatically.
    } catch (err) {
      setError(err?.message === 'Invalid login credentials'
        ? 'Incorrect email or password'
        : (err?.message || 'Could not sign in'))
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.grid} />
      <div className={`${styles.card} ${shake ? styles.shake : ''}`}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>⬡</span>
          <span className={styles.logoText}>FertIntel</span>
        </div>
        <p className={styles.sub}>Market Intelligence Platform</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            autoFocus
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError('') }}
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            autoComplete="current-password"
          />
          {error && <p className={styles.err}>{error}</p>}
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Enter →'}
          </button>
        </form>
      </div>
    </div>
  )
}
