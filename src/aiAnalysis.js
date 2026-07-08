// AI market intelligence analysis using Opus 4.8
const ARGUS_KEY = 'fertintel_argus_amsul'
const FERTECON_KEY = 'fertintel_fertecon_amsul'
const CACHE_KEY = 'fertintel_ai_analysis'

// Each view keeps its own snapshot so admin's global and per-trader analyses
// don't overwrite each other. scope is 'global' (all traders) or a trader id.
// Undefined scope maps to the original single key for backward compatibility.
function cacheKey(scope) {
  return scope ? `${CACHE_KEY}:${scope}` : CACHE_KEY
}

function loadStorage(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : [] }
  catch { return [] }
}

function parseDate(dateStr) {
  if (!dateStr) return new Date(0)
  const iso = new Date(dateStr + 'T00:00:00')
  if (!isNaN(iso.getTime())) return iso
  const natural = new Date(dateStr)
  if (!isNaN(natural.getTime())) return natural
  return new Date(0)
}

// ── Current week (Mon–Fri) range, plus that week's Thursday (publication key) ──
export function currentWeekInfo() {
  const now = new Date()
  const day = now.getDay() // 0=Sun ... 6=Sat
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  friday.setHours(23, 59, 59, 999)
  const thursday = new Date(monday)
  thursday.setDate(monday.getDate() + 3)
  const fmt = d => d.toISOString().split('T')[0]
  return { monday, friday, thursdayStr: fmt(thursday), mondayStr: fmt(monday), fridayStr: fmt(friday) }
}

// Human label like "Jun 23–27, 2026"
export function weekLabel(info = currentWeekInfo()) {
  const opts = { month: 'short', day: 'numeric' }
  const mon = info.monday.toLocaleDateString('en-US', opts)
  const friDay = info.friday.toLocaleDateString('en-US', { day: 'numeric' })
  const year = info.friday.getFullYear()
  return `${mon}–${friDay}, ${year}`
}

// Build a compact text summary. If weekOnly is true, restrict to current Mon–Fri
// calls and the publication entry dated to this week's Thursday.
function buildDataSummary(calls, weekOnly = false) {
  const week = currentWeekInfo()

  let useCalls = calls
  let argus = loadStorage(ARGUS_KEY)
  let fertecon = loadStorage(FERTECON_KEY)

  if (weekOnly) {
    useCalls = calls.filter(c => {
      const d = parseDate(c.date)
      return d >= week.monday && d <= week.friday
    })
    // Only this week's publication (keyed by the week's Thursday)
    argus = argus.filter(a => a.date === week.thursdayStr)
    fertecon = fertecon.filter(f => f.date === week.thursdayStr)
  }

  // Sort calls newest first
  const sorted = [...useCalls].sort((a, b) => parseDate(b.date) - parseDate(a.date))

  const callLines = sorted.map(c => {
    const prices = Object.entries(c.prices || {})
      .filter(([, v]) => v.value)
      .map(([k, v]) => {
        const label = v.grade || k
        const trend = v.trend && v.trend !== 'none' ? ` (${v.trend})` : ''
        return `${label}: ${v.value}${trend}`
      }).join(', ')

    const demand = (c.demandRows || [])
      .filter(r => r.product || r.volume || r.port || r.priceTarget)
      .map(r => `${r.product || '?'} ${r.volume || '?'}t ${r.port || ''} target ${r.priceTarget || '?'}`)
      .join('; ')

    const comp = (c.competitorOffers || [])
      .filter(o => o.competitor || o.price)
      .map(o => `${o.competitor || '?'} offering ${o.product || '?'} at ${o.price || '?'} ${o.port || ''}`)
      .join('; ')

    const parts = [`[${c.date}] ${c.client}`]
    if (prices) parts.push(`Prices: ${prices}`)
    if (demand) parts.push(`Demand: ${demand}`)
    if (comp) parts.push(`Competitor offers: ${comp}`)
    if (c.demand) parts.push(`Notes: ${c.demand}`)
    if (c.remarks) parts.push(`Remarks: ${c.remarks}`)
    return parts.join(' | ')
  }).join('\n')

  const argusLines = argus.map(a => `[${a.date}] Argus Amsul CFR Brazil: ${a.low}-${a.high}`).join('\n')
  const ferteconLines = fertecon.map(f => `[${f.date}] Fertecon Amsul CFR Brazil: ${f.low}-${f.high}`).join('\n')

  const header = weekOnly
    ? `## WEEKLY ANALYSIS — ${weekLabel(week)} (Mon–Fri calls + this week's publications)`
    : `## CLIENT CALLS (${useCalls.length} total, newest first)`

  return `${header}
## CLIENT CALLS (${useCalls.length} in scope, newest first)
${callLines || 'None'}

## ARGUS PUBLICATIONS
${argusLines || 'None'}

## FERTECON PUBLICATIONS
${ferteconLines || 'None'}`
}

