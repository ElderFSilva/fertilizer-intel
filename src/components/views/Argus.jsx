import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid
} from 'recharts'
import styles from './Argus.module.css'

const STORAGE_KEY = 'fertintel_argus_amsul'

function loadArgusData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveArgusData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function getThisThursday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day <= 4 ? 4 - day : 4 - day + 7
  const thursday = new Date(d)
  thursday.setDate(d.getDate() - (day === 4 ? 0 : day < 4 ? day - 4 + 7 : day - 4))
  // Just use last thursday
  const lastThursday = new Date(d)
  lastThursday.setDate(d.getDate() - ((d.getDay() + 3) % 7))
  return lastThursday.toISOString().split('T')[0]
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

// Get week start (Monday) for a given date
function getWeekKey(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return monday.toISOString().split('T')[0]
}

// Build weekly call stats for Amsul
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

function buildCallWeeklyStats(calls) {
  const weeks = {}
  calls.forEach(c => {
    const week = getWeekKey(c.date)
    if (!week) return
    const pr = c.prices?.Amsul
    if (!pr?.value) return
    const price = parsePrice(pr.value)
    if (!price) return
    if (!weeks[week]) weeks[week] = { prices: [] }
    weeks[week].prices.push(price)
  })

  return Object.entries(weeks).map(([week, data]) => ({
    week,
    callAvg: data.prices.length ? Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length) : null,
    lowestPrice: data.prices.length ? Math.min(...data.prices) : null,
    highestPrice: data.prices.length ? Math.max(...data.prices) : null,
  }))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <p style={{ color: 'var(--text)', marginBottom: 6, fontFamily: 'DM Mono', fontSize: 11 }}>{label}</p>
      {payload.map((p, i) => (
        p.value != null && (
          <div key={i} style={{ color: p.color, marginBottom: 2 }}>
            {p.name}: <strong>{p.value}</strong>
          </div>
        )
      ))}
    </div>
  )
}

