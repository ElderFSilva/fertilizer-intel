import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Upload.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }

function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', trend: 'none' }]))
}

export default function Upload({ onAdd }) {
  const [mode, setMode] = useState('pdf') // 'pdf' | 'manual'
  const [file, setFile] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Form state
  const [form, setForm] = useState({
    client: '', date: new Date().toISOString().split('T')[0],
    demand: '', remarks: '', prices: emptyPrices()
  })

  async function handleExtract() {
    if (!file) return
    setExtracting(true)
    setError('')
    try {
      const base64 = await fileToBase64(file)
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 }
              },
              {
                type: 'text',
                text: `Extract all client call notes from this PDF. For each call form found, return a JSON array. Each object must have:
- client (string)
- date (string, format YYYY-MM-DD if possible, otherwise as written)
- demand (string, the demand section text)
- remarks (string, the remarks section text)
- prices (object with keys: Amsul, Urea, MAP, SSP, TSP, NP — each having value (string price or empty) and trend (one of: up, stable, down, none based on arrow checked))

Return ONLY a valid JSON array, no markdown, no explanation.`
              }
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

  function applyExtracted(entry) {
    setForm({
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
    })
    setExtracted(null)
    setMode('manual')
  }

  function handleSave() {
    if (!form.client.trim()) { setError('Client name is required.'); return }
    onAdd(form)
    setSaved(true)
    setForm({ client: '', date: new Date().toISOString().split('T')[0], demand: '', remarks: '', prices: emptyPrices() })
    setFile(null)
    setTimeout(() => setSaved(false), 3000)
  }

  function setPrice(product, field, val) {
    setForm(f => ({ ...f, prices: { ...f.prices, [product]: { ...f.prices[product], [field]: val } } }))
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Upload Call</h1>
        <div className={styles.toggle}>
          <button className={`${styles.toggleBtn} ${mode === 'pdf' ? styles.toggleActive : ''}`} onClick={() => setMode('pdf')}>⊕ PDF Extract</button>
          <button className={`${styles.toggleBtn} ${mode === 'manual' ? styles.toggleActive : ''}`} onClick={() => setMode('manual')}>◧ Manual Entry</button>
        </div>
      </header>

      {saved && <div className={styles.successBanner}>✓ Call saved successfully!</div>}

      {mode === 'pdf' && (
        <div className={styles.pdfSection}>
          <label className={styles.dropzone}>
            <input type="file" accept=".pdf" onChange={e => { setFile(e.target.files[0]); setExtracted(null) }} className={styles.fileInput} />
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
              <p className={styles.extractedTitle}>Found {extracted.length} call(s) — click to review & save:</p>
              {extracted.map((e, i) => (
                <div key={i} className={styles.extractedCard} onClick={() => applyExtracted(e)}>
                  <span className={styles.extractedClient}>{e.client || 'Unknown client'}</span>
                  <span className={styles.extractedDate}>{e.date}</span>
                  {e.demand && <p className={styles.extractedDemand}>{e.demand}</p>}
                  <span className={styles.extractedCta}>Click to review →</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div className={styles.form}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Client *</label>
              <input className={styles.input} value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))} placeholder="Client name" />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Date</label>
              <input type="date" className={styles.input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>

          <div className={styles.pricesSection}>
            <label className={styles.label}>Prices & Trends</label>
            <div className={styles.pricesGrid}>
              {PRODUCTS.map(p => (
                <div key={p} className={styles.priceRow}>
                  <span className={styles.productLabel}>{p}</span>
                  <input
                    className={styles.priceInput}
                    placeholder="Price"
                    value={form.prices[p].value}
                    onChange={e => setPrice(p, 'value', e.target.value)}
                  />
                  <select
                    className={styles.trendSelect}
                    value={form.prices[p].trend}
                    onChange={e => setPrice(p, 'trend', e.target.value)}
                  >
                    {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Demand</label>
            <textarea className={styles.textarea} rows={2} value={form.demand} onChange={e => setForm(f => ({ ...f, demand: e.target.value }))} placeholder="Demand notes from the call..." />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Remarks</label>
            <textarea className={styles.textarea} rows={3} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Additional remarks, competitor offers, market intelligence..." />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.saveBtn} onClick={handleSave}>◈ Save Call</button>
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
