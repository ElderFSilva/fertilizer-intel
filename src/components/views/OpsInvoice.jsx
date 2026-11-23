import { useState, useMemo, useRef, useEffect } from 'react'
import styles from './Ops.module.css'
import { opsSaveInvoice, opsIssueInvoice, opsUpdateParcel, opsErrorText, num, fmtN, fmtP, fmtQ } from '../../cloudOps.js'
import { PAYMENT_TERMS, INVOICE_PAGE, prefillInvoice, buildInvoiceModel, missingForIssue, renderInvoiceHTML, printInvoice, todayYMD, fmtInvDate } from '../../opsInvoice.js'

// The invoice of one allocated sale: proforma first, commercial once the BL
// exists. Client, product, discharge port and vessel are the sale's own.
// Quantity and CFR price default to the sale's, and ops may override them for
// this invoice only — the trader's sale is never changed.
export default function OpsInvoice({ parcel, shipment, sale, parcels, saleById, invoices, issues, presets, settings, ready, onBack, onChanged, onSettings }) {
  const saved = invoices.find(i => i.parcel_id === parcel.id)
  const myIssues = issues.filter(i => i.parcel_id === parcel.id)

  const starting = useMemo(() => {
    if (saved) return { ...prefillBlank(), ...saved.data }
    const saleByParcel = {}
    parcels.forEach(p => { saleByParcel[p.id] = saleById[p.sale_id] })
    const shipmentParcelIds = new Set(parcels.filter(p => p.shipment_id === shipment.id).map(p => p.id))
    return prefillInvoice({ parcel, sale, shipmentParcelIds, invoices, saleByParcel, presets, settings })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState(starting)
  // Final quantity lives on the allocated sale (shared with the cargo breakdown), not on the invoice
  const savedQty = parcel.final_qty != null ? String(parcel.final_qty) : ''
  const [finalQty, setFinalQty] = useState(savedQty)
  const [qtyBase, setQtyBase] = useState(savedQty)
  const liveParcel = { ...parcel, final_qty: num(finalQty) > 0 ? num(finalQty) : null }
  const [baseline, setBaseline] = useState(saved ? starting : null)
  const [previewKind, setPreviewKind] = useState(myIssues.some(i => i.kind === 'proforma') ? 'commercial' : 'proforma')
  const [issueDate, setIssueDate] = useState(todayYMD())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // The preview is an A4 landscape page scaled to the width of the screen
  const boxRef = useRef(null)
  const [scale, setScale] = useState(0.7)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / INVOICE_PAGE.width))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setNote('') }
  const dirty = !baseline || finalQty !== qtyBase || Object.keys(form).some(k => String(form[k] ?? '') !== String(baseline[k] ?? ''))

  const model = buildInvoiceModel({ kind: previewKind, date: issueDate, shipment, parcel: liveParcel, sale, data: form, settings })
  const previewHtml = useMemo(() => renderInvoiceHTML(model), [JSON.stringify(model)]) // eslint-disable-line react-hooks/exhaustive-deps
  const missing = kind => missingForIssue(kind, buildInvoiceModel({ kind, date: issueDate, shipment, parcel: liveParcel, sale, data: form, settings }), settings)

  // Saved consignees/buyers and goods descriptions: the starting list plus everything used on earlier invoices
  const partyOptions = useMemo(() => {
    const out = [], seen = new Set()
    const add = (label, d) => {
      if (!d?.consignee) return
      const key = `${d.consignee}||${d.buyer || ''}`
      if (seen.has(key)) return
      seen.add(key); out.push({ label, data: d })
    }
    presets.filter(p => p.kind === 'party').forEach(p => add(p.label, p.data))
    invoices.forEach(i => { const s = saleById[parcels.find(p => p.id === i.parcel_id)?.sale_id]; add(s?.client || 'Earlier invoice', i.data) })
    const mine = (sale?.client || '').trim().toLowerCase()
    return out.sort((a, b) => ((b.label || '').toLowerCase() === mine) - ((a.label || '').toLowerCase() === mine) || a.label.localeCompare(b.label))
  }, [presets, invoices]) // eslint-disable-line react-hooks/exhaustive-deps

  const goodsOptions = useMemo(() => {
    const out = [], seen = new Set()
    const add = (label, d) => {
      if (!d?.description) return
      const key = `${d.ncm}||${d.description}||${d.manufacturer}`
      if (seen.has(key)) return
      seen.add(key); out.push({ label, data: d })
    }
    presets.filter(p => p.kind === 'product').forEach(p => add(p.label, p.data))
    invoices.forEach(i => { const s = saleById[parcels.find(p => p.id === i.parcel_id)?.sale_id]; add(s?.product || 'Earlier invoice', i.data) })
    const mine = sale?.product || ''
    return out.sort((a, b) => (b.label === mine) - (a.label === mine) || a.label.localeCompare(b.label))
  }, [presets, invoices]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickParty(idx) {
    const o = partyOptions[idx]; if (!o) return
    setForm(f => ({
      ...f, consignee: o.data.consignee || '', buyer: o.data.buyer || '',
      payment_terms: o.data.payment_terms || f.payment_terms,
    }))
    setNote('')
  }
  function pickGoods(idx) {
    const o = goodsOptions[idx]; if (!o) return
    setForm(f => ({ ...f, ncm: o.data.ncm || '', description: o.data.description || '', origin: o.data.origin || f.origin, manufacturer: o.data.manufacturer || '' }))
    setNote('')
  }
  const firstLine = t => String(t || '').split('\n')[0]
  const tail = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? '…' + x.slice(-n) : x }

  async function saveQty() {
    if (finalQty === qtyBase) return
    await opsUpdateParcel(parcel.id, { final_qty: finalQty })
    setQtyBase(finalQty)
  }

  async function save() {
    setBusy(true); setError('')
    try {
      await saveQty()
      await opsSaveInvoice(parcel.id, form)
      setBaseline(form); setNote('✓ Saved.')
      await onChanged()
    } catch (e) { setError(opsErrorText(e, 'Could not save the invoice.')) }
    setBusy(false)
  }

  async function issue(kind) {
    const miss = missing(kind)
    if (miss.length) { setError(`Still missing: ${miss.join(', ')}.`); return }
    if (!issueDate) { setError('Choose the invoice date.'); return }
    setBusy(true); setError('')
    try {
      const snapshot = buildInvoiceModel({ kind, date: issueDate, shipment, parcel: liveParcel, sale, data: form, settings })
      await saveQty()
      await opsSaveInvoice(parcel.id, form)
      await opsIssueInvoice(parcel.id, kind, issueDate, snapshot)
      setBaseline(form)
      setNote(`✓ ${kind === 'commercial' ? 'Commercial' : 'Proforma'} invoice issued. Use "Print / PDF" below to save the file.`)
      setPreviewKind('commercial')
      await onChanged()
    } catch (e) { setError(opsErrorText(e, 'Could not issue the invoice.')) }
    setBusy(false)
  }

  function print(m) {
    if (!printInvoice(m)) setError('The browser blocked the new tab. Allow pop-ups for this site and try again.')
  }

  // An issued invoice no longer matches the sale (trader changed tons/price, or the reference was retyped)
  const last = myIssues[myIssues.length - 1]
  const drift = last && (
    Number(last.snapshot.quantity) !== (num(finalQty) || num(sale?.volume)) || Number(last.snapshot.cfr) !== (num(form.cfr_override) || num(sale?.donePrice)) ||
    (last.snapshot.number || '') !== (parcel.parcel_no || '').trim() || (last.snapshot.vessel || '') !== (shipment.vessel || ''))

  if (!ready) {
    return (
      <div className={styles.wrap}>
        <p className={styles.none}>Invoices are not set up in the database yet (run <b>4-operations-invoices.sql</b> in Supabase). <button className={styles.linkBtn} onClick={onBack}>Back to the shipment</button></p>
      </div>
    )
  }

  const ro = (label, value) => (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input className={`${styles.input} ${styles.readonly}`} value={value} readOnly />
    </div>
  )
  const txt = (key, label, ph, cls = '') => (
    <div className={`${styles.field} ${cls}`}>
      <label className={styles.label}>{label}</label>
      <input className={styles.input} placeholder={ph || ''} value={form[key] ?? ''} onChange={e => set(key, e.target.value)} />
    </div>
  )
  const saleQty = num(sale?.volume), saleCfr = num(sale?.donePrice)
  const invQty = num(finalQty) || saleQty
  const cfr = num(form.cfr_override) || saleCfr
  const fr = num(form.freight)
  const overridden = (num(finalQty) && num(finalQty) !== saleQty) || (num(form.cfr_override) && num(form.cfr_override) !== saleCfr)

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <div className={styles.crumb}><button className={styles.linkBtn} onClick={onBack}>Operations › Shipments › {shipment.vessel}</button> › {parcel.parcel_no || 'no reference yet'}</div>
          <h1 className={styles.title}>Invoice {parcel.parcel_no || ''}</h1>
          <p className={styles.sub}>{sale?.client || '—'} · {fmtQ(invQty)} t {sale?.product || ''} · CFR {sale?.port || '—'} {fmtP(cfr)}</p>
        </div>
        <button className={styles.ghost} onClick={onBack}>← Back to the shipment</button>
      </header>

      {!parcel.parcel_no && <p className={styles.warn}>This sale has no reference yet. Type it on the shipment page — it is the invoice number.</p>}
      {(!settings?.company || !settings?.bank_info) && (
        <p className={styles.warn}>Seller and bank details are empty. <button className={styles.linkBtn} onClick={onSettings}>Open Invoice settings →</button></p>
      )}

      <div className={styles.invLayout}>
        <div className={styles.invCol}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>From the sale · ops sets the final quantity and, if needed, the invoice price</div>
            <div className={styles.grid4}>
              {ro('Client', sale?.client || '—')}
              {ro('Product', sale?.product || '—')}
              <div className={styles.field}>
                <label className={styles.label}>Final quantity (MT)</label>
                <input className={styles.input} inputMode="decimal" placeholder={`${fmtQ(saleQty)} (sold)`} value={finalQty} onChange={e => { setFinalQty(e.target.value); setNote('') }} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Invoice CFR price</label>
                <input className={styles.input} inputMode="decimal" placeholder={`${fmtP(saleCfr)} (from the sale)`} value={form.cfr_override ?? ''} onChange={e => set('cfr_override', e.target.value)} />
              </div>
              {ro('Discharge port', sale?.port || '—')}
              {ro('Vessel', shipment.vessel)}
              {ro('FOB = CFR − freight', fr ? fmtP(cfr - fr) : '—')}
              {ro('Total USD', fmtP(cfr * invQty))}
            </div>
            {overridden
              ? <span className={styles.warn}>Sold as {fmtQ(saleQty)} t @ {fmtP(saleCfr)}. The final quantity also shows in the cargo breakdown; the trader's sale is not changed. Clear a field to go back to the sale's figure.</span>
              : <span className={styles.note}>Leave empty to use the sale's figures ({fmtQ(saleQty)} t @ {fmtP(saleCfr)}). The final quantity is the same one shown in the cargo breakdown.</span>}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Consignee and buyer</div>
            <div className={styles.field}>
              <label className={styles.label}>Fill from saved</label>
              <select className={styles.select} value="" onChange={e => pickParty(e.target.value)}>
                <option value="">Choose a saved consignee…</option>
                {partyOptions.map((o, i) => <option key={i} value={i}>{o.label} · {firstLine(o.data.consignee)}{o.data.buyer ? ` · buyer ${firstLine(o.data.buyer)}` : ''}</option>)}
              </select>
            </div>
            <div className={styles.gridForm}>
              <div className={styles.field}>
                <label className={styles.label}>Consignee (name, address, CNPJ)</label>
                <textarea className={styles.textarea} rows={6} value={form.consignee} onChange={e => set('consignee', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Buyer · leave empty when same as consignee</label>
                <textarea className={styles.textarea} rows={6} placeholder="same as consignee" value={form.buyer} onChange={e => set('buyer', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Payment terms</label>
                <input className={styles.input} list="ops-payment-terms" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} />
                <datalist id="ops-payment-terms">{PAYMENT_TERMS.map(t => <option key={t} value={t} />)}</datalist>
              </div>
              {txt('payment_method', 'Payment method')}
              {txt('buyer_ref', 'Buyer ref', 'e.g. IMP 043/26')}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Shipment details and goods</div>
            <div className={styles.gridForm}>
              {txt('load_port_text', 'Load port', 'e.g. Taizhou - China')}
              {txt('disch_port_text', 'Discharge port as printed', 'e.g. Paranagua - PR - Brazil')}
              {txt('incoterm', 'Incoterm', 'e.g. CFR Paranagua')}
              <div className={styles.field}>
                <label className={styles.label}>Freight USD/t</label>
                <input className={styles.input} inputMode="decimal" placeholder="e.g. 20.65" value={form.freight ?? ''} onChange={e => set('freight', e.target.value)} />
              </div>
              {txt('packing', 'Packing')}
              {txt('provenance', 'Country of provenance')}
              {txt('acquisition', 'Country of acquisition')}
              {txt('origin', 'Country of origin')}
              <div className={`${styles.field} ${styles.span2}`}>
                <label className={styles.label}>Fill goods from saved</label>
                <select className={styles.select} value="" onChange={e => pickGoods(e.target.value)}>
                  <option value="">Choose a saved description…</option>
                  {goodsOptions.map((o, i) => <option key={i} value={i}>{o.label} · {firstLine(o.data.manufacturer)} · {tail(o.data.description, 46)}</option>)}
                </select>
              </div>
              {txt('ncm', 'NCM', 'e.g. 3102.21.00')}
              <div className={styles.field}>
                <label className={styles.label}>Manufacturer (name and address)</label>
                <textarea className={styles.textarea} rows={3} value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} />
              </div>
              <div className={`${styles.field} ${styles.span2}`}>
                <label className={styles.label}>Description of goods</label>
                <textarea className={styles.textarea} rows={5} value={form.description} onChange={e => set('description', e.target.value)} />
              </div>
            </div>
          </div>

          <div className={styles.card}>
          <div className={styles.formRow}>
            <span className={styles.cardTitle}>Preview · not issued until you press Issue</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className={styles.small} style={previewKind === 'proforma' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null} onClick={() => setPreviewKind('proforma')}>Proforma</button>
              <button className={styles.small} style={previewKind === 'commercial' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null} onClick={() => setPreviewKind('commercial')}>Commercial</button>
            </span>
          </div>
          <div ref={boxRef} className={styles.previewBox} style={{ height: Math.round(INVOICE_PAGE.height * scale) }}>
            <iframe title="Invoice preview" className={styles.preview} style={{ transform: `scale(${scale})` }} srcDoc={previewHtml} />
          </div>
        </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Issue</div>
            <div className={styles.gridForm}>
              <div className={styles.field}>
                <label className={styles.label}>Invoice date</label>
                <input type="date" className={`${styles.input} ${styles.dateInput}`} value={issueDate} onChange={e => setIssueDate(e.target.value)} />
              </div>
              <div />
              {txt('bl_no', 'BL number · commercial only', 'e.g. BL-LG260301-3')}
              <div className={styles.field}>
                <label className={styles.label}>BL date · commercial only</label>
                <input type="date" className={`${styles.input} ${styles.dateInput}`} value={form.bl_date || ''} onChange={e => set('bl_date', e.target.value)} />
              </div>
            </div>
            <div className={styles.formRow}>
              <button className={styles.btn} onClick={() => issue('proforma')} disabled={busy}>Issue proforma</button>
              <button className={styles.btn} onClick={() => issue('commercial')} disabled={busy}>Issue commercial</button>
              <button className={styles.ghost} onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save without issuing'}</button>
            </div>
            {note && <span className={styles.success}>{note}</span>}
            {error && <span className={styles.error}>{error}</span>}

            {myIssues.length > 0 && (
              <>
                <div className={styles.cardTitle} style={{ marginTop: 6 }}>Issued · kept exactly as issued</div>
                {[...myIssues].reverse().map(i => (
                  <div key={i.id} className={styles.issueRow}>
                    <span><b>{i.kind === 'commercial' ? 'Commercial' : 'Proforma'}</b> · {i.snapshot.number} · {fmtInvDate(i.issued_on)} · {fmtQ(i.snapshot.quantity)} t @ {fmtP(i.snapshot.cfr)} · USD {fmtN(i.snapshot.total)}</span>
                    <button className={styles.small} style={{ marginLeft: 'auto' }} onClick={() => print(i.snapshot)}>Print / PDF</button>
                  </div>
                ))}
                {drift && <span className={styles.warn}>The sale, reference or vessel changed after the last invoice was issued. Issue again to produce an updated invoice; the earlier one stays on record.</span>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function prefillBlank() {
  return {
    consignee: '', buyer: '', payment_terms: '', payment_method: '', buyer_ref: '', packing: '', provenance: '', acquisition: '',
    load_port_text: '', disch_port_text: '', incoterm: '', ncm: '', description: '', origin: '', manufacturer: '', freight: '', bl_no: '', bl_date: '',
    cfr_override: '',
  }
}
