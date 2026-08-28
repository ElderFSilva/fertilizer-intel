// AI market intelligence analysis using Claude Fable 5 (Stage 6.3)
import { buildMarketContext } from './marketSignals.js'
import { buildDeskContext } from './deskSignals.js'
import { buildTrackRecord, trackRecordText, buildLessonsText } from './learningLoop.js'
import { saveAnalysisSnapshot } from './cloudAnalysis.js'
import { supabase } from './supabaseClient.js'

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
    "opportunities": "2-3 sentences on concrete trading opportunities and risks to watch",
    "supply": "2-3 sentences on supply outlook (line-up, pace, parity)"
  },
  "positioning": {
    "bias": "LONG|NEUTRAL|SHORT",
    "confidence": "low|moderate|high",
    "rationale": "one or two sentences citing the specific computed indicators driving the bias",
    "trigger": "one concrete, falsifiable condition that would change this view"
  }
}

Rules:
- Generate 3-5 signals maximum, the most important ones. Use "alert" (red) for urgent risks, "warning" (amber) for things to watch, "opportunity" (green) for openings.
- Be specific: cite actual client names, prices, volumes, ports. Never vague.
- Focus on what changed and what it means for trading decisions.
- If data is thin, say so honestly rather than inventing trends.

You will also receive a MARKET CONTEXT section with external data and pre-computed indicators (Argus prices with historical percentile, import parity based on the desk's own Panamax freight, Amsul-vs-urea cost per unit N, supply lenses, barter ratios, farmer purchase progress, FX). Rules for using it:
- LINE-UP SOURCES ARE SEPARATE STICKS: line-up totals from different providers (e.g. Argus assessed line-up vs port-agency counts under 'other') measure differently. Revisions are only ever within one source; a gap between two sources' totals is a methodology difference, NEVER a revision, surge or collapse. Use the PRIMARY lens for the supply narrative; mention a secondary lens only as corroborating context.
- SUPPLY HAS THREE SEPARATE LENSES: Agrinvest pace (arrived+declared), Argus line-up (forward arrivals) and Siacesp actuals (customs-cleared). NEVER sum them or compare one against another; each is only compared within its own source/history. Their divergence may be noted as in-transit pipeline, nothing more.
- Import parity is computed from the desk's OWN freight contract; do not mix it with published freight benchmarks.
- Connect internal and external: judge client targets and competitor offers against parity, percentile and the N-unit spread (e.g. an offer above replacement cost is not desperation selling).
- Trust the pre-computed indicators over re-deriving your own; cite their specific figures.
- Respect the freshness stamps: if a series is marked STALE or missing, say so and lower confidence accordingly. Never invent data.
- Sample-size honesty: where the context flags weak evidence (small n), you may cite the level and the explicitly computed comparisons only. NEVER infer additional direction, trend, or causation beyond what the context literally computes.
- Directional statements (improved/worsened, up/down, above/below) must be copied from the computed indicators, never re-derived. A lower sc/ton barter ratio is BETTER for the farmer.
- SAME-WEEK RULE for benchmarks: composites and source-divergence statements only ever mix assessments from the SAME market week (Argus/Fertecon Thursday + Agrinvest Friday of that week). A source absent from the current week is PENDING when its publication day or Monday entry window hasn't passed (normal calendar - say "pending", nothing more) or MISSING when it has (a genuine gap worth one neutral mention). NEVER blend a prior-week number into the composite and NEVER describe the gap between a prior-week and a current-week assessment as "divergence" or "murky price discovery".
- DATING CONVENTION: weekly datasets dated Friday and entered Monday belong to the same market week as that week's prices - never treat them as older or stale because of the entry lag.
- BENCHMARKS ARE COMPOSITES: when multiple sources (Argus, Fertecon, Agrinvest, Profercy) are fresh, the reference price is their composite - never quote a single source as "the market" when a composite exists. If sources diverge notably, say so: source disagreement is information.
- GRADE EQUIVALENCE (established desk fact): "Amsul GR" (the desk's label in calls and sales) and "Amsul compacted" (the label in Argus/Fertecon/Agrinvest assessments) are THE SAME product - treat them as identical everywhere: GR offers, targets and sales compare directly against compacted benchmarks, parity and percentiles. "Amsul STD" / "standard" is a DIFFERENT product.
- GRADE DISCIPLINE (critical): Amsul COMPACTED/GR and STANDARD are different products at different prices. NEVER compare a price of one grade against a benchmark of another. Competitor offers and client targets whose grade is not stated must be treated as GRADE-UNKNOWN and flagged as such - never assumed comparable to the compacted benchmark. Before calling any offer "workable" or "below market", confirm the grades match; if unknown, say the comparison is unconfirmed.
- OPEN DEMAND: only ACTIVE lines (last 45 days) are the live book. Stale lines are re-engagement material, never current demand, never a reason to sell. GR and STD open demand are different products: any selling recommendation anchored to the compacted composite may cite GR lines only - STD lines get their own sentence against STD references or none.
- The DESK HISTORY section is computed from the desk's own full call and sales record. Client breadth, open demand, quiet clients and execution capture are AUTHORITATIVE computed facts - cite them. Use open demand and breadth to judge demand quality; use execution capture (our realized prices vs the published mid) to judge our real pricing power; use quiet regulars as concrete re-engagement opportunities.
- Barter has two independent dimensions: weekly DIRECTION (improved/worsened) and LEVEL vs the 4-year norm (cheap/expensive). Report both when available; never merge them into one judgment.
- The Amsul-vs-urea N-unit premium arrives with its full empirical distribution (computed live from 2020-present data). Reason from the PERCENTILE and computed TREND, never the raw number: below the historical median = historically cheap for Amsul (a point in favor of Amsul demand, never a risk). Substitution caution is justified ONLY when the context shows percentile >= 90 AND trend WIDENING, or when internal calls explicitly report clients switching to urea/blends. NEVER cap positioning confidence on the nominal premium level alone.

In the analysis object, also fill:
    "supply": "2-3 sentences on the supply outlook: line-up, pace, parity and what they mean for availability and pricing power"

LEARNING rules:
- YOUR TRACK RECORD is your own graded history - computed, authoritative. Calibrate confidence with it: if your record at a given confidence level is weak, state lower confidence now; if a bias type keeps failing, be humbler about that bias. With few scored stances, do not over-adjust - say the record is thin.
- DESK LESSONS are established desk knowledge taught by the admin. Apply them as facts about this market unless the current computed data directly contradicts one - in that case, flag the tension explicitly instead of silently ignoring either.

POSITIONING rules (this is the desk's book stance for physical Amsul in Brazil, not a futures trade):
- LESSONS INTEGRATION (mandatory): before finalizing the stance, check every DESK LESSON for applicability to the current setup. Any lesson that bears on the situation (e.g. below-parity offers possibly being shorts, the distributor barter trigger, structural preferences) MUST be explicitly addressed in the rationale or the trigger - either incorporated into the reasoning or named with why it doesn't change the call. A stance that ignores an applicable lesson is incomplete.
- LONG = hold cargoes / delay sales / offer firm. SHORT = sell forward aggressively / lighten inventory. NEUTRAL = no edge either way.
- The bias must follow from the computed indicators (parity spread, percentile, N-unit spread, line-up, pace, barter, remaining demand) and the week's internal data. Cite them in the rationale.
- Confidence must be honest: with thin history or stale/missing series, cap confidence at low or moderate. High confidence requires multiple fresh, agreeing signals.
- The trigger must be concrete and falsifiable (a number or observable event), never vague.
- If the data genuinely supports no view, say NEUTRAL with low confidence - that is a valid, honest answer.`


// Retry transient API failures (overloaded/rate-limited) before giving up:
// up to 2 retries with 20s/30s waits — most 529s clear on the next attempt.
async function fetchWithRetry(url, options, retries = 2, onStatus = null) {
  const delays = [20000, 30000]
  const wait = async (ms, why) => {
    if (onStatus) onStatus(`${why} — retrying in ${Math.round(ms / 1000)}s…`)
    await new Promise(r => setTimeout(r, ms))
    if (onStatus) onStatus('retrying now…')
  }
  for (let attempt = 0; ; attempt++) {
    let response
    try {
      response = await fetch(url, options)
    } catch (e) {
      if (attempt >= retries) throw e
      await wait(delays[Math.min(attempt, delays.length - 1)], 'connection problem')
      continue
    }
    if ((response.status === 529 || response.status === 429) && attempt < retries) {
      await wait(delays[Math.min(attempt, delays.length - 1)],
        response.status === 529 ? 'AI server busy' : 'rate limited')
      continue
    }
    return response
  }
}

async function callAnalysis(dataSummary, marketContext = '', deskContext = '', learningContext = '', onStatus = null) {
  const response = await fetchWithRetry('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 9000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Analyze this fertilizer market data and provide intelligence:\n\n${dataSummary}\n\n## MARKET CONTEXT (external data & computed indicators)\n${marketContext || 'Not available.'}\n\n## DESK HISTORY (computed from the full call & sales record)\n${deskContext || 'Not available.'}\n\n## YOUR TRACK RECORD & DESK LESSONS\n${learningContext || 'Not available.'}` }],
    }),
  }, 2, onStatus)

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    const detail = typeof err.error === 'string' ? err.error
      : err.error ? JSON.stringify(err.error)
      : err.message || JSON.stringify(err)
    throw new Error(`API ${response.status}: ${detail}`)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message || 'API returned an error')
  }
  const text = (data.content || []).map(b => b.text || '').join('')
  if (data.stop_reason === 'max_tokens') {
    throw new Error('AI response was truncated (max_tokens) — try again; if it persists, the output limit needs raising')
  }

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



