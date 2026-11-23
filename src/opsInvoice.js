// ── Invoices (proforma → commercial) for the Operations environment ──
// Layout and fields follow the desk's shipment workbook (one invoice per sale).
// Client, product, discharge port and vessel come from the trader's sale.
// Quantity is the final quantity ops set for the sale (else the quantity sold);
// CFR price is the sale's unless ops overrides it on the invoice. The sale itself
// is never changed. Everything else is filled by ops. An issued invoice is stored
// as a frozen snapshot and printed from that snapshot.

import { num } from './cloudOps.js'

export const PAYMENT_TERMS = ['CAD (cash against documents)', '30 Days from BL Date', '15 Days from BL Date']

// Fields ops fills in, with the label used in "still missing" messages
export const INVOICE_FIELDS = {
  consignee: 'Consignee', buyer: 'Buyer', payment_terms: 'Payment terms', payment_method: 'Payment method',
  buyer_ref: 'Buyer ref', packing: 'Packing', provenance: 'Country of provenance', acquisition: 'Country of acquisition',
  load_port_text: 'Load port', disch_port_text: 'Discharge port', incoterm: 'Incoterm',
  ncm: 'NCM', description: 'Description of goods', origin: 'Country of origin', manufacturer: 'Manufacturer',
  freight: 'Freight per ton', bl_no: 'BL number', bl_date: 'BL date',
}

