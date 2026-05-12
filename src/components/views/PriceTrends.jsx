import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PRODUCTS, buildPriceSeries } from '../../data.js'
import styles from './PriceTrends.module.css'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  // Try standard YYYY-MM-DD first
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  // Try parsing as-is (e.g. 'May 5')
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) {
    return d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  // Return as-is if unparseable
  return dateStr
}

const COLORS = ['#c8f060', '#60b8f0', '#f0b840', '#ff6b5b', '#b860f0', '#60f0b8']

export default function PriceTrends({ calls }) {
  const [selected, setSelected] = useState('Amsul')

  const series = buildPriceSeries(calls, selected)

  // Build multi-product comparison table (latest price per client per product)
  const clientSet = [...new Set(calls.map(c => c.client))]
  const latestByClient = {}

  function parseDate(dateStr) {
    if (!dateStr) return new Date(0)
    // Try YYYY-MM-DD first
    const iso = new Date(dateStr + 'T00:00:00')
    if (!isNaN(iso.getTime())) return iso
    // Try natural language (e.g. 'May 5')
    const natural = new Date(dateStr)
    if (!isNaN(natural.getTime())) return natural
    return new Date(0)
  }

  calls.forEach(c => {
    if (!latestByClient[c.client] || parseDate(c.date) > parseDate(latestByClient[c.client].date)) {
      latestByClient[c.client] = c
    }
  })

  const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '—' }
  const TREND_COLOR = { up: 'var(--accent)', stable: 'var(--blue)', down: 'var(--red)', none: 'var(--text3)' }

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
                <YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: 'var(--text)' }}
                />
                <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)', r: 4 }} name={selected} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◈ Latest Prices per Client</h2>
        {clientSet.length === 0 ? (
          <p className={styles.none}>No client data yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Client</th>
                  <th className={styles.thDate}>Date</th>
                  {PRODUCTS.map(p => <th key={p} className={styles.th}>{p}</th>)}
                </tr>
              </thead>
              <tbody>
                {clientSet.map(cl => {
                  const latest = latestByClient[cl]
                  return (
                    <tr key={cl} className={styles.tr}>
                      <td className={styles.tdClient}>{cl}</td>
                      <td className={styles.tdDate}>{formatDate(latest?.date)}</td>
                      {PRODUCTS.map(p => {
                        const pr = latest?.prices?.[p]
                        return (
                          <td key={p} className={styles.td}>
                            {pr?.value && <span className={styles.price}>{pr.value}{pr.type ? <span className={styles.priceType}> {pr.type}</span> : ''}</span>}
                            {pr?.trend && pr.trend !== 'none' && (
                              <span style={{ color: TREND_COLOR[pr.trend], marginLeft: 4, fontSize: 12 }}>
                                {TREND_ICON[pr.trend]}
                              </span>
                            )}
                            {!pr?.value && (!pr?.trend || pr.trend === 'none') && <span className={styles.dash}>—</span>}
                          </td>
                        )
                      })}
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
