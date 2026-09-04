import { cloudLoadBenchmarkFromIntl } from './cloudData.js'
import { loadAnalysisSnapshotForWeek, saveBriefToSnapshot } from './cloudAnalysis.js'
import { generateBriefFromAnalysis } from './aiAnalysis.js'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) return d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dateStr
}

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

// Format a Date to YYYY-MM-DD using LOCAL components (not UTC) so week keys
// don't shift a day back in negative-UTC timezones (e.g. Brazil UTC-3).
function toLocalYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function getWeekMonday(dateStr) {
  const d = parseDate(dateStr)
  if (d.getTime() === 0) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return toLocalYMD(monday)
}

function getWeekThursday(dateStr) {
  const monday = getWeekMonday(dateStr)
  if (!monday) return null
  const d = new Date(monday + 'T00:00:00')
  d.setDate(d.getDate() + 3)
  return toLocalYMD(d)
}

// Human label for a market week from its Thursday key, e.g. "Sep 1–5, 2026"
function weekLabelFromThursday(thursdayStr) {
  if (!thursdayStr) return ''
  const th = new Date(thursdayStr + 'T00:00:00')
  if (isNaN(th.getTime())) return thursdayStr
  const mon = new Date(th); mon.setDate(th.getDate() - 3)
  const fri = new Date(th); fri.setDate(th.getDate() + 1)
  const m1 = mon.toLocaleDateString('en-US', { month: 'short' })
  const m2 = fri.toLocaleDateString('en-US', { month: 'short' })
  return mon.getMonth() === fri.getMonth()
    ? `${m1} ${mon.getDate()}–${fri.getDate()}, ${fri.getFullYear()}`
    : `${m1} ${mon.getDate()} – ${m2} ${fri.getDate()}, ${fri.getFullYear()}`
}

// Current Mon–Fri window (for the always-current demand list)
function currentWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  friday.setHours(23, 59, 59, 999)
  return { monday, friday }
}

// Derive the date a sale was logged. Prefer an explicit date field; otherwise
// recover it from the numeric id (which is Date.now() at creation).
function saleLoggedDate(sale) {
  if (sale.loggedAt) return new Date(sale.loggedAt)
  if (sale.date) {
    const d = parseDate(sale.date)
    if (d.getTime() !== 0) return d
  }
  // Cloud sales carry a created_at timestamp — use it when there's no deal date
  if (sale.created_at) {
    const d = new Date(sale.created_at)
    if (!isNaN(d.getTime())) return d
  }
  const idNum = Number(sale.id)
  if (!isNaN(idNum) && idNum > 1000000000000) return new Date(idNum)
  return new Date(0)
}

function buildChartData(calls, sales, argusData, ferteconData) {
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
    // Only Amsul GR counts (matches Argus/Fertecon benchmark); legacy data = GR default
    const grade = pr.grade || 'Amsul GR'
    if (grade !== 'Amsul GR') return
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

  // Sales performed: weekly average of DONE prices for Amsul GR, bucketed by
  // deal date (falls back to created_at) - identical to the app chart.
  const salesByWeek = {}
  ;(sales || []).forEach(sl => {
    if ((sl.product || '') !== 'Amsul GR') return
    const when = sl.date || (sl.created_at ? String(sl.created_at).slice(0, 10) : null)
    if (!when) return
    const thursday = getWeekThursday(when)
    if (!thursday) return
    const price = parsePrice(sl.donePrice)
    if (!price) return
    if (!salesByWeek[thursday]) salesByWeek[thursday] = []
    salesByWeek[thursday].push(price)
  })
  Object.entries(salesByWeek).forEach(([thursday, prices]) => {
    if (!weekMap[thursday]) weekMap[thursday] = {}
    weekMap[thursday].salesAvg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
  })

  const rows = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: formatDateLabel(date),
      argusAvg: data.argusAvg ?? null,
      ferteconAvg: data.ferteconAvg ?? null,
      callAvg: data.callAvg ?? null,
      salesAvg: data.salesAvg ?? null,
    }))
  // Rolling window: last 8 weeks only - identical to the app chart
  const cut = new Date()
  cut.setDate(cut.getDate() - 8 * 7)
  const y = cut.getFullYear()
  const m = String(cut.getMonth() + 1).padStart(2, '0')
  const dd = String(cut.getDate()).padStart(2, '0')
  const cutoff = `${y}-${m}-${dd}`
  return rows.filter(r => r.date >= cutoff)
}

