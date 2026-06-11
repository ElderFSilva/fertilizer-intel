// AI market intelligence analysis using Opus 4.8
const ARGUS_KEY = 'fertintel_argus_amsul'
const FERTECON_KEY = 'fertintel_fertecon_amsul'
const CACHE_KEY = 'fertintel_ai_analysis'

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

// Build a compact text summary of all data for the AI to analyze
function buildDataSummary(calls) {
  const argus = loadStorage(ARGUS_KEY)
  const fertecon = loadStorage(FERTECON_KEY)

  // Sort calls newest first
  const sorted = [...calls].sort((a, b) => parseDate(b.date) - parseDate(a.date))

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

  return `## CLIENT CALLS (${calls.length} total, newest first)
${callLines}

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

export async function runAIAnalysis(calls) {
  const dataSummary = buildDataSummary(calls)

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
    // If there's surrounding prose, grab from first { to last }
    const first = clean.indexOf('{')
    const last = clean.lastIndexOf('}')
    if (first !== -1 && last !== -1 && last > first) {
      clean = clean.slice(first, last + 1)
    }
    parsed = JSON.parse(clean)
  } catch (e) {
    throw new Error('Could not parse analysis response')
  }

  // Validate shape — ensure we at least have signals or analysis
  if (!parsed || (!parsed.signals && !parsed.analysis)) {
    throw new Error('Analysis response missing expected fields')
  }

  // Cache result with timestamp and call count
  const result = {
    signals: parsed.signals || [],
    analysis: parsed.analysis || null,
    generatedAt: new Date().toISOString(),
    callCount: calls.length,
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(result))
  return result
}

export function getCachedAnalysis() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Should we auto-run? Yes if no cache, or if call count changed
export function shouldRefresh(calls) {
  const cached = getCachedAnalysis()
  if (!cached) return true
  if (cached.callCount !== calls.length) return true
  return false
}
