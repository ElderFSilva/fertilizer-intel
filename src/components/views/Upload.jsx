import PortSelect from './PortSelect.jsx'
import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import { findVolumeConflicts, ACTIVE_DAYS } from '../../demands.js'
import styles from './Upload.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const PRODUCT_GRADES = {
  Amsul: ['Amsul GR', 'Amsul STD'],
  SSP: ['SSP 20%', 'SSP 19%'],
  TSP: ['TSP 45%', 'TSP 46%'],
  NP: ['NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S'],
}
const DEFAULT_GRADE = {
  Amsul: 'Amsul GR',
  SSP: 'SSP 20%',
  TSP: 'TSP 45%',
  NP: 'NP 10-45',
}
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }
const DEMAND_PRODUCTS = ['', 'Amsul GR', 'Amsul STD', 'Urea', 'MAP', 'SSP 20%', 'SSP 19%', 'TSP 45%', 'TSP 46%', 'NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S']
const COMP_PRODUCTS = ['Amsul GR', 'Amsul STD', 'Urea', 'MAP', 'SSP 20%', 'SSP 19%', 'TSP 45%', 'TSP 46%', 'NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S']

function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', trend: 'none', grade: DEFAULT_GRADE[p] || '' }]))
}

function emptyCompOffer() {
  return { competitor: '', product: 'Amsul GR', price: '', port: '', laycan: '' }
}

