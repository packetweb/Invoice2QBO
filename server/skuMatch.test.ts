import assert from "node:assert/strict"
import { matchProduct, normalizeSku } from "../src/lib/match.ts"

const catalog = [
  { partNumber: "TCB-DL03", description: "probe", status: "Active", type: "Service", taxable: true, listPrice: 1 },
  { partNumber: "TCB-DL01", description: "other", status: "Active", type: "Service", taxable: true, listPrice: 1 },
  { partNumber: "S&H", description: "ship", status: "Active", type: "Service", taxable: false, listPrice: 1 },
]

assert.equal(normalizeSku("TCB - DL03"), "TCBDL03")
assert.equal(normalizeSku("TCB-DL03"), "TCBDL03")
assert.equal(normalizeSku("TCB–DL03"), "TCBDL03")
assert.equal(matchProduct("TCB - DL03", catalog)?.partNumber, "TCB-DL03")
assert.equal(matchProduct("TCB–DL03", catalog)?.partNumber, "TCB-DL03")
assert.equal(matchProduct("TCB-DL03 extra", catalog)?.partNumber, "TCB-DL03")
assert.equal(matchProduct("TCB-DL01", catalog)?.partNumber, "TCB-DL01")
assert.equal(matchProduct("S&H", catalog)?.partNumber, "S&H")
assert.equal(matchProduct("nope", catalog), null)

console.log("skuMatch.test.ts: all checks passed")
