import { useState } from 'react'
import { generateWeeklyReport } from '../../report.js'
import { PRODUCTS, buildDemandSummary } from '../../data.js'
import styles from './Overview.module.css'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) return d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dateStr
}

function formatVolume(val) {
  if (!val) return null
  const num = parseFloat(val)
  if (isNaN(num)) return val
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' T'
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  const natural = new Date(dateStr)
  if (!isNaN(natural.getTime())) return natural
  return new Date(0)
}

const SIGNAL_STYLE = {
  warning: { color: 'var(--amber)', icon: '⚠' },
  alert: { color: 'var(--red)', icon: '◉' },
  opportunity: { color: 'var(--accent)', icon: '◈' },
}

export default function Overview({ calls, signals }) {
  const demandMap = buildDemandSummary(calls)
  const clients = Object.keys(demandMap)
  const recentCalls = calls.slice(0, 5)
  const [expandedSignal, setExpandedSignal] = useState(null)
  const [demandPopup, setDemandPopup] = useState(null)

  function handleExport() {
    const html = generateWeeklyReport(calls, signals)
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
  }

  // Get latest call per client for demand popup
  const latestByClient = {}
  calls.forEach(c => {
    if (!latestByClient[c.client] || parseDate(c.date) > parseDate(latestByClient[c.client].date)) {
      latestByClient[c.client] = c
    }
  })

  const productActivity = PRODUCTS.map(p => ({
    name: p,
    count: calls.filter(c => c.prices?.[p]?.value || c.prices?.[p]?.trend !== 'none').length,
  })).sort((a, b) => b.count - a.count)

  // Build demand rows for popup — handles both old and new format
  function getDemandRows(call) {
    if (call.demandRows?.length) {
      return call.demandRows.filter(r => r.product || r.volume || r.port || r.priceTarget)
    }
    // Legacy single-field format
    if (call.demandProduct || call.demandVolume || call.demandPort || call.demandPriceTarget) {
      return [{ product: call.demandProduct, volume: call.demandVolume, port: call.demandPort, priceTarget: call.demandPriceTarget }]
    }
    return []
  }

  return (
    <div className={styles.wrap}>

      {/* Demand popup overlay */}
      {demandPopup && (
        <div className={styles.popupOverlay} onClick={() => setDemandPopup(null)}>
          <div className={styles.popup} onClick={e => e.stopPropagation()}>
            <div className={styles.popupHeader}>
              <span className={styles.popupClient}>{demandPopup.client}</span>
              <span className={styles.popupDate}>{formatDate(demandPopup.date)}</span>
              <button className={styles.popupClose} onClick={() => setDemandPopup(null)}>✕</button>
            </div>

            {/* Structured demand rows */}
            {demandPopup.demandRows?.length > 0 && (
              <div className={styles.popupBlock}>
                <span className={styles.popupLabel}>Demand</span>
                <div className={styles.popupDemandRows}>
                  {demandPopup.demandRows.map((row, i) => (
                    <div key={i} className={styles.popupDemandRow}>
                      {row.product && (
                        <div className={styles.popupDemandCell}>
                          <span className={styles.popupDemandCellLabel}>Product</span>
                          <span className={styles.popupDemandCellValue}>{row.product}</span>
                        </div>
                      )}
                      {row.volume && (
                        <div className={styles.popupDemandCell}>
                          <span className={styles.popupDemandCellLabel}>Volume</span>
                          <span className={styles.popupDemandCellValue}>{formatVolume(row.volume)}</span>
                        </div>
                      )}
                      {row.port && (
                        <div className={styles.popupDemandCell}>
                          <span className={styles.popupDemandCellLabel}>Port</span>
                          <span className={styles.popupDemandCellValue}>{row.port}</span>
                        </div>
                      )}
                      {row.priceTarget && (
                        <div className={styles.popupDemandCell}>
                          <span className={styles.popupDemandCellLabel}>Price Target</span>
                          <span className={styles.popupDemandCellValue} style={{ color: 'var(--accent)' }}>{row.priceTarget}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Free text demand notes */}
            {demandPopup.demand && (
              <div className={styles.popupBlock}>
                <span className={styles.popupLabel}>Notes</span>
                <p className={styles.popupText}>{demandPopup.demand}</p>
              </div>
            )}

            {/* Remarks */}
            {demandPopup.remarks && (
              <div className={styles.popupBlock}>
                <span className={styles.popupLabel}>Remarks</span>
                <p className={styles.popupText}>{demandPopup.remarks}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Market Overview</h1>
          <p className={styles.sub}>{calls.length} calls logged · {clients.length} clients tracked</p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.dateChip}>
            {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <button className={styles.exportBtn} onClick={handleExport}>
            ↓ Weekly Report
          </button>
        </div>
      </header>

      {signals.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>⬡ Market Signals</h2>
          <div className={styles.signals}>
            {signals.map((s, i) => {
              const st = SIGNAL_STYLE[s.type] || SIGNAL_STYLE.warning
              const isOpen = expandedSignal === i
              return (
                <div key={i} className={`${styles.signal} ${isOpen ? styles.signalOpen : ''}`}
                  style={{ borderColor: st.color + '44' }}
                  onClick={() => setExpandedSignal(isOpen ? null : i)}
                >
                  <div className={styles.signalRow}>
                    <span style={{ color: st.color, fontSize: 18 }}>{st.icon}</span>
                    <p style={{ color: 'var(--text)', flex: 1 }}>{s.text}</p>
                    <span className={styles.signalChevron} style={{ color: st.color }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </div>
                  {isOpen && s.calls?.length > 0 && (
                    <div className={styles.signalDetail}>
                      {s.calls.map((sc, j) => (
                        <div key={j} className={styles.signalCallRow}>
                          <span className={styles.signalCallClient}>{sc.client}</span>
                          <span className={styles.signalCallDate}>{formatDate(sc.date)}</span>
                          {sc.detail && <span className={styles.signalCallDetail}>{sc.detail}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {calls.length === 0 && (
        <div className={styles.empty}>
          <p>No calls logged yet.</p>
          <p className={styles.emptySub}>Go to <strong>Upload Call</strong> to add your first entry.</p>
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◧ Recent Calls</h2>
          {recentCalls.length === 0 ? <p className={styles.none}>No calls yet.</p> : (
            <div className={styles.callList}>
              {recentCalls.map(c => (
                <div key={c.id} className={styles.callCard}>
                  <div className={styles.callTop}>
                    <span className={styles.callClient}>{c.client}</span>
                    <span className={styles.callDate}>{formatDate(c.date)}</span>
                  </div>
                  {c.demand && <p className={styles.callDemand}>{c.demand}</p>}
                  {c.remarks && <p className={styles.callRemarks}>{c.remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◎ Product Activity</h2>
          <div className={styles.productList}>
            {productActivity.map(p => (
              <div key={p.name} className={styles.productRow}>
                <span className={styles.productName}>{p.name}</span>
                <div className={styles.barWrap}>
                  <div className={styles.bar} style={{ width: calls.length ? `${(p.count / calls.length) * 100}%` : '0%' }} />
                </div>
                <span className={styles.productCount}>{p.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {clients.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◈ Client Demand Status</h2>
          <div className={styles.clientGrid}>
            {clients.map(cl => {
              const d = demandMap[cl]
              const status = d.active > 0 ? 'active' : d.potential > 0 ? 'potential' : 'none'
              const label = status === 'active' ? 'Active' : status === 'potential' ? 'Potential' : 'No Demand'
              const color = status === 'active' ? 'var(--accent)' : status === 'potential' ? 'var(--amber)' : 'var(--red)'
              const isClickable = status === 'active' || status === 'potential'
              const latest = latestByClient[cl]
              const demandRows = latest ? getDemandRows(latest) : []
              return (
                <div
                  key={cl}
                  className={`${styles.clientCard} ${isClickable ? styles.clientCardClickable : ''}`}
                  onClick={() => isClickable && latest && setDemandPopup({
                    client: cl,
                    date: latest.date,
                    demandRows,
                    demand: latest.demand,
                    remarks: latest.remarks
                  })}
                >
                  <span className={styles.clientName}>{cl}</span>
                  <div className={styles.clientBottom}>
                    <span className={styles.clientStatus} style={{ color, borderColor: color + '44' }}>{label}</span>
                    {isClickable && <span className={styles.clientHint}>view →</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
