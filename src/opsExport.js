// ── Cargo breakdown export (.xlsx) for one shipment ──
import * as XLSX from 'xlsx'

export function exportBreakdownXlsx(shipment, rows) {
  const data = rows.map(r => ({
    Client: r.client,
    'LG REF': r.lgRef,
    'Port of Loading': r.loadPort,
    'Port of Discharge': r.port,
    Product: r.product,
    'Volume (MT)': r.tons,
    'Unit Price (USD)': r.price,
    'Total Value (USD)': r.total,
  }))
  data.push({
    Client: 'TOTAL', 'LG REF': '', 'Port of Loading': '', 'Port of Discharge': '', Product: '',
    'Volume (MT)': rows.reduce((a, r) => a + r.tons, 0),
    'Unit Price (USD)': '',
    'Total Value (USD)': rows.reduce((a, r) => a + r.total, 0),
  })
  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cargo Breakdown')
  const safe = s => String(s || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_')
  XLSX.writeFile(wb, `${[safe(shipment.vessel), safe(shipment.laycan)].filter(Boolean).join('_')}_Cargo_Breakdown.xlsx`)
}
