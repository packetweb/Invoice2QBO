import { apiFetch } from "./apiFetch"

export type AssistItem = {
  partNumber: string
  description: string
  quantity: number
  unitPrice: number
}

export type AssistResult = {
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
  model: string
}

export function formatClaudeModel(id: string): string {
  const raw = id.trim()
  if (!raw) return ""
  const body = raw.replace(/^claude[-_]?/i, "").replace(/[_-]+/g, " ").trim()
  const titled = body.replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
  const dotted = titled.replace(/\b(\d+)\s+(\d+)\b/g, "$1.$2")
  return dotted ? `Claude ${dotted}` : raw
}

export async function fetchPoAssistStatus(): Promise<{ ready: boolean; model: string }> {
  const res = await apiFetch("/api/po/status")
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json() as Promise<{ ready: boolean; model: string }>
}

export async function askPoAssist(pdfText: string): Promise<AssistResult> {
  const res = await apiFetch("/api/po/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdfText }),
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json() as Promise<AssistResult>
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as { error?: string }
    if (body.error) return body.error
  } catch {
    /* raw */
  }
  return text || `Assist request failed (${res.status})`
}