// Demand rows now carry a stable id so they can be referenced (sales link, report dedup)
function newDemandId() {
  return 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function emptyDemandRow() {
  return { id: newDemandId(), product: '', volume: '', port: '', priceTarget: '', laycan: '' }
}

function emptyForm() {
  return {
    client: '', date: new Date().toISOString().split('T')[0],
    demandRows: [emptyDemandRow()],
    demand: '', remarks: '', prices: emptyPrices(), competitorOffers: []
  }
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  return new Date(0)
}

function formatVol(v) {
  const n = parseFloat(v)
  if (isNaN(n)) return v
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtLogged(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return dateStr || ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// One line of a demand in desk words: "35,000t Amsul GR Santarém Dec"
function describeDemand(r) {
  return [formatVol(r.volume) + 't', r.product, r.port, r.laycan].filter(Boolean).join(' ')
}

function CompetitorOffersEditor({ offers, onChange }) {
  function addOffer() { onChange([...offers, emptyCompOffer()]) }
  function removeOffer(i) { onChange(offers.filter((_, idx) => idx !== i)) }
  function updateOffer(i, field, val) {
    onChange(offers.map((o, idx) => idx === i ? { ...o, [field]: val } : o))
  }

  return (
    <div className={styles.compSection}>
      <div className={styles.compHeader}>
        <label className={styles.label}>Competitor Offers</label>
        <button type="button" className={styles.addOfferBtn} onClick={addOffer}>+ Add Offer</button>
      </div>
      {offers.length === 0 && (
        <p className={styles.compEmpty}>No competitor offers recorded for this call.</p>
      )}
      {offers.map((o, i) => (
        <div key={i} className={styles.compRow}>
          <div className={styles.compFieldWrap}>
            <span className={styles.compFieldLabel}>Competitor</span>
            <input className={styles.compInput} placeholder="e.g. Koch, OCP, Helm" value={o.competitor} onChange={e => updateOffer(i, 'competitor', e.target.value)} />
          </div>
          <div className={styles.compFieldWrap}>
            <span className={styles.compFieldLabel}>Product</span>
            <select className={styles.compSelect} value={o.product} onChange={e => updateOffer(i, 'product', e.target.value)}>
              {COMP_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.compFieldWrap}>
            <span className={styles.compFieldLabel}>Price</span>
            <input className={styles.compInput} placeholder="e.g. 255 CFR" value={o.price} onChange={e => updateOffer(i, 'price', e.target.value)} />
          </div>
          <div className={styles.compFieldWrap}>
            <span className={styles.compFieldLabel}>Port</span>
            <PortSelect value={o.port || ''} onChange={val => updateOffer(i, 'port', val)} />
          </div>
          <div className={styles.compFieldWrap}>
            <span className={styles.compFieldLabel}>Laycan</span>
            <input className={styles.compInput} placeholder="e.g. Oct 15-30" value={o.laycan || ''} onChange={e => updateOffer(i, 'laycan', e.target.value)} />
          </div>
          <button type="button" className={styles.removeOfferBtn} title="Remove offer" onClick={() => removeOffer(i)}>✕</button>
        </div>
      ))}
    </div>
  )
}

export default function Upload({ onAdd, calls = [] }) {
  // Known client names (canonical spellings) for autocomplete + normalization
  const knownClients = [...new Set(calls.map(c => (c.client || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
  const canonicalClient = name => {
    const t = (name || '').trim().replace(/\s+/g, ' ')
    if (!t) return t
    const hit = knownClients.find(k => k.toLowerCase() === t.toLowerCase())
    return hit || t
  }
  const [error, setError] = useState('')
  const [savedBanner, setSavedBanner] = useState(false)
  const [form, setForm] = useState(emptyForm())
  // Volume-update prompt. A demand row being logged that matches an ACTIVE
  // line (same client + product + port + laycan, last ACTIVE_DAYS) with a
  // DIFFERENT volume pauses the save: the trader chooses Update or Separate.
  // Exact repeats (same volume) never prompt - they collapse on read.
  // { rows, queue: [{ rowId, existing: [...], latest }], idx }
  const [dupPopup, setDupPopup] = useState(null)

  function setField(field, val) {
    setForm(f => ({ ...f, [field]: val }))
  }

  function setPriceField(product, field, val) {
    setForm(f => ({ ...f, prices: { ...f.prices, [product]: { ...f.prices[product], [field]: val } } }))
  }

  function setOffers(offers) {
    setForm(f => ({ ...f, competitorOffers: offers }))
  }

  function finalizeSave(formToSave) {
    onAdd(formToSave)
    setForm(emptyForm())
    setError('')
    setDupPopup(null)
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  function handleSave() {
    if (!form.client.trim()) { setError('Client name is required.'); return }

    const client = form.client.trim()
    const currentRows = (form.demandRows || []).filter(r => r.product && r.volume)

    // Every row whose identity is already active with a different volume
    // needs the trader's call. Build the queue and ask one at a time.
    const queue = []
    currentRows.forEach(row => {
      const existing = findVolumeConflicts(calls, client, row, form.date)
      if (existing.length) queue.push({ rowId: row.id, existing, latest: existing[0] })
    })

    if (queue.length) {
      setDupPopup({ rows: form.demandRows || [], queue, idx: 0 })
      return
    }

    finalizeSave(form)
  }

  // Apply the trader's choice for the current conflict, then move to the next
  // one or save. Update: the new row supersedes the latest existing line (that
  // line stays in history untouched, it just stops counting). Separate: both count.
  function resolveConflict(choice) {
    if (!dupPopup) return
    const item = dupPopup.queue[dupPopup.idx]
    const rows = dupPopup.rows.map(r => {
      if (r.id !== item.rowId) return r
      if (choice === 'update') return { ...r, supersedesDemandId: item.latest.id || null }
      const { supersedesDemandId, ...rest } = r
      return rest
    })
    const nextIdx = dupPopup.idx + 1
    if (nextIdx < dupPopup.queue.length) {
      setDupPopup({ ...dupPopup, rows, idx: nextIdx })
      return
    }
    finalizeSave({ ...form, demandRows: rows })
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Upload Call</h1>
      </header>

      {savedBanner && <div className={styles.successBanner}>✓ Call saved successfully!</div>}

      {/* Volume-update prompt (one conflict at a time) */}
      {dupPopup && (() => {
        const item = dupPopup.queue[dupPopup.idx]
        const current = dupPopup.rows.find(r => r.id === item.rowId) || {}
        const others = item.existing.slice(1)
        return (
          <div className={styles.dupOverlay} onClick={() => setDupPopup(null)}>
            <div className={styles.dupModal} onClick={e => e.stopPropagation()}>
              <div className={styles.dupHeader}>
                <span className={styles.dupTitle}>
                  ⚠ Volume changed{dupPopup.queue.length > 1 ? ` (${dupPopup.idx + 1} of ${dupPopup.queue.length})` : ''}
                </span>
                <button className={styles.dupClose} onClick={() => setDupPopup(null)}>✕</button>
              </div>
              <p className={styles.dupIntro}>
                <strong>{form.client}</strong> already has <strong>{describeDemand(item.latest)}</strong> (logged {fmtLogged(item.latest.callDate)}).
                This call says <strong>{formatVol(current.volume)}t</strong>.
              </p>
              {others.length > 0 && (
                <div className={styles.dupList}>
                  {others.map((ex, i) => (
                    <div key={i} className={styles.dupItem}>
                      <span className={styles.dupItemDetail}>Also active: {describeDemand(ex)}</span>
                      <span className={styles.dupItemDate}>logged {fmtLogged(ex.callDate)} · not affected by this choice</span>
                    </div>
                  ))}
                </div>
              )}
              <p className={styles.dupQuestion}>Is this an update of that demand, or a separate cargo?</p>
              <div className={styles.dupActions}>
                <button className={styles.dupLinkBtn} onClick={() => resolveConflict('update')}>
                  ↻ Update — replaces the {formatVol(item.latest.volume)}t
                  <span className={styles.dupBtnHint}>The old line stays in history but no longer counts</span>
                </button>
                <button className={styles.dupNewBtn} onClick={() => resolveConflict('separate')}>
                  + Separate — a second cargo, count both
                </button>
              </div>
              <p className={styles.dupTip}>Same client, product, port and laycan within the last {ACTIVE_DAYS} days. Identical volumes never ask — they count once automatically.</p>
            </div>
          </div>
        )
      })()}

      <div className={styles.form}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Client *</label>
            <input className={styles.input} list="call-client-names" value={form.client} onChange={e => setField('client', e.target.value)} onBlur={e => setField('client', canonicalClient(e.target.value))} placeholder="Client name" />
            <datalist id="call-client-names">
              {knownClients.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Date</label>
            <input type="date" className={styles.input} value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
        </div>

        <div className={styles.pricesSection}>
          <label className={styles.label}>Prices & Trends</label>
          <div className={styles.pricesGrid}>
            {PRODUCTS.map(p => (
              <div key={p} className={styles.priceRow}>
                {PRODUCT_GRADES[p] ? (
                  <select className={styles.gradeSelect} value={form.prices[p].grade || DEFAULT_GRADE[p]} onChange={e => setPriceField(p, 'grade', e.target.value)}>
                    {PRODUCT_GRADES[p].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                ) : (
                  <span className={styles.productLabel}>{p}</span>
                )}
                <input className={styles.priceInput} placeholder="Price" value={form.prices[p].value} onChange={e => setPriceField(p, 'value', e.target.value)} />
                <select className={styles.trendSelect} value={form.prices[p].trend} onChange={e => setPriceField(p, 'trend', e.target.value)}>
                  {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.demandSection}>
          <div className={styles.demandSectionHeader}>
            <label className={styles.label}>Demand</label>
            <button type="button" className={styles.addDemandBtn} onClick={() => setField('demandRows', [...(form.demandRows || []), emptyDemandRow()])}>+ Add Demand</button>
          </div>
          {(form.demandRows || [emptyDemandRow()]).map((row, i) => (
            <div key={row.id || i} className={styles.demandRowWrap}>
              <div className={styles.demandGrid}>
                <div className={styles.demandField}>
                  <label className={styles.demandLabel}>Product</label>
                  <select className={styles.input} value={row.product || ''} onChange={e => {
                    const rows = [...(form.demandRows || [])]
                    rows[i] = { ...rows[i], product: e.target.value }
                    setField('demandRows', rows)
                  }}>
                    {DEMAND_PRODUCTS.map(p => <option key={p} value={p}>{p || '— Select —'}</option>)}
                  </select>
                </div>
                <div className={styles.demandField}>
                  <label className={styles.demandLabel}>Volume (Tons)</label>
                  <input type="number" step="0.01" min="0" className={styles.input}
                    value={row.volume || ''}
                    onChange={e => {
                      const rows = [...(form.demandRows || [])]
                      rows[i] = { ...rows[i], volume: e.target.value }
                      setField('demandRows', rows)
                    }}
                    placeholder="e.g. 5,000.00"
                  />
                </div>
                <div className={styles.demandField}>
                  <label className={styles.demandLabel}>Port</label>
                  <PortSelect value={row.port || ''} onChange={val => {
                    const rows = [...(form.demandRows || [])]
                    rows[i] = { ...rows[i], port: val }
                    setField('demandRows', rows)
                  }} />
                </div>
                <div className={styles.demandField}>
                  <label className={styles.demandLabel}>Price Target</label>
                  <input className={styles.input} value={row.priceTarget || ''}
                    onChange={e => {
                      const rows = [...(form.demandRows || [])]
                      rows[i] = { ...rows[i], priceTarget: e.target.value }
                      setField('demandRows', rows)
                    }}
                    placeholder="e.g. 240 CFR"
                  />
                </div>
                <div className={styles.demandField}>
                  <label className={styles.demandLabel}>Laycan</label>
                  <input className={styles.input} value={row.laycan || ''}
                    onChange={e => {
                      const rows = [...(form.demandRows || [])]
                      rows[i] = { ...rows[i], laycan: e.target.value }
                      setField('demandRows', rows)
                    }}
                    placeholder="e.g. Jun 15-30"
                  />
                </div>
              </div>
              {(form.demandRows || []).length > 1 && (
                <button type="button" className={styles.removeDemandBtn} onClick={() => {
                  const rows = (form.demandRows || []).filter((_, idx) => idx !== i)
                  setField('demandRows', rows)
                }}>✕</button>
              )}
            </div>
          ))}
          <textarea className={styles.textarea} rows={2} value={form.demand} onChange={e => setField('demand', e.target.value)} placeholder="Additional demand notes, laycan..." />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Remarks</label>
          <textarea className={styles.textarea} rows={3} value={form.remarks} onChange={e => setField('remarks', e.target.value)} placeholder="Additional remarks..." />
        </div>

        <CompetitorOffersEditor offers={form.competitorOffers || []} onChange={setOffers} />

        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.saveBtn} onClick={handleSave}>◈ Save Call</button>
      </div>
    </div>
  )
}
