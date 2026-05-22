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

// Short label for chart X axis — matches Publication.jsx formatDateLabel exactly
function formatDateLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

// Copied exactly from Publication.jsx
function getWeekMonday(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return monday.toISOString().split('T')[0]
}

function getWeekThursday(dateStr) {
  const monday = getWeekMonday(dateStr)
  if (!monday) return null
  const d = new Date(monday + 'T00:00:00')
  d.setDate(d.getDate() + 3)
  return d.toISOString().split('T')[0]
}

// Copied exactly from Publication.jsx buildChartData
function buildChartData(calls, argusData, ferteconData) {
  const weekMap = {}

  argusData.forEach(a => {
    if (!weekMap[a.date]) weekMap[a.date] = {}
    weekMap[a.date].argusAvg = Math.round((a.low + a.high) / 2)
    weekMap[a.date].argusLow = a.low
    weekMap[a.date].argusHigh = a.high
  })

  ferteconData.forEach(f => {
    if (!weekMap[f.date]) weekMap[f.date] = {}
    weekMap[f.date].ferteconAvg = Math.round((f.low + f.high) / 2)
  })

  const callsByWeek = {}
  calls.forEach(c => {
    const d = parseDate(c.date)
    if (d.getTime() === 0) return
    const day = d.getDay()
    if (day === 0 || day === 6) return
    const thursday = getWeekThursday(c.date)
    if (!thursday) return
    const pr = c.prices?.Amsul
    if (!pr?.value) return
    const price = parsePrice(pr.value)
    if (!price) return
    if (!callsByWeek[thursday]) callsByWeek[thursday] = []
    callsByWeek[thursday].push(price)
  })

  Object.entries(callsByWeek).forEach(([thursday, prices]) => {
    if (!weekMap[thursday]) weekMap[thursday] = {}
    weekMap[thursday].callAvg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    weekMap[thursday].lowestPrice = Math.min(...prices)
    weekMap[thursday].highestPrice = Math.max(...prices)
  })

  return Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: formatDateLabel(date),
      argusAvg: data.argusAvg ?? null,
      ferteconAvg: data.ferteconAvg ?? null,
      callAvg: data.callAvg ?? null,
      lowestPrice: data.lowestPrice ?? null,
      highestPrice: data.highestPrice ?? null,
    }))
}

