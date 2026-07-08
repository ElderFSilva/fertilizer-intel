import { useState } from 'react'
import PortSelect from './PortSelect.jsx'
import { buildSalesStats, SALE_PRODUCTS } from '../../sales.js'
import styles from './Sales.module.css'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dateStr
}

function formatVolume(val) {
  const num = parseFloat(val)
  if (isNaN(num)) return val || '—'
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  return new Date(0)
}

// Today's date as YYYY-MM-DD using LOCAL components (never toISOString, which
// shifts the day for Brazil/UTC-3 and would mis-file the deal's week).
function todayYMD() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyForm() {
  return {
    date: todayYMD(),
    client: '', product: 'Amsul GR', volume: '', donePrice: '',
    laycan: '', vessel: '', port: '',
    offerPrice: '', bidPrice: '', linkedDemandId: ''
  }
}

export default function Sales({ calls, sales = [], onAddSale, onDeleteSale, role, traderNames = {} }) {
  const isAdmin = role === 'admin'
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
  const [busy, setBusy] = useState(false)

  const clientNames = [...new Set(calls.map(c => c.client).filter(Boolean))].sort()

  // Build demand options for the selected client (to optionally link)
  const linkedDemandIds = new Set(sales.map(s => s.linkedDemandId).filter(Boolean))
  const clientDemands = []
  if (form.client) {
    calls
      .filter(c => c.client === form.client)
      .sort((a, b) => parseDate(b.date) - parseDate(a.date))
      .forEach(c => {
        (c.demandRows || []).forEach((r, idx) => {
          const did = r.id || `${c.id}-${idx}`
          const hasContent = r.product || r.volume || r.port || r.priceTarget
          if (hasContent && !linkedDemandIds.has(did)) {
            clientDemands.push({
              id: did,
              label: `${formatDate(c.date)} · ${r.product || '?'} ${r.volume || '?'}t ${r.port || ''} @ ${r.priceTarget || '?'}${r.laycan ? ` · ${r.laycan}` : ''}`
            })
          }
        })
      })
  }

  const stats = buildSalesStats(sales)

  // Show newest deal first by deal date; fall back to created_at for any
  // legacy sale that predates the date field.
  const sortedSales = [...sales].sort((a, b) => {
    const da = a.date ? parseDate(a.date).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0)
    const db = b.date ? parseDate(b.date).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0)
    return db - da
  })

  function set(field, val) { setForm(f => ({ ...f, [field]: val })) }

  async function handleSave() {
    if (!form.date) { setError('Deal date is required.'); return }
    if (!form.client.trim()) { setError('Client is required.'); return }
    if (!form.product) { setError('Product is required.'); return }
    if (!form.volume) { setError('Volume is required.'); return }
    if (!form.donePrice) { setError('Done price is required.'); return }
    if (!form.laycan) { setError('Laycan date is required.'); return }
    if (!form.vessel.trim()) { setError('Vessel name is required.'); return }
    if (!form.port) { setError('Port is required.'); return }

    setBusy(true)
    try {
      await onAddSale(form)
      setForm(emptyForm())
      setShowOptional(false)
      setError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError('Could not save the sale to the cloud.')
    }
    setBusy(false)
  }

  async function handleDelete(id) {
    try {
      await onDeleteSale(id)
    } catch (e) {
      setError('Could not delete the sale.')
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Sales Log</h1>
          <p className={styles.sub}>{sales.length} deal{sales.length !== 1 ? 's' : ''} recorded</p>
        </div>
      </header>

      {/* Quick-add form — traders only (admin environment is read-only) */}
      {!isAdmin && (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>⊕ Log a Sale</h2>
        <div className={styles.quickAdd}>
          {/* Required fields */}
          <div className={styles.coreGrid}>
            <div className={styles.field}>
              <label className={styles.label}>Deal Date *</label>
              <input type="date" className={styles.input} value={form.date} max={todayYMD()} onChange={e => set('date', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Client *</label>
              <input className={styles.input} list="client-names" placeholder="Client" value={form.client} onChange={e => set('client', e.target.value)} />
              <datalist id="client-names">
                {clientNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Product *</label>
              <select className={styles.input} value={form.product} onChange={e => set('product', e.target.value)}>
                {SALE_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Volume (T) *</label>
              <input type="number" step="0.01" min="0" className={styles.input} placeholder="5,000.00" value={form.volume} onChange={e => set('volume', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Done Price *</label>
              <input className={styles.input} placeholder="e.g. 250" value={form.donePrice} onChange={e => set('donePrice', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Laycan *</label>
              <input className={styles.input} value={form.laycan} placeholder="e.g. Jul 15-30" onChange={e => set('laycan', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Vessel *</label>
              <input className={styles.input} placeholder="Vessel name" value={form.vessel} onChange={e => set('vessel', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Port *</label>
              <PortSelect value={form.port} onChange={val => set('port', val)} />
            </div>
          </div>

          {/* Optional toggle */}
          <button type="button" className={styles.optionalToggle} onClick={() => setShowOptional(s => !s)}>
            {showOptional ? '− Hide' : '+ Add'} offer price, bid price & link to demand
          </button>

          {showOptional && (
            <div className={styles.optionalGrid}>
              <div className={styles.field}>
                <label className={styles.label}>Offer Price</label>
                <input className={styles.input} placeholder="Your offer" value={form.offerPrice} onChange={e => set('offerPrice', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Bid Price</label>
                <input className={styles.input} placeholder="Their bid" value={form.bidPrice} onChange={e => set('bidPrice', e.target.value)} />
              </div>
              <div className={styles.field} style={{ gridColumn: 'span 2' }}>
                <label className={styles.label}>Link to Demand {form.client ? '' : '(select client first)'}</label>
                <select className={styles.input} value={form.linkedDemandId} onChange={e => set('linkedDemandId', e.target.value)} disabled={!form.client || clientDemands.length === 0}>
                  <option value="">{clientDemands.length === 0 ? 'No demands logged for this client' : '— None —'}</option>
                  {clientDemands.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {saved && <p className={styles.success}>✓ Sale logged!</p>}

          <button className={styles.saveBtn} onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : '◈ Log Sale'}</button>
        </div>
      </section>
      )}

      {/* Stats */}
      {stats && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◎ Performance</h2>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{stats.totalDeals}</div>
              <div className={styles.statLbl}>Total Deals</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{stats.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
              <div className={styles.statLbl}>Total Volume (T)</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{stats.avgSpread != null ? stats.avgSpread.toFixed(1) : '—'}</div>
              <div className={styles.statLbl}>Avg Spread (offer−done)</div>
            </div>
          </div>

          {stats.productStats.length > 0 && (
            <div className={styles.productStats}>
              {stats.productStats.map(p => (
                <div key={p.product} className={styles.productStatRow}>
                  <span className={styles.productStatName}>{p.product}</span>
                  <span className={styles.productStatVol}>{p.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })} T</span>
                  <span className={styles.productStatDeals}>{p.deals} deal{p.deals !== 1 ? 's' : ''}</span>
                  <span className={styles.productStatDone}>{p.avgDone != null ? `avg ${p.avgDone}` : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sales log */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◧ Recorded Sales</h2>
        {sales.length === 0 ? (
          <p className={styles.none}>No sales logged yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Date</th>
                  <th className={styles.th}>Laycan</th>
                  <th className={styles.th}>Client</th>
                  {isAdmin && <th className={styles.th}>Trader</th>}
                  <th className={styles.th}>Product</th>
                  <th className={styles.th}>Volume</th>
                  <th className={styles.th}>Vessel</th>
                  <th className={styles.th}>Port</th>
                  <th className={styles.th}>Offer</th>
                  <th className={styles.th}>Bid</th>
                  <th className={styles.th} style={{ color: 'var(--accent)' }}>Done</th>
                  {!isAdmin && <th className={styles.th}></th>}
                </tr>
              </thead>
              <tbody>
                {sortedSales.map(s => (
                  <tr key={s.id} className={styles.tr}>
                    <td className={styles.td}>{formatDate(s.date)}</td>
                    <td className={styles.td}>{s.laycan || '—'}</td>
                    <td className={styles.td} style={{ fontWeight: 700 }}>{s.client}</td>
                    {isAdmin && (
                      <td className={styles.td}>
                        <span style={{ fontSize: 10, fontFamily: 'DM Mono, monospace', color: 'var(--accent, #c8f060)', border: '1px solid var(--accent, #c8f060)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                          {traderNames[s.trader_id] || 'Trader'}
                        </span>
                      </td>
                    )}
                    <td className={styles.td}>{s.product}</td>
                    <td className={styles.td}>{formatVolume(s.volume)} T</td>
                    <td className={styles.td}>{s.vessel || '—'}</td>
                    <td className={styles.td}>{s.port || '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--text3)' }}>{s.offerPrice || '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--text3)' }}>{s.bidPrice || '—'}</td>
                    <td className={styles.td} style={{ color: 'var(--accent)', fontWeight: 700 }}>{s.donePrice || '—'}</td>
                    {!isAdmin && (
                      <td className={styles.td}>
                        <button className={styles.deleteBtn} onClick={() => handleDelete(s.id)}>⊗</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
