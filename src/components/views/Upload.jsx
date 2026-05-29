import PortSelect from './PortSelect.jsx'
import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Upload.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const NP_GRADES = ['NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S']
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }
const DEMAND_PRODUCTS = ['', 'Amsul', 'Urea', 'MAP', 'SSP', 'TSP', 'NP 10-45', 'NP 08-40']

function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', trend: 'none', grade: p === 'NP' ? 'NP 10-45' : '' }]))
}

function emptyCompOffer() {
  return { competitor: '', product: 'Amsul', price: '', port: '' }
}

function emptyDemandRow() {
  return { product: '', volume: '', port: '', priceTarget: '' }
}

function emptyForm() {
  return {
    client: '', date: new Date().toISOString().split('T')[0],
    demandRows: [emptyDemandRow()],
    demand: '', remarks: '', prices: emptyPrices(), competitorOffers: []
  }
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
                {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
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

export default function Upload({ onAdd }) {
  const [error, setError] = useState('')
  const [savedBanner, setSavedBanner] = useState(false)
  const [form, setForm] = useState(emptyForm())

  function setField(field, val) {
    setForm(f => ({ ...f, [field]: val }))
  }

  function setPriceField(product, field, val) {
    setForm(f => ({ ...f, prices: { ...f.prices, [product]: { ...f.prices[product], [field]: val } } }))
  }

  function setOffers(offers) {
    setForm(f => ({ ...f, competitorOffers: offers }))
  }

  function handleSave() {
    if (!form.client.trim()) { setError('Client name is required.'); return }
    onAdd(form)
    setForm(emptyForm())
    setError('')
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Upload Call</h1>
      </header>

      {savedBanner && <div className={styles.successBanner}>✓ Call saved successfully!</div>}

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
                {p === 'NP' ? (
                  <select className={styles.npGradeSelect} value={form.prices[p].grade || 'NP 10-45'} onChange={e => setPriceField(p, 'grade', e.target.value)}>
                    {NP_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
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
            <div key={i} className={styles.demandRowWrap}>
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
