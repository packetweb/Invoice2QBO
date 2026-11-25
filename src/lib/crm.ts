import { apiFetch } from "./apiFetch"
import type { Product, QboCustomerMatch, QboTerm } from "../types"

export function crmApiBase(): string {
  const port = (import.meta.env.VITE_CRM_PORT_NUM as string | undefined)?.trim() || "3000"
  if (typeof window !== "undefined" && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:${port}`
  }
  return "http://localhost:3000"
}

async function crmJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`${crmApiBase()}${path}`, init)
  const body = await res.json().catch(() => ({}) as Record<string, unknown>)
  if (!res.ok || (body as { ok?: boolean })?.ok === false) {
    const err = new Error(
      (body as { message?: string; error?: string })?.message ||
        (body as { error?: string })?.error ||
        `CRM request failed (${res.status})`,
    ) as Error & { status?: number; body?: unknown }
    err.status = res.status
    err.body = body
    throw err
  }
  return body as T
}

export async function fetchQboCatalogItems(): Promise<Product[]> {
  const body = await crmJson<{ items: Product[] }>("/api/qbo/items")
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error("No active QBO items returned. Is CRM connected to QuickBooks?")
  }
  return body.items
}

export async function fetchQboClasses(): Promise<Array<{ id: string; name: string }>> {
  const body = await crmJson<{ classes?: Array<{ id: string; name: string }> }>("/api/qbo/classes")
  return Array.isArray(body.classes) ? body.classes.filter((c) => c?.name) : []
}

export async function fetchQboTerms(): Promise<QboTerm[]> {
  const body = await crmJson<{ terms: QboTerm[] }>("/api/qbo/terms")
  return body.terms || []
}

export async function searchQboCustomers(q: string): Promise<QboCustomerMatch[]> {
  const query = q.trim()
  if (query.length < 2) return []
  const body = await crmJson<{ customers: QboCustomerMatch[] }>(
    `/api/qbo/customers?q=${encodeURIComponent(query)}`,
  )
  return body.customers || []
}

export type PoMatch = {
  source: string
  invoiceId: string
  docNumber: string | null
  txnDate: string | null
  poNumber: string
  customerName: string
  total: number
  link: string
}

export type EstimateItem = {
  sku: string
  qty: number | null
}

export type EstimateMatch = {
  source: string
  estimateId: string
  docNumber: string | null
  txnDate: string | null
  status: string
  total: number
  customerName: string
  converted: boolean
  items?: EstimateItem[]
  extra?: number
  skus: string[]
  link: string
}

export async function fetchEstimatesForCustomer(
  qboId: string,
  company = "",
): Promise<EstimateMatch[]> {
  const id = qboId.trim()
  const name = company.trim()
  if (!id && !name) return []
  const q = new URLSearchParams()
  if (id) q.set("qbo_id", id)
  if (name) q.set("company", name)
  const body = await crmJson<{ estimates: EstimateMatch[] }>(
    `/api/qbo/estimates-for-customer?${q.toString()}`,
  )
  return body.estimates || []
}

export async function fetchInvoicesByPo(poNumber: string): Promise<PoMatch[]> {
  const po = poNumber.trim()
  if (!po) return []
  const body = await crmJson<{ matches: PoMatch[] }>(
    `/api/qbo/invoices-by-po?po=${encodeURIComponent(po)}`,
  )
  return body.matches || []
}

export type CreatedInvoice = {
  id: number
  poNumber: string
  qboInvoiceId: string
  docNumber: string | null
  customerName: string
  companyName: string
  email: string
  subtotal: number
  link: string
  createdAt: string
  usedTempCustomer?: boolean
}

export async function fetchCreatedInvoices(): Promise<CreatedInvoice[]> {
  const body = await crmJson<{ invoices: CreatedInvoice[] }>("/api/qbo/created-invoices")
  return body.invoices || []
}

export async function fetchTempCustomer(): Promise<{ id: string; displayName: string; created: boolean }> {
  const body = await crmJson<{ created?: boolean; customer: { id: string; displayName: string } }>(
    "/api/qbo/temp-customer",
  )
  return {
    id: body.customer.id,
    displayName: body.customer.displayName,
    created: Boolean(body.created),
  }
}

export type CreateInvoiceResult = {
  invoiceId: string
  docNumber: string | null
  poNumber: string
  link: string
  customerId: string
  createdNewCustomer: boolean
  usedTempCustomer?: boolean
  customerDisplayName?: string
  term: { id: string; name: string } | null
  createdAt: string
}

export async function createQboInvoice(
  job: Record<string, unknown>,
): Promise<CreateInvoiceResult> {
  return crmJson<CreateInvoiceResult>("/api/qbo/create-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  })
}
