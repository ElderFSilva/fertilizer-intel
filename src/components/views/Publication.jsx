import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts'
import styles from './Publication.module.css'
import { cloudLoadBenchmarkFromIntl } from '../../cloudData.js'

function formatDateLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  return new Date(0)
}

function toLocalYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getWeekMonday(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return toLocalYMD(monday)
}

function getWeekThursday(dateStr) {
  const monday = getWeekMonday(dateStr)
  if (!monday) return null
  const d = new Date(monday + 'T00:00:00')
  d.setDate(d.getDate() + 3)
  return toLocalYMD(d)
}

function parsePrice(val) {
  if (!val) return null
  const raw = String(val).replace(/[^0-9.\-]/g, '')
  if (raw.includes('-')) {
    const parts = raw.split('-').map(Number).filter(n => !isNaN(n))
    return parts.length === 2 ? (parts[0] + parts[1]) / 2 : null
  }
  const p = parseFloat(raw)
  return isNaN(p) ? null : p
}

function buildChartData(calls, sales, argusData, ferteconData) {
  const weekMap = {}

  argusData.forEach(a => {
    if (!weekMap[a.date]) weekMap[a.date] = {}
    weekMap[a.date].argusAvg = Math.round((a.low + a.high) / 2)
    weekMap[a.date].argusLow = a.low
    weekMap[a.date].argusHigh = a.high
  })

  ferteconData.forEach(f => {
    if (!weekMap[f.date]) weekMap[f.date] = {}
    weekMap[f.date].ferteconAvg = Math.round((f.low + f.high) / 2)
  })

  const callsByWeek = {}
  calls.forEach(c => {
    const d = parseDate(c.date)
    if (d.getTime() === 0) return
    const day = d.getDay()
    if (day === 0 || day === 6) return
    const thursday = getWeekThursday(c.date)
    if (!thursday) return
    const pr = c.prices?.Amsul
    if (!pr?.value) return
    const grade = pr.grade || 'Amsul GR'
    if (grade !== 'Amsul GR') return
    const price = parsePrice(pr.value)
    if (!price) return
    if (!callsByWeek[thursday]) callsByWeek[thursday] = []
    callsByWeek[thursday].push(price)
  })

  Object.entries(callsByWeek).forEach(([thursday, prices]) => {
    if (!weekMap[thursday]) weekMap[thursday] = {}
    weekMap[thursday].callAvg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    weekMap[thursday].lowestPrice = Math.min(...prices)
    weekMap[thursday].highestPrice = Math.max(...prices)
  })

  // Sales performed: weekly average of DONE prices for Amsul GR, bucketed by
  // the deal date (falls back to created_at for legacy sales without one) so
  // it lines up with the same Thursday-keyed weeks as calls and publications.
  const salesByWeek = {}
  ;(sales || []).forEach(s => {
    if ((s.product || '') !== 'Amsul GR') return
    const when = s.date || (s.created_at ? String(s.created_at).slice(0, 10) : null)
    if (!when) return
    const thursday = getWeekThursday(when)
    if (!thursday) return
    const price = parsePrice(s.donePrice)
    if (!price) return
    if (!salesByWeek[thursday]) salesByWeek[thursday] = []
    salesByWeek[thursday].push(price)
  })

  Object.entries(salesByWeek).forEach(([thursday, prices]) => {
    if (!weekMap[thursday]) weekMap[thursday] = {}
    weekMap[thursday].salesAvg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
  })

  return Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: formatDateLabel(date),
      argusAvg: data.argusAvg ?? null,
      ferteconAvg: data.ferteconAvg ?? null,
      callAvg: data.callAvg ?? null,
      salesAvg: data.salesAvg ?? null,
      lowestPrice: data.lowestPrice ?? null,
      highestPrice: data.highestPrice ?? null,
    }))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <p style={{ color: 'var(--text)', marginBottom: 6, fontFamily: 'DM Mono', fontSize: 11 }}>{label}</p>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  )
}

