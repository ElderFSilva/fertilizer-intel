import { useState, useRef, useEffect } from 'react'
import styles from './MarketData.module.css'
import { askAdvisor } from '../../deskAdvisor.js'

// ── Ask the Desk: admin-only advisor chat ──
// Grounded in the same computed context as the weekly analysis.
// Advises only; every Q&A is logged to advisor_log.

const SUGGESTIONS = [
  'Should we sell at 220 today?',
  'How does our replacement cost compare to the market right now?',
  'Which clients should we call this week and why?',
  'Is the current Amsul premium vs urea a risk?',
]

export default function Advisor({ role, calls, sales, scope }) {
  const isAdmin = role === 'admin'
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setError('')
    setInput('')
    const history = messages
    setMessages(m => [...m, { role: 'user', content: q }])
    setBusy(true)
    try {
      const answer = await askAdvisor(q, history, calls, sales, scope)
      setMessages(m => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      setError('The advisor could not answer — try again in a moment.')
      setMessages(m => m.slice(0, -1))
      setInput(q)
    }
    setBusy(false)
  }

  if (!isAdmin) {
    return (
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Ask the Desk</h1>
            <p className={styles.sub}>Admin-only advisor</p>
          </div>
        </header>
        <p className={styles.none}>This view is available to the admin account only.</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap} style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Ask the Desk</h1>
          <p className={styles.sub}>Answers grounded in the live signals, your calls & sales, the track record and desk lessons · advises only · every Q&A is logged</p>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 2px' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <p className={styles.none}>Ask anything the desk data can answer. For example:</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SUGGESTIONS.map(sug => (
                <button key={sug} className={styles.tab} onClick={() => send(sug)} disabled={busy}>
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '82%',
            background: m.role === 'user' ? 'var(--accent)' : 'var(--bg2)',
            color: m.role === 'user' ? '#0e0f0c' : 'var(--text)',
            border: m.role === 'user' ? 'none' : '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 14,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}>
            {m.content}
          </div>
        ))}

        {busy && (
          <div style={{
            alignSelf: 'flex-start', background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '12px 16px', fontSize: 14, color: 'var(--text3)',
            fontFamily: "'DM Mono', monospace",
          }}>
            ◌ reading the desk data…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <input
          className={styles.input}
          style={{ flex: 1 }}
          placeholder="Ask the desk… (Enter to send)"
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className={styles.saveBtn} onClick={() => send()} disabled={busy || !input.trim()}>
          {busy ? '…' : '❯ Ask'}
        </button>
      </div>
    </div>
  )
}
