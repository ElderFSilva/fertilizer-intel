import { PRODUCTS } from './data.js'

const ARGUS_KEY = 'fertintel_argus_amsul'
const FERTECON_KEY = 'fertintel_fertecon_amsul'

function loadStorage(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : [] }
  catch { return [] }
}

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

function parsePrice(val) {
  if (!val) return null
  const raw = String(val).replace(/[^0-9.\-]/g, '')
  if (raw.includes('-')) {
    const parts = raw.split('-').map(Number).filter(n => !isNaN(n))
    return parts.length === 2 ? (parts[0] + parts[1]) / 2 : null
  }
  const p = parseFloat(raw)
  return isNaN(p) ? null : p
}

function getWeekKey(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return monday.toISOString().split('T')[0]
}

const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '' }

// Build Amsul chart data for the report period
function buildChartData(calls, argusData, ferteconData, dateFrom, dateTo) {
  const weeks = new Set()
  const fromD = parseDate(dateFrom)
  const toD = parseDate(dateTo)
  toD.setHours(23, 59, 59)

  // Collect all relevant weeks
  argusData.forEach(a => {
    const d = parseDate(a.date)
    if (d >= fromD && d <= toD) weeks.add(a.date)
  })
  ferteconData.forEach(f => {
    const d = parseDate(f.date)
    if (d >= fromD && d <= toD) weeks.add(f.date)
  })
  calls.forEach(c => {
    const week = getWeekKey(c.date)
    if (week) {
      const d = parseDate(week)
      if (d >= fromD && d <= toD) weeks.add(week)
    }
  })

  // Build call weekly stats
  const callWeeks = {}
  calls.forEach(c => {
    const d = parseDate(c.date)
    if (d < fromD || d > toD) return
    const week = getWeekKey(c.date)
    if (!week) return
    const pr = c.prices?.Amsul
    if (!pr?.value) return
    const price = parsePrice(pr.value)
    if (!price) return
    if (!callWeeks[week]) callWeeks[week] = []
    callWeeks[week].push(price)
  })

  return [...weeks].sort().map(week => {
    const argus = argusData.find(a => a.date === week)
    const fertecon = ferteconData.find(f => f.date === week)
    const prices = callWeeks[week] || []
    return {
      week,
      label: formatDate(week),
      argusAvg: argus ? Math.round((argus.low + argus.high) / 2) : null,
      argusLow: argus?.low ?? null,
      argusHigh: argus?.high ?? null,
      ferteconAvg: fertecon ? Math.round((fertecon.low + fertecon.high) / 2) : null,
      callAvg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
      callLow: prices.length ? Math.min(...prices) : null,
      callHigh: prices.length ? Math.max(...prices) : null,
    }
  })
}

