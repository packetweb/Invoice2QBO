import type { Product } from "../types"

export function normalizeSku(value: string): string {
  return value.replace(/[\s._-]/g, "").toUpperCase()
}

export function matchProduct(partNumber: string, products: Product[]): Product | null {
  const part = partNumber.trim()
  if (!part) return null
  const exact = products.find((p) => p.partNumber.toLowerCase() === part.toLowerCase())
  if (exact) return exact
  const n = normalizeSku(part)
  return products.find((p) => normalizeSku(p.partNumber) === n) || null
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