// Build SVG chart using exact same data as Publication.jsx
function buildChartSVG(chartData) {
  if (chartData.length < 2) return '<p style="color:#888;font-size:12px;text-align:center;padding:40px 0">Not enough data to display chart.</p>'

  const W = 860, H = 280
  const PAD = { top: 20, right: 100, bottom: 40, left: 50 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  // Use only argus, fertecon, callAvg for Y scale — same as app
  const allVals = chartData.flatMap(d => [d.argusAvg, d.ferteconAvg, d.callAvg].filter(Boolean))
  if (!allVals.length) return '<p style="color:#888;font-size:12px;text-align:center;padding:40px 0">No price data available.</p>'

  const minY = Math.floor(Math.min(...allVals) - 10)
  const maxY = Math.ceil(Math.max(...allVals) + 10)

  const n = chartData.length
  const xScale = i => PAD.left + (i / Math.max(n - 1, 1)) * chartW
  const yScale = v => PAD.top + chartH - ((v - minY) / (maxY - minY)) * chartH

  function makeLine(key, color, dash = '') {
    let path = ''
    chartData.forEach((d, i) => {
      if (d[key] == null) return
      path += path === '' ? `M ${xScale(i).toFixed(1)} ${yScale(d[key]).toFixed(1)}`
                          : ` L ${xScale(i).toFixed(1)} ${yScale(d[key]).toFixed(1)}`
    })
    if (!path) return ''
    return `<path d="${path}" stroke="${color}" stroke-width="2.5" fill="none" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`
  }

  function makeDots(key, color) {
    return chartData.map((d, i) => d[key] != null
      ? `<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(d[key]).toFixed(1)}" r="5" fill="${color}" stroke="white" stroke-width="1.5"/>`
      : '').join('')
  }

  // Y grid lines (5 levels)
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const v = minY + (i / 4) * (maxY - minY)
    const y = yScale(v).toFixed(1)
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#e0e0e0" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${PAD.left - 6}" y="${(parseFloat(y) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#999">${Math.round(v)}</text>`
  }).join('')

  // X labels — one per data point, same as app
  const xLabels = chartData.map((d, i) =>
    `<text x="${xScale(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#999">${d.label}</text>`
  ).join('')

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:100%;display:block">
    <!-- Grid -->
    ${gridLines}
    <!-- Border -->
    <rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="none" stroke="#e0e0e0" stroke-width="1"/>
    <!-- Lines — same order as Publication.jsx -->
    ${makeLine('argusAvg', '#60b8f0', '6 3')}
    ${makeLine('ferteconAvg', '#b860f0', '6 3')}
    ${makeLine('callAvg', '#4caf50')}
    <!-- Dots -->
    ${makeDots('argusAvg', '#60b8f0')}
    ${makeDots('ferteconAvg', '#b860f0')}
    ${makeDots('callAvg', '#4caf50')}
    <!-- X labels -->
    ${xLabels}
  </svg>`
}

function buildPriceBubbles(calls, fromStr, toStr) {
  const fromD = parseDate(fromStr)
  const toD = parseDate(toStr); toD.setHours(23, 59, 59)
  const PRODUCTS = ['Amsul', 'Urea', 'MAP', 'SSP', 'TSP', 'NP']
  const periodCalls = calls.filter(c => { const d = parseDate(c.date); return d >= fromD && d <= toD })

  return PRODUCTS.map(product => {
    const prices = []
    periodCalls.forEach(c => {
      const pr = c.prices?.[product]; if (!pr?.value) return
      const p = parsePrice(pr.value); if (p) prices.push(p)
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

function buildDemandVolume(calls, fromStr, toStr) {
  const fromD = parseDate(fromStr)
  const toD = parseDate(toStr); toD.setHours(23, 59, 59)
  const periodCalls = calls.filter(c => { const d = parseDate(c.date); return d >= fromD && d <= toD })

  const map = {}
  periodCalls.forEach(c => {
    const rows = c.demandRows?.length ? c.demandRows
      : (c.demandProduct || c.demandVolume) ? [{ product: c.demandProduct, volume: c.demandVolume }] : []
    rows.forEach(r => {
      if (!r.product || !r.volume) return
      const vol = parseFloat(r.volume); if (isNaN(vol)) return
      map[r.product] = (map[r.product] || 0) + vol
    })
  })

  return Object.entries(map).map(([product, total]) => ({ product, total })).sort((a, b) => b.total - a.total)
}

export function generateWeeklyReport(calls, signals, dateFrom, dateTo) {
  const argusData = loadStorage(ARGUS_KEY)
  const ferteconData = loadStorage(FERTECON_KEY)

  const now = new Date()
  const defaultFrom = new Date(now); defaultFrom.setDate(now.getDate() - 6)
  const fromStr = dateFrom || defaultFrom.toISOString().split('T')[0]
  const toStr = dateTo || now.toISOString().split('T')[0]
  const periodLabel = `${formatDate(fromStr)} – ${formatDate(toStr)}`

  // Chart uses ALL data — same as Publication vs Mrkt tab
  const chartData = buildChartData(calls, argusData, ferteconData)
  const chartSVG = buildChartSVG(chartData)

  // Price bubbles and demand use selected date range
  const priceBubbles = buildPriceBubbles(calls, fromStr, toStr)
  const demandVolumes = buildDemandVolume(calls, fromStr, toStr)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FertIntel Report – ${periodLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: white; font-size: 12px; }
  .page { max-width: 920px; margin: 0 auto; padding: 40px 48px; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid #111; margin-bottom: 32px; }
  .header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .header p { font-size: 12px; color: #666; margin-top: 4px; }
  .brand { font-size: 13px; font-weight: 700; text-align: right; }
  .meta { font-size: 11px; color: #888; margin-top: 3px; text-align: right; }

  .section { margin-bottom: 36px; }
  .section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #666; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0; margin-bottom: 16px; }

  .chart-wrap { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 16px; overflow-x: auto; }
  .chart-legend { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 14px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #555; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .legend-dash { width: 20px; height: 0; border-top: 2.5px dashed; flex-shrink: 0; }

  .bubbles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .bubble-card { border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px 18px; }
  .bubble-product { font-size: 13px; font-weight: 700; margin-bottom: 12px; }
  .bubble-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; text-align: center; }
  .bubble-val { font-size: 18px; font-weight: 700; }
  .bubble-lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .bubble-count { font-size: 10px; color: #bbb; margin-top: 10px; }

  .volume-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .volume-card { background: #f7f7f7; border-radius: 8px; padding: 14px 16px; }
  .volume-product { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .volume-num { font-size: 20px; font-weight: 700; }
  .volume-unit { font-size: 10px; color: #999; margin-top: 2px; }

  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; font-size: 10px; color: #aaa; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 20px 24px; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div>
      <h1>Market Intelligence Report</h1>
      <p>${periodLabel}</p>
    </div>
    <div>
      <div class="brand">⬡ FertIntel</div>
      <div class="meta">Generated ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Amsul CFR Brazil — Publication vs Market</div>
    <div class="chart-wrap">
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-dash" style="border-color:#60b8f0"></div> Argus Avg</div>
        <div class="legend-item"><div class="legend-dash" style="border-color:#b860f0"></div> Fertecon Avg</div>
        <div class="legend-item"><div class="legend-dot" style="background:#4caf50"></div> Call Average</div>
      </div>
      ${chartSVG}
    </div>
  </div>

  ${priceBubbles.length > 0 ? `
  <div class="section">
    <div class="section-title">Price Range per Product — ${periodLabel}</div>
    <div class="bubbles-grid">
      ${priceBubbles.map(b => `
      <div class="bubble-card">
        <div class="bubble-product">${b.product}</div>
        <div class="bubble-stats">
          <div><div class="bubble-val" style="color:#f0b840">${b.low}</div><div class="bubble-lbl">Lowest</div></div>
          <div><div class="bubble-val" style="color:#4caf50">${b.avg}</div><div class="bubble-lbl">Average</div></div>
          <div><div class="bubble-val" style="color:#e05c4b">${b.high}</div><div class="bubble-lbl">Highest</div></div>
        </div>
        <div class="bubble-count">${b.count} price point${b.count !== 1 ? 's' : ''} recorded</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${demandVolumes.length > 0 ? `
  <div class="section">
    <div class="section-title">Total Demand Volume per Product — ${periodLabel}</div>
    <div class="volume-grid">
      ${demandVolumes.map(d => `
      <div class="volume-card">
        <div class="volume-product">${d.product}</div>
        <div class="volume-num">${d.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="volume-unit">tons</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <div class="footer">
    <span>FertIntel — Confidential</span>
    <span>fertintel.vercel.app</span>
  </div>

</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`
}
