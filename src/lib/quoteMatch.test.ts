import assert from "node:assert/strict"
import { rankQuotes } from "./quoteMatch"

const dvt = [
  {
    docNumber: "26040605",
    total: 30128,
    items: [
      { sku: "HPS24RP_SET", qty: 1 },
      { sku: "TP250LB", qty: 1 },
      { sku: "TP250RB", qty: 1 },
    ],
  },
  {
    docNumber: "26020401",
    total: 30228,
    items: [
      { sku: "TP250LB", qty: 1 },
      { sku: "TP250RB", qty: 1 },
      { sku: "FP160MS-MA02", qty: 2 },
    ],
  },
  {
    docNumber: "26011204",
    total: 6200,
    items: [
      { sku: "DP-GSSG-651505", qty: 1 },
      { sku: "DP-GSSG-651505DL", qty: 1 },
    ],
  },
]

{
  const ranked = rankQuotes(dvt, [])
  assert.deepEqual(
    ranked.map((q) => q.docNumber),
    ["26040605", "26020401", "26011204"],
  )
  assert.equal(ranked.every((q) => !q.match.best), true)
}

{
  const ranked = rankQuotes(dvt, [
    { sku: "HPS24RP_SET", qty: 1 },
    { sku: "TP250LB", qty: 1 },
  ])
  assert.equal(ranked[0].docNumber, "26040605")
  assert.equal(ranked[0].match.best, true)
  assert.equal(ranked[0].match.skuHits, 2)
  assert.equal(ranked[1].docNumber, "26020401")
  assert.equal(ranked[1].match.best, false)
  assert.equal(ranked[1].match.skuHits, 1)
  assert.equal(ranked[2].docNumber, "26011204")
  assert.equal(ranked[2].match.skuHits, 0)
}

{
  const ranked = rankQuotes(dvt, [{ sku: "DP-GSSG-651505", qty: 1 }])
  assert.equal(ranked[0].docNumber, "26011204")
  assert.equal(ranked[0].match.best, true)
}

{
  const ranked = rankQuotes(dvt, [{ sku: "NO-SUCH-SKU", qty: 1 }])
  assert.equal(ranked.every((q) => !q.match.best), true)
  assert.deepEqual(
    ranked.map((q) => q.docNumber),
    ["26040605", "26020401", "26011204"],
  )
}

console.log("quoteMatch.test.ts: all checks passed")
