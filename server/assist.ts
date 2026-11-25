import { loadEnv } from "./env.ts"

const MODEL = "claude-haiku-4-5"
const API = "https://api.anthropic.com/v1/messages"
const MAX_TEXT = 16000

export type AssistItem = {
  partNumber: string
  description: string
  quantity: number
  unitPrice: number
}

export type AssistParse = {
  poNumber: string
  poDate: string
  contactName: string
  companyName: string
  email: string
  phone: string
  billingAddress: string
  shippingAddress: string
  city: string
  state: string
  country: string
  zip: string
  comments: string
  paymentTerms: string
  freightTerms: string
  taxExempt: boolean
  shippingAmount: number
  items: AssistItem[]
  warnings: string[]
}

export type AssistResult = AssistParse & {
  model: string
}

function claudeKey(): string {
  return (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim()
}

function modelId(): string {
  return (process.env.CLAUDE_MODEL || MODEL).trim() || MODEL
}

export async function assistStatus() {
  await loadEnv()
  return {
    ready: Boolean(claudeKey()),
    model: modelId(),
  }
}

export async function assistPo(input: { pdfText?: string }): Promise<AssistResult> {
  await loadEnv()
  const key = claudeKey()
  if (!key) {
    throw new Error(
      "Claude API key is missing. Put CLAUDE_API_KEY=sk-ant-... in po-invoice/.env and restart.",
    )
  }

  const payload = {
    model: modelId(),
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(input.pdfText || "") }],
  }

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  })
  const raw = await res.text()
  if (!res.ok) {
    throw new Error(apiError(res.status, raw))
  }

  let parsed: { content?: Array<{ type?: string; text?: string }> }
  try {
    parsed = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> }
  } catch {
    throw new Error("Claude returned a response that was not JSON.")
  }
  const text = (parsed.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text || "")
    .join("\n")
  return { ...toParse(parseJsonObject(text), input.pdfText || ""), model: modelId() }
}

const SYSTEM = `You extract a customer purchase order into JSON for PacketMicro to create a QuickBooks Online Invoice.
PacketMicro is the vendor/supplier — never treat PacketMicro, 3350 Scott Blvd, or sales@packetmicro.com as the customer.
Return JSON only, no markdown, with this shape:
{"poNumber":"","poDate":"","contactName":"","companyName":"","email":"","phone":"","billingAddress":"","shippingAddress":"","city":"","state":"","country":"","zip":"","comments":"","paymentTerms":"","freightTerms":"","taxExempt":false,"shippingAmount":0,"items":[{"partNumber":"","description":"","quantity":1,"unitPrice":0}],"warnings":[]}
Rules:
- poNumber: the customer's PO number that must appear on the invoice (Keysight "Purchase Order Number", PSG "PSG-Order no." / "PO number").
- poDate: order date as YYYY-MM-DD when possible.
- companyName: the buying company (Keysight, PSG Procurement Services, etc.), not PacketMicro.
- email: the line-item requestor / deliver-to person, labeled "Requestor Deliver to" then "Email" (e.g. anthony.trujillo2@keysight.com). Never AP / scanning / invoice mailboxes such as americas-apscanning@keysight.com, never buyer/purchasing header, never PacketMicro.
- billingAddress / shippingAddress: COMPLETE customer addresses — name/company if present, street, city, state/region, postal code, country. Use \\n between lines. Do not put only street line 1. Not PacketMicro's address.
- Address priority: shippingAddress is required when a ship-to / deliver-to exists (including when the header says "see item" / "in shipment lines"). Use billingAddress only when there is no ship-to.
- city/state/country/zip: parse from shippingAddress when present, else billingAddress. Still fill these even though the full address is also in shippingAddress/billingAddress.
- paymentTerms: the PO payment terms only (NET 45, Prepay, Net 30, Due on receipt). Prefer the header "Payment Terms" / "Terms of Payment" line. Keep it short, e.g. "NET 45" not a sentence.
- freightTerms: COLLECT, PREPAID, DAP, etc. If freight is collect / customer-paid, shippingAmount is 0.
- taxExempt: true when the PO says tax-exempt, intra-Community supply, export, or tax-free. A Tax column of "Y" is only a flag — it is not a tax amount. Do not invent tax dollars.
- shippingAmount: only a number if the PO lists a freight/shipping charge. Otherwise 0.
- items: each product line. Prefer the supplier/vendor part number (e.g. "SUPPLIER PART NUMBER TP250LB") over the customer's internal item number. Keep hyphens as written. Do not invent SKUs. If a line is visible but the SKU is unreadable, still include it with partNumber "" and describe what you saw.
- comments: MUST include "Ship-to email: {email}" when that email exists. Also need-by date, FedEx account, deliver-to name. Not the full item list.
- warnings: short notes for anything unclear, guessed, conflicting, unreadable, or missing (garbled SKU, two possible PO numbers, tax unclear, missing ship-to email, etc.). If everything is clear, use [].
- If a field is unknown, use "". items may be [].`

