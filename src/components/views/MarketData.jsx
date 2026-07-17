import { useState, useEffect } from 'react'
import styles from './MarketData.module.css'
import { loadMarketRows, insertMarketRow, updateMarketRow, deleteMarketRow } from '../../cloudMarketData.js'

// ─────────────────────────────────────────────────────────────
// Stage 6.1 — Market Data
// One generic tabbed engine drives all seven datasets. Each tab
// declares its Supabase table, form fields, and history columns.
// Forms are admin-only; every logged-in trader can read the data.
// ─────────────────────────────────────────────────────────────

function todayYMD() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: 'numeric' })
}

function fmtMonth(v) {
  if (!v) return '—'
  const d = new Date(String(v).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}

const nice = s => (s == null || s === '' ? '—' : String(s).replace(/_/g, ' '))

// Field types: date | month | number | text | select
// select fields take options: [{ v, l }]
const TABS = [
  {
    id: 'intl',
    label: 'Intl Prices',
    table: 'intl_publications',
    hint: 'Argus / Fertecon / Profercy / Agrinvest price assessments (USD/mt).',
    fields: [
      { key: 'pub_date', label: 'Date', type: 'date', required: true, def: todayYMD },
      { key: 'source', label: 'Source', type: 'select', required: true, def: 'argus', options: [
        { v: 'argus', l: 'Argus' }, { v: 'fertecon', l: 'Fertecon' },
        { v: 'profercy', l: 'Profercy' }, { v: 'agrinvest', l: 'Agrinvest' } ] },
      { key: 'product', label: 'Product', type: 'select', required: true, def: 'amsul', options: [
        { v: 'amsul', l: 'Amsul' }, { v: 'urea', l: 'Urea' } ] },
      { key: 'price_point', label: 'Price Point', type: 'select', required: true, def: 'cfr_brazil', options: [
        { v: 'cfr_brazil', l: 'CFR Brazil' }, { v: 'fob_china', l: 'FOB China' },
        { v: 'fca_paranagua', l: 'FCA Paranaguá' }, { v: 'fob_paranagua', l: 'FOB Paranaguá' },
        { v: 'fob_rondonopolis', l: 'FOB Rondonópolis' }, { v: 'fob_middle_east', l: 'FOB Middle East' } ] },
      { key: 'grade', label: 'Grade', type: 'select', def: 'compacted', options: [
        { v: 'compacted', l: 'Compacted' }, { v: 'standard', l: 'Standard' },
        { v: 'granular', l: 'Granular' }, { v: '', l: '—' } ] },
      { key: 'frequency', label: 'Freq', type: 'select', def: 'weekly', options: [
        { v: 'weekly', l: 'Weekly' }, { v: 'daily', l: 'Daily' } ] },
      { key: 'price_low', label: 'Low', type: 'number', required: true, ph: 'e.g. 185' },
      { key: 'price_high', label: 'High', type: 'number', ph: 'e.g. 200' },
      { key: 'notes', label: 'Notes', type: 'text', ph: 'optional' },
    ],
    columns: [
      { key: 'pub_date', label: 'Date', fmt: fmtDate },
      { key: 'source', label: 'Source', fmt: nice },
      { key: 'product', label: 'Product', fmt: nice },
      { key: 'price_point', label: 'Point', fmt: nice },
      { key: 'grade', label: 'Grade', fmt: nice },
      { key: 'price_low', label: 'Low' },
      { key: 'price_high', label: 'High' },
      { key: '_mid', label: 'Mid', fmt: (_, r) => r.price_high != null && r.price_low != null
          ? Math.round((Number(r.price_low) + Number(r.price_high)) / 2) : (r.price_low ?? '—') },
    ],
  },
  {
    id: 'freight',
    label: 'Freight',
    table: 'freight_rates',
    hint: 'Your closed fixtures / quotes / yearly contract, plus published benchmarks.',
    fields: [
      { key: 'rate_date', label: 'Date', type: 'date', required: true, def: todayYMD },
      { key: 'route', label: 'Route', type: 'select', required: true, def: 'china_brazil', options: [
        { v: 'china_brazil', l: 'China → Brazil' }, { v: 'mideast_brazil', l: 'Mideast → Brazil' },
        { v: 'baltic_brazil', l: 'Baltic → Brazil' }, { v: 'paranagua_sorriso', l: 'Paranaguá → Sorriso' },
        { v: 'santos_rondonopolis', l: 'Santos → Rondonópolis' }, { v: 'other', l: 'Other (use notes)' } ] },
      { key: 'vessel_type', label: 'Vessel', type: 'select', def: 'panamax', options: [
        { v: 'panamax', l: 'Panamax' }, { v: 'supramax', l: 'Supramax' },
        { v: 'handysize', l: 'Handysize' }, { v: '', l: '— (inland)' } ] },
      { key: 'rate_type', label: 'Type', type: 'select', required: true, def: 'closed', options: [
        { v: 'closed', l: 'Closed fixture' }, { v: 'quote', l: 'Quote' },
        { v: 'contract', l: 'Yearly contract' }, { v: 'benchmark', l: 'Published benchmark' } ] },
      { key: 'source', label: 'Source', type: 'select', def: 'own', options: [
        { v: 'own', l: 'Own' }, { v: 'argus', l: 'Argus' }, { v: 'agrinvest', l: 'Agrinvest' } ] },
      { key: 'rate_low', label: 'Rate (low)', type: 'number', required: true, ph: 'e.g. 45' },
      { key: 'rate_high', label: 'Rate (high)', type: 'number', ph: 'optional' },
      { key: 'currency', label: 'Currency', type: 'select', def: 'USD', options: [
        { v: 'USD', l: 'USD' }, { v: 'BRL', l: 'BRL' } ] },
      { key: 'notes', label: 'Notes', type: 'text', ph: 'laycan, ports…' },
    ],
    columns: [
      { key: 'rate_date', label: 'Date', fmt: fmtDate },
      { key: 'route', label: 'Route', fmt: nice },
      { key: 'vessel_type', label: 'Vessel', fmt: nice },
      { key: 'rate_type', label: 'Type', fmt: nice },
      { key: 'source', label: 'Source', fmt: nice },
      { key: '_rate', label: 'Rate', fmt: (_, r) => r.rate_high != null && r.rate_high !== ''
          ? `${r.rate_low}–${r.rate_high} ${r.currency}` : `${r.rate_low} ${r.currency}` },
      { key: 'notes', label: 'Notes', fmt: nice },
    ],
  },
  {
    id: 'pace',
    label: 'Import Pace',
    table: 'supply_snapshots',
    hint: 'Agrinvest cumulative program (arrived + declared line-up). Each week, add TWO rows: this year\u2019s Jan\u2013now total AND last year\u2019s same-window total. Never edit old weeks \u2014 revisions are history.',
    fixed: { series: 'ytd_pace' },
    fields: [
      { key: 'report_date', label: 'Report Date', type: 'date', required: true, def: todayYMD },
      { key: 'product', label: 'Product', type: 'select', required: true, def: 'amsul', options: [
        { v: 'amsul', l: 'Amsul' }, { v: 'urea', l: 'Urea' } ] },
      { key: 'period', label: 'Cutoff Month (Jan\u2192this month)', type: 'month', required: true },
      { key: 'volume_kt', label: 'Cumulative (k tons)', type: 'number', required: true, ph: 'e.g. 3199' },
      { key: 'source', label: 'Source', type: 'select', def: 'agrinvest', options: [
        { v: 'agrinvest', l: 'Agrinvest' }, { v: 'other', l: 'Other' } ] },
    ],
    columns: [
      { key: 'report_date', label: 'Report', fmt: fmtDate },
      { key: 'product', label: 'Product', fmt: nice },
      { key: 'period', label: 'Window (Jan\u2192)', fmt: fmtMonth },
      { key: 'volume_kt', label: 'Cumulative', fmt: v => v != null ? `${Number(v).toLocaleString('en-US')}k Tons` : '—' },
      { key: 'source', label: 'Source', fmt: nice },
    ],
    filter: r => r.series === 'ytd_pace',
  },
  {
    id: 'barter',
    label: 'Barter',
    table: 'barter_ratios',
    hint: 'Relação de troca — sacas of crop per ton of product (sc/ton).',
    fields: [
      { key: 'ratio_date', label: 'Date', type: 'date', required: true, def: todayYMD },
      { key: 'crop', label: 'Crop', type: 'select', required: true, def: 'corn', options: [
        { v: 'corn', l: 'Corn' }, { v: 'soybean', l: 'Soybean' } ] },
      { key: 'product', label: 'Product', type: 'select', required: true, def: 'amsul', options: [
        { v: 'amsul', l: 'Amsul' }, { v: 'urea', l: 'Urea' }, { v: '20-00-20', l: '20-00-20' },
        { v: 'map', l: 'MAP' }, { v: 'kcl', l: 'KCl' }, { v: 'ssp', l: 'SSP' }, { v: '00-18-18', l: '00-18-18' } ] },
      { key: 'condition', label: 'Condition', type: 'select', def: 'antecipado', options: [
        { v: 'antecipado', l: 'Antecipado' }, { v: 'a_prazo', l: 'A Prazo' } ] },
      { key: 'region', label: 'Region', type: 'text', def: 'sorriso_mt', ph: 'sorriso_mt' },
      { key: 'ratio', label: 'Ratio (sc/ton)', type: 'number', required: true, ph: 'e.g. 42.8' },
    ],
    columns: [
      { key: 'ratio_date', label: 'Date', fmt: fmtDate },
      { key: 'crop', label: 'Crop', fmt: nice },
      { key: 'product', label: 'Product', fmt: nice },
      { key: 'condition', label: 'Condition', fmt: nice },
      { key: 'region', label: 'Region', fmt: nice },
      { key: 'ratio', label: 'sc/ton' },
    ],
  },
  {
    id: 'lineup',
    label: 'Line-up',
    table: 'supply_snapshots',
    hint: 'Argus forward line-up — total kt per arrival month. Each week, ADD new rows with that report\u2019s date (don\u2019t edit old weeks): the revision history is itself a signal.',
    fixed: { series: 'lineup' },
    fields: [
      { key: 'report_date', label: 'Report Date', type: 'date', required: true, def: todayYMD },
      { key: 'product', label: 'Product', type: 'select', required: true, def: 'amsul', options: [
        { v: 'amsul', l: 'Amsul' }, { v: 'urea', l: 'Urea' } ] },
      { key: 'period', label: 'Arrival Month', type: 'month', required: true },
      { key: 'volume_kt', label: 'Total Volume (k tons)', type: 'number', required: true, ph: 'e.g. 259' },
      { key: 'source', label: 'Source', type: 'select', def: 'argus', options: [
        { v: 'argus', l: 'Argus' }, { v: 'agrinvest', l: 'Agrinvest' }, { v: 'other', l: 'Other' } ] },
    ],
    columns: [
      { key: 'report_date', label: 'Report', fmt: fmtDate },
      { key: 'product', label: 'Product', fmt: nice },
      { key: 'period', label: 'Arrival Month', fmt: fmtMonth },
      { key: 'volume_kt', label: 'Total Volume', fmt: v => v != null ? `${Number(v).toLocaleString('en-US')}k Tons` : '—' },
      { key: 'source', label: 'Source', fmt: nice },
    ],
    filter: r => r.series === 'lineup',
  },
  {
    id: 'fx',
    label: 'FX',
    table: 'fx_rates',
    hint: 'USD/BRL — needed for import parity in reais.',
    fields: [
      { key: 'rate_date', label: 'Date', type: 'date', required: true, def: todayYMD },
      { key: 'rate', label: 'USD/BRL', type: 'number', required: true, ph: 'e.g. 5.116' },
      { key: 'source', label: 'Source', type: 'select', def: 'agrinvest', options: [
        { v: 'agrinvest', l: 'Agrinvest' }, { v: 'bcb', l: 'Central Bank' }, { v: 'other', l: 'Other' } ] },
    ],
    // pair defaults to 'usd_brl' at the DB level — no need to show it
    columns: [
      { key: 'rate_date', label: 'Date', fmt: fmtDate },
      { key: 'rate', label: 'USD/BRL' },
      { key: 'source', label: 'Source', fmt: nice },
    ],
  },
  {
    id: 'progress',
    label: 'Purchase %',
    table: 'purchase_progress',
    hint: '% of fertilizer already purchased by farmers, by crop and region.',
    fields: [
      { key: 'report_date', label: 'Date', type: 'date', required: true, def: todayYMD },
      { key: 'crop', label: 'Crop', type: 'select', required: true, def: 'soybean', options: [
        { v: 'soybean', l: 'Soybean' }, { v: 'safrinha_corn', l: 'Safrinha Corn' },
        { v: 'cotton', l: 'Cotton' }, { v: 'coffee', l: 'Coffee' }, { v: 'wheat', l: 'Wheat' } ] },
      { key: 'season', label: 'Season', type: 'text', required: true, def: '2026_27', ph: '2026_27' },
      { key: 'region', label: 'Region', type: 'text', def: 'brazil', ph: 'brazil / mt / pr…' },
      { key: 'pct', label: '% purchased', type: 'number', required: true, ph: '0–100' },
    ],
    columns: [
      { key: 'report_date', label: 'Date', fmt: fmtDate },
      { key: 'crop', label: 'Crop', fmt: nice },
      { key: 'season', label: 'Season', fmt: nice },
      { key: 'region', label: 'Region', fmt: nice },
      { key: 'pct', label: '%', fmt: v => v != null ? `${v}%` : '—' },
    ],
  },
]

function emptyFormFor(tab) {
  const f = {}
  tab.fields.forEach(fl => {
    f[fl.key] = fl.def ? (typeof fl.def === 'function' ? fl.def() : fl.def) : ''
  })
  return f
}

// month input gives 'YYYY-MM' — the DB wants a full date (first of month)
function toRowValues(tab, form) {
  const row = { ...(tab.fixed || {}) }
  tab.fields.forEach(fl => {
    let v = form[fl.key]
    if (v === '' || v == null) { row[fl.key] = null; return }
    if (fl.type === 'month') v = `${v}-01`
    if (fl.type === 'number') v = Number(v)
    row[fl.key] = v
  })
  return row
}

function toFormValues(tab, row) {
  const f = {}
  tab.fields.forEach(fl => {
    let v = row[fl.key]
    if (v == null) { f[fl.key] = ''; return }
    if (fl.type === 'month') v = String(v).slice(0, 7)
    if (fl.type === 'date') v = String(v).slice(0, 10)
    f[fl.key] = String(v)
  })
  return f
}

export default function MarketData({ role }) {
  const isAdmin = role === 'admin'
  const [tabId, setTabId] = useState(TABS[0].id)
  const tab = TABS.find(t => t.id === tabId)

  const [rows, setRows] = useState([])
  const [form, setForm] = useState(() => emptyFormFor(TABS[0]))
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function reload(t = tab) {
    setLoading(true)
    try {
      let r = await loadMarketRows(t.table)
      if (t.filter) r = r.filter(t.filter)
      setRows(r)
      setError('')
    } catch {
      setError('Could not load market data. Have the Stage 6.1 tables been created in Supabase?')
    }
    setLoading(false)
  }

  useEffect(() => {
    setForm(emptyFormFor(tab))
    setEditingId(null)
    setSaved(false)
    reload(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  function switchTab(id) { setTabId(id) }

  async function handleSave() {
    // validate required fields
    for (const fl of tab.fields) {
      if (fl.required && (form[fl.key] === '' || form[fl.key] == null)) {
        setError(`"${fl.label}" is required.`)
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const values = toRowValues(tab, form)
      if (editingId) {
        const updated = await updateMarketRow(tab.table, editingId, values)
        setRows(prev => prev.map(r => r.id === editingId ? updated : r))
      } else {
        const inserted = await insertMarketRow(tab.table, values)
        setRows(prev => [inserted, ...prev])
      }
      setForm(emptyFormFor(tab))
      setEditingId(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(editingId ? 'Could not update (admin only).' : 'Could not save (admin only).')
    }
    setBusy(false)
  }

  function startEdit(row) {
    setForm(toFormValues(tab, row))
    setEditingId(row.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setForm(emptyFormFor(tab))
    setEditingId(null)
    setError('')
  }

  async function handleDelete(id) {
    setBusy(true)
    try {
      await deleteMarketRow(tab.table, id)
      setRows(prev => prev.filter(r => r.id !== id))
    } catch {
      setError('Could not delete (admin only).')
    }
    setBusy(false)
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Market Data</h1>
          <p className={styles.sub}>External signals — prices, freight, imports, barter, vessels, FX, demand</p>
        </div>
      </header>

      {/* Tabs */}
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.tab} ${tabId === t.id ? styles.tabActive : ''}`}
            onClick={() => switchTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className={styles.hint}>{tab.hint}</p>

      {/* Entry form — admin only */}
      {isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{editingId ? '✎ Edit Entry' : '⊕ Add Entry'}</h2>
          <div className={styles.formWrap}>
            {tab.fields.map(fl => (
              <div key={fl.key} className={styles.formField}>
                <label className={styles.label}>
                  {fl.label}{fl.required ? ' *' : ''}
                </label>
                {fl.type === 'select' ? (
                  <select
                    className={styles.input}
                    value={form[fl.key]}
                    onChange={e => setForm(f => ({ ...f, [fl.key]: e.target.value }))}
                  >
                    {fl.options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                ) : (
                  <input
                    className={styles.input}
                    type={fl.type === 'number' ? 'number' : fl.type === 'month' ? 'month' : fl.type === 'date' ? 'date' : 'text'}
                    step={fl.type === 'number' ? 'any' : undefined}
                    placeholder={fl.ph || ''}
                    value={form[fl.key]}
                    onChange={e => setForm(f => ({ ...f, [fl.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <div className={styles.formActions}>
              {editingId && <button className={styles.cancelBtn} onClick={cancelEdit}>Cancel</button>}
              <button className={styles.saveBtn} onClick={handleSave} disabled={busy}>
                {busy ? 'Saving…' : (editingId ? '◈ Update' : '◈ Save')}
              </button>
            </div>
          </div>
          {error && <p className={styles.error}>{error}</p>}
          {saved && <p className={styles.success}>✓ Saved successfully!</p>}
        </section>
      )}
      {!isAdmin && error && <p className={styles.error}>{error}</p>}

      {/* History table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◧ {tab.label} History</h2>
        {loading ? (
          <p className={styles.none}>◌ Loading…</p>
        ) : rows.length === 0 ? (
          <p className={styles.none}>
            {isAdmin ? 'No entries yet — add the first one above.' : 'No data entered yet.'}
          </p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {tab.columns.map(c => <th key={c.key} className={styles.th}>{c.label}</th>)}
                  {isAdmin && <th className={styles.th}></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className={styles.tr}>
                    {tab.columns.map(c => (
                      <td key={c.key} className={styles.td}>
                        {c.fmt ? c.fmt(row[c.key], row) : (row[c.key] ?? '—')}
                      </td>
                    ))}
                    {isAdmin && (
                      <td className={styles.td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className={styles.editBtn} onClick={() => startEdit(row)}>✎</button>
                          <button className={styles.deleteBtn} onClick={() => handleDelete(row.id)} disabled={busy}>⊗</button>
                        </div>
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
