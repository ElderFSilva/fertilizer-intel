import PortSelect from './PortSelect.jsx'
import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
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
  return { competitor: '', product: 'Amsul GR', price: '', port: '' }
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

// Monday of the week for a given date
function getWeekMonday(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  return monday
}

// Find this client's active demands recorded earlier the same Mon–Fri week
function findActiveDemandsThisWeek(calls, client, dateStr) {
  if (!client) return []
  const weekMonday = getWeekMonday(dateStr)
  if (!weekMonday) return []
  const weekFriday = new Date(weekMonday)
  weekFriday.setDate(weekMonday.getDate() + 4)
  weekFriday.setHours(23, 59, 59, 999)
  const thisDate = parseDate(dateStr)

  const found = []
  calls.forEach(c => {
    if (c.client !== client) return
    const cd = parseDate(c.date)
    if (cd < weekMonday || cd > weekFriday) return
    if (cd > thisDate) return // only earlier-or-same in the week
    ;(c.demandRows || []).forEach(r => {
      if (!r.product || !r.volume) return
      if (r.closed) return // already closed (e.g. converted to sale)
      found.push({ ...r, callDate: c.date, callId: c.id })
    })
  })
  return found
}

function formatVol(v) {
  const n = parseFloat(v)
  if (isNaN(n)) return v
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
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
          <div className={styles.compRowTop}>
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
          </div>
          <div className={styles.compRowBottom}>
            <div className={styles.compFieldWrap}>
              <span className={styles.compFieldLabel}>Price</span>
              <input className={styles.compInput} placeholder="e.g. 255 CFR" value={o.price} onChange={e => updateOffer(i, 'price', e.target.value)} />
            </div>
            <div className={styles.compPortWrap}>
              <span className={styles.compFieldLabel}>Port</span>
              <PortSelect value={o.port || ''} onChange={val => updateOffer(i, 'port', val)} />
            </div>
            <button type="button" className={styles.removeOfferBtn} onClick={() => removeOffer(i)}>✕</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Upload({ onAdd, calls = [] }) {
  const [error, setError] = useState('')
  const [savedBanner, setSavedBanner] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [dupPopup, setDupPopup] = useState(null) // { existing: [...], pendingForm }

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

    // Check for active demands this week that exactly match a demand row being logged now
    const activeDemands = findActiveDemandsThisWeek(calls, form.client.trim(), form.date)
    const currentRows = (form.demandRows || []).filter(r => r.product && r.volume)

    if (activeDemands.length > 0 && currentRows.length > 0) {
      // Find matches: existing active demands that share product (the trigger condition)
      const matches = []
      currentRows.forEach(row => {
        activeDemands.forEach(ex => {
          if (ex.product === row.product) {
            matches.push({ existing: ex, current: row })
          }
        })
      })
      if (matches.length > 0) {
        setDupPopup({ matches, allActive: activeDemands })
        return
      }
    }

    finalizeSave(form)
  }

  // User chose: link to existing — mark the current matching rows as linked (don't double-count)
  function handleLink() {
    const matchedCurrentIds = new Set(dupPopup.matches.map(m => m.current.id))
    const linkMap = {}
    dupPopup.matches.forEach(m => { linkMap[m.current.id] = m.existing.id })

    const updatedRows = (form.demandRows || []).map(r => {
      if (matchedCurrentIds.has(r.id)) {
        // Mark as a link to the original demand so the report counts it only once
        return { ...r, linkedToDemandId: linkMap[r.id], isDuplicate: true }
      }
      return r
    })
    finalizeSave({ ...form, demandRows: updatedRows })
  }

  // User chose: this is new/separate — save as-is, counts independently
  function handleSaveAsNew() {
    finalizeSave(form)
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Upload Call</h1>
      </header>

      {savedBanner && <div className={styles.successBanner}>✓ Call saved successfully!</div>}

      {/* Duplicate-demand popup */}
      {dupPopup && (
        <div className={styles.dupOverlay} onClick={() => setDupPopup(null)}>
          <div className={styles.dupModal} onClick={e => e.stopPropagation()}>
            <div className={styles.dupHeader}>
              <span className={styles.dupTitle}>⚠ Existing Demand This Week</span>
              <button className={styles.dupClose} onClick={() => setDupPopup(null)}>✕</button>
            </div>
            <p className={styles.dupIntro}>
              <strong>{form.client}</strong> already has an open demand recorded this week for the same product:
            </p>
            <div className={styles.dupList}>
              {dupPopup.matches.map((m, i) => (
                <div key={i} className={styles.dupItem}>
                  <span className={styles.dupItemProduct}>{m.existing.product}</span>
                  <span className={styles.dupItemDetail}>
                    {formatVol(m.existing.volume)}t {m.existing.port ? `· ${m.existing.port}` : ''} {m.existing.priceTarget ? `· ${m.existing.priceTarget}` : ''}
                  </span>
                  <span className={styles.dupItemDate}>logged {new Date(m.existing.callDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
              ))}
            </div>
            <p className={styles.dupQuestion}>Is this the same demand, or new tonnage?</p>
            <div className={styles.dupActions}>
              <button className={styles.dupLinkBtn} onClick={handleLink}>
                ↩ Same demand — link it
                <span className={styles.dupBtnHint}>Won't double-count in reports</span>
              </button>
              <button className={styles.dupNewBtn} onClick={handleSaveAsNew}>
                + New tonnage — count separately
              </button>
            </div>
            <p className={styles.dupTip}>Tip: if the volume just grew, link it here and edit the original demand to the new figure.</p>
          </div>
        </div>
      )}

      <div className={styles.form}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Client *</label>
            <input className={styles.input} value={form.client} onChange={e => setField('client', e.target.value)} placeholder="Client name" />
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
