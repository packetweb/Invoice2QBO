type TermLike = { id: string; name: string; active: boolean }

function normalizeTermLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%]/g, "")
}

const TERM_ALIASES: Record<string, string> = {
  net45: "net45",
  net45days: "net45",
  net30: "net30",
  net15: "net15",
  net60: "net60",
  net90: "net90",
  net10: "net10",
  prepaid: "prepaid",
  prepay: "prepaid",
  dueonreceipt: "dueonreceipt",
  cod: "dueonreceipt",
}

function termKey(label: string): string {
  const raw = normalizeTermLabel(label)
  if (!raw) return ""
  if (TERM_ALIASES[raw]) return TERM_ALIASES[raw]
  const net = label.match(/\bnet[\s-]*(\d+)\b/i) || raw.match(/net(\d+)/)
  if (net) return `net${net[1]}`
  if (/pre-?pay|prepaid/i.test(label) || raw.includes("prepaid") || raw.includes("prepay")) return "prepaid"
  return raw
}

/** Same mapping CRM uses when creating the invoice (NET 45 / Prepay / Net 45 days → QBO Term). */
export function matchQboTerm(terms: TermLike[], label: string): TermLike | null {
  const raw = normalizeTermLabel(label)
  const want = termKey(label)
  if (!want || terms.length === 0) return null
  const scored = terms
    .filter((t) => t.active !== false)
    .map((t) => {
      const name = normalizeTermLabel(t.name)
      const key = termKey(t.name)
      let score = 0
      if (name === want || name === raw || key === want) score = 100
      else if (name.startsWith(want) || want.startsWith(name) || key.startsWith(want) || want.startsWith(key)) score = 60
      else if (name.includes(want) || want.includes(name)) score = 40
      return { t, score, name }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
  return scored[0]?.t || null
}
