// ── One call edit form, two entry points ──
// Used by All Calls (inline under the card) and by the Overview demand popup,
// so a trader edits the exact same fields the same way in both places.
// Every field of a call is editable here: client, date, prices & trends,
// demand rows (product / volume / port / target / laycan), notes, competitor
// offers (competitor / product / price / port / laycan) and remarks.
// Trader-only by desk ruling (2026-09-18): admin never edits or deletes calls.

import { PRODUCTS } from '../../data.js'
import PortSelect from './PortSelect.jsx'
import styles from './CallEditForm.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }
const DEMAND_PRODUCTS = ['', 'Amsul GR', 'Amsul STD', 'Urea', 'MAP', 'SSP 20%', 'SSP 19%', 'TSP 45%', 'TSP 46%', 'NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S']
const COMP_PRODUCTS = ['Amsul GR', 'Amsul STD', 'Urea', 'MAP', 'SSP 20%', 'SSP 19%', 'TSP 45%', 'TSP 46%', 'NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S']
const PRODUCT_GRADES = {
  Amsul: ['Amsul GR', 'Amsul STD'],
  SSP: ['SSP 20%', 'SSP 19%'],
  TSP: ['TSP 45%', 'TSP 46%'],
  NP: ['NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S'],
}
const DEFAULT_GRADE = { Amsul: 'Amsul GR', SSP: 'SSP 20%', TSP: 'TSP 45%', NP: 'NP 10-45' }

export function newDemandId() {
  return 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

export function emptyDemandRow() {
  return { id: newDemandId(), product: '', volume: '', port: '', priceTarget: '', laycan: '' }
}

export function emptyCompOffer() {
  return { competitor: '', product: 'Amsul GR', price: '', port: '', laycan: '' }
}

function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', trend: 'none', grade: DEFAULT_GRADE[p] || '' }]))
}

// Build the editable form state from a stored call. Legacy single-field
// demand (demandProduct/...) is lifted into one demand row; every row gets an id.
export function buildEditForm(c) {
  return {
    client: c.client || '',
    date: c.date || '',
    demandRows: c.demandRows?.length
      ? c.demandRows.map(r => r.id ? r : { ...r, id: newDemandId() })
      : (c.demandProduct || c.demandVolume || c.demandPort || c.demandPriceTarget)
        ? [{ id: newDemandId(), product: c.demandProduct || '', volume: c.demandVolume || '', port: c.demandPort || '', priceTarget: c.demandPriceTarget || '', laycan: '' }]
        : [emptyDemandRow()],
    demand: c.demand || '',
    remarks: c.remarks || '',
    competitorOffers: (c.competitorOffers || []).map(o => ({ ...emptyCompOffer(), ...o })),
    prices: { ...emptyPrices(), ...Object.fromEntries(PRODUCTS.map(p => [p, {
      value: c.prices?.[p]?.value || '',
      trend: c.prices?.[p]?.trend || 'none',
      grade: c.prices?.[p]?.grade || DEFAULT_GRADE[p] || '',
    }])) },
  }
}

