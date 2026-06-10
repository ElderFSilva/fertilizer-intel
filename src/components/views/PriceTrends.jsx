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

  // Latest call per client that matches the selected grade
  const latestByClient = {}
  calls.forEach(c => {
    if (!matchesGrade(c.prices?.[tab.product], tab)) return
    if (!latestByClient[c.client] || parseDate(c.date) > parseDate(latestByClient[c.client].date)) {
      latestByClient[c.client] = c
    }
  })

  const clientsWithProduct = Object.entries(latestByClient)
    .sort((a, b) => parseDate(b[1].date) - parseDate(a[1].date))

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
        <h2 className={styles.sectionTitle}>◈ Latest {tab.label} Prices per Client</h2>
        {clientsWithProduct.length === 0 ? (
          <p className={styles.none}>No clients with {tab.label} price data yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Client</th>
                  <th className={styles.thDate}>Date</th>
                  <th className={styles.th}>{tab.label} Price</th>
                  <th className={styles.th}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {clientsWithProduct.map(([cl, call]) => {
                  const pr = call.prices?.[tab.product]
                  return (
                    <tr key={cl} className={styles.tr}>
                      <td className={styles.tdClient}>{cl}</td>
                      <td className={styles.tdDate}>{formatDate(call.date)}</td>
                      <td className={styles.td}>
                        <span className={styles.price}>{pr?.value}</span>
                      </td>
                      <td className={styles.td}>
                        {pr?.trend && pr.trend !== 'none' && (
                          <span style={{ color: TREND_COLOR[pr.trend], fontSize: 14 }}>
                            {TREND_ICON[pr.trend]}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
