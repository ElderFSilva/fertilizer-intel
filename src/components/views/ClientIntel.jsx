import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { loadSales } from '../../sales.js'
import styles from './ClientIntel.module.css'

const PRODUCTS = ['Amsul', 'Urea', 'MAP', 'SSP', 'TSP', 'NP']

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dateStr
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  return new Date(0)
}

function parseNum(v) {
  if (v === '' || v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

function formatVol(v) {
  const n = parseFloat(v)
  if (isNaN(n)) return v || '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// Extract a numeric price target from a demand row's priceTarget string
function targetNum(v) {
  return parseNum(v)
}

export default function ClientIntel({ client, calls, sales: salesProp, onClose }) {
  const clientCalls = calls
    .filter(c => c.client === client)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date)) // oldest → newest for charting

  // Use the caller-provided (already trader-scoped) sales when available;
  // fall back to the localStorage mirror for any legacy caller.
  const sales = (Array.isArray(salesProp) ? salesProp : loadSales()).filter(s => s.client === client)

  // ── Target movement: for each product, series of price targets over time ──
  // Uses demand priceTarget where available, else the recorded price value.
  const productTargetSeries = {}
  PRODUCTS.forEach(p => {
    const series = []
    clientCalls.forEach(c => {
      // Prefer demand price target for this product
      let val = null
      const demandRow = (c.demandRows || []).find(r => (r.product || '').startsWith(p) && targetNum(r.priceTarget) != null)
      if (demandRow) val = targetNum(demandRow.priceTarget)
      // Fall back to recorded price for the product
      if (val == null) {
        const pr = c.prices?.[p]
        if (pr?.value) val = parseNum(pr.value)
      }
      if (val != null) {
        series.push({ date: c.date, label: formatDate(c.date).replace(/, \d{4}$/, ''), value: val })
      }
    })
    if (series.length >= 1) productTargetSeries[p] = series
  })

  // Pick the product with the most data points to chart by default
  const chartProduct = Object.keys(productTargetSeries)
    .sort((a, b) => productTargetSeries[b].length - productTargetSeries[a].length)[0] || null
  const chartSeries = chartProduct ? productTargetSeries[chartProduct] : []

  // ── Demand history: every demand row across all calls, newest first ──
  const demandHistory = []
  clientCalls.slice().reverse().forEach(c => {
    (c.demandRows || []).forEach(r => {
      if (r.product || r.volume || r.port || r.priceTarget) {
        demandHistory.push({ ...r, date: c.date })
      }
    })
  })

  // ── Hit rate / reliability ──
  const totalDemands = demandHistory.length
  const totalSales = sales.length
  const totalSoldVolume = sales.reduce((s, x) => s + (parseNum(x.volume) || 0), 0)

  // Spread between stated target and done price (do they buy where they say?)
  const targetVsDone = []
  sales.forEach(s => {
    const done = parseNum(s.donePrice)
    // Find a demand for the same product to compare target
    const matchingDemand = demandHistory.find(d => (d.product || '').startsWith((s.product || '').split(' ')[0]) && targetNum(d.priceTarget) != null)
    if (done != null && matchingDemand) {
      const tgt = targetNum(matchingDemand.priceTarget)
      targetVsDone.push(done - tgt) // positive = bought higher than they targeted
    }
  })
  const avgTargetVsDone = targetVsDone.length
    ? (targetVsDone.reduce((a, b) => a + b, 0) / targetVsDone.length)
    : null

  const conversionRate = totalDemands > 0 ? Math.round((totalSales / totalDemands) * 100) : null

  const lastCall = clientCalls.length ? clientCalls[clientCalls.length - 1] : null
  const daysSince = lastCall ? Math.floor((new Date() - parseDate(lastCall.date)) / 86400000) : null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.clientName}>{client}</h2>
            <p className={styles.sub}>
              {clientCalls.length} call{clientCalls.length !== 1 ? 's' : ''}
              {daysSince != null && ` · last contact ${daysSince === 0 ? 'today' : `${daysSince}d ago`}`}
            </p>
          </div>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        {/* Reliability stats */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <div className={styles.statNum}>{totalDemands}</div>
            <div className={styles.statLbl}>Demands Logged</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNum}>{totalSales}</div>
            <div className={styles.statLbl}>Deals Closed</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNum}>{conversionRate != null ? `${conversionRate}%` : '—'}</div>
            <div className={styles.statLbl}>Demand → Sale</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNum} style={{ color: avgTargetVsDone == null ? 'var(--text)' : avgTargetVsDone > 0 ? 'var(--accent)' : 'var(--red)' }}>
              {avgTargetVsDone != null ? (avgTargetVsDone > 0 ? '+' : '') + avgTargetVsDone.toFixed(1) : '—'}
            </div>
            <div className={styles.statLbl}>Done vs Target</div>
          </div>
        </div>
        {avgTargetVsDone != null && (
          <p className={styles.reliabilityNote}>
            {avgTargetVsDone > 2
              ? `On average ${client} closes ${avgTargetVsDone.toFixed(0)} above their stated target — their targets run low vs where they actually buy.`
              : avgTargetVsDone < -2
                ? `On average ${client} closes ${Math.abs(avgTargetVsDone).toFixed(0)} below their stated target — they talk higher than they pay.`
                : `${client} closes close to their stated targets — their talk is reliable.`}
          </p>
        )}

        {/* Target movement chart */}
        {chartProduct && chartSeries.length >= 2 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>◎ {chartProduct} — Target / Price Movement</h3>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: 'var(--text3)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text)' }}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} name={chartProduct} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Demand history */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>◈ Demand History</h3>
          {demandHistory.length === 0 ? (
            <p className={styles.none}>No demands logged for this client.</p>
          ) : (
            <div className={styles.demandList}>
              {demandHistory.map((d, i) => (
                <div key={i} className={styles.demandRow}>
                  <span className={styles.demandDate}>{formatDate(d.date)}</span>
                  <span className={styles.demandProduct}>{d.product || '—'}</span>
                  <span className={styles.demandVol}>{formatVol(d.volume)} T</span>
                  <span className={styles.demandPort}>{d.port || '—'}</span>
                  <span className={styles.demandTarget}>{d.priceTarget || '—'}</span>
                  {(d.isDuplicate || d.linkedToDemandId) && <span className={styles.demandLinked}>↩ linked</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sales history */}
        {sales.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>✓ Closed Deals</h3>
            <div className={styles.demandList}>
              {sales.slice().sort((a, b) => parseDate(b.laycan || b.date) - parseDate(a.laycan || a.date)).map((s, i) => (
                <div key={i} className={styles.saleRow}>
                  <span className={styles.demandDate}>{formatDate(s.laycan || s.date)}</span>
                  <span className={styles.demandProduct}>{s.product || '—'}</span>
                  <span className={styles.demandVol}>{formatVol(s.volume)} T</span>
                  <span className={styles.demandPort}>{s.port || '—'}</span>
                  <span className={styles.saleDone}>{s.donePrice || '—'}</span>
                </div>
              ))}
            </div>
            <p className={styles.totalSold}>Total sold: <strong>{formatVol(totalSoldVolume)} T</strong> across {totalSales} deal{totalSales !== 1 ? 's' : ''}</p>
          </div>
        )}
      </div>
    </div>
  )
}
