import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
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

// ── Grade tabs ──
// Each tab maps to a base product + (optional) required grade.
// Urea & MAP have no grade. Defaults: old data with no grade is treated as the
// product's default grade so it still shows under that tab.
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

// Does this call's price entry match the selected grade tab?
function matchesGrade(priceEntry, tab) {
  if (!priceEntry?.value) return false
  if (!tab.grade) return true // Urea / MAP — no grade filtering
  const g = priceEntry.grade
  if (g) return g === tab.grade
  // No grade stored (legacy data) → counts as the product's default grade
  return !!tab.isDefault
}

function buildGradeSeries(calls, tab) {
  return calls
    .filter(c => matchesGrade(c.prices?.[tab.product], tab))
    .sort((a, b) => parseDate(a.date) - parseDate(b.date))
    .map(c => ({
      date: c.date,
      client: c.client,
      price: parseFloat(c.prices[tab.product].value),
      trend: c.prices[tab.product].trend,
    }))
    .filter(d => !isNaN(d.price))
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text3)', fontSize: 11, fontFamily: 'DM Mono', marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'var(--text)', fontWeight: 700 }}>{d?.client}</p>
      <p style={{ color: 'var(--accent)', marginTop: 2 }}>{payload[0]?.name}: <strong>{payload[0]?.value}</strong></p>
    </div>
  )
}

const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '—' }
const TREND_COLOR = { up: 'var(--accent)', stable: 'var(--blue)', down: 'var(--red)', none: 'var(--text3)' }

export default function PriceTrends({ calls }) {
  const [selectedLabel, setSelectedLabel] = useState('Amsul GR')
  const tab = GRADE_TABS.find(t => t.label === selectedLabel) || GRADE_TABS[0]

  const series = buildGradeSeries(calls, tab)

  // ── Price snapshot stats for the selected grade ──
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

    // Last-7-days window
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const weekPrices = series.filter(s => parseDate(s.date) >= weekAgo).map(s => s.price)

    // Active clients this week (Mon-based current week)
    const wkMon = currentWeekMonday()
    const activeClients = new Set(
      calls.filter(c => matchesGrade(c.prices?.[tab.product], tab) && parseDate(c.date) >= wkMon)
        .map(c => c.client)
    ).size

    const periodLow = Math.min(...prices)
    const periodHigh = Math.max(...prices)
    const weekLow = weekPrices.length ? Math.min(...weekPrices) : null
    const weekHigh = weekPrices.length ? Math.max(...weekPrices) : null

    // Direction: latest vs first (period), and latest vs week-ago first
    const periodChange = latest.price - first.price
    const periodPct = first.price ? (periodChange / first.price) * 100 : 0
    const weekFirst = series.find(s => parseDate(s.date) >= weekAgo)
    const weekChange = weekFirst ? latest.price - weekFirst.price : null

    snapshot = {
      latest, periodLow, periodHigh, weekLow, weekHigh,
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

        {series.length < 2 ? (
          <div className={styles.noData}>
            <p>Not enough data for {tab.label} yet.</p>
            <p className={styles.noDataSub}>Log at least 2 calls with {tab.label} prices to see a trend chart.</p>
          </div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <XAxis dataKey="date" tick={{ fill: 'var(--text3)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)', r: 4 }} name={tab.label} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◈ {tab.label} Snapshot</h2>
        {!snapshot ? (
          <p className={styles.none}>No {tab.label} price data yet.</p>
        ) : (
          <div className={styles.snapGrid}>
            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Latest</div>
              <div className={styles.snapValue}>
                {snapshot.latest.price}
                {snapshot.latest.trend && snapshot.latest.trend !== 'none' && (
                  <span style={{ color: TREND_COLOR[snapshot.latest.trend], fontSize: 18, marginLeft: 6 }}>
                    {TREND_ICON[snapshot.latest.trend]}
                  </span>
                )}
              </div>
              <div className={styles.snapSub}>{formatDate(snapshot.latest.date)}</div>
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
              <div className={styles.snapSub}>all logged data</div>
            </div>

            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Direction</div>
              <div className={styles.snapValue} style={{ color: snapshot.periodChange < 0 ? 'var(--red)' : snapshot.periodChange > 0 ? 'var(--accent)' : 'var(--text)' }}>
                {snapshot.periodChange > 0 ? '+' : ''}{snapshot.periodChange.toFixed(0)}
                <span style={{ fontSize: 13, marginLeft: 4 }}>({snapshot.periodPct > 0 ? '+' : ''}{snapshot.periodPct.toFixed(1)}%)</span>
              </div>
              <div className={styles.snapSub}>
                {snapshot.weekChange != null ? `${snapshot.weekChange > 0 ? '+' : ''}${snapshot.weekChange.toFixed(0)} past week` : 'over period'}
              </div>
            </div>

            <div className={styles.snapCard}>
              <div className={styles.snapLabel}>Active Clients</div>
              <div className={styles.snapValue}>{snapshot.activeClients}</div>
              <div className={styles.snapSub}>quoted this week</div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