function userPrompt(pdfText: string): string {
  return ["Customer PO text:", clip(pdfText, MAX_TEXT)].join("\n")
}

function clip(text: string, max = MAX_TEXT): string {
  const trimmed = text.replace(/\u0000/g, "").trim()
  if (!trimmed) return "(empty)"
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}\n…[truncated]`
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/\{[\s\S]*\}/)
  const raw = fenced ? fenced[0] : text
  try {
    const value = JSON.parse(raw) as unknown
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  throw new Error("Claude did not return usable PO JSON.")
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const SKIP_EMAIL =
  /packetmicro\.com$|noreply|donotreply|purchasing@|accounts\.?payable|vendor@|aps?canning|americas-ap|invoices?@|remit@|imaging@/i
const ROLE_LOCAL =
  /^(ap|accounts|purchasing|buyer|procurement|invoices?|billing|noreply|scan|scanning|imaging|webmaster|info|sales|americas-ap)/i
const SHIP_WINDOW =
  /(?:requestor\s+deliver\s+to|deliver\s+to|ship\s*-?\s*to|end\s*user|consignee|notify(?:\s+party)?)[:\s][\s\S]{0,600}/gi

function isSkippedEmail(email: string): boolean {
  return SKIP_EMAIL.test(email) || ROLE_LOCAL.test(email.split("@")[0] || "")
}

function isPersonEmail(email: string): boolean {
  const local = email.split("@")[0] || ""
  if (isSkippedEmail(email) || ROLE_LOCAL.test(local) || /scanning|invoice|payable|procurement/i.test(local)) {
    return false
  }
  return /[a-z]+[._][a-z]+/i.test(local)
}

function scoreShipToEmail(email: string, text: string, contactName: string): number {
  const e = email.toLowerCase()
  if (isSkippedEmail(e)) return -100
  let score = isPersonEmail(e) ? 8 : 1
  const local = e.split("@")[0]
  const req = text.match(/requestor\s+deliver\s+to[\s\S]{0,400}/i)
  if (req?.[0].toLowerCase().includes(e)) score += 40
  const labeled = text.match(/requestor\s+deliver\s+to[\s\S]{0,250}?email\s+(\S+@\S+)/i)
  if (labeled?.[1]?.toLowerCase().includes(local)) score += 20
  const last = (contactName.split(/[,\s]+/).find((w) => w.length > 2) || "").toLowerCase()
  if (last && local.includes(last)) score += 25
  return score
}

export function shipToEmailsFromText(text: string, contactName = ""): string[] {
  const chunks = [...text.matchAll(SHIP_WINDOW)].map((m) => m[0])
  const near = chunks.flatMap((c) => c.match(EMAIL_RE) || [])
  const unique = [...new Set(near.map((e) => e.trim()))].filter((e) => e.includes("@") && !isSkippedEmail(e))
  return unique.sort(
    (a, b) => scoreShipToEmail(b, text, contactName) - scoreShipToEmail(a, text, contactName),
  )
}

export function pickShipToEmail(text: string, contactName = "", fallback = ""): string {
  const fromWindows = shipToEmailsFromText(text, contactName)
  const all = [...fromWindows, fallback.trim()].filter(Boolean)
  const unique = [...new Set(all)]
  const ranked = unique
    .map((e) => ({ e, score: scoreShipToEmail(e, text, contactName) }))
    .sort((a, b) => b.score - a.score)
  return ranked.find((row) => row.score > 0)?.e || fromWindows.find(isPersonEmail) || ""
}

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function multiLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function stitchAddress(
  block: string,
  city: string,
  state: string,
  zip: string,
  country: string,
): string {
  if (!block) return ""
  const lower = block.toLowerCase()
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
  const extra = [cityStateZip, country].filter((p) => p && !lower.includes(p.toLowerCase()))
  return [block, ...extra].join("\n")
}

function withShipToEmails(comments: string, emails: string[]): string {
  if (emails.length === 0) return comments
  const missing = emails.filter((e) => !comments.toLowerCase().includes(e.toLowerCase()))
  if (missing.length === 0) return comments
  return [`Ship-to email: ${missing.join("; ")}`, comments].filter(Boolean).join("\n")
}

export function toParse(obj: Record<string, unknown>, pdfText = ""): AssistParse {
  const str = (key: string) => oneLine(obj[key])
  const itemsRaw = Array.isArray(obj.items) ? obj.items : []
  const items: AssistItem[] = []
  for (const row of itemsRaw) {
    if (!row || typeof row !== "object") continue
    const rec = row as Record<string, unknown>
    const partNumber = String(rec.partNumber ?? rec.sku ?? "").trim()
    const description = String(rec.description ?? "").trim()
    const quantity = Math.max(1, Number(rec.quantity) || 0)
    const unitPrice = Number(rec.unitPrice)
    if (!partNumber && !description) continue
    if (quantity < 1 || quantity > 99999) continue
    items.push({
      partNumber,
      description,
      quantity,
      unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
    })
    if (items.length >= 80) break
  }
  const shippingAmount = Number(obj.shippingAmount)
  const warningsRaw = Array.isArray(obj.warnings) ? obj.warnings : []
  const warnings = warningsRaw
    .map((w) => String(w || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20)
  const city = str("city")
  const state = str("state")
  const country = str("country")
  const zip = str("zip")
  const shippingAddress = stitchAddress(multiLine(obj.shippingAddress), city, state, zip, country)
  const billingAddress = stitchAddress(
    multiLine(obj.billingAddress),
    shippingAddress ? "" : city,
    shippingAddress ? "" : state,
    shippingAddress ? "" : zip,
    shippingAddress ? "" : country,
  )
  const foundEmails = shipToEmailsFromText(pdfText, str("contactName"))
  const email = pickShipToEmail(pdfText, str("contactName"), str("email"))
  const comments = withShipToEmails(
    multiLine(obj.comments),
    foundEmails.length ? foundEmails : email ? [email] : [],
  )
  return {
    poNumber: str("poNumber"),
    poDate: str("poDate"),
    contactName: str("contactName"),
    companyName: str("companyName"),
    email,
    phone: str("phone"),
    billingAddress,
    shippingAddress,
    city,
    state,
    country,
    zip,
    comments,
    paymentTerms: str("paymentTerms"),
    freightTerms: str("freightTerms"),
    taxExempt: obj.taxExempt === true || /true|yes|exempt/i.test(String(obj.taxExempt ?? "")),
    shippingAmount: Number.isFinite(shippingAmount) && shippingAmount > 0 ? shippingAmount : 0,
    items,
    warnings,
  }
}

function apiError(status: number, raw: string): string {
  try {
    const body = JSON.parse(raw) as { error?: { message?: string; type?: string } }
    const msg = body.error?.message || ""
    if (status === 401 || status === 403) return "Claude API key was rejected. Check CLAUDE_API_KEY."
    if (msg) return msg
  } catch {
    /* use status */
  }
  return `Claude request failed (${status})`
}

export function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}
