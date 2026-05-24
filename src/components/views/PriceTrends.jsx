import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { PRODUCTS, buildPriceSeries } from '../../data.js'
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
  const [selected, setSelected] = useState('Amsul')

  const series = buildPriceSeries(calls, selected)

  // Get latest call per client
  const latestByClient = {}
  calls.forEach(c => {
    if (!latestByClient[c.client] || parseDate(c.date) > parseDate(latestByClient[c.client].date)) {
      latestByClient[c.client] = c
    }
  })

  // Filter to only clients that have data for the selected product
  const clientsWithProduct = Object.entries(latestByClient)
    .filter(([, call]) => call.prices?.[selected]?.value)
    .sort((a, b) => parseDate(b[1].date) - parseDate(a[1].date))

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Price Trends</h1>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◎ Price History by Product</h2>
        <div className={styles.tabs}>
          {PRODUCTS.map(p => (
            <button
              key={p}
              className={`${styles.tab} ${selected === p ? styles.tabActive : ''}`}
              onClick={() => setSelected(p)}
            >
              {p}
            </button>
          ))}
        </div>

        {series.length < 2 ? (
          <div className={styles.noData}>
            <p>Not enough data for {selected} yet.</p>
            <p className={styles.noDataSub}>Log at least 2 calls with {selected} prices to see a trend chart.</p>
          </div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <XAxis dataKey="date" tick={{ fill: 'var(--text3)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)', r: 4 }} name={selected} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◈ Latest {selected} Prices per Client</h2>
        {clientsWithProduct.length === 0 ? (
          <p className={styles.none}>No clients with {selected} price data yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Client</th>
                  <th className={styles.thDate}>Date</th>
                  <th className={styles.th}>{selected} Price</th>
                  <th className={styles.th}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {clientsWithProduct.map(([cl, call]) => {
                  const pr = call.prices?.[selected]
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
