import { useState } from 'react'
import styles from './Ops.module.css'
import { opsSaveInvoiceSettings, opsErrorText } from '../../cloudOps.js'

const FIELDS = { logo: '', company_cn: '', company: '', seller: '', bank_info: '', signature: '', packing: 'Bulk', provenance: 'China', acquisition: 'Singapore', payment_method: 'T/T Bank Transfer' }

// The seller's own details, printed on every invoice. Stored in the database,
// never in the app's code.
export default function OpsInvoiceSettings({ settings, ready, onChanged }) {
  const [form, setForm] = useState({ ...FIELDS, ...(settings || {}) })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setMsg('') }

  async function save() {
    setBusy(true); setError('')
    try {
      await opsSaveInvoiceSettings(form)
      setMsg('✓ Saved. New invoices use these details; invoices already issued keep what they were issued with.')
      await onChanged()
    } catch (e) { setError(opsErrorText(e, 'Could not save the settings.')) }
    setBusy(false)
  }

  if (!ready) return <div className={styles.wrap}><p className={styles.none}>Invoices are not set up in the database yet (run <b>4-operations-invoices.sql</b> in Supabase).</p></div>

  // The logo is kept with the settings in the database, never in the app's code
  function pickLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 300 * 1024) { setError('That image is over 300 KB. Use a smaller PNG or JPG of the logo.'); return }
    const reader = new FileReader()
    reader.onload = () => { set('logo', String(reader.result)); setError('') }
    reader.readAsDataURL(file)
  }

  const txt = (key, label) => (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input className={styles.input} value={form[key] || ''} onChange={e => set(key, e.target.value)} />
    </div>
  )
  const area = (key, label, rows) => (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <textarea className={styles.textarea} rows={rows} value={form[key] || ''} onChange={e => set(key, e.target.value)} />
    </div>
  )

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Invoice settings</h1>
          <p className={styles.sub}>Seller, bank details and defaults printed on every invoice</p>
        </div>
      </header>
      <div className={styles.card}>
        <div className={styles.cardTitle}>Seller</div>
        <div className={styles.gridForm}>
          {txt('company_cn', 'Company name (Chinese), top line')}
          {txt('company', 'Company name, second line')}
          {area('seller', 'Seller block (name and address)', 4)}
          {area('bank_info', 'Bank account information', 7)}
          {txt('signature', 'Signature line')}
          <div className={styles.field}>
            <label className={styles.label}>Logo (top right of the invoice)</label>
            <div className={styles.formRow}>
              {form.logo && <img src={form.logo} alt="Logo" style={{ height: 64, background: '#fff', borderRadius: 6, padding: 4 }} />}
              <input type="file" accept="image/png,image/jpeg" onChange={pickLogo} style={{ fontSize: 12, color: 'var(--text2)' }} />
              {form.logo && <button className={styles.small} onClick={() => set('logo', '')}>Remove logo</button>}
            </div>
          </div>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardTitle}>Defaults for a new invoice</div>
        <div className={styles.grid4}>
          {txt('packing', 'Packing')}
          {txt('provenance', 'Country of provenance')}
          {txt('acquisition', 'Country of acquisition')}
          {txt('payment_method', 'Payment method')}
        </div>
      </div>
      <div className={styles.formRow}>
        <button className={styles.btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        {msg && <span className={styles.success}>{msg}</span>}
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  )
}
