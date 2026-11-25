import type { Product } from "../types"

/** Fold PDF/QBO punctuation so "TCB - DL03", "TCB–DL03", and "TCB-DL03" are the same SKU. */
export function normalizeSku(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\s._/\-]+/g, "")
    .toUpperCase()
}

export function matchProduct(partNumber: string, products: Product[]): Product | null {
  const part = partNumber.trim()
  if (!part) return null
  const exact = products.find((p) => p.partNumber.toLowerCase() === part.toLowerCase())
  if (exact) return exact
  const n = normalizeSku(part)
  if (!n) return null
  const equal = products.find((p) => normalizeSku(p.partNumber) === n)
  if (equal) return equal
  const extras = products.filter((p) => {
    const pn = normalizeSku(p.partNumber)
    return pn.length >= 6 && n.length > pn.length && n.startsWith(pn)
  })
  extras.sort((a, b) => normalizeSku(b.partNumber).length - normalizeSku(a.partNumber).length)
  if (!extras.length) return null
  const best = extras[0]
  const bestLen = normalizeSku(best.partNumber).length
  if (extras.filter((p) => normalizeSku(p.partNumber).length === bestLen).length > 1) return null
  return best
}

export function matchTaxItem(city: string, country: string, products: Product[]): Product | null {
  if (!city.trim()) return null
  if (country && !/usa|united states|^us$/i.test(country.trim())) return null
  const needle = city.replace(/[^a-z]/gi, "").toLowerCase()
  if (needle.length < 4) return null
  const taxes = products.filter((p) => /^stax/i.test(p.partNumber))
  const hits = taxes.filter((p) =>
    p.partNumber.replace(/[^a-z]/gi, "").toLowerCase().includes(needle),
  )
  hits.sort((a, b) => a.partNumber.length - b.partNumber.length)
  return hits.find((p) => !/partial/i.test(p.partNumber)) || hits[0] || null
}

export function isFreightCollect(freightTerms: string): boolean {
  return /\bcollect\b/i.test(freightTerms)
}
