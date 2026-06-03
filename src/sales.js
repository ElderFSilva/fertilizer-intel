// Sales / trade log — stored separately from calls
const SALES_KEY = 'fertintel_sales'

export const SALE_PRODUCTS = ['Amsul', 'Urea', 'MAP', 'SSP', 'TSP', 'NP 10-45', 'NP 11-44', 'NP 08-40', 'NP 08-40+5S']

export function loadSales() {
  try {
    const raw = localStorage.getItem(SALES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveSales(sales) {
  localStorage.setItem(SALES_KEY, JSON.stringify(sales))
}

export function addSale(sale) {
  const sales = loadSales()
  const newSale = { ...sale, id: Date.now() }
  const updated = [newSale, ...sales]
  saveSales(updated)
  return updated
}

export function deleteSale(id) {
  const updated = loadSales().filter(s => s.id !== id)
  saveSales(updated)
  return updated
}

export function editSale(id, patch) {
  const updated = loadSales().map(s => s.id === id ? { ...s, ...patch } : s)
  saveSales(updated)
  return updated
}

function parseNum(v) {
  if (v === '' || v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

// Analytics across the sales log
export function buildSalesStats(sales) {
  if (!sales.length) return null

  const totalVolume = sales.reduce((s, x) => s + (parseNum(x.volume) || 0), 0)
  const totalDeals = sales.length

  // Spread = offer - done, where both exist
  const spreads = sales
    .map(s => {
      const offer = parseNum(s.offerPrice)
      const done = parseNum(s.donePrice)
      return offer != null && done != null ? offer - done : null
    })
    .filter(v => v != null)
  const avgSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null

  // Per-product volume + avg done price
  const byProduct = {}
  sales.forEach(s => {
    const p = s.product || 'Unknown'
    if (!byProduct[p]) byProduct[p] = { volume: 0, doneSum: 0, doneCount: 0, deals: 0 }
    byProduct[p].volume += parseNum(s.volume) || 0
    byProduct[p].deals += 1
    const done = parseNum(s.donePrice)
    if (done != null) { byProduct[p].doneSum += done; byProduct[p].doneCount += 1 }
  })
  const productStats = Object.entries(byProduct).map(([product, d]) => ({
    product,
    volume: d.volume,
    deals: d.deals,
    avgDone: d.doneCount ? Math.round(d.doneSum / d.doneCount) : null,
  })).sort((a, b) => b.volume - a.volume)

  return { totalVolume, totalDeals, avgSpread, productStats }
}