export default function CallEditForm({ form, setForm, knownClients = [], onSave, onCancel, saving = false, datalistId = 'call-edit-client-names' }) {
  const canonicalClient = name => {
    const t = (name || '').trim().replace(/\s+/g, ' ')
    if (!t) return t
    const hit = knownClients.find(k => k.toLowerCase() === t.toLowerCase())
    return hit || t
  }
  const set = (field, val) => setForm(f => ({ ...f, [field]: val }))
  const setPrice = (p, field, val) => setForm(f => ({ ...f, prices: { ...f.prices, [p]: { ...f.prices[p], [field]: val } } }))
  const setRow = (i, field, val) => setForm(f => {
    const rows = [...(f.demandRows || [])]
    rows[i] = { ...rows[i], [field]: val }
    return { ...f, demandRows: rows }
  })
  const setOffer = (i, field, val) => setForm(f => {
    const offers = [...(f.competitorOffers || [])]
    offers[i] = { ...offers[i], [field]: val }
    return { ...f, competitorOffers: offers }
  })

  const rows = form.demandRows?.length ? form.demandRows : [emptyDemandRow()]
  const offers = form.competitorOffers || []

  return (
    <div className={styles.form}>
      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Client</label>
          <input className={styles.input} list={datalistId} value={form.client} onChange={e => set('client', e.target.value)} onBlur={e => set('client', canonicalClient(e.target.value))} />
          <datalist id={datalistId}>
            {knownClients.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Date</label>
          <input type="date" className={styles.input} value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Prices & Trends</label>
        {PRODUCTS.map(p => (
          <div key={p} className={styles.priceRow}>
            {PRODUCT_GRADES[p] ? (
              <select className={styles.gradeSelect} value={form.prices[p].grade || DEFAULT_GRADE[p]} onChange={e => setPrice(p, 'grade', e.target.value)}>
                {PRODUCT_GRADES[p].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            ) : (
              <span className={styles.productLabel}>{p}</span>
            )}
            <input className={styles.input} placeholder="Price" value={form.prices[p].value} onChange={e => setPrice(p, 'value', e.target.value)} />
            <select className={styles.select} value={form.prices[p].trend} onChange={e => setPrice(p, 'trend', e.target.value)}>
              {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className={styles.field}>
        <div className={styles.sectionHeader}>
          <label className={styles.label}>Demand</label>
          <button type="button" className={styles.addBtn} onClick={() => set('demandRows', [...rows, emptyDemandRow()])}>+ Add Demand</button>
        </div>
        {rows.map((row, i) => (
          <div key={row.id || i} className={styles.lineWrap}>
            <div className={styles.demandGrid}>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Product</label>
                <select className={styles.input} value={row.product || ''} onChange={e => setRow(i, 'product', e.target.value)}>
                  {DEMAND_PRODUCTS.map(p => <option key={p} value={p}>{p || '— Select —'}</option>)}
                </select>
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Volume (Tons)</label>
                <input type="number" step="0.01" min="0" className={styles.input} value={row.volume || ''} onChange={e => setRow(i, 'volume', e.target.value)} placeholder="e.g. 5,000.00" />
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Port</label>
                <PortSelect value={row.port || ''} onChange={val => setRow(i, 'port', val)} />
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Price Target</label>
                <input className={styles.input} value={row.priceTarget || ''} onChange={e => setRow(i, 'priceTarget', e.target.value)} placeholder="e.g. 240 CFR" />
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Laycan</label>
                <input className={styles.input} value={row.laycan || ''} onChange={e => setRow(i, 'laycan', e.target.value)} placeholder="e.g. Jun 15-30" />
              </div>
            </div>
            {rows.length > 1 && (
              <button type="button" className={styles.removeBtn} title="Remove demand" onClick={() => set('demandRows', rows.filter((_, idx) => idx !== i))}>✕</button>
            )}
          </div>
        ))}
        <textarea className={styles.textarea} rows={2} value={form.demand} onChange={e => set('demand', e.target.value)} placeholder="Additional demand notes..." />
      </div>

      <div className={styles.field}>
        <div className={styles.sectionHeader}>
          <label className={styles.label}>Competitor Offers</label>
          <button type="button" className={styles.addBtn} onClick={() => set('competitorOffers', [...offers, emptyCompOffer()])}>+ Add Offer</button>
        </div>
        {offers.length === 0 && <p className={styles.empty}>No competitor offers recorded for this call.</p>}
        {offers.map((o, i) => (
          <div key={i} className={styles.lineWrap}>
            <div className={styles.offerGrid}>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Competitor</label>
                <input className={styles.input} value={o.competitor || ''} onChange={e => setOffer(i, 'competitor', e.target.value)} placeholder="e.g. Koch, OCP, Helm" />
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Product</label>
                <select className={styles.input} value={o.product || 'Amsul GR'} onChange={e => setOffer(i, 'product', e.target.value)}>
                  {COMP_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Price</label>
                <input className={styles.input} value={o.price || ''} onChange={e => setOffer(i, 'price', e.target.value)} placeholder="e.g. 255 CFR" />
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Port</label>
                <PortSelect value={o.port || ''} onChange={val => setOffer(i, 'port', val)} />
              </div>
              <div className={styles.cell}>
                <label className={styles.subLabel}>Laycan</label>
                <input className={styles.input} value={o.laycan || ''} onChange={e => setOffer(i, 'laycan', e.target.value)} placeholder="e.g. Oct 15-30" />
              </div>
            </div>
            <button type="button" className={styles.removeBtn} title="Remove offer" onClick={() => set('competitorOffers', offers.filter((_, idx) => idx !== i))}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Remarks</label>
        <textarea className={styles.textarea} rows={3} value={form.remarks} onChange={e => set('remarks', e.target.value)} />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className={styles.saveBtn} onClick={onSave} disabled={saving}>{saving ? '◌ Saving…' : '◈ Save Changes'}</button>
      </div>
    </div>
  )
}
