import { PRODUCTS } from './data.js'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) return d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dateStr
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  const natural = new Date(dateStr)
  if (!isNaN(natural.getTime())) return natural
  return new Date(0)
}

const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '' }
const TYPE_LABEL = { bid: 'Bid', target: 'Target', mrkt: 'Mkt offer', '': '' }

export function generateWeeklyReport(calls, signals) {
  // Filter calls from last 7 days
  const now = new Date()
  const weeklyCalls = calls.filter(c => {
    const diff = (now - parseDate(c.date)) / (1000 * 60 * 60 * 24)
    return diff <= 7
  }).sort((a, b) => parseDate(b.date) - parseDate(a.date))

  // Week range label
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 6)
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // Latest price per client
  const latestByClient = {}
  calls.forEach(c => {
    if (!latestByClient[c.client] || parseDate(c.date) > parseDate(latestByClient[c.client].date)) {
      latestByClient[c.client] = c
    }
  })

  // Demand status per client
  function getDemandStatus(client) {
    const latest = latestByClient[client]
    if (!latest) return 'No Demand'
    const diff = (now - parseDate(latest.date)) / (1000 * 60 * 60 * 24)
    if (diff > 7) return 'No Demand'
    const d = (latest.demand || '').toLowerCase()
    if (d.includes('no demand') || d.includes('no demanda')) return 'No Demand'
    if (d.includes('possible') || d.includes('looking')) return 'Potential'
    if (d.trim()) return 'Active'
    return 'No Demand'
  }

  const demandColor = { Active: '#7ab648', Potential: '#d4a017', 'No Demand': '#e05c4b' }

  // Collect all competitor offers this week
  const allCompOffers = []
  weeklyCalls.forEach(c => {
    (c.competitorOffers || []).forEach(o => {
      if (o.competitor || o.price) allCompOffers.push({ ...o, client: c.client, date: c.date })
    })
  })

  // Build price table rows (clients with any price data this week)
  const weeklyClients = [...new Set(weeklyCalls.map(c => c.client))]

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FertIntel Weekly Report – ${weekLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: white; font-size: 12px; }
  
  .page { max-width: 900px; margin: 0 auto; padding: 40px 48px; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid #111; margin-bottom: 28px; }
  .header-left h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
  .header-left p { font-size: 12px; color: #666; margin-top: 4px; }
  .header-right { text-align: right; }
  .header-right .brand { font-size: 14px; font-weight: 700; color: #111; }
  .header-right .meta { font-size: 11px; color: #888; margin-top: 3px; }

  .section { margin-bottom: 28px; }
  .section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #666; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0; margin-bottom: 12px; }

  /* Summary cards */
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 8px; }
  .summary-card { background: #f7f7f7; border-radius: 8px; padding: 12px 14px; }
  .summary-card .num { font-size: 22px; font-weight: 700; color: #111; }
  .summary-card .lbl { font-size: 10px; color: #888; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }

  /* Price table */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f0f0f0; padding: 7px 10px; text-align: left; font-size: 9px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; border-bottom: 1px solid #ccc; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #fafafa; }
  .client-name { font-weight: 700; }
  .trend-down { color: #e05c4b; }
  .trend-up { color: #7ab648; }
  .trend-stable { color: #888; }
  .price-type { font-size: 9px; color: #888; font-style: italic; }

  /* Demand status */
  .demand-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .demand-card { border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 12px; }
  .demand-card .name { font-weight: 600; font-size: 12px; }
  .demand-card .status { font-size: 10px; font-weight: 600; margin-top: 4px; display: inline-block; padding: 2px 8px; border-radius: 20px; }

  /* Call summaries */
  .call-item { padding: 10px 0; border-bottom: 1px solid #eee; }
  .call-item:last-child { border-bottom: none; }
  .call-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .call-client { font-weight: 700; font-size: 13px; }
  .call-date { font-size: 10px; color: #888; }
  .call-demand { font-size: 11px; color: #444; margin-top: 2px; }
  .call-remarks { font-size: 11px; color: #666; margin-top: 2px; font-style: italic; }

  /* Competitor table */
  .comp-table th { background: #f5f0ff; }

  /* Signals */
  .signal-item { display: flex; gap: 10px; padding: 8px 12px; background: #f7f7f7; border-radius: 6px; margin-bottom: 6px; font-size: 12px; }
  .signal-icon { font-size: 14px; flex-shrink: 0; }

  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; font-size: 10px; color: #aaa; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 20px 24px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <h1>Weekly Market Report</h1>
      <p>${weekLabel}</p>
    </div>
    <div class="header-right">
      <div class="brand">⬡ FertIntel</div>
      <div class="meta">Generated ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
    </div>
  </div>

  <!-- Summary -->
  <div class="section">
    <div class="section-title">Summary</div>
    <div class="summary-grid">
      <div class="summary-card"><div class="num">${weeklyCalls.length}</div><div class="lbl">Calls this week</div></div>
      <div class="summary-card"><div class="num">${weeklyClients.length}</div><div class="lbl">Clients contacted</div></div>
      <div class="summary-card"><div class="num">${allCompOffers.length}</div><div class="lbl">Competitor offers</div></div>
      <div class="summary-card"><div class="num">${weeklyCalls.filter(c => c.demand && !c.demand.toLowerCase().includes('no demand')).length}</div><div class="lbl">Active demand calls</div></div>
    </div>
  </div>

  <!-- Price Table -->
  <div class="section">
    <div class="section-title">Latest Prices per Client (this week)</div>
    ${weeklyClients.length === 0 ? '<p style="color:#888;font-size:12px">No calls this week.</p>' : `
    <table>
      <thead>
        <tr>
          <th>Client</th>
          <th>Date</th>
          ${PRODUCTS.map(p => `<th>${p}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${weeklyClients.map(cl => {
          const latest = latestByClient[cl]
          return `<tr>
            <td class="client-name">${cl}</td>
            <td>${formatDate(latest?.date)}</td>
            ${PRODUCTS.map(p => {
              const pr = latest?.prices?.[p]
              if (!pr?.value) return '<td style="color:#ccc">—</td>'
              const tClass = pr.trend === 'down' ? 'trend-down' : pr.trend === 'up' ? 'trend-up' : 'trend-stable'
              return `<td class="${tClass}">${pr.value}${pr.type ? `<br><span class="price-type">${TYPE_LABEL[pr.type] || pr.type}</span>` : ''} ${TREND_ICON[pr.trend] || ''}</td>`
            }).join('')}
          </tr>`
        }).join('')}
      </tbody>
    </table>`}
  </div>

  <!-- Client Demand Status -->
  <div class="section">
    <div class="section-title">Client Demand Status</div>
    <div class="demand-grid">
      ${weeklyClients.map(cl => {
        const status = getDemandStatus(cl)
        const color = demandColor[status] || '#888'
        return `<div class="demand-card">
          <div class="name">${cl}</div>
          <span class="status" style="color:${color};background:${color}18">${status}</span>
        </div>`
      }).join('')}
    </div>
  </div>

  <!-- Competitor Offers -->
  ${allCompOffers.length > 0 ? `
  <div class="section">
    <div class="section-title">Competitor Offers Mentioned</div>
    <table class="comp-table">
      <thead>
        <tr><th>Competitor</th><th>Product</th><th>Price</th><th>Reported by</th><th>Date</th></tr>
      </thead>
      <tbody>
        ${allCompOffers.map(o => `
        <tr>
          <td style="font-weight:600">${o.competitor || '—'}</td>
          <td>${o.product || '—'}</td>
          <td>${o.price || '—'}</td>
          <td>${o.client}</td>
          <td>${formatDate(o.date)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Call Summaries -->
  <div class="section">
    <div class="section-title">Call Notes (${weeklyCalls.length} calls)</div>
    ${weeklyCalls.length === 0 ? '<p style="color:#888;font-size:12px">No calls this week.</p>' :
      weeklyCalls.map(c => `
      <div class="call-item">
        <div class="call-header">
          <span class="call-client">${c.client}</span>
          <span class="call-date">${formatDate(c.date)}</span>
        </div>
        ${c.demand ? `<div class="call-demand">📋 ${c.demand}</div>` : ''}
        ${c.remarks ? `<div class="call-remarks">${c.remarks}</div>` : ''}
      </div>`).join('')
    }
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>FertIntel — Confidential</span>
    <span>fertintel.vercel.app</span>
  </div>

</div>
<script>
  window.onload = () => window.print()
</script>
</body>
</html>`

  return html
}