export default function Argus({ calls }) {
  const [argusData, setArgusData] = useState(loadArgusData())
  const [form, setForm] = useState({ date: getThisThursday(), low: '', high: '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const callStats = buildCallWeeklyStats(calls)

  // Merge argus + call data by week
  const allWeeks = new Set([
    ...argusData.map(a => a.date),
    ...callStats.map(c => c.week)
  ])

  const chartData = [...allWeeks]
    .sort()
    .map(week => {
      const argus = argusData.find(a => a.date === week)
      const callWeek = callStats.find(c => c.week === week)
      const argusAvg = argus ? Math.round((argus.low + argus.high) / 2) : null
      return {
        week,
        label: formatDateLabel(week),
        argusAvg,
        callAvg: callWeek?.callAvg ?? null,
        lowestPrice: callWeek?.lowestPrice ?? null,
        highestPrice: callWeek?.highestPrice ?? null,
      }
    })

  function handleSave() {
    if (!form.date) { setError('Date is required.'); return }
    if (!form.low || !form.high) { setError('Both low and high prices are required.'); return }
    const low = parseFloat(form.low)
    const high = parseFloat(form.high)
    if (isNaN(low) || isNaN(high)) { setError('Prices must be numbers.'); return }
    if (low > high) { setError('Low must be less than or equal to high.'); return }

    let updated
    if (editingId) {
      updated = argusData.map(a => a.id === editingId ? { ...a, date: form.date, low, high } : a)
      setEditingId(null)
    } else {
      // Check if date already exists
      if (argusData.find(a => a.date === form.date)) {
        setError('An entry for this date already exists. Edit the existing one.')
        return
      }
      updated = [...argusData, { id: Date.now(), date: form.date, low, high }]
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    saveArgusData(updated)
    setArgusData(updated)
    setForm({ date: getThisThursday(), low: '', high: '' })
    setError('')
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function startEdit(entry) {
    setForm({ date: entry.date, low: String(entry.low), high: String(entry.high) })
    setEditingId(entry.id)
    setError('')
  }

  function handleDelete(id) {
    const updated = argusData.filter(a => a.id !== id)
    saveArgusData(updated)
    setArgusData(updated)
  }

  function cancelEdit() {
    setForm({ date: getThisThursday(), low: '', high: '' })
    setEditingId(null)
    setError('')
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Publication vs Mrkt</h1>
          <p className={styles.sub}>Amsul CFR Brazil — Argus publication vs market call data</p>
        </div>
      </header>

      {/* Entry form */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{editingId ? '✎ Edit Entry' : '⊕ Add Argus Publication'}</h2>
        <div className={styles.form}>
          <div className={styles.formField}>
            <label className={styles.label}>Publication Date (Thursday)</label>
            <input type="date" className={styles.input} value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>Argus Low (CFR Brazil)</label>
            <input className={styles.input} placeholder="e.g. 250" value={form.low}
              onChange={e => setForm(f => ({ ...f, low: e.target.value }))} />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>Argus High (CFR Brazil)</label>
            <input className={styles.input} placeholder="e.g. 260" value={form.high}
              onChange={e => setForm(f => ({ ...f, high: e.target.value }))} />
          </div>
          <div className={styles.formActions}>
            {editingId && <button className={styles.cancelBtn} onClick={cancelEdit}>Cancel</button>}
            <button className={styles.saveBtn} onClick={handleSave}>
              {editingId ? '◈ Update' : '◈ Save'}
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
            <p>Add at least 2 Argus publications to see the chart.</p>
          </div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--text3)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)', paddingTop: 12 }} />
                <Line type="monotone" dataKey="argusAvg" stroke="#60b8f0" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 5, fill: '#60b8f0' }} name="Argus Avg (Low/High)" connectNulls />
                <Line type="monotone" dataKey="callAvg" stroke="#c8f060" strokeWidth={2} dot={{ r: 4, fill: '#c8f060' }} name="Call Average" connectNulls />
                <Line type="monotone" dataKey="lowestPrice" stroke="#f0b840" strokeWidth={2} dot={{ r: 4, fill: '#f0b840' }} name="Lowest Price" connectNulls />
                <Line type="monotone" dataKey="highestPrice" stroke="#ff6b5b" strokeWidth={2} dot={{ r: 4, fill: '#ff6b5b' }} name="Highest Price" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Argus entries table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◧ Argus Publication History</h2>
        {argusData.length === 0 ? (
          <p className={styles.none}>No publications entered yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Argus Low</th>
                <th className={styles.th}>Argus High</th>
                <th className={styles.th}>Mid</th>
                <th className={styles.th}>Call Avg</th>
                <th className={styles.th}>Lowest Price</th>
                <th className={styles.th}>Highest Price</th>
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {[...argusData].sort((a, b) => b.date.localeCompare(a.date)).map(entry => {
                const week = getWeekKey(entry.date) || entry.date
                const callWeek = callStats.find(c => c.week === week)
                return (
                  <tr key={entry.id} className={styles.tr}>
                    <td className={styles.td} style={{ fontFamily: 'DM Mono', fontSize: 12 }}>{formatDateLabel(entry.date)}</td>
                    <td className={styles.td} style={{ color: 'var(--blue)' }}>{entry.low}</td>
                    <td className={styles.td} style={{ color: 'var(--blue)' }}>{entry.high}</td>
                    <td className={styles.td} style={{ color: 'var(--text2)' }}>{Math.round((entry.low + entry.high) / 2)}</td>
                    <td className={styles.td} style={{ color: 'var(--accent)' }}>{callWeek?.callAvg ?? '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--amber)' }}>{callWeek?.lowestPrice ?? '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--red)' }}>{callWeek?.highestPrice ?? '—'}</td>
                    <td className={styles.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className={styles.editBtn} onClick={() => startEdit(entry)}>✎</button>
                        <button className={styles.deleteBtn} onClick={() => handleDelete(entry.id)}>⊗</button>
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
