export const PRODUCTS = ['Amsul', 'Urea', 'MAP', 'SSP', 'TSP', 'NP']

export const TREND = { up: '↑', stable: '↔', down: '↓', none: '—' }

// localStorage key
const KEY = 'fertintel_calls'

export function loadCalls() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveCalls(calls) {
  localStorage.setItem(KEY, JSON.stringify(calls))
}

export function addCall(calls, entry) {
  const updated = [{ ...entry, id: Date.now() }, ...calls]
  saveCalls(updated)
  return updated
}

export function deleteCall(calls, id) {
  const updated = calls.filter(c => c.id !== id)
  saveCalls(updated)
  return updated
}

// Summarize price data across calls for charts
export function buildPriceSeries(calls, product) {
  return calls
    .filter(c => c.prices?.[product]?.value)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(c => ({
      date: c.date,
      client: c.client,
      price: parseFloat(c.prices[product].value),
      trend: c.prices[product].trend,
    }))
}

export function buildDemandSummary(calls) {
  const map = {}
  calls.forEach(c => {
    if (!map[c.client]) map[c.client] = { active: 0, none: 0, potential: 0 }
    const d = (c.demand || '').toLowerCase()
    if (d.includes('no demand') || d.includes('no demanda')) map[c.client].none++
    else if (d.includes('possible') || d.includes('posible') || d.includes('looking')) map[c.client].potential++
    else if (d.trim()) map[c.client].active++
  })
  return map
}

export function buildMarketSignals(calls) {
  const signals = []
  const recent = calls.slice(0, 10)

  // Price pressure signal
  const downCalls = recent.filter(c =>
    Object.values(c.prices || {}).some(p => p.trend === 'down')
  )
  if (downCalls.length >= 2) {
    signals.push({ type: 'warning', text: `${downCalls.length} recent calls show downward price trends.` })
  }

  // Supply overhang from remarks
  const supplyKeywords = ['unsold', 'overhang', 'arriving', 'excess', 'surplus']
  const supplyAlerts = recent.filter(c =>
    supplyKeywords.some(kw => (c.remarks || '').toLowerCase().includes(kw))
  )
  if (supplyAlerts.length) {
    signals.push({ type: 'alert', text: `Supply overhang mentioned by: ${supplyAlerts.map(c => c.client).join(', ')}.` })
  }

  // Demand silence
  const noDemand = recent.filter(c =>
    (c.demand || '').toLowerCase().includes('no demand') ||
    (c.demand || '').toLowerCase().includes('no demanda')
  )
  if (noDemand.length >= 2) {
    signals.push({ type: 'warning', text: `${noDemand.length} clients report no current demand.` })
  }

  // Opportunities
  const opportunity = recent.filter(c =>
    ['possible', 'looking', 'target', 'opportunity'].some(kw =>
      (c.remarks || '').toLowerCase().includes(kw) ||
      (c.demand || '').toLowerCase().includes(kw)
    )
  )
  if (opportunity.length) {
    signals.push({ type: 'opportunity', text: `Potential opportunities: ${opportunity.map(c => c.client).join(', ')}.` })
  }

  return signals
}

export function editCall(calls, id, updates) {
  const updated = calls.map(c => c.id === id ? { ...c, ...updates } : c)
  saveCalls(updated)
  return updated
}
