import { useState, useEffect } from 'react'
import styles from './MarketData.module.css'
import { buildTrackRecord } from '../../learningLoop.js'

// ── Track Record: how right has the system's stance been? ──
// Outcomes are recomputed from the positioning log + Argus prices on every
// load — nothing stored, nothing editable, nothing to drift.

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00')
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: 'numeric' })
}

const BIAS_COLOR = { LONG: 'var(--accent)', SHORT: 'var(--red)', NEUTRAL: '#d4a72c' }
const RESULT_ICON = { correct: '✓', wrong: '✗', pending: '⏳' }
const RESULT_COLOR = { correct: 'var(--accent)', wrong: 'var(--red)', pending: 'var(--text3)' }

function Tile({ label, value, sub }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '14px 18px', flex: 1, minWidth: 150,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: 'Fraunces, serif', fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const rate = t => t.total ? `${Math.round(t.correct / t.total * 100)}%` : '—'
const frac = t => t.total ? `${t.correct}/${t.total}` : 'no data'

export default function TrackRecord({ scope }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const r = await buildTrackRecord(scope)
        if (active) { setRecord(r); setError('') }
      } catch {
        if (active) setError('Could not load the track record.')
      }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [scope])

  const s = record?.summary

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Track Record</h1>
          <p className={styles.sub}>Every stance, graded against what the market actually did (Argus CFR mid, following 2 weeks, ±1.5% threshold)</p>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.none}>◌ Loading…</p>}

      {!loading && record && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Tile label="Overall hit rate" value={rate(s.overall)} sub={`${frac(s.overall)} scored · ${s.pending} pending`} />
            <Tile label="LONG calls" value={rate(s.byBias.LONG)} sub={frac(s.byBias.LONG)} />
            <Tile label="SHORT calls" value={rate(s.byBias.SHORT)} sub={frac(s.byBias.SHORT)} />
            <Tile label="NEUTRAL calls" value={rate(s.byBias.NEUTRAL)} sub={frac(s.byBias.NEUTRAL)} />
            <Tile label="At high confidence" value={rate(s.byConf.high)} sub={frac(s.byConf.high)} />
            <Tile label="At moderate" value={rate(s.byConf.moderate)} sub={frac(s.byConf.moderate)} />
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>◧ Stance History</h2>
            {record.rows.length === 0 ? (
              <p className={styles.none}>No stances logged yet — generate a weekly analysis to start the record.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Week</th>
                      <th className={styles.th}>Call</th>
                      <th className={styles.th}>Confidence</th>
                      <th className={styles.th}>Mid then</th>
                      <th className={styles.th}>Mid +2wks</th>
                      <th className={styles.th}>Move</th>
                      <th className={styles.th}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.rows.map((r, i) => (
                      <tr key={i} className={styles.tr}>
                        <td className={styles.td}>{fmtDate(r.week)}</td>
                        <td className={styles.td} style={{ color: BIAS_COLOR[r.bias] || 'var(--text)', fontWeight: 700 }}>{r.bias}</td>
                        <td className={styles.td}>{r.confidence || '—'}</td>
                        <td className={styles.td}>{r.priceThen != null ? r.priceThen.toFixed(0) : '—'}</td>
                        <td className={styles.td}>{r.priceAfter != null ? r.priceAfter.toFixed(0) : '—'}</td>
                        <td className={styles.td}>{r.changePct != null ? `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1)}%` : '—'}</td>
                        <td className={styles.td} style={{ color: RESULT_COLOR[r.result] }}>{RESULT_ICON[r.result]} {r.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
