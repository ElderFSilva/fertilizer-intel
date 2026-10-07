// ── History: price and premium against their own history, with every graded
// stance on the price line. Display only - see Market Signals for the stance.
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ReferenceArea,
} from 'recharts'
import { buildHistory, addDays, GRADE_BAND_PCT, GRADE_HORIZON_DAYS } from '../../history.js'
import styles from './History.module.css'

const C = {
  cfr: '#60b8f0', fob: '#b860f0', repl: '#f0b840',
  correct: '#c8f060', wrong: '#ff6b5b', pending: '#9a9b93',
  band: '#5a5b54', text: '#e8e9e2', text2: '#9a9b93', text3: '#5a5b54', border: '#2a2b26',
}
const RANGES = [{ k: '1y', d: 365 }, { k: '2y', d: 730 }, { k: 'all', d: null }]
const fmt1 = v => v == null ? '—' : Number(v).toFixed(1)
const fmt0 = v => v == null ? '—' : Math.round(Number(v)).toString()
const label = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
const dLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function cutoff(days) {
  if (!days) return '0000-00-00'
  return addDays(new Date().toISOString().slice(0, 10), -days)
}

// ▲ LONG · ■ NEUTRAL · ▼ SHORT, coloured by grading result; the shape carries
// the bias so identity is never colour alone.
function StanceShape({ cx, cy, payload }) {
  const s = payload?.stance
  if (!s || cx == null || cy == null) return null
  const col = s.result === 'correct' ? C.correct : s.result === 'wrong' ? C.wrong : C.pending
  const r = 6
  if (s.bias === 'LONG') return <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} fill={col} stroke="#0e0f0c" strokeWidth={1.5} />
  if (s.bias === 'SHORT') return <polygon points={`${cx},${cy + r} ${cx - r},${cy - r} ${cx + r},${cy - r}`} fill={col} stroke="#0e0f0c" strokeWidth={1.5} />
  return <rect x={cx - r + 1} y={cy - r + 1} width={2 * r - 2} height={2 * r - 2} fill={col} stroke="#0e0f0c" strokeWidth={1.5} />
}

function PriceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const s = p.stance
  return (
    <div className={styles.tip}>
      <div className={styles.tipDate}>{dLabel(p.date)}</div>
      <div><span className={styles.tipKey} style={{ color: C.cfr }}>CFR Argus</span> {fmt1(p.cfr)}</div>
      {p.fob != null && <div><span className={styles.tipKey} style={{ color: C.fob }}>FOB China</span> {fmt1(p.fob)}</div>}
      {p.repl != null && <div><span className={styles.tipKey} style={{ color: C.repl }}>Replacement</span> {fmt1(p.repl)}</div>}
      {s && (
        <div className={styles.tipStance}>
          <b>{s.bias}</b> · {s.confidence || '—'} · <span style={{ color: s.result === 'correct' ? C.correct : s.result === 'wrong' ? C.wrong : C.pending }}>{s.result}</span>
          <div>then {fmt1(s.priceThen)} → after {GRADE_HORIZON_DAYS}d {fmt1(s.priceAfter)} ({s.changePct == null ? 'pending' : `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(1)}%`})</div>
        </div>
      )}
    </div>
  )
}

function PremTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className={styles.tip}>
      <div className={styles.tipDate}>{dLabel(p.date)}</div>
      <div><span className={styles.tipKey} style={{ color: C.cfr }}>Premium / unit N</span> {p.prem >= 0 ? '+' : ''}{fmt1(p.prem)}%</div>
    </div>
  )
}