// Build SVG line chart
function buildChartSVG(chartData) {
  if (chartData.length < 2) return '<p style="color:#888;font-size:12px;text-align:center;padding:40px">Not enough publication data for this period.</p>'

  const W = 820, H = 260, PAD = { top: 20, right: 20, bottom: 40, left: 50 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  // Get all values to compute Y scale
  const allVals = chartData.flatMap(d => [d.argusAvg, d.ferteconAvg, d.callAvg, d.callLow, d.callHigh].filter(Boolean))
  if (!allVals.length) return '<p style="color:#888;font-size:12px;text-align:center;padding:40px">No price data available for this period.</p>'

  const minY = Math.floor(Math.min(...allVals) - 10)
  const maxY = Math.ceil(Math.max(...allVals) + 10)

  const xScale = i => PAD.left + (i / (chartData.length - 1)) * chartW
  const yScale = v => PAD.top + chartH - ((v - minY) / (maxY - minY)) * chartH

  function makeLine(key, color, dash = '') {
    const pts = chartData.map((d, i) => d[key] != null ? `${xScale(i)},${yScale(d[key])}` : null).filter(Boolean)
    if (pts.length < 2) return ''
    // Build path with gaps for nulls
    let path = ''
    chartData.forEach((d, i) => {
      if (d[key] == null) return
      path += path === '' ? `M ${xScale(i)} ${yScale(d[key])}` : ` L ${xScale(i)} ${yScale(d[key])}`
    })
    return `<path d="${path}" stroke="${color}" stroke-width="2" fill="none" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`
  }

  function makeDots(key, color) {
    return chartData.map((d, i) => d[key] != null
      ? `<circle cx="${xScale(i)}" cy="${yScale(d[key])}" r="4" fill="${color}" stroke="white" stroke-width="1.5"/>`
      : '').join('')
  }

  // Y grid lines
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const v = minY + (i / 4) * (maxY - minY)
    const y = yScale(v)
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#e8e8e8" stroke-width="1"/>
            <text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#999">${Math.round(v)}</text>`
  }).join('')

  // X labels
  const xLabels = chartData.map((d, i) => {
    const x = xScale(i)
    return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#999">${d.label}</text>`
  }).join('')

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:Arial,sans-serif">
    ${gridLines}
    ${makeLine('callHigh', '#ff6b5b')}
    ${makeLine('callLow', '#f0b840')}
    ${makeLine('callAvg', '#4caf50')}
    ${makeLine('argusAvg', '#60b8f0', '6 3')}
    ${makeLine('ferteconAvg', '#b860f0', '6 3')}
    ${makeDots('callHigh', '#ff6b5b')}
    ${makeDots('callLow', '#f0b840')}
    ${makeDots('callAvg', '#4caf50')}
    ${makeDots('argusAvg', '#60b8f0')}
    ${makeDots('ferteconAvg', '#b860f0')}
    ${xLabels}
  </svg>`
}

// Build price bubbles per product
function buildPriceBubbles(calls, dateFrom, dateTo) {
  const fromD = parseDate(dateFrom)
  const toD = parseDate(dateTo)
  toD.setHours(23, 59, 59)

  const periodCalls = calls.filter(c => {
    const d = parseDate(c.date)
    return d >= fromD && d <= toD
  })

  return PRODUCTS.map(product => {
    const prices = []
    periodCalls.forEach(c => {
      const pr = c.prices?.[product]
      if (!pr?.value) return
      const p = parsePrice(pr.value)
      if (p) prices.push(p)
    })
    if (!prices.length) return null
    return {
      product,
      low: Math.min(...prices),
      high: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      count: prices.length
    }
  }).filter(Boolean)
}

// Build demand volume per product
function buildDemandVolume(calls, dateFrom, dateTo) {
  const fromD = parseDate(dateFrom)
  const toD = parseDate(dateTo)
  toD.setHours(23, 59, 59)

  const periodCalls = calls.filter(c => {
    const d = parseDate(c.date)
    return d >= fromD && d <= toD
  })

  const volumeMap = {}
  periodCalls.forEach(c => {
    const rows = c.demandRows?.length ? c.demandRows
      : (c.demandProduct || c.demandVolume)
        ? [{ product: c.demandProduct, volume: c.demandVolume }]
        : []
    rows.forEach(r => {
      if (!r.product || !r.volume) return
      const vol = parseFloat(r.volume)
      if (isNaN(vol)) return
      volumeMap[r.product] = (volumeMap[r.product] || 0) + vol
    })
  })

  return Object.entries(volumeMap)
    .map(([product, total]) => ({ product, total }))
    .sort((a, b) => b.total - a.total)
}

export function generateWeeklyReport(calls, signals, dateFrom, dateTo) {
  const argusData = loadStorage(ARGUS_KEY)
  const ferteconData = loadStorage(FERTECON_KEY)

  // Default to last 7 days if no dates provided
  const now = new Date()
  const defaultFrom = new Date(now); defaultFrom.setDate(now.getDate() - 6)
  const fromStr = dateFrom || defaultFrom.toISOString().split('T')[0]
  const toStr = dateTo || now.toISOString().split('T')[0]

  const fromD = parseDate(fromStr)
  const toD = parseDate(toStr); toD.setHours(23, 59, 59)

  const periodCalls = calls.filter(c => {
    const d = parseDate(c.date)
    return d >= fromD && d <= toD
  }).sort((a, b) => parseDate(b.date) - parseDate(a.date))

  const periodLabel = `${formatDate(fromStr)} – ${formatDate(toStr)}`

  const latestByClient = {}
  calls.forEach(c => {
    if (!latestByClient[c.client] || parseDate(c.date) > parseDate(latestByClient[c.client].date)) {
      latestByClient[c.client] = c
    }
  })

  const allCompOffers = []
  periodCalls.forEach(c => {
    ;(c.competitorOffers || []).forEach(o => {
      if (o.competitor || o.price) allCompOffers.push({ ...o, client: c.client, date: c.date })
    })
  })

  const periodClients = [...new Set(periodCalls.map(c => c.client))]

  // Chart
  const chartData = buildChartData(calls, argusData, ferteconData, fromStr, toStr)
  const chartSVG = buildChartSVG(chartData)

  // Price bubbles
  const priceBubbles = buildPriceBubbles(calls, fromStr, toStr)

  // Demand volumes
  const demandVolumes = buildDemandVolume(calls, fromStr, toStr)

  const demandColor = { Active: '#7ab648', Potential: '#d4a017', 'No Demand': '#e05c4b' }

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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FertIntel Report – ${periodLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: white; font-size: 12px; }
  .page { max-width: 920px; margin: 0 auto; padding: 40px 48px; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid #111; margin-bottom: 28px; }
  .header-left h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
  .header-left p { font-size: 12px; color: #666; margin-top: 4px; }
  .header-right { text-align: right; }
  .header-right .brand { font-size: 14px; font-weight: 700; color: #111; }
  .header-right .meta { font-size: 11px; color: #888; margin-top: 3px; }

  .section { margin-bottom: 28px; }
  .section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #666; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0; margin-bottom: 14px; }

  /* Summary */
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .summary-card { background: #f7f7f7; border-radius: 8px; padding: 12px 14px; }
  .summary-card .num { font-size: 22px; font-weight: 700; color: #111; }
  .summary-card .lbl { font-size: 10px; color: #888; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }

  /* Chart */
  .chart-wrap { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px; overflow-x: auto; }
  .chart-legend { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #555; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .legend-dash { width: 18px; height: 2px; flex-shrink: 0; }

  /* Price bubbles */
  .bubbles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .bubble-card { border: 1px solid #e0e0e0; border-radius: 10px; padding: 14px 16px; }
  .bubble-product { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 8px; }
  .bubble-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .bubble-stat { text-align: center; }
  .bubble-stat .val { font-size: 16px; font-weight: 700; }
  .bubble-stat .lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .bubble-low .val { color: #f0b840; }
  .bubble-high .val { color: #e05c4b; }
  .bubble-avg .val { color: #4caf50; }
  .bubble-count { font-size: 10px; color: #aaa; margin-top: 6px; }

  /* Demand volume */
  .volume-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .volume-card { background: #f7f7f7; border-radius: 8px; padding: 12px 14px; }
  .volume-product { font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .volume-num { font-size: 18px; font-weight: 700; color: #111; }
  .volume-unit { font-size: 10px; color: #888; }

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
      <h1>Market Intelligence Report</h1>
      <p>${periodLabel}</p>
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
      <div class="summary-card"><div class="num">${periodCalls.length}</div><div class="lbl">Calls this period</div></div>
      <div class="summary-card"><div class="num">${periodClients.length}</div><div class="lbl">Clients contacted</div></div>
      <div class="summary-card"><div class="num">${allCompOffers.length}</div><div class="lbl">Competitor offers</div></div>
      <div class="summary-card"><div class="num">${demandVolumes.reduce((s, d) => s + d.total, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} T</div><div class="lbl">Total demand volume</div></div>
    </div>
  </div>

  <!-- Amsul Chart -->
  <div class="section">
    <div class="section-title">Amsul CFR Brazil — Publication vs Market</div>
    <div class="chart-wrap">
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-dash" style="background:#60b8f0;border-top:2px dashed #60b8f0"></div> Argus Avg</div>
        <div class="legend-item"><div class="legend-dash" style="background:#b860f0;border-top:2px dashed #b860f0"></div> Fertecon Avg</div>
        <div class="legend-item"><div class="legend-dot" style="background:#4caf50"></div> Call Average</div>
        <div class="legend-item"><div class="legend-dot" style="background:#f0b840"></div> Lowest Price</div>
        <div class="legend-item"><div class="legend-dot" style="background:#e05c4b"></div> Highest Price</div>
      </div>
      ${chartSVG}
    </div>
  </div>

  <!-- Price Bubbles -->
  ${priceBubbles.length > 0 ? `
  <div class="section">
    <div class="section-title">Price Range per Product — This Period</div>
    <div class="bubbles-grid">
      ${priceBubbles.map(b => `
      <div class="bubble-card">
        <div class="bubble-product">${b.product}</div>
        <div class="bubble-stats">
          <div class="bubble-stat bubble-low">
            <div class="val">${b.low}</div>
            <div class="lbl">Lowest</div>
          </div>
          <div class="bubble-stat bubble-avg">
            <div class="val">${b.avg}</div>
            <div class="lbl">Average</div>
          </div>
          <div class="bubble-stat bubble-high">
            <div class="val">${b.high}</div>
            <div class="lbl">Highest</div>
          </div>
        </div>
        <div class="bubble-count">${b.count} price point${b.count > 1 ? 's' : ''} recorded</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <!-- Demand Volume -->
  ${demandVolumes.length > 0 ? `
  <div class="section">
    <div class="section-title">Total Demand Volume per Product — This Period</div>
    <div class="volume-grid">
      ${demandVolumes.map(d => `
      <div class="volume-card">
        <div class="volume-product">${d.product}</div>
        <div class="volume-num">${d.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="volume-unit">tons</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <!-- Price Table -->
  <div class="section">
    <div class="section-title">Latest Prices per Client</div>
    ${periodClients.length === 0 ? '<p style="color:#888;font-size:12px">No calls this period.</p>' : `
    <table>
      <thead>
        <tr>
          <th>Client</th>
          <th>Date</th>
          ${PRODUCTS.map(p => `<th>${p}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${periodClients.map(cl => {
          const latest = latestByClient[cl]
          return `<tr>
            <td class="client-name">${cl}</td>
            <td>${formatDate(latest?.date)}</td>
            ${PRODUCTS.map(p => {
              const pr = latest?.prices?.[p]
              if (!pr?.value) return '<td style="color:#ccc">—</td>'
              const tClass = pr.trend === 'down' ? 'trend-down' : pr.trend === 'up' ? 'trend-up' : 'trend-stable'
              return `<td class="${tClass}">${pr.value} ${TREND_ICON[pr.trend] || ''}</td>`
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
      ${periodClients.map(cl => {
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
        <tr><th>Competitor</th><th>Product</th><th>Price</th><th>Port</th><th>Reported by</th><th>Date</th></tr>
      </thead>
      <tbody>
        ${allCompOffers.map(o => `
        <tr>
          <td style="font-weight:600">${o.competitor || '—'}</td>
          <td>${o.product || '—'}</td>
          <td>${o.price || '—'}</td>
          <td>${o.port || '—'}</td>
          <td>${o.client}</td>
          <td>${formatDate(o.date)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Call Summaries -->
  <div class="section">
    <div class="section-title">Call Notes (${periodCalls.length} calls)</div>
    ${periodCalls.length === 0 ? '<p style="color:#888;font-size:12px">No calls this period.</p>' :
      periodCalls.map(c => `
      <div class="call-item">
        <div class="call-header">
          <span class="call-client">${c.client}</span>
          <span class="call-date">${formatDate(c.date)}</span>
        </div>
        ${c.demand ? `<div class="call-demand">📋 ${c.demand}</div>` : ''}
        ${c.remarks ? `<div class="call-remarks">${c.remarks}</div>` : ''}
      </div>`).join('')}
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
