import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import styles from './PriceTrends.module.css'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) return d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dateStr
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  const natural = new Date(dateStr)
  if (!isNaN(natural.getTime())) return natural
  return new Date(0)
}

function toLocalYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// ── Grade tabs ──
const GRADE_TABS = [
  { label: 'Amsul GR', product: 'Amsul', grade: 'Amsul GR', isDefault: true },
  { label: 'Amsul STD', product: 'Amsul', grade: 'Amsul STD' },
  { label: 'Urea', product: 'Urea', grade: null },
  { label: 'MAP', product: 'MAP', grade: null },
  { label: 'SSP 20%', product: 'SSP', grade: 'SSP 20%', isDefault: true },
  { label: 'SSP 19%', product: 'SSP', grade: 'SSP 19%' },
  { label: 'TSP 45%', product: 'TSP', grade: 'TSP 45%', isDefault: true },
  { label: 'TSP 46%', product: 'TSP', grade: 'TSP 46%' },
  { label: 'NP 10-45', product: 'NP', grade: 'NP 10-45', isDefault: true },
  { label: 'NP 11-44', product: 'NP', grade: 'NP 11-44' },
  { label: 'NP 08-40', product: 'NP', grade: 'NP 08-40' },
  { label: 'NP 08-40+5S', product: 'NP', grade: 'NP 08-40+5S' },
]

// ── Period filter (default: last 8 weeks) ──
const PERIODS = [
  { label: '8W', days: 56 },
  { label: '26W', days: 182 },
  { label: '52W', days: 364 },
  { label: 'All', days: null },
]

function matchesGrade(priceEntry, tab) {
  if (!priceEntry?.value) return false
  if (!tab.grade) return true
  const g = priceEntry.grade
  if (g) return g === tab.grade
  return !!tab.isDefault
}

function buildGradeSeries(calls, tab, cutoff) {
  return calls
    .filter(c => matchesGrade(c.prices?.[tab.product], tab))
    .filter(c => !cutoff || String(c.date) >= cutoff)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date))
    .map(c => ({
      date: c.date,
      client: c.client,
      price: parseFloat(c.prices[tab.product].value),
      trend: c.prices[tab.product].trend,
    }))
    .filter(d => !isNaN(d.price))
}

const saleDate = s => String(s.dealDate || s.deal_date || s.date || s.created_at || '').slice(0, 10)

// Sales store the full grade label as product (e.g. 'Amsul GR'), matching tab labels.
function saleMatchesTab(s, tab) {
  const sp = (s.product || '').trim().toLowerCase()
  if (!sp) return false
  if (tab.grade) return sp === tab.label.trim().toLowerCase()
  return sp === tab.product.trim().toLowerCase() || sp.startsWith(tab.product.trim().toLowerCase())
}

function buildSalesSeries(sales, tab, cutoff) {
  return (sales || [])
    .filter(s => saleMatchesTab(s, tab))
    .map(s => ({ date: saleDate(s), client: s.client || s.clientName || '', salePrice: parseFloat(s.donePrice) }))
    .filter(d => d.date && !isNaN(d.salePrice))
    .filter(d => !cutoff || d.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text3)', fontSize: 11, fontFamily: 'DM Mono', marginBottom: 4 }}>{label}</p>
      {d?.client && <p style={{ color: 'var(--text)', fontWeight: 700 }}>{d.client}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.stroke && p.stroke !== 'none' ? p.stroke : SALES_COLOR, marginTop: 2 }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  )
}

const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '—' }
const TREND_COLOR = { up: 'var(--accent)', stable: 'var(--blue)', down: 'var(--red)', none: 'var(--text3)' }
const SALES_COLOR = '#ff9500'