// Assemble the learning context: the scorecard + admin-taught lessons
async function buildLearningContext(scope) {
  const [record, lessons] = await Promise.all([
    buildTrackRecord(scope).catch(() => null),
    buildLessonsText().catch(() => ''),
  ])
  const parts = []
  parts.push('### YOUR PAST STANCES, GRADED (computed, authoritative)')
  parts.push(trackRecordText(record))
  if (lessons) parts.push('### DESK LESSONS (taught by the admin - treat as established desk knowledge)\n' + lessons)
  return parts.join('\n')
}


// ── Weekly-definitive stance ──
// The FIRST stance generated in a market week (the Monday run, after the
// week's data is entered) is the desk's committed stance for that week.
// Later generations refresh signals & analysis, but their positioning output
// is discarded: the pinned stance is returned instead and nothing is logged.
async function getDefinitiveStance(scope, weekThursday) {
  try {
    const { data, error } = await supabase
      .from('positioning_log')
      .select('*')
      .eq('scope', scope || 'default')
      .eq('week_thursday', weekThursday)
      .order('generated_at', { ascending: true })
      .limit(1)
    if (error || !data || !data.length) return null
    return data[0]
  } catch { return null }
}

// Append the stance to the immutable positioning log (best-effort, never blocks the analysis)
async function logPositioning(positioning, scope, weekThursday) {
  if (!positioning || !positioning.bias) return
  try {
    await supabase.from('positioning_log').insert({
      scope: scope || 'default',
      week_thursday: weekThursday || null,
      bias: positioning.bias,
      confidence: positioning.confidence || 'low',
      rationale: positioning.rationale || null,
      trigger_condition: positioning.trigger || null,
    })
  } catch { /* logging must never break the analysis */ }
}