export default function ArgusView({ calls, sales = [] }) {
  const [argusData, setArgusData] = useState([])
  const [ferteconData, setFerteconData] = useState([])
  const [error, setError] = useState('')

  // Load shared publications from the cloud on mount
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { argus, fertecon } = await cloudLoadBenchmarkFromIntl()
        if (active) { setArgusData(argus); setFerteconData(fertecon) }
      } catch {
        if (active) setError('Could not load publications.')
      }
    })()
    return () => { active = false }
  }, [])

  const fullChartData = buildChartData(calls, sales, argusData, ferteconData)
  // Rolling window: last 8 weeks only (full history lives in Market Data -> Intl Prices)
  const cutoff = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 8 * 7)
    return toLocalYMD(d)
  })()
  const chartData = fullChartData.filter(r => r.date >= cutoff)

  // CURRENT week's weekly average per series, shown in the single top legend.
  // Never "the most recent week that printed one": a series with nothing this
  // week shows no number, rather than a stale figure under this week's label.
  const currentThursday = (() => {
    const now = new Date()
    const day = now.getDay()
    const mon = new Date(now)
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    mon.setDate(mon.getDate() + 3)
    return toLocalYMD(mon)
  })()
  const currentWeekRow = chartData.find(r => r.date === currentThursday) || null
  const currentWeekLabel = (() => {
    const th = new Date(currentThursday + 'T00:00:00')
    if (isNaN(th.getTime())) return currentThursday
    const mon = new Date(th); mon.setDate(th.getDate() - 3)
    const fri = new Date(th); fri.setDate(th.getDate() + 1)
    const m1 = mon.toLocaleDateString('en-US', { month: 'short' })
    const m2 = fri.toLocaleDateString('en-US', { month: 'short' })
    return mon.getMonth() === fri.getMonth()
      ? `${m1} ${mon.getDate()}\u2013${fri.getDate()}, ${fri.getFullYear()}`
      : `${m1} ${mon.getDate()} \u2013 ${m2} ${fri.getDate()}, ${fri.getFullYear()}`
  })()
  const latestOf = key => (currentWeekRow && currentWeekRow[key] != null) ? currentWeekRow[key] : null
  const LEGEND = [
    { key: 'argusAvg', color: '#60b8f0', dash: true, name: 'Argus Avg' },
    { key: 'ferteconAvg', color: '#b860f0', dash: true, name: 'Fertecon Avg' },
    { key: 'callAvg', color: '#c8f060', dash: false, name: 'Call Average' },
    { key: 'salesAvg', color: '#ffd60a', dash: false, name: 'Sales Avg (done)' },
  ]

  const allDates = [...new Set([...argusData.map(a => a.date), ...ferteconData.map(f => f.date)])]
    .filter(d => d >= cutoff)
    .sort((a, b) => b.localeCompare(a))


  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Publication vs Mrkt</h1>
          <p className={styles.sub}>Amsul CFR Brazil — Argus & Fertecon vs call data</p>
        </div>
      </header>

      <p className={styles.sub} style={{ marginTop: -8 }}>
        Prices are sourced from Market Data → Intl Prices (Amsul CFR Brazil, compacted — Argus & Fertecon). Enter or edit them there.
      </p>
      {error && <p className={styles.error}>{error}</p>}

      {/* Chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◎ Amsul CFR Brazil — Publication vs Market</h2>
        {chartData.length < 2 ? (
          <div className={styles.noData}>
            <p>Not enough publication data yet — add weekly prices in Market Data → Intl Prices.</p>
          </div>
        ) : (
          <div className={styles.chartWrap}>
            <div style={{ fontSize: 11, color: 'var(--text3)', margin: '0 0 6px 6px' }}>
              Values shown are the weekly average for the week of {currentWeekLabel}
            </div>
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', margin: '0 0 12px 6px' }}>
              {LEGEND.map(l => (
                <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text2)' }}>
                  <span style={{ width: 20, borderTop: `2.5px ${l.dash ? 'dashed' : 'solid'} ${l.color}` }} />
                  {l.name}{latestOf(l.key) != null && <b style={{ color: l.color }}>{latestOf(l.key)}</b>}
                </span>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--text3)', fontSize: 11 }} interval={0} />
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} domain={[100, 300]} ticks={[100, 150, 200, 250, 300]} allowDataOverflow />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="argusAvg" stroke="#60b8f0" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 5, fill: '#60b8f0' }} name="Argus Avg" connectNulls />
                <Line type="monotone" dataKey="ferteconAvg" stroke="#b860f0" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 5, fill: '#b860f0' }} name="Fertecon Avg" connectNulls />
                <Line type="monotone" dataKey="lowestPrice" stroke="transparent" strokeWidth={0} dot={false} legendType="none" name="Lowest Price" connectNulls />
                <Line type="monotone" dataKey="highestPrice" stroke="transparent" strokeWidth={0} dot={false} legendType="none" name="Highest Price" connectNulls />
                <Line type="monotone" dataKey="callAvg" stroke="#c8f060" strokeWidth={2.5} dot={{ r: 5, fill: '#c8f060' }} name="Call Average" connectNulls />
                <Line type="monotone" dataKey="salesAvg" stroke="#ffd60a" strokeWidth={2.5} dot={{ r: 5, fill: '#ffd60a' }} name="Sales Avg (done)" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* History table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◧ Publication History</h2>
        {allDates.length === 0 ? (
          <p className={styles.none}>No publication prices found — enter them in Market Data → Intl Prices.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th} style={{ color: '#60b8f0' }}>Argus Low</th>
                <th className={styles.th} style={{ color: '#60b8f0' }}>Argus High</th>
                <th className={styles.th} style={{ color: '#60b8f0' }}>Argus Avg</th>
                <th className={styles.th} style={{ color: '#b860f0' }}>Fertecon Low</th>
                <th className={styles.th} style={{ color: '#b860f0' }}>Fertecon High</th>
                <th className={styles.th} style={{ color: '#b860f0' }}>Fertecon Avg</th>
                <th className={styles.th} style={{ color: 'var(--accent)' }}>Call Avg</th>
                <th className={styles.th} style={{ color: '#ffd60a' }}>Sales Avg</th>
                <th className={styles.th} style={{ color: 'var(--amber)' }}>Lowest</th>
                <th className={styles.th} style={{ color: 'var(--red)' }}>Highest</th>
              </tr>
            </thead>
            <tbody>
              {allDates.map(date => {
                const argus = argusData.find(a => a.date === date)
                const fertecon = ferteconData.find(f => f.date === date)
                const stats = chartData.find(d => d.date === date)
                return (
                  <tr key={date} className={styles.tr}>
                    <td className={styles.td}>{formatDateLabel(date)}</td>
                    <td className={styles.td} style={{ color: '#60b8f0' }}>{argus?.low ?? '—'}</td>
                    <td className={styles.td} style={{ color: '#60b8f0' }}>{argus?.high ?? '—'}</td>
                    <td className={styles.td} style={{ color: '#60b8f0' }}>{argus ? Math.round((argus.low + argus.high) / 2) : '—'}</td>
                    <td className={styles.td} style={{ color: '#b860f0' }}>{fertecon?.low ?? '—'}</td>
                    <td className={styles.td} style={{ color: '#b860f0' }}>{fertecon?.high ?? '—'}</td>
                    <td className={styles.td} style={{ color: '#b860f0' }}>{fertecon ? Math.round((fertecon.low + fertecon.high) / 2) : '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--accent)' }}>{stats?.callAvg ?? '—'}</td>
                    <td className={styles.td} style={{ color: '#ffd60a' }}>{stats?.salesAvg ?? '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--amber)' }}>{stats?.lowestPrice ?? '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--red)' }}>{stats?.highestPrice ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
