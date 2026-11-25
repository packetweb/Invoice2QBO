import { normalizeSku } from "./match"

export type QuoteCartLine = {
  sku: string
  qty: number
}

export type QuoteLine = {
  sku: string
  qty: number | null
}

export type QuoteForMatch = {
  items?: QuoteLine[]
  skus?: string[]
  total?: number
}

export type QuoteMatchInfo = {
  skuHits: number
  cartCount: number
  qtyHits: number
  score: number
  best: boolean
}

export type RankedQuote<T extends QuoteForMatch> = T & { match: QuoteMatchInfo }

function isIgnoredSku(sku: string) {
  const s = normalizeSku(sku)
  if (!s) return true
  if (s === "TAX" || s.startsWith("STAX") || s === "SH" || s.startsWith("SHIP")) return true
  return false
}

function quoteLines(quote: QuoteForMatch): QuoteLine[] {
  if (quote.items?.length) return quote.items
  return (quote.skus || []).map((sku) => ({ sku, qty: null }))
}

function scoreQuote(quote: QuoteForMatch, cart: QuoteCartLine[], poTotal = 0) {
  const quoteMap = new Map<string, number | null>()
  for (const row of quoteLines(quote)) {
    if (isIgnoredSku(row.sku)) continue
    const key = normalizeSku(row.sku)
    const prev = quoteMap.get(key)
    const qty = row.qty != null && Number.isFinite(row.qty) ? row.qty : null
    if (prev == null) quoteMap.set(key, qty)
    else quoteMap.set(key, (prev || 0) + (qty || 0))
  }

  let skuHits = 0
  let qtyHits = 0
  for (const line of cart) {
    const key = normalizeSku(line.sku)
    if (!quoteMap.has(key)) continue
    skuHits += 1
    const quoteQty = quoteMap.get(key)
    if (quoteQty != null && quoteQty > 0 && Math.abs(quoteQty - line.qty) < 0.01) qtyHits += 1
  }

  const coverage = cart.length ? skuHits / cart.length : 0
  const precision = quoteMap.size ? skuHits / quoteMap.size : 0
  const qtyRatio = skuHits ? qtyHits / skuHits : 0
  let totalRatio = 0
  const quoteTotal = Number(quote.total) || 0
  if (poTotal > 0 && quoteTotal > 0) {
    totalRatio = 1 - Math.min(1, Math.abs(poTotal - quoteTotal) / Math.max(poTotal, quoteTotal))
  }

  return {
    skuHits,
    cartCount: cart.length,
    qtyHits,
    score: coverage * 100 + precision * 30 + qtyRatio * 15 + totalRatio * 10,
  }
}

/** Rank QBO estimates against PO lines. Best match is first when the PO has SKUs. */
export function rankQuotes<T extends QuoteForMatch>(
  quotes: T[],
  cart: QuoteCartLine[],
  poTotal = 0,
): RankedQuote<T>[] {
  const usable = cart.filter((line) => line.sku.trim() && !isIgnoredSku(line.sku))
  if (usable.length === 0) {
    return quotes.map((quote) => ({
      ...quote,
      match: { skuHits: 0, cartCount: 0, qtyHits: 0, score: 0, best: false },
    }))
  }

  const scored = quotes.map((quote, index) => {
    const info = scoreQuote(quote, usable, poTotal)
    return { quote, index, info }
  })
  scored.sort((a, b) => b.info.score - a.info.score || a.index - b.index)

  const top = scored[0]?.info
  const topScore = top?.score ?? 0
  const canCrown = Boolean(top && top.skuHits > 0 && topScore > 0)

  return scored.map(({ quote, info }) => ({
    ...quote,
    match: {
      ...info,
      best: canCrown && info.score === topScore && info.skuHits > 0,
    },
  }))
}