const SYSTEM_PROMPT = `You are a senior fertilizer market analyst working for a trading desk in Brazil. You analyze client call notes, competitor offers, and price publications (Argus, Fertecon) to produce sharp, actionable market intelligence.

The products tracked are: Amsul (ammonium sulphate), Urea, MAP, SSP, TSP, NP. Prices are typically CFR Brazil in USD/tonne. Key ports: Paranaguá, Aratu, Rio Grande, Santos, São Francisco do Sul, Santarém, Itaqui, Vitória.

Analyze the data and respond ONLY with valid JSON (no markdown, no preamble) in this exact structure:
{
  "signals": [
    { "type": "warning|alert|opportunity", "text": "one sharp sentence with specific numbers/clients" }
  ],
  "analysis": {
    "priceTrends": "2-3 sentences on price direction and momentum per product, with specific figures",
    "demand": "2-3 sentences on demand strength, volumes, ports, and notable client targets",
    "competitors": "2-3 sentences on competitor activity, who is offering what at what level",
    "opportunities": "2-3 sentences on concrete trading opportunities and risks to watch"
  }
}

Rules:
- Generate 3-5 signals maximum, the most important ones. Use "alert" (red) for urgent risks, "warning" (amber) for things to watch, "opportunity" (green) for openings.
- Be specific: cite actual client names, prices, volumes, ports. Never vague.
- Focus on what changed and what it means for trading decisions.
- If data is thin, say so honestly rather than inventing trends.`

async function callAnalysis(dataSummary) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Analyze this fertilizer market data and provide intelligence:\n\n${dataSummary}` }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `API error ${response.status}`)
  }

  const data = await response.json()
  const text = (data.content || []).map(b => b.text || '').join('')

  // Resilient parse: strip code fences, then extract the outermost JSON object
  let parsed
  try {
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim()
    const first = clean.indexOf('{')
    const last = clean.lastIndexOf('}')
    if (first !== -1 && last !== -1 && last > first) {
      clean = clean.slice(first, last + 1)
    }
    parsed = JSON.parse(clean)
  } catch (e) {
    throw new Error('Could not parse analysis response')
  }

  if (!parsed || (!parsed.signals && !parsed.analysis)) {
    throw new Error('Analysis response missing expected fields')
  }
  return parsed
}

// Legacy all-data analysis (kept for compatibility)
export async function runAIAnalysis(calls, scope) {
  const parsed = await callAnalysis(buildDataSummary(calls, false))
  const result = {
    signals: parsed.signals || [],
    analysis: parsed.analysis || null,
    generatedAt: new Date().toISOString(),
    callCount: calls.length,
  }
  localStorage.setItem(cacheKey(scope), JSON.stringify(result))
  return result
}

// ── Weekly snapshot: Mon–Fri calls + this week's publications, locked & stamped ──
export async function runWeeklyAnalysis(calls, scope) {
  const week = currentWeekInfo()
  const parsed = await callAnalysis(buildDataSummary(calls, true))
  const result = {
    signals: parsed.signals || [],
    analysis: parsed.analysis || null,
    generatedAt: new Date().toISOString(),
    callCount: calls.length,
    weekThursday: week.thursdayStr,   // identifies which week this snapshot is for
    weekLabel: weekLabel(week),       // human label, e.g. "Jun 23–27, 2026"
  }
  localStorage.setItem(cacheKey(scope), JSON.stringify(result))
  return result
}

export function getCachedAnalysis(scope) {
  try {
    const raw = localStorage.getItem(cacheKey(scope))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Is the cached snapshot for the CURRENT week? (used to show "generate this week" state)
export function isCurrentWeekSnapshot(scope) {
  const cached = getCachedAnalysis(scope)
  if (!cached || !cached.weekThursday) return false
  return cached.weekThursday === currentWeekInfo().thursdayStr
}

// Legacy auto-refresh check (no longer used for weekly snapshot flow)
export function shouldRefresh(calls, scope) {
  const cached = getCachedAnalysis(scope)
  if (!cached) return true
  if (cached.callCount !== calls.length) return true
  return false
}
