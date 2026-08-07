import { useState, useEffect } from 'react'
import { generateWeeklyReport } from '../../report.js'
import { runWeeklyAnalysis, getCachedAnalysis, isCurrentWeekSnapshot, weekLabel } from '../../aiAnalysis.js'
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
  { key: 'supply', label: 'Supply & Parity', icon: '⊚' },
  { key: 'competitors', label: 'Competitor Activity', icon: '⊟' },
  { key: 'opportunities', label: 'Opportunities & Risks', icon: '◇' },
]

export default function Overview({ calls, sales, scope, scopeLabel }) {
  const demandMap = buildDemandSummary(calls)
  const clients = Object.keys(demandMap)
  const recentCalls = calls.slice(0, 5)
  const [demandPopup, setDemandPopup] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)
  // Client Demand Status filters
  const [filterProduct, setFilterProduct] = useState('')
  const [filterPort, setFilterPort] = useState('')
  const [filterLaycan, setFilterLaycan] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [reportFrom, setReportFrom] = useState(() => {
    const now = new Date(); const day = now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    return monday.toISOString().split('T')[0]
  })
  const [reportTo, setReportTo] = useState(() => {
    const now = new Date(); const day = now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4)
    return friday.toISOString().split('T')[0]
  })

  // AI analysis state — scoped per view (global vs per-trader), so switching
  // the admin trader toggle shows that view's own snapshot instead of clobbering.
  const [analysis, setAnalysis] = useState(() => getCachedAnalysis(scope))
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  // When the viewed scope changes (admin toggles trader), load that scope's
  // cached snapshot. Option A: no auto-generation — an unseen scope simply
  // shows the "Generate" state until the user asks for it.
  useEffect(() => {
    setAnalysis(getCachedAnalysis(scope))
    setAiError('')
  }, [scope])

  async function generateWeekly() {
    if (calls.length === 0) return
    setAiLoading(true)
    setAiError('')
    try {
      const result = await runWeeklyAnalysis(calls, scope, sales)
      setAnalysis(result)
    } catch (e) {
      setAiError('Could not generate analysis. Please try again.')
    }
    setAiLoading(false)
  }

  // Whether the cached snapshot is for the current week
  const snapshotIsCurrent = isCurrentWeekSnapshot(scope)
  const thisWeekLabel = weekLabel()

  function handleExport() {
    const html = generateWeeklyReport(calls, analysis?.signals || [], reportFrom, reportTo, analysis, sales)
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
      return call.demandRows.filter(r => r.product || r.volume || r.port || r.priceTarget || r.laycan)
    }
    if (call.demandProduct || call.demandVolume || call.demandPort || call.demandPriceTarget) {
      return [{ product: call.demandProduct, volume: call.demandVolume, port: call.demandPort, priceTarget: call.demandPriceTarget }]
    }
    return []
  }

  const signals = analysis?.signals || []

  // ── Current week (Mon–Fri) demand collection ──
  // Resets every Saturday 00:00 — always shows Mon–Fri of the current week.
  function currentWeekRange() {
    const now = new Date()
    const day = now.getDay() // 0=Sun, 1=Mon ... 6=Sat
    const monday = new Date(now)
    const diffToMonday = day === 0 ? 6 : day - 1
    monday.setDate(now.getDate() - diffToMonday)
    monday.setHours(0, 0, 0, 0)
    const friday = new Date(monday)
    friday.setDate(monday.getDate() + 4)
    friday.setHours(23, 59, 59, 999)
    return { monday, friday }
  }

  const { monday: weekMon, friday: weekFri } = currentWeekRange()

  // Gather every demand row from every call dated within this Mon–Fri, grouped by client
  const weekDemandsByClient = {}
  calls.forEach(c => {
    const d = parseDate(c.date)
    if (d < weekMon || d > weekFri) return
    const rows = getDemandRows(c)
    if (!rows.length) return
    if (!weekDemandsByClient[c.client]) weekDemandsByClient[c.client] = { rows: [], latestCall: c }
    rows.forEach(r => weekDemandsByClient[c.client].rows.push(r))
    if (parseDate(c.date) >= parseDate(weekDemandsByClient[c.client].latestCall.date)) {
      weekDemandsByClient[c.client].latestCall = c
    }
  })
  const weekDemandClients = Object.keys(weekDemandsByClient).sort()

  // ── Filter option lists (populated from this week's demand rows) ──
  const allWeekRows = weekDemandClients.flatMap(cl => weekDemandsByClient[cl].rows)
  const productOptions = [...new Set(allWeekRows.map(r => r.product).filter(Boolean))].sort()
  const portOptions = [...new Set(allWeekRows.map(r => r.port).filter(Boolean))].sort()
  const laycanOptions = [...new Set(allWeekRows.map(r => r.laycan).filter(Boolean))].sort()

  const filtersActive = filterProduct || filterPort || filterLaycan || filterClient.trim()

  function rowMatches(row) {
    if (filterProduct && row.product !== filterProduct) return false
    if (filterPort && row.port !== filterPort) return false
    if (filterLaycan && row.laycan !== filterLaycan) return false
    return true
  }

  function clearFilters() {
    setFilterProduct(''); setFilterPort(''); setFilterLaycan(''); setFilterClient('')
  }

  // Apply filters → clients with at least one matching row (and matching client search)
  const filteredClients = weekDemandClients
    .filter(cl => !filterClient.trim() || cl.toLowerCase().includes(filterClient.trim().toLowerCase()))
    .map(cl => ({ client: cl, rows: weekDemandsByClient[cl].rows.filter(rowMatches), latestCall: weekDemandsByClient[cl].latestCall }))
    .filter(entry => entry.rows.length > 0)

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
                      {row.laycan && (
                        <div className={styles.popupDemandCell}>
                          <span className={styles.popupDemandCellLabel}>Laycan</span>
                          <span className={styles.popupDemandCellValue}>{row.laycan}</span>
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

      {/* AI Market Signals — Weekly Snapshot */}
      <section className={styles.section}>
        <div className={styles.aiHeader}>
          <h2 className={styles.sectionTitle}>
            ⬡ Market Signals
            {scopeLabel && (
              <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--accent, #c8f060)', border: '1px solid var(--accent, #c8f060)', borderRadius: 4, padding: '1px 7px', verticalAlign: 'middle' }}>
                {scopeLabel}
              </span>
            )}
          </h2>
          <div className={styles.aiHeaderRight}>
            {analysis?.weekLabel && !aiLoading && (
              <span className={styles.aiTimestamp}>
                Week of {analysis.weekLabel} · generated {formatTimestamp(analysis.generatedAt)}
              </span>
            )}
            <button className={styles.refreshBtn} onClick={generateWeekly} disabled={aiLoading || calls.length === 0}>
              {aiLoading
                ? '◌ Analyzing...'
                : snapshotIsCurrent ? '↻ Regenerate this week' : `✦ Generate ${thisWeekLabel} analysis`}
            </button>
          </div>
        </div>

        {!snapshotIsCurrent && analysis?.weekLabel && !aiLoading && (
          <p className={styles.staleNote}>
            Showing last locked read ({analysis.weekLabel}). Generate this week's analysis when your calls and publications are in.
          </p>
        )}

        {aiError && <p className={styles.aiError}>{aiError}</p>}

        {aiLoading && !analysis && (
          <div className={styles.aiLoading}>
            <p>◌ Claude is analyzing this week's market data...</p>
          </div>
        )}

        {!aiLoading && signals.length === 0 && !aiError && (
          <div className={styles.aiLoading}>
            <p>{calls.length === 0 ? 'Log calls to generate market signals.' : 'No analysis yet — click Generate to analyze this week.'}</p>
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

        {analysis?.positioning?.bias && (
          <div className={styles.signal} style={{
            borderColor: (analysis.positioning.bias === 'LONG' ? 'var(--accent)'
              : analysis.positioning.bias === 'SHORT' ? 'var(--red)' : '#d4a72c') + '66',
            marginTop: 10,
          }}>
            <div className={styles.signalRow}>
              <span style={{
                color: analysis.positioning.bias === 'LONG' ? 'var(--accent)'
                  : analysis.positioning.bias === 'SHORT' ? 'var(--red)' : '#d4a72c',
                fontSize: 13, fontFamily: "'DM Mono', monospace", fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                ◆ {analysis.positioning.bias} · {String(analysis.positioning.confidence || '').toUpperCase()}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ color: 'var(--text)' }}>{analysis.positioning.rationale}</p>
                {analysis.positioning.trigger && (
                  <p style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>
                    Would change on: {analysis.positioning.trigger}
                  </p>
                )}
              </div>
            </div>
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

      {weekDemandClients.length > 0 && (
        <section className={styles.section}>
          <div className={styles.demandHeadRow}>
            <h2 className={styles.sectionTitle}>◈ Client Demand Status</h2>
            {filtersActive ? (
              <button className={styles.clearFiltersBtn} onClick={clearFilters}>✕ Clear filters</button>
            ) : null}
          </div>

          {/* Filter bar */}
          <div className={styles.demandFilters}>
            <select className={styles.demandFilterSelect} value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
              <option value="">All products</option>
              {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className={styles.demandFilterSelect} value={filterPort} onChange={e => setFilterPort(e.target.value)}>
              <option value="">All ports</option>
              {portOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className={styles.demandFilterSelect} value={filterLaycan} onChange={e => setFilterLaycan(e.target.value)}>
              <option value="">All laycans</option>
              {laycanOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <input
              className={styles.demandFilterInput}
              placeholder="Search client…"
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
            />
          </div>

          <div className={styles.demandListWrap}>
            <div className={styles.demandListHead}>
              <span>Client</span>
              <span>Product</span>
              <span>Volume</span>
              <span>Port</span>
              <span>Price Target</span>
              <span>Laycan</span>
            </div>
            {filteredClients.length === 0 ? (
              <div className={styles.demandNoMatch}>No demands match these filters.</div>
            ) : (
              filteredClients.map(({ client: cl, rows, latestCall }) => (
                <div key={cl} className={styles.demandClientBlock}>
                  {rows.map((row, idx) => (
                    <div
                      key={idx}
                      className={styles.demandListRow}
                      onClick={() => setDemandPopup({
                        client: cl,
                        date: latestCall.date,
                        demandRows: weekDemandsByClient[cl].rows,
                        demand: latestCall.demand,
                        remarks: latestCall.remarks
                      })}
                    >
                      <span className={styles.demandListClient}>{idx === 0 ? cl : ''}</span>
                      <span className={styles.demandListCell}>{row.product || '—'}</span>
                      <span className={styles.demandListCell}>{row.volume ? formatVolume(row.volume) : '—'}</span>
                      <span className={styles.demandListCell}>{row.port || '—'}</span>
                      <span className={styles.demandListCell} style={{ color: row.priceTarget ? 'var(--accent)' : 'var(--text3)' }}>{row.priceTarget || '—'}</span>
                      <span className={styles.demandListCell}>{row.laycan || '—'}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  )
}
