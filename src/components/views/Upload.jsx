import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Upload.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }

function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', trend: 'none' }]))
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
          trend: entry.prices?.[p]?.trend || 'none'
        }])
      )
    }
  }
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

  const [manualForm, setManualForm] = useState({
    client: '', date: new Date().toISOString().split('T')[0],
    demand: '', remarks: '', prices: emptyPrices()
  })

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
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: `Extract all client call notes from this PDF. For each call form found, return a JSON array. Each object must have:\n- client (string)\n- date (string, format YYYY-MM-DD if possible, otherwise as written)\n- demand (string, the demand section text)\n- remarks (string, the remarks section text)\n- prices (object with keys: Amsul, Urea, MAP, SSP, TSP, NP — each having value (string price or empty) and trend (one of: up, stable, down, none based on arrow checked))\n\nReturn ONLY a valid JSON array, no markdown, no explanation.` }
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
    setManualForm({ client: '', date: new Date().toISOString().split('T')[0], demand: '', remarks: '', prices: emptyPrices() })
    setError('')
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  const allSaved = extracted && savedIds.length === extracted.length

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
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {mode === 'pdf' && reviewing && (
        <div className={styles.form}>
          <div className={styles.reviewHeader}>
            <button className={styles.backBtn} onClick={closeReview}>← Back to list</button>
            <span className={styles.reviewingLabel}>Reviewing: <strong>{reviewing.form.client || 'Unknown'}</strong></span>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Client *</label>
              <input className={styles.input} value={reviewing.form.client} onChange={e => setReviewing(r => ({ ...r, form: { ...r.form, client: e.target.value } }))} placeholder="Client name" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Date</label>
              <input type="date" className={styles.input} value={reviewing.form.date} onChange={e => setReviewing(r => ({ ...r, form: { ...r.form, date: e.target.value } }))} />
            </div>
          </div>
          <div className={styles.pricesSection}>
            <label className={styles.label}>Prices & Trends</label>
            <div className={styles.pricesGrid}>
              {PRODUCTS.map(p => (
                <div key={p} className={styles.priceRow}>
                  <span className={styles.productLabel}>{p}</span>
                  <input className={styles.priceInput} placeholder="Price" value={reviewing.form.prices[p].value} onChange={e => setReviewPrice(p, 'value', e.target.value)} />
                  <select className={styles.trendSelect} value={reviewing.form.prices[p].trend} onChange={e => setReviewPrice(p, 'trend', e.target.value)}>
                    {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Demand</label>
            <textarea className={styles.textarea} rows={2} value={reviewing.form.demand} onChange={e => setReviewing(r => ({ ...r, form: { ...r.form, demand: e.target.value } }))} placeholder="Demand notes..." />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Remarks</label>
            <textarea className={styles.textarea} rows={3} value={reviewing.form.remarks} onChange={e => setReviewing(r => ({ ...r, form: { ...r.form, remarks: e.target.value } }))} placeholder="Additional remarks..." />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.reviewActions}>
            <button className={styles.cancelBtn} onClick={closeReview}>Cancel</button>
            <button className={styles.saveBtn} onClick={handleSaveReview}>◈ Save Call</button>
          </div>
        </div>
      )}

      {mode === 'manual' && (
        <div className={styles.form}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Client *</label>
              <input className={styles.input} value={manualForm.client} onChange={e => setManualForm(f => ({ ...f, client: e.target.value }))} placeholder="Client name" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Date</label>
              <input type="date" className={styles.input} value={manualForm.date} onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div className={styles.pricesSection}>
            <label className={styles.label}>Prices & Trends</label>
            <div className={styles.pricesGrid}>
              {PRODUCTS.map(p => (
                <div key={p} className={styles.priceRow}>
                  <span className={styles.productLabel}>{p}</span>
                  <input className={styles.priceInput} placeholder="Price" value={manualForm.prices[p].value} onChange={e => setManualPrice(p, 'value', e.target.value)} />
                  <select className={styles.trendSelect} value={manualForm.prices[p].trend} onChange={e => setManualPrice(p, 'trend', e.target.value)}>
                    {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Demand</label>
            <textarea className={styles.textarea} rows={2} value={manualForm.demand} onChange={e => setManualForm(f => ({ ...f, demand: e.target.value }))} placeholder="Demand notes from the call..." />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Remarks</label>
            <textarea className={styles.textarea} rows={3} value={manualForm.remarks} onChange={e => setManualForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Additional remarks..." />
          </div>
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