export default function PriceTrends({ calls, sales = [] }) {
  const [selectedLabel, setSelectedLabel] = useState('Amsul GR')
  const [periodLabel, setPeriodLabel] = useState('8W')
  const tab = GRADE_TABS.find(t => t.label === selectedLabel) || GRADE_TABS[0]
  const period = PERIODS.find(p => p.label === periodLabel) || PERIODS[0]

  const cutoff = period.days == null ? null : (() => {
    const d = new Date()
    d.setDate(d.getDate() - period.days)
    return toLocalYMD(d)
  })()

  const series = buildGradeSeries(calls, tab, cutoff)
  const salesSeries = buildSalesSeries(sales, tab, cutoff)

  // Merged chart data: call points and sale points on one date axis
  const chartData = [
    ...series.map(p => ({ date: p.date, client: p.client, price: p.price })),
    ...salesSeries.map(p => ({ date: p.date, client: p.client, salePrice: p.salePrice })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)))

  // ── Price snapshot stats for the selected grade (within the selected period) ──
  function currentWeekMonday() {
    const now = new Date()
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  let snapshot = null
  if (series.length > 0) {
    const prices = series.map(s => s.price)
    const latest = series[series.length - 1]
    const first = series[0]

    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const weekPrices = series.filter(s => parseDate(s.date) >= weekAgo).map(s => s.price)

    const wkMon = currentWeekMonday()
    const currentWeekPrices = series.filter(x => parseDate(x.date) >= wkMon).map(x => x.price)
    const currentWeekAvg = currentWeekPrices.length
      ? currentWeekPrices.reduce((sum, v) => sum + v, 0) / currentWeekPrices.length : null
    const activeClients = new Set(
      calls.filter(c => matchesGrade(c.prices?.[tab.product], tab) && parseDate(c.date) >= wkMon)
        .map(c => c.client)
    ).size

    const avgPrice = prices.reduce((sum, v) => sum + v, 0) / prices.length
    const periodLow = Math.min(...prices)
    const periodHigh = Math.max(...prices)
    const weekLow = weekPrices.length ? Math.min(...weekPrices) : null
    const weekHigh = weekPrices.length ? Math.max(...weekPrices) : null

    // Direction: avg of the first 7 days in the window vs avg of the last 7 days
    // (outlier-resistant, unlike single first/last calls)
    const firstDay = parseDate(first.date)
    const firstWeekEnd = new Date(firstDay); firstWeekEnd.setDate(firstWeekEnd.getDate() + 7)
    const lastDay = parseDate(latest.date)
    const lastWeekStart = new Date(lastDay); lastWeekStart.setDate(lastWeekStart.getDate() - 7)
    const avgOf = arr => arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : null
    const firstWeekAvg = avgOf(series.filter(x => parseDate(x.date) < firstWeekEnd).map(x => x.price))
    const lastWeekAvg = avgOf(series.filter(x => parseDate(x.date) >= lastWeekStart).map(x => x.price))
    const periodChange = (firstWeekAvg != null && lastWeekAvg != null) ? lastWeekAvg - firstWeekAvg : 0
    const periodPct = firstWeekAvg ? (periodChange / firstWeekAvg) * 100 : 0
    const weekFirst = series.find(x => parseDate(x.date) >= weekAgo)
    const weekChange = weekFirst ? latest.price - weekFirst.price : null

    snapshot = {
      latest, avgPrice, currentWeekAvg, periodLow, periodHigh, weekLow, weekHigh,
      periodChange, periodPct, weekChange, activeClients,
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Price Trends</h1>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◎ Price History by Product</h2>
        <div className={styles.tabs}>
          {GRADE_TABS.map(t => (
            <button
              key={t.label}
              className={`${styles.tab} ${selectedLabel === t.label ? styles.tabActive : ''}`}
              onClick={() => setSelectedLabel(t.label)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.tabs} style={{ marginTop: 4 }}>
          {PERIODS.map(p => (
            <button
              key={p.label}
              className={`${styles.tab} ${periodLabel === p.label ? styles.tabActive : ''}`}
              onClick={() => setPeriodLabel(p.label)}
              title={p.days ? `Last ${p.label}` : 'Full history'}
            >
              {p.label}
            </button>
          ))}
        </div>

        {chartData.length < 2 ? (
          <div className={styles.noData}>
            <p>Not enough data for {tab.label} in the last {period.days ? period.label : 'full history'}.</p>
            <p className={styles.noDataSub}>Try a longer period, or log calls/sales with {tab.label} prices.</p>
          </div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fill: 'var(--text3)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }}
                  formatter={(value, entry) => (
                    <span style={{ color: entry?.color && entry.color !== 'none' ? entry.color : SALES_COLOR }}>{value}</span>
                  )} />
                <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2}
                  dot={{ fill: 'var(--accent)', r: 4 }} name={`${tab.label} — call prices`} connectNulls />
                <Line dataKey="salePrice" stroke="none" strokeWidth={0} legendType="circle"
                  dot={{ fill: SALES_COLOR, stroke: SALES_COLOR, r: 5 }} name={`Sales executed — ${tab.label}`} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◈ {tab.label} Snapshot</h2>
        {!snapshot ? (
          <p className={styles.none}>No {tab.label} price data in this period.</p>
        ) : (
          <div className={styles.snapGrid}>
            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Avg Calls Price — This Week</div>
              <div className={styles.snapValue}>{snapshot.currentWeekAvg != null ? snapshot.currentWeekAvg.toFixed(0) : '—'}</div>
              <div className={styles.snapSub}>current week (Mon–today)</div>
            </div>

            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>This Week Range</div>
              <div className={styles.snapValue}>
                {snapshot.weekLow != null ? `${snapshot.weekLow}–${snapshot.weekHigh}` : '—'}
              </div>
              <div className={styles.snapSub}>last 7 days</div>
            </div>

            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Period Range</div>
              <div className={styles.snapValue}>{snapshot.periodLow}–{snapshot.periodHigh}</div>
              <div className={styles.snapSub}>{period.days ? `last ${period.label}` : 'all logged data'}</div>
            </div>

            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Avg Calls Price — Period</div>
              <div className={styles.snapValue}>{snapshot.avgPrice.toFixed(0)}</div>
              <div className={styles.snapSub}>{period.days ? `last ${period.label} average` : 'all-data average'}</div>
            </div>

            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Direction</div>
              <div className={styles.snapValue} style={{ color: snapshot.periodChange < 0 ? 'var(--red)' : snapshot.periodChange > 0 ? 'var(--accent)' : 'var(--text)' }}>
                {snapshot.periodChange > 0 ? '+' : ''}{snapshot.periodChange.toFixed(0)}
                <span style={{ fontSize: 13, marginLeft: 4 }}>({snapshot.periodPct > 0 ? '+' : ''}{snapshot.periodPct.toFixed(1)}%)</span>
              </div>
              <div className={styles.snapSub}>
                first-week avg vs last-week avg{snapshot.weekChange != null ? ` · ${snapshot.weekChange > 0 ? '+' : ''}${snapshot.weekChange.toFixed(0)} past week` : ''}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