// Legacy all-data analysis (kept for compatibility)
export async function runAIAnalysis(calls, scope, sales = []) {
  const market = await buildMarketContext().catch(() => 'Market data unavailable (load error).')
  const desk = await buildDeskContext(calls, sales).catch(() => 'Desk history unavailable (load error).')
  const learning = await buildLearningContext(scope).catch(() => '')
  const parsed = await callAnalysis(buildDataSummary(calls, false), market, desk, learning)
  const result = {
    signals: parsed.signals || [],
    analysis: parsed.analysis || null,
    positioning: parsed.positioning || null,
    trackRecord: (await buildTrackRecord(scope).catch(() => null))?.summary || null,
    generatedAt: new Date().toISOString(),
    callCount: calls.length,
  }
  await logPositioning(parsed.positioning, scope, null)
  localStorage.setItem(cacheKey(scope), JSON.stringify(result))
  return result
}

// ── Weekly snapshot: Mon–Fri calls + this week's publications, locked & stamped ──
export async function runWeeklyAnalysis(calls, scope, sales = [], onStatus = null) {
  const week = currentWeekInfo()
  const market = await buildMarketContext().catch(() => 'Market data unavailable (load error).')
  const desk = await buildDeskContext(calls, sales).catch(() => 'Desk history unavailable (load error).')
  const learning = await buildLearningContext(scope).catch(() => '')
  const parsed = await callAnalysis(buildDataSummary(calls, true), market, desk, learning, onStatus)
  const result = {
    signals: parsed.signals || [],
    analysis: parsed.analysis || null,
    positioning: parsed.positioning || null,
    trackRecord: (await buildTrackRecord(scope).catch(() => null))?.summary || null,
    generatedAt: new Date().toISOString(),
    callCount: calls.length,
    weekThursday: week.thursdayStr,   // identifies which week this snapshot is for
    weekLabel: weekLabel(week),       // human label, e.g. "Jun 23–27, 2026"
  }
  const pinned = await getDefinitiveStance(scope, week.thursdayStr)
  if (pinned) {
    result.positioning = {
      bias: pinned.bias,
      confidence: pinned.confidence,
      rationale: pinned.rationale,
      trigger: pinned.trigger_condition,
    }
    result.stanceLockedAt = pinned.generated_at
  } else {
    await logPositioning(parsed.positioning, scope, week.thursdayStr)
    result.stanceLockedAt = new Date().toISOString()
  }
  if (scope === 'global') {
    // Shared desk analysis: publish to the cloud for every user
    await saveAnalysisSnapshot(result).catch(() => {})
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
