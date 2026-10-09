// ── Sales report export: Excel (.xlsx) and PDF (print page) ──
// Both act on the rows the Sales Log is currently showing (search + filters
// applied). Trader column admin-only; PDF unbranded (rulings 2026-10-09).

import * as XLSX from 'xlsx'
import { buildSalesStats } from './sales.js'

const num = v => {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}
const fmtDate = d => {
  if (!d) return ''
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const todayYMD = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function saleDate(s) {
  return s.date || (s.created_at ? String(s.created_at).slice(0, 10) : '')
}

// One flat record per sale, numbers as numbers.
function flatten(sales, { isAdmin, traderNames }) {
  return sales.map(s => {
    const offer = num(s.offerPrice), done = num(s.donePrice)
    const row = {
      Date: saleDate(s),
      Laycan: s.laycan || '',
      Client: s.client || '',
    }
    if (isAdmin) row.Trader = traderNames?.[s.trader_id] || 'Trader'
    Object.assign(row, {
      Product: s.product || '',
      'Volume (t)': num(s.volume),
      Vessel: s.vessel || '',
      Port: s.port || '',
      Offer: offer,
      Bid: num(s.bidPrice),
      Done: done,
      'Spread (offer−done)': offer != null && done != null ? +(offer - done).toFixed(2) : null,
    })
    return row
  })
}

function describeFilters(f) {
  const bits = []
  if (f.search) bits.push(`search "${f.search}"`)
  if (f.product) bits.push(`product ${f.product}`)
  if (f.port) bits.push(`port ${f.port}`)
  if (f.trader) bits.push(`trader ${f.trader}`)
  if (f.dateFrom || f.dateTo) bits.push(`deal date ${f.dateFrom || '…'} to ${f.dateTo || '…'}`)
  return bits.length ? bits.join(' · ') : 'all sales'
}

// ── Excel ──
export function exportSalesXlsx(sales, opts) {
  const rows = flatten(sales, opts)
  const wb = XLSX.utils.book_new()

  const ws = XLSX.utils.json_to_sheet(rows)
  // totals row
  const n = rows.length
  if (n) {
    const totalVol = rows.reduce((a, r) => a + (r['Volume (t)'] || 0), 0)
    const dones = rows.map(r => r.Done).filter(v => v != null)
    const avgDone = dones.length ? dones.reduce((a, b) => a + b, 0) / dones.length : null
    const total = {}
    Object.keys(rows[0]).forEach(k => { total[k] = '' })
    total.Date = 'TOTAL'
    total.Client = `${n} sale${n === 1 ? '' : 's'}`
    total['Volume (t)'] = +totalVol.toFixed(2)
    total.Done = avgDone != null ? +avgDone.toFixed(1) : ''
    total.Vessel = avgDone != null ? 'avg done →' : ''
    XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 })
  }
  ws['!cols'] = Object.keys(rows[0] || { Date: 1 }).map(k => ({ wch: Math.max(10, Math.min(28, k.length + 4)) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Sales')

  const stats = buildSalesStats(sales)
  const summary = [
    { Metric: 'Filter', Value: describeFilters(opts.filters || {}) },
    { Metric: 'Exported', Value: todayYMD() },
    { Metric: 'Deals', Value: stats ? stats.totalDeals : 0 },
    { Metric: 'Total volume (t)', Value: stats ? +stats.totalVolume.toFixed(2) : 0 },
    { Metric: 'Avg spread (offer−done)', Value: stats && stats.avgSpread != null ? +stats.avgSpread.toFixed(2) : '' },
    {},
    ...(stats ? stats.productStats.map(p => ({ Metric: p.product, Value: +p.volume.toFixed(2), Deals: p.deals, 'Avg done': p.avgDone ?? '' })) : []),
  ]
  const ws2 = XLSX.utils.json_to_sheet(summary)
  ws2['!cols'] = [{ wch: 28 }, { wch: 40 }, { wch: 8 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary')

  XLSX.writeFile(wb, `fertintel-sales-${todayYMD()}.xlsx`)
}

// ── PDF (print page in the report's dark palette, opened in a new tab) ──
export function exportSalesPdf(sales, opts) {
  const rows = flatten(sales, opts)
  const stats = buildSalesStats(sales)
  const cols = Object.keys(rows[0] || { Date: 1, Laycan: 1, Client: 1, Product: 1, 'Volume (t)': 1, Vessel: 1, Port: 1, Offer: 1, Bid: 1, Done: 1, 'Spread (offer−done)': 1 })
  const numCols = new Set(['Volume (t)', 'Offer', 'Bid', 'Done', 'Spread (offer−done)'])
  const cell = (k, v) => {
    if (v == null || v === '') return '—'
    if (k === 'Date') return fmtDate(v)
    if (k === 'Volume (t)') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
    if (numCols.has(k)) return Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })
    return esc(v)
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sales report ${todayYMD()}</title>
<style>
  :root { --bg:#0e0f0c; --bg2:#161713; --border:#2a2b26; --text:#e8e9e2; --text2:#9a9b93; --text3:#5a5b54; --accent:#c8f060; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; padding: 32px; font-size: 12px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .sub { color: var(--text3); font-family: ui-monospace, Menlo, monospace; font-size: 11px; margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
  .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .stat b { display: block; font-size: 20px; font-family: ui-monospace, Menlo, monospace; }
  .stat span { color: var(--text3); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
  table { width: 100%; border-collapse: collapse; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  th { text-align: left; color: var(--text3); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; padding: 8px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td.num, th.num { text-align: right; }
  td.done { color: var(--accent); font-weight: 700; }
  tr.total td { border-top: 1px solid var(--text3); font-weight: 700; }
  .prod { margin-top: 18px; }
  .prod h2 { font-size: 13px; color: var(--text2); margin-bottom: 8px; }
  .foot { color: var(--text3); font-size: 10px; margin-top: 24px; font-family: ui-monospace, Menlo, monospace; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 16px; } @page { size: A4 landscape; margin: 10mm; } }
</style></head><body>
<h1>Sales report</h1>
<div class="sub">${esc(describeFilters(opts.filters || {}))} · exported ${todayYMD()} · ${rows.length} sale${rows.length === 1 ? '' : 's'}</div>
<div class="stats">
  <div class="stat"><b>${stats ? stats.totalDeals : 0}</b><span>Deals</span></div>
  <div class="stat"><b>${stats ? stats.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 0}</b><span>Total volume (t)</span></div>
  <div class="stat"><b>${stats && stats.avgSpread != null ? stats.avgSpread.toFixed(1) : '—'}</b><span>Avg spread (offer−done)</span></div>
</div>
<table>
  <thead><tr>${cols.map(k => `<th class="${numCols.has(k) ? 'num' : ''}">${esc(k)}</th>`).join('')}</tr></thead>
  <tbody>
    ${rows.map(r => `<tr>${cols.map(k => `<td class="${numCols.has(k) ? 'num' : ''}${k === 'Done' ? ' done' : ''}">${cell(k, r[k])}</td>`).join('')}</tr>`).join('')}
    ${rows.length ? `<tr class="total">${cols.map(k => {
      if (k === 'Date') return '<td>TOTAL</td>'
      if (k === 'Volume (t)') return `<td class="num">${rows.reduce((a, r) => a + (r['Volume (t)'] || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>`
      if (k === 'Done') { const d = rows.map(r => r.Done).filter(v => v != null); return `<td class="num done">${d.length ? 'avg ' + (d.reduce((a, b) => a + b, 0) / d.length).toFixed(1) : '—'}</td>` }
      return '<td></td>'
    }).join('')}</tr>` : ''}
  </tbody>
</table>
${stats && stats.productStats.length ? `
<div class="prod"><h2>Per product</h2>
<table><thead><tr><th>Product</th><th class="num">Volume (t)</th><th class="num">Deals</th><th class="num">Avg done</th></tr></thead>
<tbody>${stats.productStats.map(p => `<tr><td>${esc(p.product)}</td><td class="num">${p.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td><td class="num">${p.deals}</td><td class="num">${p.avgDone ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
<div class="foot">Use the browser's Print → Save as PDF.</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300))</script>
</body></html>`
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  return true
}
