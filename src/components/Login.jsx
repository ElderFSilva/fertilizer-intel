import { useState } from 'react'
import styles from './Login.module.css'

// Simple hardcoded password — change this before deploying
const TEAM_PASSWORD = 'fertintel2025'

export default function Login({ onLogin }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (pw === TEAM_PASSWORD) {
      onLogin()
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 500)
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
            type="password"
            placeholder="Team password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(false) }}
            className={`${styles.input} ${error ? styles.inputError : ''}`}
            autoFocus
          />
          {error && <p className={styles.err}>Incorrect password</p>}
          <button type="submit" className={styles.btn}>Enter →</button>
        </form>
      </div>
    </div>
  )
}
