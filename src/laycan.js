// ── Laycan by month (desk ruling 2026-11-11) ──
// A laycan is a month: "Nov 2026". The forms offer the next 12 months and
// store that one spelling, so two entries for the same shipment month can
// never differ by typing.
//
// Older calls hold free text ("Nov", "November", "Nov 15-30", "nov/26").
// Their stored text is never changed. For MATCHING only, anything that names
// exactly one month is read as that month, with the year taken from the
// call's own date when the text has none. Text that names no month, or more
// than one ("Nov/Dec"), is left as typed and matches only itself.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// English and Portuguese month names, long and short, accent-free.
const MONTH_WORDS = {
  jan: 0, january: 0, janeiro: 0,
  feb: 1, fev: 1, february: 1, fevereiro: 1,
  mar: 2, march: 2, marco: 2,
  apr: 3, abr: 3, april: 3, abril: 3,
  may: 4, mai: 4, maio: 4,
  jun: 5, june: 5, junho: 5,
  jul: 6, july: 6, julho: 6,
  aug: 7, ago: 7, august: 7, agosto: 7,
  sep: 8, sept: 8, set: 8, september: 8, setembro: 8,
  oct: 9, out: 9, october: 9, outubro: 9,
  nov: 10, november: 10, novembro: 10,
  dec: 11, dez: 11, december: 11, dezembro: 11,
}

const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function refParts(refDate) {
  const d = refDate ? new Date(String(refDate).slice(0, 10) + 'T12:00:00') : new Date()
  const ok = !isNaN(d.getTime())
  const x = ok ? d : new Date()
  return { year: x.getFullYear(), month: x.getMonth() }
}

export const formatLaycan = (monthIdx, year) => `${MONTHS[monthIdx]} ${year}`

// The next `count` months starting at the month of `refDate` (default today).
export function monthOptions(refDate, count = 12) {
  const { year, month } = refParts(refDate)
  return Array.from({ length: count }, (_, i) => {
    const m = (month + i) % 12, y = year + Math.floor((month + i) / 12)
    return formatLaycan(m, y)
  })
}

// "Nov 2026" when the text names exactly one month; otherwise null.
export function canonicalLaycan(text, refDate) {
  const s = strip(text).trim()
  if (!s) return null
  const words = s.match(/[a-z]+/g) || []
  const months = [...new Set(words.map(w => MONTH_WORDS[w]).filter(m => m != null))]
  if (months.length !== 1) return null
  const m = months[0]
  // an explicit year: 4 digits, or 2 digits right after the month ("nov/26", "nov 26" is ambiguous with a day, so only after / or -)
  let year = null
  const y4 = s.match(/\b(20\d{2})\b/)
  if (y4) year = parseInt(y4[1], 10)
  else {
    const y2 = s.match(/[a-z]\s*[\/\-']\s*(\d{2})\b(?!\s*[-–]\s*\d)/)
    // only a plausible year counts ("nov/26"); "nov-15" is a day, not 2015
    if (y2 && Math.abs(2000 + parseInt(y2[1], 10) - refParts(refDate).year) <= 2) year = 2000 + parseInt(y2[1], 10)
  }
  if (year == null) {
    // No year: the shipment month nearest ahead of the call. A month up to two
    // months before the call date is read as the same year (late shipment);
    // anything earlier is next year.
    const ref = refParts(refDate)
    year = m < ref.month - 2 ? ref.year + 1 : ref.year
  }
  return formatLaycan(m, year)
}

// Key used when comparing two laycans: the canonical month when there is one,
// else the trimmed, lower-cased text.
export function laycanKey(text, refDate) {
  const c = canonicalLaycan(text, refDate)
  return c ? c.toLowerCase() : String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}
