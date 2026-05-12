import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Upload.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const TYPE_OPTIONS = ['', 'bid', 'target', 'mrkt']
const TYPE_LABEL = { '': '—', bid: 'Bid', target: 'Target', mrkt: 'Market offer' }
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }


function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', type: '', trend: 'none' }]))
}

function emptyCompOffer() {
  return { competitor: '', product: 'Amsul', price: '' }
}

function entryToForm(entry) {
  return {
    client: entry.client || '',
    date: entry.date || new Date().toISOString().split('T')[0],
    demand: entry.demand || '',
    remarks: entry.remarks || '',
    prices: {
      ...emptyPrices(),
      ...Object.fromEntries(
        PRODUCTS.map(p => [p, {
          value: entry.prices?.[p]?.value || '',
          type: entry.prices?.[p]?.type || '',
          trend: entry.prices?.[p]?.trend || 'none'
        }])
      )
    },
    competitorOffers: entry.competitorOffers?.length ? entry.competitorOffers : []
  }
}

function emptyForm() {
  return {
    client: '', date: new Date().toISOString().split('T')[0],
    demand: '', remarks: '', prices: emptyPrices(), competitorOffers: []
  }
}

// Reusable competitor offers editor
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
          <input
            className={styles.compInput}
            placeholder="Competitor"
            value={o.competitor}
            onChange={e => updateOffer(i, 'competitor', e.target.value)}
          />
          <select className={styles.compSelect} value={o.product} onChange={e => updateOffer(i, 'product', e.target.value)}>
            {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            className={styles.compInput}
            placeholder="Price"
            value={o.price}
            onChange={e => updateOffer(i, 'price', e.target.value)}
          />

          <button type="button" className={styles.removeOfferBtn} onClick={() => removeOffer(i)}>✕</button>
        </div>
      ))}
    </div>
  )
}