// Latest non-null value per series (the most recent week each series printed)
// Legend values are the REPORTED WEEK's values only, never "the most recent
// week that happens to have one". A series with nothing this week prints no
// number at all - a stale figure wearing this week's label is a lie.
function weekValues(chartData, weekThursday) {
  const row = chartData.find(r => r.date === weekThursday) || null
  const pick = key => (row && row[key] != null) ? { v: row[key] } : null
  return {
    argus: pick('argusAvg'),
    fertecon: pick('ferteconAvg'),
    call: pick('callAvg'),
    sales: pick('salesAvg'),
  }
}

function buildChartSVG(chartData) {
  if (chartData.length < 2) return '<p style="color:#5a5b54;font-size:12px;text-align:center;padding:40px 0">Not enough data to display chart.</p>'
  const W = 720, H = 300
  const PAD = { top: 16, right: 16, bottom: 34, left: 44 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const minY = 180, maxY = 280, stepY = 50 // fixed axis - identical to the app chart
  const xScale = i => PAD.left + (chartData.length === 1 ? chartW / 2 : (i / (chartData.length - 1)) * chartW)
  // clamp: a value outside the window is pinned to the edge rather than drawn
  // off-plot, so the line stays inside the axes
  const yScale = v => {
    const c = Math.max(minY, Math.min(maxY, v))
    return PAD.top + chartH - ((c - minY) / (maxY - minY)) * chartH
  }

  const gridAndTicks = []
  for (let v = minY; v <= maxY; v += stepY) {
    const y = yScale(v)
    gridAndTicks.push(`<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#2a2b26" stroke-dasharray="3 3"/>`)
    gridAndTicks.push(`<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="#5a5b54">${v}</text>`)
  }
  const xLabels = chartData.map((r, i) =>
    `<text x="${xScale(i)}" y="${H - PAD.bottom + 18}" text-anchor="middle" font-size="10" fill="#5a5b54">${r.label}</text>`).join('')

  // connectNulls: draw each series through its existing points only
  const seriesPath = (key) => {
    const pts = chartData.map((r, i) => r[key] != null ? [xScale(i), yScale(r[key])] : null).filter(Boolean)
    if (!pts.length) return { path: '', dots: '' }
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    return { path, pts }
  }
  const SERIES = [
    { key: 'argusAvg', color: '#60b8f0', dash: '6 3', name: 'Argus Avg' },
    { key: 'ferteconAvg', color: '#b860f0', dash: '6 3', name: 'Fertecon Avg' },
    { key: 'callAvg', color: '#c8f060', dash: '', name: 'Call Average' },
    { key: 'salesAvg', color: '#ffd60a', dash: '', name: 'Sales Avg (done)' },
  ]
  const lines = SERIES.map(sr => {
    const { path, pts } = seriesPath(sr.key)
    if (!path) return ''
    const dots = (pts || []).map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${sr.color}"/>`).join('')
    return `<path d="${path}" fill="none" stroke="${sr.color}" stroke-width="2.5"${sr.dash ? ` stroke-dasharray="${sr.dash}"` : ''}/>${dots}`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:transparent">
    ${gridAndTicks.join('')}
    ${xLabels}
    ${lines}
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

function buildDemandVolume(calls, fromStr, toStr, soldDemandIds) {
  const fromD = parseDate(fromStr)
  const toD = parseDate(toStr); toD.setHours(23, 59, 59)
  const periodCalls = calls.filter(c => { const d = parseDate(c.date); return d >= fromD && d <= toD })

  // Count every recorded demand in the period, but:
  //  - skip rows flagged isDuplicate / linkedToDemandId (don't double count)
  //  - skip demands converted to a sale (id in soldDemandIds)
  //  - dedupe exact-match repeats (same client+product+volume+port+target) within the period
  const map = {}
  const seen = new Set()
  periodCalls.forEach(c => {
    const rows = c.demandRows?.length ? c.demandRows
      : (c.demandProduct || c.demandVolume) ? [{ product: c.demandProduct, volume: c.demandVolume, port: c.demandPort, priceTarget: c.demandPriceTarget }] : []
    rows.forEach(r => {
      if (!r.product || !r.volume) return
      if (r.isDuplicate || r.linkedToDemandId) return
      if (r.closed) return
      if (r.id && soldDemandIds && soldDemandIds.has(r.id)) return
      const vol = parseFloat(r.volume); if (isNaN(vol)) return
      const sig = [
        (c.client || '?').trim().toLowerCase(),
        (r.product || '').trim().toLowerCase(),
        String(vol),
        (r.port || '').trim().toLowerCase(),
        (r.priceTarget || '').trim().toLowerCase(),
      ].join('|')
      if (seen.has(sig)) return
      seen.add(sig)
      map[r.product] = (map[r.product] || 0) + vol
    })
  })

  return Object.entries(map).map(([product, total]) => ({ product, total })).sort((a, b) => b.total - a.total)
}

// Client Demand Status — always the current Mon–Fri week, grouped by client
function buildCurrentWeekDemandList(calls) {
  const { monday, friday } = currentWeekRange()
  const byClient = {}
  calls.forEach(c => {
    const d = parseDate(c.date)
    if (d < monday || d > friday) return
    const rows = (c.demandRows || []).filter(r => r.product || r.volume || r.port || r.priceTarget || r.laycan)
    if (!rows.length) return
    if (!byClient[c.client]) byClient[c.client] = []
    rows.forEach(r => byClient[c.client].push(r))
  })
  return Object.keys(byClient).sort().map(client => ({ client, rows: byClient[client] }))
}

function parseNum(v) {
  if (v === '' || v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

// Sales performed in the period — filtered by the date the sale was LOGGED.
// `sales` is passed in (the caller's filtered set); falls back to the
// localStorage mirror if a caller doesn't provide it.
function buildSalesPerformance(sales, fromStr, toStr) {
  const allSales = Array.isArray(sales) ? sales : loadStorage(SALES_KEY)
  const fromD = parseDate(fromStr)
  const toD = parseDate(toStr); toD.setHours(23, 59, 59)

  const periodSales = allSales.filter(s => {
    const d = saleLoggedDate(s)
    return d >= fromD && d <= toD
  })

  // soldDemandIds spans ALL sales (not just period) so demand totals stay correct
  const soldDemandIds = new Set(allSales.map(s => s.linkedDemandId).filter(Boolean))

  if (!periodSales.length) return { empty: true, soldDemandIds }

  const totalDeals = periodSales.length
  const totalVolume = periodSales.reduce((sum, s) => sum + (parseNum(s.volume) || 0), 0)

  const byProduct = {}
  periodSales.forEach(s => {
    const p = s.product || 'Unknown'
    if (!byProduct[p]) byProduct[p] = { volume: 0, doneSum: 0, doneCount: 0, deals: 0 }
    byProduct[p].volume += parseNum(s.volume) || 0
    byProduct[p].deals += 1
    const done = parseNum(s.donePrice)
    if (done != null) { byProduct[p].doneSum += done; byProduct[p].doneCount += 1 }
  })
  const productStats = Object.entries(byProduct).map(([product, d]) => ({
    product, volume: d.volume, deals: d.deals,
    avgDone: d.doneCount ? Math.round(d.doneSum / d.doneCount) : null,
  })).sort((a, b) => b.volume - a.volume)

  return { empty: false, totalDeals, totalVolume, productStats, soldDemandIds, sales: periodSales }
}

const ANALYSIS_SECTIONS = [
  { key: 'priceTrends', label: 'Price Trends' },
  { key: 'demand', label: 'Demand' },
  { key: 'competitors', label: 'Competitor Activity' },
  { key: 'opportunities', label: 'Opportunities & Risks' },
]

const SIGNAL_COLOR = { warning: '#f0b840', alert: '#ff6b5b', opportunity: '#c8f060' }


export async function generateWeeklyReport(calls, signals, dateFrom, dateTo, analysis, sales) {
  let argusData = [], ferteconData = []
  try {
    const bench = await cloudLoadBenchmarkFromIntl()
    argusData = bench.argus || []
    ferteconData = bench.fertecon || []
  } catch { /* chart renders with whatever loaded */ }

  // Default range = current Mon–Fri
  const { monday, friday } = currentWeekRange()
  const fromStr = dateFrom || toLocalYMD(monday)
  const toStr = dateTo || toLocalYMD(friday)
  const periodLabel = `${formatDate(fromStr)} – ${formatDate(toStr)}`

  const now = new Date()

  // The market week this report is about, keyed by its Thursday. Used by both
  // the chart legend and the AI block so they can never describe different weeks.
  const reportWeekThursday = getWeekThursday(toStr)

  const chartData = buildChartData(calls, sales, argusData, ferteconData)
  const latest = weekValues(chartData, reportWeekThursday)
  const chartSVG = buildChartSVG(chartData)

  const salesPerf = buildSalesPerformance(sales, fromStr, toStr)
  const soldDemandIds = salesPerf.soldDemandIds || new Set()
  const priceBubbles = buildPriceBubbles(calls, fromStr, toStr)
  const demandVolumes = buildDemandVolume(calls, fromStr, toStr, soldDemandIds)
  const demandList = buildCurrentWeekDemandList(calls)

  const fmtVol = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ── AI analysis block, resolved to the WEEK BEING REPORTED ──
  // The market week is keyed by its Thursday. The report anchors on the LAST
  // day of the range, so a Mon–Fri export uses that week and a longer range
  // uses the week it closes on. Never "the newest snapshot in the table" —
  // that prints one week's words on another week's report.
  let weekSnapshot = null
  let weekSnapshotId = null
  try {
    const row = await loadAnalysisSnapshotForWeek(reportWeekThursday)
    if (row) { weekSnapshot = row.payload; weekSnapshotId = row.id }
  } catch { weekSnapshot = null }
  // Cloud unreachable or nothing stored: fall back to the snapshot handed in
  // by the app ONLY if it belongs to the very week being reported.
  if (!weekSnapshot && analysis && analysis.weekThursday === reportWeekThursday) {
    weekSnapshot = analysis
  }

  let aiBrief = (weekSnapshot && weekSnapshot.brief) || ''
  const aiDeep = weekSnapshot && weekSnapshot.analysis

  // The report ALWAYS carries a brief when the week has an analysis. Snapshots
  // written before the brief field existed get one generated here from their
  // own sections, then saved back so it is produced once, not every export.
  if (!aiBrief && aiDeep) {
    aiBrief = await generateBriefFromAnalysis(weekSnapshot, weekLabelFromThursday(reportWeekThursday)).catch(() => '')
    if (aiBrief && weekSnapshotId) {
      await saveBriefToSnapshot(weekSnapshotId, { ...weekSnapshot, brief: aiBrief })
    }
  }
  // Label is DERIVED from the week key, never read from the stored snapshot:
  // old snapshots carry labels written by an earlier, month-blind formatter
  // (which rendered this week as "Aug 31–4, 2026"). Deriving self-heals them.
  const aiWeekLabel = weekLabelFromThursday(reportWeekThursday)
    || (weekSnapshot && weekSnapshot.weekLabel) || ''

  // Two honest kinds of "nothing", never blank space: no analysis was ever
  // generated for that week, or one exists but predates the brief field.
  const aiBriefNotice = aiBrief ? ''
    : weekSnapshot
      ? `Brief unavailable for the week of ${aiWeekLabel} — analysis panels below.`
      : `No analysis was generated for the week of ${aiWeekLabel}.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FertIntel Report – ${periodLabel}</title>
<style>
  :root {
    --bg: #0e0f0c; --bg2: #161713; --bg3: #1e1f1a;
    --border: #2a2b26; --border2: #383930;
    --text: #e8e9e2; --text2: #9a9b93; --text3: #5a5b54;
    --accent: #c8f060; --red: #ff6b5b; --amber: #f0b840; --blue: #60b8f0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg); }
  body { font-family: 'Cabinet Grotesk', 'Helvetica Neue', Arial, sans-serif; color: var(--text); font-size: 12px; -webkit-font-smoothing: antialiased; }
  .page { max-width: 920px; margin: 0 auto; padding: 40px 48px; background: var(--bg); }

  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid var(--border2); margin-bottom: 32px; }
  .header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: var(--text); }
  .header p { font-size: 12px; color: var(--text2); margin-top: 4px; }
  .brand { font-size: 13px; font-weight: 700; text-align: right; color: var(--accent); }
  .meta { font-size: 11px; color: var(--text3); margin-top: 3px; text-align: right; }

  .section { margin-bottom: 36px; }
  .section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text2); padding-bottom: 6px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }

  .chart-wrap { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; overflow-x: auto; }
  .chart-caption { font-size: 10px; color: var(--text3); margin-bottom: 8px; }
  .chart-legend { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 14px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text2); }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .legend-dash { width: 20px; height: 0; border-top: 2.5px dashed; flex-shrink: 0; }

  .brief { font-size: 12.5px; line-height: 1.65; color: var(--text); margin: 0 0 16px; }
  .brief-none { font-size: 12.5px; line-height: 1.65; color: var(--text3); font-style: italic; margin: 0 0 16px; }

  .bubbles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .bubble-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
  .bubble-product { font-size: 13px; font-weight: 700; margin-bottom: 12px; color: var(--text); }
  .bubble-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; text-align: center; }
  .bubble-val { font-size: 18px; font-weight: 700; color: var(--text); }
  .bubble-lbl { font-size: 9px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .bubble-count { font-size: 10px; color: var(--text3); margin-top: 10px; }

  .volume-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .volume-card { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
  .volume-product { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .volume-num { font-size: 20px; font-weight: 700; color: var(--text); }
  .volume-unit { font-size: 10px; color: var(--text3); margin-top: 2px; }

  .demand-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .demand-table th { text-align: left; padding: 8px 10px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text3); border-bottom: 1px solid var(--border2); }
  .demand-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--text2); }
  .demand-client { font-weight: 700; color: var(--text); }
  .demand-target { color: var(--accent); font-weight: 600; }

  .ai-signals { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .ai-signal { display: flex; align-items: flex-start; gap: 10px; background: var(--bg2); border: 1px solid var(--border); border-left-width: 3px; border-radius: 6px; padding: 10px 14px; font-size: 12px; }
  .ai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .ai-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .ai-card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 6px; }
  .ai-card-text { font-size: 12px; line-height: 1.55; color: var(--text2); }
  .ai-disclaimer { font-size: 9px; color: var(--text3); margin-top: 12px; text-align: center; }

  .sales-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px; }
  .sales-stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; text-align: center; }
  .sales-stat-num { font-size: 22px; font-weight: 700; color: var(--text); }
  .sales-stat-lbl { font-size: 9px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 3px; }
  .sales-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .sales-table th { text-align: left; padding: 8px 10px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text3); border-bottom: 1px solid var(--border2); }
  .sales-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--text2); }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 10px; color: var(--text3); }

  @media print {
    /* Force the dark theme through to PDF/print, which strips backgrounds by default */
    html, body, .page { background: var(--bg) !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 20px 24px; }
    .ai-card, .bubble-card, .sales-stat, .demand-table tr { break-inside: avoid; }
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

  ${(aiBrief || aiDeep || aiBriefNotice) ? `
  <div class="section">
    <div class="section-title">AI Market Analysis${aiWeekLabel ? ` — Week of ${escapeHtml(aiWeekLabel)}` : ''}</div>
    ${aiBrief
      ? `<p class="brief">${escapeHtml(aiBrief)}</p>`
      : `<p class="brief-none">${escapeHtml(aiBriefNotice)}</p>`}
    ${aiDeep ? `
    <div class="ai-grid">
      ${ANALYSIS_SECTIONS.map(sec => aiDeep[sec.key] ? `
      <div class="ai-card">
        <div class="ai-card-label">${sec.label}</div>
        <div class="ai-card-text">${escapeHtml(aiDeep[sec.key])}</div>
      </div>` : '').join('')}
    </div>
    <div class="ai-disclaimer">Generated by Claude Fable 5 · Analysis is informational, not financial advice</div>` : ''}
  </div>` : ''}

  <div class="section">
    <div class="section-title">Amsul CFR Brazil — Publication vs Market</div>
    <div class="chart-wrap">
      <div class="chart-caption">Values shown are the weekly average for the week of ${escapeHtml(aiWeekLabel)}</div>
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-dash" style="border-color:#60b8f0"></div> Argus Avg${latest.argus ? ` <b>${latest.argus.v}</b>` : ''}</div>
        <div class="legend-item"><div class="legend-dash" style="border-color:#b860f0"></div> Fertecon Avg${latest.fertecon ? ` <b>${latest.fertecon.v}</b>` : ''}</div>
        <div class="legend-item"><div class="legend-dot" style="background:#c8f060"></div> Call Average${latest.call ? ` <b>${latest.call.v}</b>` : ''}</div>
        <div class="legend-item"><div class="legend-dot" style="background:#ffd60a"></div> Sales Avg (done)${latest.sales ? ` <b>${latest.sales.v}</b>` : ''}</div>
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
          <div><div class="bubble-val" style="color:#c8f060">${b.avg}</div><div class="bubble-lbl">Average</div></div>
          <div><div class="bubble-val" style="color:#ff6b5b">${b.high}</div><div class="bubble-lbl">Highest</div></div>
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

  ${demandList.length > 0 ? `
  <div class="section">
    <div class="section-title">Client Demand Status — Current Week (Mon–Fri)</div>
    <table class="demand-table">
      <thead>
        <tr><th>Client</th><th>Product</th><th>Volume (T)</th><th>Port</th><th>Price Target</th><th>Laycan</th></tr>
      </thead>
      <tbody>
        ${demandList.map(({ client, rows }) => rows.map((r, idx) => `
        <tr>
          <td class="demand-client">${idx === 0 ? escapeHtml(client) : ''}</td>
          <td>${escapeHtml(r.product) || '—'}</td>
          <td>${r.volume ? fmtVol(r.volume) : '—'}</td>
          <td>${escapeHtml(r.port) || '—'}</td>
          <td class="demand-target">${escapeHtml(r.priceTarget) || '—'}</td>
          <td>${escapeHtml(r.laycan) || '—'}</td>
        </tr>`).join('')).join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${!salesPerf.empty ? `
  <div class="section">
    <div class="section-title">Sales Performed — ${periodLabel}</div>
    <div class="sales-stats">
      <div class="sales-stat">
        <div class="sales-stat-num">${salesPerf.totalDeals}</div>
        <div class="sales-stat-lbl">Deals Closed</div>
      </div>
      <div class="sales-stat">
        <div class="sales-stat-num">${salesPerf.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
        <div class="sales-stat-lbl">Total Volume (T)</div>
      </div>
      <div class="sales-stat">
        <div class="sales-stat-num">${salesPerf.productStats.length}</div>
        <div class="sales-stat-lbl">Products Sold</div>
      </div>
    </div>
    <table class="sales-table">
      <thead>
        <tr><th>Client</th><th>Product</th><th>Volume (T)</th><th>Done Price</th><th>Port</th><th>Laycan</th></tr>
      </thead>
      <tbody>
        ${salesPerf.sales.map(s => `
        <tr>
          <td><strong>${escapeHtml(s.client) || '—'}</strong></td>
          <td>${escapeHtml(s.product) || '—'}</td>
          <td>${s.volume ? Number(s.volume).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</td>
          <td>${escapeHtml(s.donePrice) || '—'}</td>
          <td>${escapeHtml(s.port) || '—'}</td>
          <td>${escapeHtml(s.laycan) || '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <div class="footer">
    <span>FertIntel — Confidential</span>
    <span>${escapeHtml(typeof window !== 'undefined' && window.location ? window.location.hostname : 'fertintel.app')}</span>
  </div>

</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`
}
