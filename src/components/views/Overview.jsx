import { useState, useEffect } from 'react'
import { generateWeeklyReport } from '../../report.js'
import { runAIAnalysis, getCachedAnalysis, shouldRefresh } from '../../aiAnalysis.js'
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

function formatTimestamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const SIGNAL_STYLE = {
  warning: { color: 'var(--amber)', icon: '⚠' },
  alert: { color: 'var(--red)', icon: '◉' },
  opportunity: { color: 'var(--accent)', icon: '◈' },
}

const ANALYSIS_SECTIONS = [
  { key: 'priceTrends', label: 'Price Trends', icon: '◎' },
  { key: 'demand', label: 'Demand', icon: '◈' },
  { key: 'competitors', label: 'Competitor Activity', icon: '⊟' },
  { key: 'opportunities', label: 'Opportunities & Risks', icon: '◇' },
]

export default function Overview({ calls }) {
  const demandMap = buildDemandSummary(calls)
  const clients = Object.keys(demandMap)
  const recentCalls = calls.slice(0, 5)
  const [demandPopup, setDemandPopup] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportFrom, setReportFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split('T')[0]
  })
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().split('T')[0])

  // AI analysis state
  const [analysis, setAnalysis] = useState(() => getCachedAnalysis())
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  async function refreshAnalysis() {
    if (calls.length === 0) return
    setAiLoading(true)
    setAiError('')
    try {
      const result = await runAIAnalysis(calls)
      setAnalysis(result)
    } catch (e) {
      setAiError('Could not generate analysis. Please try again.')
    }
    setAiLoading(false)
  }

  // Auto-run on load if needed (no cache or call count changed)
  useEffect(() => {
    if (calls.length > 0 && shouldRefresh(calls)) {
      refreshAnalysis()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleExport() {
    const html = generateWeeklyReport(calls, analysis?.signals || [], reportFrom, reportTo)
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    setShowReportModal(false)
  }

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

  function getDemandRows(call) {
    if (call.demandRows?.length) {
      return call.demandRows.filter(r => r.product || r.volume || r.port || r.priceTarget)
    }
    if (call.demandProduct || call.demandVolume || call.demandPort || call.demandPriceTarget) {
      return [{ product: call.demandProduct, volume: call.demandVolume, port: call.demandPort, priceTarget: call.demandPriceTarget }]
    }
    return []
  }

  const signals = analysis?.signals || []

  return (
    <div className={styles.wrap}>

      {/* Report date picker modal */}
      {showReportModal && (
        <div className={styles.popupOverlay} onClick={() => setShowReportModal(false)}>
          <div className={styles.popup} style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className={styles.popupHeader}>
              <span className={styles.popupClient}>Export Report</span>
              <button className={styles.popupClose} onClick={() => setShowReportModal(false)}>✕</button>
            </div>
            <div className={styles.popupBlock}>
              <span className={styles.popupLabel}>Select Date Range</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', textTransform: 'uppercase', marginBottom: 4 }}>From</div>
                  <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)}
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', fontFamily: 'inherit' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono', textTransform: 'uppercase', marginBottom: 4 }}>To</div>
                  <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)}
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', fontFamily: 'inherit' }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowReportModal(false)}
                style={{ flex:1, background:'transparent', border:'1px solid var(--border2)', color:'var(--text2)', borderRadius:8, padding:'11px', fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>
                Cancel
              </button>
              <button onClick={handleExport}
                style={{ flex:2, background:'var(--accent)', color:'#0e0f0c', border:'none', borderRadius:8, padding:'11px', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                ↓ Generate Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Demand popup overlay */}
      {demandPopup && (
        <div className={styles.popupOverlay} onClick={() => setDemandPopup(null)}>
          <div className={styles.popup} onClick={e => e.stopPropagation()}>
            <div className={styles.popupHeader}>
              <span className={styles.popupClient}>{demandPopup.client}</span>
              <span className={styles.popupDate}>{formatDate(demandPopup.date)}</span>
              <button className={styles.popupClose} onClick={() => setDemandPopup(null)}>✕</button>
            </div>
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
            {demandPopup.demand && (
              <div className={styles.popupBlock}>
                <span className={styles.popupLabel}>Notes</span>
                <p className={styles.popupText}>{demandPopup.demand}</p>
              </div>
            )}
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
          <button className={styles.exportBtn} onClick={() => setShowReportModal(true)}>
            ↓ Export Report
          </button>
        </div>
      </header>

      {/* AI Market Signals */}
      <section className={styles.section}>
        <div className={styles.aiHeader}>
          <h2 className={styles.sectionTitle}>⬡ Market Signals</h2>
          <div className={styles.aiHeaderRight}>
            {analysis?.generatedAt && !aiLoading && (
              <span className={styles.aiTimestamp}>Updated {formatTimestamp(analysis.generatedAt)}</span>
            )}
            <button className={styles.refreshBtn} onClick={refreshAnalysis} disabled={aiLoading || calls.length === 0}>
              {aiLoading ? '◌ Analyzing...' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {aiError && <p className={styles.aiError}>{aiError}</p>}

        {aiLoading && !analysis && (
          <div className={styles.aiLoading}>
            <p>◌ Claude is analyzing your market data...</p>
          </div>
        )}

        {!aiLoading && signals.length === 0 && !aiError && (
          <div className={styles.aiLoading}>
            <p>{calls.length === 0 ? 'Log calls to generate market signals.' : 'No signals yet — click Refresh to analyze.'}</p>
          </div>
        )}

        {signals.length > 0 && (
          <div className={styles.signals}>
            {signals.map((s, i) => {
              const st = SIGNAL_STYLE[s.type] || SIGNAL_STYLE.warning
              return (
                <div key={i} className={styles.signal} style={{ borderColor: st.color + '44' }}>
                  <div className={styles.signalRow}>
                    <span style={{ color: st.color, fontSize: 18 }}>{st.icon}</span>
                    <p style={{ color: 'var(--text)', flex: 1 }}>{s.text}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* AI Deep Analysis */}
      {analysis?.analysis && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>✦ AI Market Analysis</h2>
          <div className={styles.analysisGrid}>
            {ANALYSIS_SECTIONS.map(sec => (
              analysis.analysis[sec.key] && (
                <div key={sec.key} className={styles.analysisCard}>
                  <div className={styles.analysisCardHeader}>
                    <span className={styles.analysisIcon}>{sec.icon}</span>
                    <span className={styles.analysisLabel}>{sec.label}</span>
                  </div>
                  <p className={styles.analysisText}>{analysis.analysis[sec.key]}</p>
                </div>
              )
            ))}
          </div>
          <p className={styles.aiDisclaimer}>Generated by Claude Opus 4.8 · Analysis is informational, not financial advice</p>
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
