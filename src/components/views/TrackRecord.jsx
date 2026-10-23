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

const BIAS_COLOR = { LONG: 'var(--accent)', SHORT: 'var(--red)', NEUTRAL: '#d4a72c', COIN_FLIP: 'var(--text3)' }
const BIAS_LABEL = { COIN_FLIP: 'COIN FLIP' }
const RESULT_ICON = { correct: '✓', wrong: '✗', pending: '⏳', coin_flip: '○' }
const RESULT_LABEL = { coin_flip: 'not graded' }
const RESULT_COLOR = { correct: 'var(--accent)', wrong: 'var(--red)', pending: 'var(--text3)', coin_flip: 'var(--text3)' }

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

// ── Sales of the stance week (ruling 2026-10-22) ──
// Amsul GR deals (the benchmark is compacted CFR) dated inside the market
// week of the stance (Mon→Sun around its Thursday). Avg done price is
// volume-weighted. "Sold vs mkt +2wks" = avg done minus the composite mid two
// weeks later: positive = the desk sold above where the market went (good
// timing), negative = it would have fetched more by waiting.
const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n }
const saleDate = s => String(s.dealDate || s.deal_date || s.date || s.created_at || '').slice(0, 10)
const shiftDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function weekSales(sales, weekThu) {
  const from = shiftDays(weekThu, -3), to = shiftDays(weekThu, 3)
  const rows = (sales || []).filter(s => (s.product || '').trim().toLowerCase() === 'amsul gr' && num(s.donePrice) != null && num(s.volume) > 0)
    .filter(s => { const d = saleDate(s); return d >= from && d <= to })
  if (!rows.length) return null
  const vol = rows.reduce((a, s) => a + num(s.volume), 0)
  const avg = rows.reduce((a, s) => a + num(s.donePrice) * num(s.volume), 0) / vol
  return { avg, vol, deals: rows.length }
}
const fmtKt = v => v >= 1000 ? `${(v / 1000).toFixed(1)}kt` : `${Math.round(v)}t`

export default function TrackRecord({ scope, sales = [] }) {
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
          <p className={styles.sub}>Every stance, graded against what the market actually did (same-week composite CFR mid — Argus/Fertecon/Agrinvest as available, following 2 weeks, ±1.5% threshold; hover a mid to see which sources formed it). Avg sold = volume-weighted Amsul GR done price in the stance week; Sold vs mkt +2wks = that price minus the mid two weeks later, USD/t — positive means the desk sold above where the market went.</p>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.none}>◌ Loading…</p>}

      {!loading && record && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Tile label="Overall hit rate" value={rate(s.overall)} sub={`${frac(s.overall)} scored · ${s.pending} pending${s.coinFlips ? ` · ${s.coinFlips} coin flip${s.coinFlips === 1 ? '' : 's'}` : ''}`} />
            <Tile label="Same weeks, always LONG" value={s.baseline ? `${s.baseline.alwaysLong}%` : '—'} sub={s.baseline ? `baseline on ${s.baseline.n} scored weeks` : 'no scored weeks'} />
            <Tile label="Same weeks, always SHORT" value={s.baseline ? `${s.baseline.alwaysShort}%` : '—'} sub="the hit rate must beat the better of these two" />
            <Tile label="LONG calls" value={rate(s.byBias.LONG)} sub={frac(s.byBias.LONG)} />
            <Tile label="SHORT calls" value={rate(s.byBias.SHORT)} sub={frac(s.byBias.SHORT)} />
            <Tile label="NEUTRAL calls" value={rate(s.byBias.NEUTRAL)} sub={frac(s.byBias.NEUTRAL)} />
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
                      <th className={styles.th}>Mid then</th>
                      <th className={styles.th}>Mid +2wks</th>
                      <th className={styles.th}>Move</th>
                      <th className={styles.th}>Result</th>
                      <th className={styles.th}>Avg sold (Amsul GR)</th>
                      <th className={styles.th}>Sold vs mkt +2wks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.rows.map((r, i) => {
                      const ws = weekSales(sales, r.week)
                      const perf = ws && r.priceAfter != null ? ws.avg - r.priceAfter : null
                      return (
                      <tr key={i} className={styles.tr}>
                        <td className={styles.td}>{fmtDate(r.week)}</td>
                        <td className={styles.td} style={{ color: BIAS_COLOR[r.bias] || 'var(--text)', fontWeight: 700 }}>{BIAS_LABEL[r.bias] || r.bias}</td>
                        <td className={styles.td} title={r.srcThen || ''}>{r.priceThen != null ? r.priceThen.toFixed(0) : '—'}</td>
                        <td className={styles.td} title={r.srcAfter || ''}>{r.priceAfter != null ? r.priceAfter.toFixed(0) : '—'}</td>
                        <td className={styles.td}>{r.changePct != null ? `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1)}%` : '—'}</td>
                        <td className={styles.td} style={{ color: RESULT_COLOR[r.result] }}>{RESULT_ICON[r.result]} {RESULT_LABEL[r.result] || r.result}</td>
                        <td className={styles.td} title={ws ? `${ws.deals} deal${ws.deals === 1 ? '' : 's'}, ${Math.round(ws.vol).toLocaleString('en-US')} t` : 'no Amsul GR sales that week'}>
                          {ws ? <>{ws.avg.toFixed(1)} <span style={{ color: 'var(--text3)', fontSize: 11 }}>· {fmtKt(ws.vol)}</span></> : '—'}
                        </td>
                        <td className={styles.td} style={{ fontWeight: 700, color: perf == null ? 'var(--text3)' : perf >= 0 ? 'var(--accent)' : 'var(--red)' }} title={perf != null ? `avg done ${ws.avg.toFixed(1)} vs mid +2wks ${r.priceAfter.toFixed(1)}` : ws ? 'mid +2wks not published yet' : ''}>
                          {perf != null ? `${perf >= 0 ? '+' : ''}${perf.toFixed(1)}` : ws ? '⏳' : '—'}
                        </td>
                      </tr>
                      )
                    })}
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
