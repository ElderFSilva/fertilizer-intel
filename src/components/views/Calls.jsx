import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Calls.module.css'
import PortSelect from './PortSelect.jsx'
import ClientIntel from './ClientIntel.jsx'
import CallEditForm, { buildEditForm } from './CallEditForm.jsx'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) {
    return d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return dateStr
}

function formatVolume(val) {
  if (!val) return null
  const num = parseFloat(val)
  if (isNaN(num)) return val
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' T'
}

const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '—' }
const PRODUCT_GRADES = {
  Amsul: ['Amsul GR', 'Amsul STD'],
  SSP: ['SSP 20%', 'SSP 19%'],
  TSP: ['TSP 45%', 'TSP 46%'],
  NP: ['NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S'],
}
const TREND_COLOR = { up: 'var(--accent)', stable: 'var(--blue)', down: 'var(--red)', none: 'var(--text3)' }

export default function Calls({ calls, sales = [], onDelete, onEdit, role, traderNames = {} }) {
  const knownClients = [...new Set(calls.map(c => (c.client || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
  const isAdmin = role === 'admin'
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [filterPort, setFilterPort] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterTrend, setFilterTrend] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [savedBanner, setSavedBanner] = useState(false)
  const [intelClient, setIntelClient] = useState(null)

  function parseDate(dateStr) {
    if (!dateStr) return null
    const d = new Date(dateStr + 'T00:00:00')
    return isNaN(d.getTime()) ? null : d
  }

  const activeFilters = [filterProduct, filterPort, filterDateFrom, filterDateTo, filterTrend].filter(Boolean).length

  const filtered = calls.filter(c => {
    // Text search — client, remarks, demand, competitor names
    if (search) {
      const q = search.toLowerCase()
      const inClient = c.client.toLowerCase().includes(q)
      const inRemarks = (c.remarks || '').toLowerCase().includes(q)
      const inDemand = (c.demand || '').toLowerCase().includes(q)
      const inCompetitors = (c.competitorOffers || []).some(o => o.competitor?.toLowerCase().includes(q))
      const inPrices = Object.entries(c.prices || {}).some(([, v]) => (v.value || '').toLowerCase().includes(q))
      if (!inClient && !inRemarks && !inDemand && !inCompetitors && !inPrices) return false
    }

    // Product filter — checks prices and demand rows
    if (filterProduct) {
      const inPrices = c.prices?.[filterProduct]?.value
      const inDemandRows = (c.demandRows || []).some(r => r.product === filterProduct)
      const inOldDemand = c.demandProduct === filterProduct
      if (!inPrices && !inDemandRows && !inOldDemand) return false
    }

    // Port filter — checks demand rows
    if (filterPort) {
      const inDemandRows = (c.demandRows || []).some(r => r.port?.toLowerCase().includes(filterPort.toLowerCase()))
      const inOldPort = (c.demandPort || '').toLowerCase().includes(filterPort.toLowerCase())
      if (!inDemandRows && !inOldPort) return false
    }

    // Date range filter
    if (filterDateFrom) {
      const callDate = parseDate(c.date)
      const from = parseDate(filterDateFrom)
      if (callDate && from && callDate < from) return false
    }
    if (filterDateTo) {
      const callDate = parseDate(c.date)
      const to = parseDate(filterDateTo)
      if (callDate && to && callDate > to) return false
    }

    // Trend filter
    if (filterTrend) {
      const hasTrend = Object.values(c.prices || {}).some(p => p.trend === filterTrend)
      if (!hasTrend) return false
    }

    return true
  })

  function clearFilters() {
    setSearch('')
    setFilterProduct('')
    setFilterPort('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterTrend('')
  }

  // Product activity — count of calls referencing each product (price or demand)
  const productActivity = PRODUCTS.map(p => ({
    name: p,
    count: calls.filter(c =>
      (c.prices?.[p]?.value || (c.prices?.[p]?.trend && c.prices[p].trend !== 'none')) ||
      (c.demandRows || []).some(r => r.product === p || (r.product || '').startsWith(p))
    ).length,
  })).sort((a, b) => b.count - a.count)
  const maxActivity = Math.max(1, ...productActivity.map(p => p.count))

  function startEdit(c) {
    setEditingId(c.id)
    setEditForm(buildEditForm(c))
    setExpandedId(c.id)
  }

  function cancelEdit() { setEditingId(null); setEditForm(null) }

  function saveEdit(id) {
    onEdit(id, editForm)
    setEditingId(null)
    setEditForm(null)
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  return (
    <div className={styles.wrap}>
      {intelClient && (
        <ClientIntel client={intelClient} calls={calls} sales={sales} onClose={() => setIntelClient(null)} />
      )}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>All Calls</h1>
          <span className={styles.resultCount}>{filtered.length} of {calls.length}</span>
        </div>
        <div className={styles.searchBar}>
          <input className={styles.search} placeholder="Search clients, remarks, prices..." value={search} onChange={e => setSearch(e.target.value)} />
          <button
            className={`${styles.filterToggle} ${showFilters ? styles.filterToggleActive : ''}`}
            onClick={() => setShowFilters(f => !f)}
          >
            ⊟ Filters {activeFilters > 0 && <span className={styles.filterBadge}>{activeFilters}</span>}
          </button>
          {(search || activeFilters > 0) && (
            <button className={styles.clearBtn} onClick={clearFilters}>✕ Clear</button>
          )}
        </div>
      </header>

      {showFilters && (
        <div className={styles.filterBar}>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>Product</label>
            <select className={styles.filterSelect} value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
              <option value="">All products</option>
              {['Amsul', 'Urea', 'MAP', 'SSP', 'TSP', 'NP 10-45', 'NP 08-40'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>Port</label>
            <select className={styles.filterSelect} value={filterPort} onChange={e => setFilterPort(e.target.value)}>
              <option value="">All ports</option>
              {['Paranaguá', 'Aratu', 'Rio Grande', 'Santos', 'São Francisco do Sul', 'Santarém', 'Itaqui', 'Vitória'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>Trend</label>
            <select className={styles.filterSelect} value={filterTrend} onChange={e => setFilterTrend(e.target.value)}>
              <option value="">Any trend</option>
              <option value="up">↑ Up</option>
              <option value="stable">↔ Stable</option>
              <option value="down">↓ Down</option>
            </select>
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>Date from</label>
            <input type="date" className={styles.filterSelect} value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>Date to</label>
            <input type="date" className={styles.filterSelect} value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
          </div>
        </div>
      )}

      {calls.length > 0 && (
        <section className={styles.activitySection}>
          <h2 className={styles.activityTitle}>◎ Product Activity</h2>
          <div className={styles.productList}>
            {productActivity.map(p => (
              <div key={p.name} className={styles.productRow}>
                <span className={styles.productName}>{p.name}</span>
                <div className={styles.barWrap}>
                  <div className={styles.bar} style={{ width: `${(p.count / maxActivity) * 100}%` }} />
                </div>
                <span className={styles.productCount}>{p.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {savedBanner && <div className={styles.savedBanner}>✓ Call updated successfully!</div>}

      {filtered.length === 0 && (
        <p className={styles.empty}>{calls.length === 0 ? 'No calls logged yet.' : 'No results found.'}</p>
      )}

      <div className={styles.list}>
        {filtered.map(c => {
          const open = expandedId === c.id
          const isEditing = editingId === c.id

          return (
            <div key={c.id} className={`${styles.card} ${open ? styles.cardOpen : ''}`}>
              <div className={styles.cardTop} onClick={() => !isEditing && setExpandedId(open ? null : c.id)}>
                <div className={styles.meta}>
                  <span className={styles.client} onClick={(e) => { e.stopPropagation(); setIntelClient(c.client) }} title="View client intelligence">{c.client}</span>
                  {isAdmin && (
                    <span title="Trader" style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: 'var(--accent, #c8f060)', border: '1px solid var(--accent, #c8f060)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                      {traderNames[c.trader_id] || 'Trader'}
                    </span>
                  )}
                  <span className={styles.date}>{formatDate(c.date)}</span>
                </div>
                <div className={styles.pills}>
                  {PRODUCTS.filter(p => c.prices?.[p]?.trend && c.prices[p].trend !== 'none').map(p => (
                    <span key={p} className={styles.pill} style={{ color: TREND_COLOR[c.prices[p].trend] }}>
                      {PRODUCT_GRADES[p] && c.prices[p].grade ? c.prices[p].grade : p} {TREND_ICON[c.prices[p].trend]}
                    </span>
                  ))}
                </div>
                <button className={styles.chevron}>{open ? '▲' : '▼'}</button>
              </div>

              {open && !isEditing && (
                <div className={styles.detail}>
                  <div className={styles.pricesTable}>
                    {PRODUCTS.map(p => {
                      const pr = c.prices?.[p]
                      if (!pr?.value && (!pr?.trend || pr.trend === 'none')) return null
                      return (
                        <div key={p} className={styles.priceRow}>
                          <span className={styles.priceProduct}>{PRODUCT_GRADES[p] && pr.grade ? pr.grade : p}</span>
                          <span className={styles.priceVal}>{pr.value || '—'}</span>
                          <span style={{ color: TREND_COLOR[pr.trend || 'none'] }}>{TREND_ICON[pr.trend || 'none']}</span>
                        </div>
                      )
                    })}
                  </div>
                  {((c.demandRows?.length && c.demandRows.some(r => r.product || r.volume || r.port || r.priceTarget)) || c.demand) && (
                    <div className={styles.block}>
                      <span className={styles.blockLabel}>Demand</span>
                      {(c.demandRows || []).map((row, i) => (
                        (row.product || row.volume || row.port || row.priceTarget || row.laycan) ? (
                          <div key={i} className={styles.demandTags} style={{ marginBottom: 4 }}>
                            {row.product && <span className={styles.demandTag}><span className={styles.demandTagLabel}>Product</span> {row.product}</span>}
                            {row.volume && <span className={styles.demandTag}><span className={styles.demandTagLabel}>Vol</span> {formatVolume(row.volume)}</span>}
                            {row.port && <span className={styles.demandTag}><span className={styles.demandTagLabel}>Port</span> {row.port}</span>}
                            {row.priceTarget && <span className={styles.demandTag}><span className={styles.demandTagLabel}>Target</span> {row.priceTarget}</span>}
                            {row.laycan && <span className={styles.demandTag}><span className={styles.demandTagLabel}>Laycan</span> {row.laycan}</span>}
                          </div>
                        ) : null
                      ))}
                      {c.demand && <p className={styles.blockText}>{c.demand}</p>}
                    </div>
                  )}
                  {c.remarks && <div className={styles.block}><span className={styles.blockLabel}>Remarks</span><p className={styles.blockText}>{c.remarks}</p></div>}
                  {c.competitorOffers?.length > 0 && (
                    <div className={styles.block}>
                      <span className={styles.blockLabel}>Competitor Offers</span>
                      <div className={styles.compOfferList}>
                        {c.competitorOffers.map((o, i) => (
                          <div key={i} className={styles.compOfferRow}>
                            <span className={styles.compName}>{o.competitor}</span>
                            <span className={styles.compProduct}>{o.product}</span>
                            <span className={styles.compPrice}>{o.price}</span>
                            {o.port && <span className={styles.compPort}>{o.port}</span>}
                            {o.laycan && <span className={styles.compPort}>· {o.laycan}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!isAdmin && (
                    <div className={styles.actions}>
                      <button className={styles.editBtn} onClick={() => startEdit(c)}>✎ Edit</button>
                      <button className={styles.deleteBtn} onClick={() => onDelete(c.id)}>⊗ Delete</button>
                    </div>
                  )}
                </div>
              )}

              {open && isEditing && (
                <div className={styles.editForm}>
                  <CallEditForm
                    form={editForm}
                    setForm={setEditForm}
                    knownClients={knownClients}
                    onSave={() => saveEdit(c.id)}
                    onCancel={cancelEdit}
                    datalistId="calls-edit-client-names"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