export default function Upload({ onAdd }) {
  const [mode, setMode] = useState('pdf')
  const [file, setFile] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(null)
  const [savedIds, setSavedIds] = useState([])
  const [reviewing, setReviewing] = useState(null)
  const [error, setError] = useState('')
  const [savedBanner, setSavedBanner] = useState(false)
  const [manualForm, setManualForm] = useState(emptyForm())

  async function handleExtract() {
    if (!file) return
    setExtracting(true)
    setError('')
    setSavedIds([])
    setReviewing(null)
    try {
      const base64 = await fileToBase64(file)
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: `Extract all client call notes from this PDF. The current year is 2026. For each call form found, return a JSON array. Each object must have:
- client (string)
- date (string, format YYYY-MM-DD, always use year 2026 if year is not written)
- demand (string, the demand section text including volume in tons and laycan/timeframe if mentioned)
- remarks (string, the remarks section text)
- prices (object with keys: Amsul, Urea, MAP, SSP, TSP, NP — each having value (string price or empty), type (one of: bid, target, mrkt, or empty string — infer from context e.g. 'target' if client is targeting a price, 'mrkt' if it is a market offer, 'bid' if buyer is bidding), and trend (one of: up, stable, down, none based on arrow checked))
- competitorOffers (array of objects, each with: competitor (string), product (one of Amsul/Urea/MAP/SSP/TSP/NP), price (string). Extract these from the remarks section — look for mentions of companies offering products at specific prices)

Return ONLY a valid JSON array, no markdown, no explanation.` }
            ]
          }]
        })
      })
      const data = await response.json()
      const text = data.content.map(b => b.text || '').join('')
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setExtracted(parsed)
    } catch (e) {
      setError('Could not extract data. Try again or use manual entry.')
    }
    setExtracting(false)
  }

  function openReview(index) {
    setReviewing({ index, form: entryToForm(extracted[index]) })
    setError('')
  }

  function closeReview() { setReviewing(null); setError('') }

  function setReviewPrice(product, field, val) {
    setReviewing(r => ({ ...r, form: { ...r.form, prices: { ...r.form.prices, [product]: { ...r.form.prices[product], [field]: val } } } }))
  }

  function setReviewOffers(offers) {
    setReviewing(r => ({ ...r, form: { ...r.form, competitorOffers: offers } }))
  }

  function handleSaveReview() {
    if (!reviewing.form.client.trim()) { setError('Client name is required.'); return }
    onAdd(reviewing.form)
    setSavedIds(prev => [...prev, reviewing.index])
    setReviewing(null)
    setError('')
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  function setManualPrice(product, field, val) {
    setManualForm(f => ({ ...f, prices: { ...f.prices, [product]: { ...f.prices[product], [field]: val } } }))
  }

  function handleManualSave() {
    if (!manualForm.client.trim()) { setError('Client name is required.'); return }
    onAdd(manualForm)
    setManualForm(emptyForm())
    setError('')
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  const allSaved = extracted && savedIds.length === extracted.length

  // Shared form fields (used in both review and manual mode)
  function renderFormFields(form, setField, setPriceField, setOffers) {
    return <>
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
              <span className={styles.productLabel}>{p}</span>
              <input className={styles.priceInput} placeholder="Price" value={form.prices[p].value} onChange={e => setPriceField(p, 'value', e.target.value)} />
              <select className={styles.typeSelect} value={form.prices[p].type} onChange={e => setPriceField(p, 'type', e.target.value)}>
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
              <select className={styles.trendSelect} value={form.prices[p].trend} onChange={e => setPriceField(p, 'trend', e.target.value)}>
                {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Demand</label>
        <textarea className={styles.textarea} rows={2} value={form.demand} onChange={e => setField('demand', e.target.value)} placeholder="Demand notes, volume, laycan..." />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Remarks</label>
        <textarea className={styles.textarea} rows={3} value={form.remarks} onChange={e => setField('remarks', e.target.value)} placeholder="Additional remarks..." />
      </div>

      <CompetitorOffersEditor offers={form.competitorOffers || []} onChange={setOffers} />
    </>
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Upload Call</h1>
        <div className={styles.toggle}>
          <button className={`${styles.toggleBtn} ${mode === 'pdf' ? styles.toggleActive : ''}`} onClick={() => { setMode('pdf'); setReviewing(null) }}>⊕ PDF Extract</button>
          <button className={`${styles.toggleBtn} ${mode === 'manual' ? styles.toggleActive : ''}`} onClick={() => { setMode('manual'); setReviewing(null) }}>◧ Manual Entry</button>
        </div>
      </header>

      {savedBanner && <div className={styles.successBanner}>✓ Call saved successfully!</div>}

      {/* PDF MODE - list */}
      {mode === 'pdf' && !reviewing && (
        <div className={styles.pdfSection}>
          <label className={styles.dropzone}>
            <input type="file" accept=".pdf" onChange={e => { setFile(e.target.files[0]); setExtracted(null); setSavedIds([]) }} className={styles.fileInput} />
            <span className={styles.dropIcon}>⊕</span>
            <span>{file ? file.name : 'Click to select a PDF'}</span>
            {file && <span className={styles.fileSize}>{(file.size / 1024).toFixed(0)} KB</span>}
          </label>
          {file && (
            <button className={styles.extractBtn} onClick={handleExtract} disabled={extracting}>
              {extracting ? '◌ Extracting...' : '◈ Extract with AI'}
            </button>
          )}
          {error && <p className={styles.error}>{error}</p>}
          {extracted && (
            <div className={styles.extractedList}>
              <p className={styles.extractedTitle}>Found {extracted.length} call(s) — {savedIds.length}/{extracted.length} saved</p>
              {allSaved && <p className={styles.allSavedMsg}>✓ All calls saved!</p>}
              {extracted.map((e, i) => {
                const isSaved = savedIds.includes(i)
                return (
                  <div key={i} className={`${styles.extractedCard} ${isSaved ? styles.extractedSaved : ''}`} onClick={() => !isSaved && openReview(i)}>
                    <div className={styles.extractedTop}>
                      <span className={styles.extractedClient}>{e.client || 'Unknown client'}</span>
                      <span className={styles.extractedDate}>{e.date}</span>
                      {isSaved ? <span className={styles.savedBadge}>✓ Saved</span> : <span className={styles.extractedCta}>Review & Save →</span>}
                    </div>
                    {e.demand && <p className={styles.extractedDemand}>{e.demand}</p>}
                    {e.competitorOffers?.length > 0 && (
                      <p className={styles.extractedOffers}>🏷 {e.competitorOffers.length} competitor offer{e.competitorOffers.length > 1 ? 's' : ''} found</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* PDF MODE - review form */}
      {mode === 'pdf' && reviewing && (
        <div className={styles.form}>
          <div className={styles.reviewHeader}>
            <button className={styles.backBtn} onClick={closeReview}>← Back to list</button>
            <span className={styles.reviewingLabel}>Reviewing: <strong>{reviewing.form.client || 'Unknown'}</strong></span>
          </div>
          {renderFormFields(
            reviewing.form,
            (field, val) => setReviewing(r => ({ ...r, form: { ...r.form, [field]: val } })),
            setReviewPrice,
            setReviewOffers
          )}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.reviewActions}>
            <button className={styles.cancelBtn} onClick={closeReview}>Cancel</button>
            <button className={styles.saveBtn} onClick={handleSaveReview}>◈ Save Call</button>
          </div>
        </div>
      )}

      {/* MANUAL MODE */}
      {mode === 'manual' && (
        <div className={styles.form}>
          {renderFormFields(
            manualForm,
            (field, val) => setManualForm(f => ({ ...f, [field]: val })),
            setManualPrice,
            offers => setManualForm(f => ({ ...f, competitorOffers: offers }))
          )}
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.saveBtn} onClick={handleManualSave}>◈ Save Call</button>
        </div>
      )}
    </div>
  )
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = () => rej(new Error('Read failed'))
    r.readAsDataURL(file)
  })
}