export function todayYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtInvDate(ymd) {
  if (!ymd) return ''
  const x = new Date(String(ymd).slice(0, 10) + 'T00:00:00')
  if (isNaN(x.getTime())) return String(ymd)
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(x.getDate()).padStart(2, '0')} ${M[x.getMonth()]} ${x.getFullYear()}`
}

const norm = v => (v || '').trim().replace(/\s+/g, ' ').toLowerCase()
const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })

// Starting values for a sale that has no invoice yet: what was used last time
// for the same client / product / vessel, then the saved lists, then defaults.
export function prefillInvoice({ parcel, sale, shipmentParcelIds, invoices, saleByParcel, presets, settings }) {
  const s = settings || {}
  const others = invoices
    .filter(i => i.parcel_id !== parcel.id)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  const sameClient = others.find(i => norm(saleByParcel[i.parcel_id]?.client) === norm(sale?.client))
  const sameProduct = others.find(i => (saleByParcel[i.parcel_id]?.product || '') === (sale?.product || ''))
  const sameVessel = others.find(i => shipmentParcelIds.has(i.parcel_id) && i.data?.freight !== undefined && i.data?.freight !== '')
  const partyHits = presets.filter(p => p.kind === 'party' && norm(p.label) === norm(sale?.client))
  const party = sameClient?.data || (partyHits.length === 1 ? partyHits[0].data : {})
  const productHits = presets.filter(p => p.kind === 'product' && p.label === (sale?.product || ''))
  const goods = sameProduct?.data || (productHits.length === 1 ? productHits[0].data : {})
  const port = sale?.port || ''
  return {
    consignee: party.consignee || '',
    buyer: party.buyer || '',
    payment_terms: party.payment_terms || '',
    payment_method: s.payment_method || 'T/T Bank Transfer',
    buyer_ref: '',
    packing: s.packing || 'Bulk',
    provenance: s.provenance || 'China',
    acquisition: s.acquisition || 'Singapore',
    load_port_text: parcel.load_port ? `${parcel.load_port} - China` : '',
    disch_port_text: (norm(party.disch_port_text).includes(norm(port).slice(0, 5)) && party.disch_port_text) || (port ? `${port} - Brazil` : ''),
    incoterm: port ? `CFR ${port}` : '',
    ncm: goods.ncm || '',
    description: goods.description || '',
    origin: goods.origin || s.provenance || 'China',
    manufacturer: goods.manufacturer || '',
    freight: sameVessel?.data?.freight ?? '',
    cfr_override: '',
    bl_no: '',
    bl_date: '',
  }
}

// Everything printed on one invoice, in one flat object. This is what gets frozen at issue.
export function buildInvoiceModel({ kind, date, shipment, parcel, sale, data, settings }) {
  const s = settings || {}
  // Quantity = the final quantity ops set for this sale (the same figure the cargo
  // breakdown shows), else the quantity sold. Price = the sale's, unless ops
  // overrides it on this invoice.
  const quantity = num(parcel.final_qty) || num(sale?.volume)
  const cfr = num(data.cfr_override) || num(sale?.donePrice)
  const freight = num(data.freight)
  const r2 = n => Math.round(n * 100) / 100
  const fob = r2(cfr - freight)
  return {
    kind, date,
    company_cn: s.company_cn || '', company: s.company || '', seller: s.seller || '',
    bank_info: s.bank_info || '', signature: s.signature || s.company || '',
    logo: s.logo || '',
    number: (parcel.parcel_no || '').trim(),
    bl_no: data.bl_no || '', bl_date: data.bl_date || '',
    payment_terms: data.payment_terms || '', payment_method: data.payment_method || '', buyer_ref: data.buyer_ref || '',
    consignee: data.consignee || '', buyer: (data.buyer || '').trim() || data.consignee || '',
    packing: data.packing || '', provenance: data.provenance || '', acquisition: data.acquisition || '',
    load_port: data.load_port_text || '', disch_port: data.disch_port_text || '', incoterm: data.incoterm || '',
    vessel: shipment.vessel || '',
    client: sale?.client || '', product: sale?.product || '',
    ncm: data.ncm || '', description: data.description || '', origin: data.origin || '', manufacturer: data.manufacturer || '',
    quantity, freight, fob, cfr,
    total: r2(cfr * quantity), total_fob: r2(fob * quantity), total_freight: r2(freight * quantity),
  }
}

// What still has to be filled before this kind of invoice can be issued
export function missingForIssue(kind, model, settings) {
  const miss = []
  if (!model.number) miss.push("the sale's reference (type it on the shipment page)")
  if (!(settings?.company) || !(settings?.bank_info)) miss.push('seller and bank details (Invoice settings)')
  if (!model.quantity) miss.push('quantity')
  if (!model.cfr) miss.push('CFR price')
  if (!model.consignee.trim()) miss.push('consignee')
  if (!model.payment_terms.trim()) miss.push('payment terms')
  if (!model.load_port.trim()) miss.push('load port')
  if (!model.disch_port.trim()) miss.push('discharge port')
  if (!model.ncm.trim()) miss.push('NCM')
  if (!model.description.trim()) miss.push('description of goods')
  if (!model.manufacturer.trim()) miss.push('manufacturer')
  if (!model.freight) miss.push('freight per ton')
  if (model.freight && model.freight >= model.cfr) miss.push('a freight lower than the CFR price')
  if (kind === 'commercial') {
    if (!model.bl_no.trim()) miss.push('BL number')
    if (!model.bl_date) miss.push('BL date')
  }
  return miss
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const block = s => esc(s).replace(/\n/g, '<br>')
const nameBlock = s => { const [first, ...rest] = String(s ?? '').split('\n'); return `<div class="nm">${esc(first)}</div>${rest.map(esc).join('<br>')}` }

// The invoice page: A4 landscape, laid out like the desk's workbook (blue
// company band, yellow title, logo on the right, one wide goods table).
// Used for the on-screen preview and, with print:true, for the PDF.
export const INVOICE_PAGE = { width: 1123, height: 860 }   // on-screen preview size (A4 landscape width, room for a long description)

export function renderInvoiceHTML(m, { print = false } = {}) {
  const commercial = m.kind === 'commercial'
  const title = commercial ? 'COMMERCIAL INVOICE' : 'PROFORMA INVOICE'
  const row = (k, v) => `<tr><td class="k">${k}</td><td>${esc(v)}</td></tr>`
  const details = [
    row('Invoice number', m.number),
    row('Date', fmtInvDate(m.date)),
    commercial ? row('BL', m.bl_no) : '',
    commercial ? row('BL date', fmtInvDate(m.bl_date)) : '',
    row('Payment terms', m.payment_terms),
    row('Payment method', m.payment_method),
    m.buyer_ref ? row('Buyer ref', m.buyer_ref) : '',
  ].join('')
  const shipA = [row('Vessel name', m.vessel), row('Load port', m.load_port), row('Disch. port', m.disch_port), row('Incoterm', m.incoterm)].join('')
  const shipB = [row('Packing', m.packing), row('Country of provenance', m.provenance), row('Country of acquisition', m.acquisition)].join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(m.number)}</title>
<style>
  @page { size: A4 landscape; margin: 9mm 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #1a1a1a; font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { ${print ? '' : 'width: 1123px; padding: 34px 38px;'} }
  .band { background: #b8cce4; text-align: center; padding: 6px 0 5px; border: 1px solid #5b7fa8; }
  .cn { font-size: 16px; letter-spacing: 2px; }
  .co { font-size: 14px; font-weight: 700; letter-spacing: .5px; margin-top: 2px; }
  .title { background: #ffff00; text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 3px; padding: 5px 0; border: 1px solid #5b7fa8; border-top: none; }
  .top { display: flex; gap: 20px; margin-top: 12px; align-items: stretch; }
  .blocks { flex: 1; display: grid; grid-template-columns: 1fr 1.15fr 1fr; gap: 10px; }
  .box { border: 1px solid #5b7fa8; }
  .box .hd { background: #b8cce4; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; padding: 4px 9px; border-bottom: 1px solid #5b7fa8; }
  .box .bd { padding: 6px 9px 7px; }
  .box .bd .nm { font-weight: 700; }
  .wide { grid-column: span 2; }
  .logo { flex: 0 0 180px; display: flex; align-items: center; justify-content: center; }
  .logo img { width: 100%; height: auto; }
  table { border-collapse: collapse; }
  .kv { width: 100%; }
  .kv td { padding: 1.5px 0; vertical-align: top; }
  .kv td.k { color: #444; white-space: nowrap; padding-right: 14px; width: 1%; }
  .kv td:last-child { font-weight: 700; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; align-items: start; }
  .goods { width: 100%; margin-top: 12px; }
  .goods th, .goods td { border: 1px solid #5b7fa8; padding: 6px 8px; vertical-align: top; text-align: left; }
  .goods th { background: #b8cce4; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; text-align: center; vertical-align: middle; }
  .goods td.n { text-align: right; white-space: nowrap; }
  .goods td.c { text-align: center; white-space: nowrap; }
  .below { display: flex; gap: 20px; margin-top: 12px; align-items: flex-start; }
  .bank { flex: 1; }
  .tots { width: 330px; }
  .tots td { border: 1px solid #5b7fa8; padding: 6px 10px; }
  .tots td:last-child { text-align: right; white-space: nowrap; }
  .tots tr.due td { font-weight: 700; background: #ffff00; font-size: 12.5px; }
  .sig { margin-top: 34px; text-align: right; }
  .sig span { display: inline-block; border-top: 1px solid #1a1a1a; padding-top: 5px; min-width: 330px; text-align: center; font-weight: 700; }
</style></head><body><div class="page">
  <div class="band"><div class="cn">${esc(m.company_cn)}</div><div class="co">${esc(m.company)}</div></div>
  <div class="title">${title}</div>

  <div class="top">
    <div class="blocks">
      <div class="box"><div class="hd">Seller</div><div class="bd">${nameBlock(m.seller)}</div></div>
      <div class="box"><div class="hd">Invoice details</div><div class="bd"><table class="kv">${details}</table></div></div>
      <div class="box"><div class="hd">Consignee</div><div class="bd">${nameBlock(m.consignee)}</div></div>
      <div class="box"><div class="hd">Buyer</div><div class="bd">${nameBlock(m.buyer)}</div></div>
      <div class="box wide"><div class="hd">Shipment details</div><div class="bd two"><table class="kv">${shipA}</table><table class="kv">${shipB}</table></div></div>
    </div>
    ${m.logo ? `<div class="logo"><img src="${esc(m.logo)}" alt=""></div>` : ''}
  </div>

  <table class="goods">
    <tr><th>NCM</th><th>Description of goods</th><th>Quantity</th><th>Un.</th><th>Freight</th><th>FOB price</th><th>CFR price</th><th>Total</th><th>Country of origin</th><th>Manufacturer</th></tr>
    <tr>
      <td class="c">${esc(m.ncm)}</td>
      <td style="width:33%">${block(m.description)}</td>
      <td class="n">${qty(m.quantity)}</td>
      <td class="c">MT</td>
      <td class="n">USD ${money(m.freight)}</td>
      <td class="n">USD ${money(m.fob)}</td>
      <td class="n">USD ${money(m.cfr)}</td>
      <td class="n"><b>USD ${money(m.total)}</b></td>
      <td class="c">${esc(m.origin)}</td>
      <td style="width:19%">${block(m.manufacturer)}</td>
    </tr>
  </table>

  <div class="below">
    <div class="box bank"><div class="hd">Bank account information</div><div class="bd">${block(m.bank_info)}</div></div>
    <table class="tots">
      <tr><td>TOTAL FOB</td><td>USD ${money(m.total_fob)}</td></tr>
      <tr><td>TOTAL FREIGHT</td><td>USD ${money(m.total_freight)}</td></tr>
      <tr class="due"><td>TOTAL AMOUNT DUE</td><td>USD ${money(m.total)}</td></tr>
    </table>
  </div>

  <div class="sig"><span>${esc(m.signature)}</span></div>
</div>${print ? `<script>
  window.onload = () => {
    const page = document.querySelector('.page')
    const max = 715   // printable height of A4 landscape with these margins, in px
    if (page.scrollHeight > max) page.style.zoom = max / page.scrollHeight
    window.print()
  }
</script>` : ''}</body></html>`
}

// Opens the invoice in a new tab with the print dialog → "Save as PDF".
export function printInvoice(model) {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(renderInvoiceHTML(model, { print: true }))
  win.document.close()
  return true
}
