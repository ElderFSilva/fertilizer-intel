import { useState } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid
} from 'recharts'
import styles from './Publication.module.css'

const ARGUS_KEY = 'fertintel_argus_amsul'
const FERTECON_KEY = 'fertintel_fertecon_amsul'

function loadData(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : [] }
  catch { return [] }
}

function saveData(key, data) { localStorage.setItem(key, JSON.stringify(data)) }

function getLastThursday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day >= 4 ? day - 4 : day + 3
  const thursday = new Date(d)
  thursday.setDate(d.getDate() - diff)
  return thursday.toISOString().split('T')[0]
}

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

// Get the Monday of the week for a given date
function getWeekMonday(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return monday.toISOString().split('T')[0]
}

// Get the Thursday of the week for a given date
function getWeekThursday(dateStr) {
  const monday = getWeekMonday(dateStr)
  if (!monday) return null
  const d = new Date(monday + 'T00:00:00')
  d.setDate(d.getDate() + 3)
  return d.toISOString().split('T')[0]
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

function emptyForm() {
  return { date: getLastThursday(), argusLow: '', argusHigh: '', ferteconLow: '', ferteconHigh: '' }
}

// Build unified weekly chart data — one point per week keyed by Thursday date
function buildChartData(calls, argusData, ferteconData) {
  const weekMap = {}

  // Add argus publications — keyed by their Thursday date
  argusData.forEach(a => {
    if (!weekMap[a.date]) weekMap[a.date] = {}
    weekMap[a.date].argusAvg = Math.round((a.low + a.high) / 2)
    weekMap[a.date].argusLow = a.low
    weekMap[a.date].argusHigh = a.high
  })

  // Add fertecon publications — keyed by their Thursday date
  ferteconData.forEach(f => {
    if (!weekMap[f.date]) weekMap[f.date] = {}
    weekMap[f.date].ferteconAvg = Math.round((f.low + f.high) / 2)
  })

  // Add call data — Mon-Fri only, grouped by that week's Thursday
  const callsByWeek = {}
  calls.forEach(c => {
    const d = parseDate(c.date)
    if (d.getTime() === 0) return
    const day = d.getDay()
    if (day === 0 || day === 6) return // exclude weekends
    const thursday = getWeekThursday(c.date)
    if (!thursday) return
    const pr = c.prices?.Amsul
    if (!pr?.value) return
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

  // Sort by date and build final array
  return Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: formatDateLabel(date),
      argusAvg: data.argusAvg ?? null,
      ferteconAvg: data.ferteconAvg ?? null,
      callAvg: data.callAvg ?? null,
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

export default function ArgusView({ calls }) {
  const [argusData, setArgusData] = useState(loadData(ARGUS_KEY))
  const [ferteconData, setFerteconData] = useState(loadData(FERTECON_KEY))
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [editingDate, setEditingDate] = useState(null)

  const chartData = buildChartData(calls, argusData, ferteconData)

  // All publication dates for history table
  const allDates = [...new Set([...argusData.map(a => a.date), ...ferteconData.map(f => f.date)])]
    .sort((a, b) => b.localeCompare(a))

  function handleSave() {
    if (!form.date) { setError('Date is required.'); return }
    const hasArgus = form.argusLow || form.argusHigh
    const hasFertecon = form.ferteconLow || form.ferteconHigh
    if (!hasArgus && !hasFertecon) { setError('Enter at least one publication price.'); return }

    let updatedArgus = [...argusData]
    let updatedFertecon = [...ferteconData]

    if (hasArgus) {
      const low = parseFloat(form.argusLow), high = parseFloat(form.argusHigh)
      if (isNaN(low) || isNaN(high)) { setError('Argus prices must be numbers.'); return }
      if (low > high) { setError('Argus low must be ≤ high.'); return }
      const existing = updatedArgus.findIndex(a => a.date === form.date)
      if (existing >= 0) updatedArgus[existing] = { date: form.date, low, high }
      else updatedArgus = [...updatedArgus, { date: form.date, low, high }].sort((a, b) => a.date.localeCompare(b.date))
      saveData(ARGUS_KEY, updatedArgus)
      setArgusData(updatedArgus)
    }

    if (hasFertecon) {
      const low = parseFloat(form.ferteconLow), high = parseFloat(form.ferteconHigh)
      if (isNaN(low) || isNaN(high)) { setError('Fertecon prices must be numbers.'); return }
      if (low > high) { setError('Fertecon low must be ≤ high.'); return }
      const existing = updatedFertecon.findIndex(f => f.date === form.date)
      if (existing >= 0) updatedFertecon[existing] = { date: form.date, low, high }
      else updatedFertecon = [...updatedFertecon, { date: form.date, low, high }].sort((a, b) => a.date.localeCompare(b.date))
      saveData(FERTECON_KEY, updatedFertecon)
      setFerteconData(updatedFertecon)
    }

    setForm(emptyForm())
    setEditingDate(null)
    setError('')
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function startEdit(date) {
    const argus = argusData.find(a => a.date === date)
    const fertecon = ferteconData.find(f => f.date === date)
    setForm({
      date,
      argusLow: argus ? String(argus.low) : '',
      argusHigh: argus ? String(argus.high) : '',
      ferteconLow: fertecon ? String(fertecon.low) : '',
      ferteconHigh: fertecon ? String(fertecon.high) : '',
    })
    setEditingDate(date)
    setError('')
  }

  function handleDelete(date) {
    const ua = argusData.filter(a => a.date !== date)
    const uf = ferteconData.filter(f => f.date !== date)
    saveData(ARGUS_KEY, ua); saveData(FERTECON_KEY, uf)
    setArgusData(ua); setFerteconData(uf)
  }

  function cancelEdit() { setForm(emptyForm()); setEditingDate(null); setError('') }

  // For history table — get aggregated call stats per publication week
  function getCallStatsForDate(date) {
    const thursday = getWeekThursday(date) || date
    const entry = chartData.find(d => d.date === thursday)
    return entry || null
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Publication vs Mrkt</h1>
          <p className={styles.sub}>Amsul CFR Brazil — Argus & Fertecon vs call data</p>
        </div>
      </header>

      {/* Entry form */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{editingDate ? '✎ Edit Publication' : '⊕ Add Weekly Publication'}</h2>
        <div className={styles.formWrap}>
          <div className={styles.formDate}>
            <label className={styles.label}>Publication Date (Thursday)</label>
            <input type="date" className={styles.input} value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className={styles.pubBlock}>
            <div className={styles.pubLabel}>
              <span className={styles.pubDot} style={{ background: '#60b8f0' }} />
              Argus CFR Brazil
            </div>
            <div className={styles.pubFields}>
              <div className={styles.formField}>
                <label className={styles.label}>Low</label>
                <input className={styles.input} placeholder="e.g. 250" value={form.argusLow}
                  onChange={e => setForm(f => ({ ...f, argusLow: e.target.value }))} />
              </div>
              <div className={styles.formField}>
                <label className={styles.label}>High</label>
                <input className={styles.input} placeholder="e.g. 260" value={form.argusHigh}
                  onChange={e => setForm(f => ({ ...f, argusHigh: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className={styles.pubBlock}>
            <div className={styles.pubLabel}>
              <span className={styles.pubDot} style={{ background: '#b860f0' }} />
              Fertecon CFR Brazil
            </div>
            <div className={styles.pubFields}>
              <div className={styles.formField}>
                <label className={styles.label}>Low</label>
                <input className={styles.input} placeholder="e.g. 252" value={form.ferteconLow}
                  onChange={e => setForm(f => ({ ...f, ferteconLow: e.target.value }))} />
              </div>
              <div className={styles.formField}>
                <label className={styles.label}>High</label>
                <input className={styles.input} placeholder="e.g. 262" value={form.ferteconHigh}
                  onChange={e => setForm(f => ({ ...f, ferteconHigh: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className={styles.formActions}>
            {editingDate && <button className={styles.cancelBtn} onClick={cancelEdit}>Cancel</button>}
            <button className={styles.saveBtn} onClick={handleSave}>
              {editingDate ? '◈ Update' : '◈ Save'}
            </button>
          </div>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {saved && <p className={styles.success}>✓ Saved successfully!</p>}
      </section>

      {/* Chart */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◎ Amsul CFR Brazil — Publication vs Market</h2>
        {chartData.length < 2 ? (
          <div className={styles.noData}>
            <p>Add at least 2 weekly publications to see the chart.</p>
          </div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text3)', fontSize: 11 }}
                  interval={0}
                />
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)', paddingTop: 12 }} />
                {/* Argus & Fertecon — visible dashed lines, no dots */}
                <Line type="monotone" dataKey="argusAvg" stroke="#60b8f0" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 5, fill: '#60b8f0' }} name="Argus Avg" connectNulls />
                <Line type="monotone" dataKey="ferteconAvg" stroke="#b860f0" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 5, fill: '#b860f0' }} name="Fertecon Avg" connectNulls />
                {/* Lowest & Highest — tooltip only, invisible */}
                <Line type="monotone" dataKey="lowestPrice" stroke="transparent" strokeWidth={0} dot={false} legendType="none" name="Lowest Price" connectNulls />
                <Line type="monotone" dataKey="highestPrice" stroke="transparent" strokeWidth={0} dot={false} legendType="none" name="Highest Price" connectNulls />
                {/* Call Average — main solid line */}
                <Line type="monotone" dataKey="callAvg" stroke="#c8f060" strokeWidth={2.5} dot={{ r: 5, fill: '#c8f060' }} name="Call Average" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* History table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◧ Publication History</h2>
        {allDates.length === 0 ? (
          <p className={styles.none}>No publications entered yet.</p>
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
                <th className={styles.th} style={{ color: 'var(--amber)' }}>Lowest</th>
                <th className={styles.th} style={{ color: 'var(--red)' }}>Highest</th>
                <th className={styles.th}></th>
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
                    <td className={styles.td} style={{ color: 'var(--amber)' }}>{stats?.lowestPrice ?? '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--red)' }}>{stats?.highestPrice ?? '—'}</td>
                    <td className={styles.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className={styles.editBtn} onClick={() => startEdit(date)}>✎</button>
                        <button className={styles.deleteBtn} onClick={() => handleDelete(date)}>⊗</button>
                      </div>
                    </td>
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