export default function History({ load = buildHistory }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState('2y')
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    let on = true
    load().then(d => { if (on) setData(d) }).catch(() => { if (on) setError('Could not load history from the cloud.') })
    return () => { on = false }
  }, [])

  const from = cutoff(RANGES.find(r => r.k === range)?.d)
  // stanceY carries the marker on the SAME rows as the line, so the x-axis keeps every week
  const rows = useMemo(() => (data?.rows || []).filter(r => r.date >= from).map(r => ({ ...r, stanceY: r.stance ? r.stance.priceThen : null })), [data, from])
  const prem = useMemo(() => (data?.prem || []).filter(r => r.date >= from), [data, from])
  const stanceRows = rows.filter(r => r.stance)

  if (error) return <div className={styles.wrap}><p className={styles.error}>{error}</p></div>
  if (!data) return <div className={styles.wrap}><p className={styles.none}>◌ Loading history…</p></div>

  const b = data.cfrBands
  const pb = data.premBands
  // Y domain: data in range plus the bands, with a little air
  const yVals = [...rows.map(r => r.cfr), ...(overlay ? rows.flatMap(r => [r.fob, r.repl]) : []), b?.p90, b?.p25].filter(v => v != null)
  const yMin = Math.floor((Math.min(...yVals) - 10) / 10) * 10
  const yMax = Math.ceil((Math.max(...yVals) + 10) / 10) * 10
  const pVals = [...prem.map(p => p.prem), pb?.p90, pb?.p50].filter(v => v != null)
  const pMin = Math.floor(Math.min(...pVals) - 2), pMax = Math.ceil(Math.max(...pVals) + 2)
  const tickEvery = Math.max(1, Math.round(rows.length / 10))

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>History</h1>
          <p className={styles.sub}>Display of computed history — see Market Signals for the stance. Bands are over the full record regardless of range.</p>
        </div>
        <div className={styles.controls}>
          {RANGES.map(r => (
            <button key={r.k} className={`${styles.rangeBtn} ${range === r.k ? styles.rangeOn : ''}`} onClick={() => setRange(r.k)}>{r.k}</button>
          ))}
          <label className={styles.toggle}>
            <input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} /> FOB &amp; replacement
          </label>
        </div>
      </header>

      {/* Chart 1 — CFR Brazil compacted vs its history, with graded stances */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>◎ Amsul CFR Brazil compacted (Argus weekly mid)</h2>
          {data.cfrNow && (
            <div className={styles.now}>
              <span className={styles.nowVal}>{fmt1(data.cfrNow.mid)}</span>
              <span className={styles.nowSub}>{data.cfrNow.pct}th pct of {b?.n} weeks · {dLabel(data.cfrNow.date)}</span>
            </div>
          )}
        </div>
        <div className={styles.legend}>
          <span><i className={styles.sw} style={{ background: C.cfr }} /> CFR Argus mid</span>
          {overlay && <span><i className={styles.sw} style={{ background: C.fob }} /> FOB China compacted composite</span>}
          {overlay && <span><i className={styles.swDash} style={{ borderColor: C.repl }} /> Replacement (FOB + desk freight {fmt0(data.freight)})</span>}
          <span><i className={styles.swDash} style={{ borderColor: C.band }} /> P25 · median · P75 · P90</span>
          <span>▲ LONG ■ NEUTRAL ▼ SHORT — <i style={{ color: C.correct }}>correct</i> / <i style={{ color: C.wrong }}>wrong</i> / <i style={{ color: C.pending }}>pending</i>; box = ±{GRADE_BAND_PCT}% over {GRADE_HORIZON_DAYS}d</span>
        </div>
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={rows} margin={{ top: 10, right: 56, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="date" tickFormatter={label} interval={tickEvery - 1} tick={{ fill: C.text3, fontSize: 11 }} />
            <YAxis domain={[yMin, yMax]} tick={{ fill: C.text3, fontSize: 11 }} width={44} />
            <Tooltip content={<PriceTooltip />} />
            {b && [['p25', 'P25'], ['p50', 'median'], ['p75', 'P75'], ['p90', 'P90']].map(([k, l]) => (
              <ReferenceLine key={k} y={b[k]} stroke={C.band} strokeDasharray="4 4" label={{ value: `${l} ${fmt0(b[k])}`, position: 'right', fill: C.text3, fontSize: 10 }} />
            ))}
            {stanceRows.map(r => (
              <ReferenceArea key={r.date} x1={r.date} x2={rows.find(x => x.date >= addDays(r.date, GRADE_HORIZON_DAYS))?.date || r.date}
                y1={r.stance.priceThen * (1 - GRADE_BAND_PCT / 100)} y2={r.stance.priceThen * (1 + GRADE_BAND_PCT / 100)}
                fill={r.stance.result === 'correct' ? C.correct : r.stance.result === 'wrong' ? C.wrong : C.pending} fillOpacity={0.1} stroke="none" />
            ))}
            {overlay && <Line type="monotone" dataKey="fob" stroke={C.fob} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
            {overlay && <Line type="monotone" dataKey="repl" stroke={C.repl} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls isAnimationActive={false} />}
            <Line type="monotone" dataKey="cfr" stroke={C.cfr} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter dataKey="stanceY" shape={<StanceShape />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className={styles.note}>
          {stanceRows.length} stance{stanceRows.length === 1 ? '' : 's'} in range · graded against the same-week composite, exactly as in Track Record.
          {rows.length < 8 ? ' Few weeks in range — widen it.' : ''}
        </p>
      </section>

      {/* Chart 2 — premium per unit N */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>⊚ Amsul premium vs urea, per unit N (Argus, same date)</h2>
          {data.premNow && (
            <div className={styles.now}>
              <span className={styles.nowVal}>{data.premNow.prem >= 0 ? '+' : ''}{fmt1(data.premNow.prem)}%</span>
              <span className={styles.nowSub}>{data.premNow.pct}th pct of {pb?.n} weeks · {dLabel(data.premNow.date)}</span>
            </div>
          )}
        </div>
        <div className={styles.legend}>
          <span><i className={styles.sw} style={{ background: C.cfr }} /> premium %</span>
          <span><i className={styles.swDash} style={{ borderColor: C.band }} /> median · P75</span>
          <span><i className={styles.swDash} style={{ borderColor: C.repl }} /> P90 = substitution-caution line (rule: ≥P90 and widening)</span>
        </div>
        {prem.length < 2 ? <p className={styles.none}>No aligned Amsul/urea weeks in range.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={prem} margin={{ top: 10, right: 56, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" tickFormatter={label} interval={Math.max(0, Math.round(prem.length / 10) - 1)} tick={{ fill: C.text3, fontSize: 11 }} />
              <YAxis domain={[pMin, pMax]} tick={{ fill: C.text3, fontSize: 11 }} width={44} tickFormatter={v => `${v}%`} />
              <Tooltip content={<PremTooltip />} />
              {pb && <ReferenceLine y={pb.p50} stroke={C.band} strokeDasharray="4 4" label={{ value: `median ${fmt1(pb.p50)}%`, position: 'right', fill: C.text3, fontSize: 10 }} />}
              {pb && <ReferenceLine y={pb.p75} stroke={C.band} strokeDasharray="4 4" label={{ value: `P75 ${fmt1(pb.p75)}%`, position: 'right', fill: C.text3, fontSize: 10 }} />}
              {pb && <ReferenceLine y={pb.p90} stroke={C.repl} strokeDasharray="4 4" label={{ value: `P90 ${fmt1(pb.p90)}%`, position: 'right', fill: C.repl, fontSize: 10 }} />}
              <ReferenceLine y={0} stroke={C.text3} />
              <Line type="monotone" dataKey="prem" stroke={C.cfr} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </section>
    </div>
  )
}
