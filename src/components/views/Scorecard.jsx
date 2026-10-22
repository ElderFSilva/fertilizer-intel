import { useState, useEffect } from 'react'
import styles from './MarketData.module.css'
import { loadScorecard } from '../../scorecard.js'

// ── Indicator Scorecard (admin) ──
// Every indicator graded on the yardstick the AI stance is graded on: the
// forward 2-week CFR composite move, ±1.5%. Read each hit rate against the
// always-LONG / always-SHORT baselines on the same weeks. Recomputed on every
// load from the entered tables - nothing stored.

const STATUS_COLOR = { EARNED: 'var(--accent)', FAILED: 'var(--red)', UNPROVEN: 'var(--text3)' }
const SIG_COLOR = { SELL: 'var(--red)', HOLD: 'var(--accent)' }

const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
const fmtVal = r => {
  const v = r.now?.value
  if (v == null) return r.now?.note ? `n/a · ${r.now.note}` : 'n/a'
  if (r.unit === 'pct') return `${ordinal(v)} pct`
  if (r.unit === 'kt') return `${Math.round(v).toLocaleString('en-US')}k`
  if (r.unit === 'pts') return `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts`
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`
}
const fmtDate = v => {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00')
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: 'numeric' })
}
const pctOrDash = v => v == null ? '—' : `${v}%`

function Tile({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: 'Fraunces, serif', fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Row({ r, open, onToggle }) {
  const edge = r.rate != null && r.best != null ? r.rate - r.best : null
  return (
    <>
      <tr className={styles.tr} onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td className={styles.td}>
          <div style={{ fontWeight: 600 }}>{r.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{r.history}</div>
        </td>
        <td className={styles.td} style={{ fontWeight: 700, color: STATUS_COLOR[r.status] }}>{r.status}</td>
        <td className={styles.td}>
          {fmtVal(r)}
          {r.now?.signal && <span style={{ marginLeft: 8, color: SIG_COLOR[r.now.signal], fontWeight: 700 }}>→ {r.now.signal}</span>}
        </td>
        <td className={styles.td} style={{ fontWeight: 700 }}>{pctOrDash(r.rate)}</td>
        <td className={styles.td}>{r.n ? `${r.n} (${r.sells} sell / ${r.holds} hold)` : '0'}</td>
        <td className={styles.td}>{pctOrDash(r.baseLong)} / {pctOrDash(r.baseShort)}</td>
        <td className={styles.td} style={{ color: edge == null ? 'var(--text3)' : edge >= 5 ? 'var(--accent)' : edge < 0 ? 'var(--red)' : 'var(--text2)' }}>
          {edge == null ? '—' : `${edge >= 0 ? '+' : ''}${edge} pts`}
        </td>
        <td className={styles.td} style={{ color: 'var(--text3)', fontSize: 11 }}>{r.firstCall ? `${fmtDate(r.firstCall)} → ${fmtDate(r.lastCall)}` : '—'}</td>
      </tr>
      {open && (
        <tr className={styles.tr}>
          <td className={styles.td} colSpan={8} style={{ background: 'var(--bg)', fontSize: 12 }}>
            <div style={{ color: 'var(--text2)', marginBottom: 6 }}><b>Rule:</b> {r.rule}</div>
            {r.recent?.length ? (
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--text3)' }}>
                Last calls: {r.recent.map(c => {
                  const ok = (c.signal === 'SELL' && c.cls === 'DOWN') || (c.signal === 'HOLD' && c.cls === 'UP')
                  return <span key={c.date} style={{ marginRight: 12, color: c.cls === 'PENDING' ? 'var(--text3)' : ok ? 'var(--accent)' : 'var(--red)' }}>
                    {fmtDate(c.date)} {c.signal} → {c.move != null ? `${c.move >= 0 ? '+' : ''}${c.move.toFixed(1)}%` : 'pending'}
                  </span>
                })}
              </div>
            ) : <div style={{ color: 'var(--text3)' }}>No calls made yet.</div>}
          </td>
        </tr>
      )}
    </>
  )
}

export default function Scorecard() {
  const [sc, setSc] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try { const r = await loadScorecard(); if (active) { setSc(r); setError('') } }
      catch { if (active) setError('Could not compute the scorecard.') }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [])

  const counts = sc ? sc.rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, {}) : {}
  const b = sc?.base

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Indicator Scorecard</h1>
          <p className={styles.sub}>
            Every indicator graded on the yardstick the stance is graded on: forward {sc?.yardstick.horizonDays || 14}-day CFR composite move, ±{sc?.yardstick.thresholdPct || 1.5}%, Thursday to Thursday. A rule's SELL is correct when the market fell, HOLD when it rose. Read every hit rate against always-LONG / always-SHORT on the same weeks. Point-in-time: each week's rule sees only data up to that week.
          </p>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.none}>◌ Computing…</p>}

      {!loading && sc && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Tile label="Weeks scored" value={b.n} sub={b.n ? `${fmtDate(b.from)} → ${fmtDate(b.to)}` : 'no outcomes yet'} />
            <Tile label="Base rate UP / DOWN / FLAT" value={b.n ? `${Math.round(b.up / b.n * 100)} / ${Math.round(b.down / b.n * 100)} / ${Math.round(b.flat / b.n * 100)}%` : '—'} sub="what a coin would score" />
            <Tile label="Earned" value={counts.EARNED || 0} sub={`≥ ${sc.minWeeks} weeks, +${sc.edgePts} pts over baseline`} />
            <Tile label="Failed" value={counts.FAILED || 0} sub="below the better baseline" />
            <Tile label="Unproven" value={counts.UNPROVEN || 0} sub="too few weeks or no edge" />
            <Tile label="AI stance" value={pctOrDash(sc.stanceRow.rate)} sub={sc.stanceRow.n ? `${sc.stanceRow.n} weeks · baseline ${sc.stanceRow.baseLong}/${sc.stanceRow.baseShort}% · ${sc.stanceRow.status}` : 'no scored weeks'} />
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>◧ Indicators — click a row for the rule and its last calls</h2>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Indicator</th>
                    <th className={styles.th}>Status</th>
                    <th className={styles.th}>Now</th>
                    <th className={styles.th}>Hit rate</th>
                    <th className={styles.th}>Weeks called</th>
                    <th className={styles.th}>Baseline LONG / SHORT</th>
                    <th className={styles.th}>Edge</th>
                    <th className={styles.th}>Calls span</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.rows.map(r => <Row key={r.key} r={r} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} />)}
                  <Row r={sc.stanceRow} open={open === 'ai_stance'} onToggle={() => setOpen(open === 'ai_stance' ? null : 'ai_stance')} />
                </tbody>
              </table>
            </div>
            <p className={styles.hint} style={{ marginTop: 10 }}>
              FAILED indicators are shown to you but told to the AI as "do not use for the stance". UNPROVEN ones are passed as context only. Thresholds are the first set agreed on 2026-10-22 and are meant to be tested, not trusted.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
