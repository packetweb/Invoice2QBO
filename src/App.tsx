import { useEffect, useMemo, useRef, useState } from "react"
import "./App.css"
import type { LineItem, PoDraft, Product, QboTerm } from "./types"
import { askPoAssist, fetchPoAssistStatus, formatClaudeModel } from "./lib/assist"
import {
  createQboInvoice,
  fetchCreatedInvoices,
  fetchInvoicesByPo,
  fetchQboCatalogItems,
  fetchQboTerms,
  type CreatedInvoice,
  type PoMatch,
} from "./lib/crm"
import { createId, formatMoney } from "./lib/format"
import { isFreightCollect, matchProduct } from "./lib/match"
import { extractPdfText } from "./lib/pdfText"

const emptyDraft = (): PoDraft => ({
  poNumber: "",
  poDate: "",
  contactName: "",
  companyName: "",
  email: "",
  phone: "",
  billingAddress: "",
  shippingAddress: "",
  city: "",
  state: "",
  country: "",
  zip: "",
  comments: "",
  paymentTerms: "",
  freightTerms: "",
  taxExempt: false,
  shippingAmount: 0,
})

function homeHref() {
  return `${window.location.protocol}//${window.location.hostname}:4000/`
}

function field(
  label: string,
  value: string,
  onChange: (v: string) => void,
  extra?: { wide?: boolean; textarea?: boolean; warn?: boolean },
) {
  return (
    <div className={`field${extra?.wide ? " wide" : ""}${extra?.warn ? " has-error" : ""}`}>
      <label>{label}</label>
      {extra?.textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<"builder" | "created">("builder")
  const [fileName, setFileName] = useState("")
  const [over, setOver] = useState(false)
  const [draft, setDraft] = useState<PoDraft>(emptyDraft)
  const [lines, setLines] = useState<LineItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [terms, setTerms] = useState<QboTerm[]>([])
  const [termId, setTermId] = useState("")
  const [claudeReady, setClaudeReady] = useState(false)
  const [claudeModel, setClaudeModel] = useState("")
  const [busy, setBusy] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [dupes, setDupes] = useState<PoMatch[]>([])
  const [created, setCreated] = useState<CreatedInvoice[]>([])
  const [createdErr, setCreatedErr] = useState("")
  const [resultLink, setResultLink] = useState("")
  const [extracted, setExtracted] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  const set = (patch: Partial<PoDraft>) => setDraft((d) => ({ ...d, ...patch }))

  useEffect(() => {
    void fetchPoAssistStatus()
      .then((s) => {
        setClaudeReady(s.ready)
        setClaudeModel(s.model)
      })
      .catch(() => setClaudeReady(false))
    void fetchQboCatalogItems()
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load QBO catalog."))
    void fetchQboTerms()
      .then(setTerms)
      .catch(() => setTerms([]))
  }, [])

  const matchedTerm = useMemo(() => {
    if (termId) return terms.find((t) => t.id === termId) || null
    const want = draft.paymentTerms.replace(/[^a-z0-9%]/gi, "").toLowerCase()
    return (
      terms.find((t) => t.name.replace(/[^a-z0-9%]/gi, "").toLowerCase() === want) ||
      terms.find((t) => t.name.replace(/[^a-z0-9%]/gi, "").toLowerCase().includes(want) && want.length >= 4) ||
      null
    )
  }, [termId, terms, draft.paymentTerms])

  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
  const unmapped = lines.filter((l) => l.kind === "item" && !l.mapped)
  const emptyPrice = lines.filter((l) => l.kind === "item" && !(l.unitPrice > 0))
  const missing = {
    poNumber: extracted && !draft.poNumber.trim(),
    contactName: extracted && !draft.contactName.trim(),
    companyName: extracted && !draft.companyName.trim(),
    email: extracted && !draft.email.trim(),
    shipAddress: extracted && !draft.shippingAddress.trim() && !draft.billingAddress.trim(),
    paymentTerms: extracted && !draft.paymentTerms.trim(),
    qboTerm: extracted && Boolean(draft.paymentTerms.trim()) && !matchedTerm,
  }
  const reviewIssues = useMemo(() => {
    if (!extracted) return []
    const issues = [...warnings]
    if (missing.poNumber) issues.push("PO number was not found.")
    if (missing.companyName) issues.push("Customer company was not found.")
    if (missing.contactName) issues.push("Contact name was not found.")
    if (missing.email) issues.push("Ship-to email was not found.")
    if (missing.shipAddress) issues.push("Ship-to address was not found (and no bill-to fallback).")
    if (missing.qboTerm) issues.push(`Payment terms “${draft.paymentTerms}” did not match a QBO Term.`)
    if (missing.paymentTerms) issues.push("Payment terms were not found.")
    if (lines.filter((l) => l.kind === "item").length === 0) issues.push("No product lines were found.")
    if (unmapped.length) {
      issues.push(
        `${unmapped.length} line${unmapped.length === 1 ? "" : "s"} have no QBO item: ${unmapped.map((l) => l.partNumber || "(no SKU)").join(", ")}`,
      )
    }
    if (emptyPrice.length) {
      issues.push(
        `${emptyPrice.length} line${emptyPrice.length === 1 ? "" : "s"} have no unit price.`,
      )
    }
    return [...new Set(issues)]
  }, [
    extracted,
    warnings,
    missing.poNumber,
    missing.companyName,
    missing.contactName,
    missing.email,
    missing.shipAddress,
    missing.qboTerm,
    missing.paymentTerms,
    draft.paymentTerms,
    lines,
    unmapped,
    emptyPrice,
  ])

  const refreshCreated = async () => {
    setCreatedErr("")
    try {
      setCreated(await fetchCreatedInvoices())
    } catch (e) {
      setCreatedErr(e instanceof Error ? e.message : "Could not load created invoices.")
    }
  }

  const applyExtract = (parsed: Awaited<ReturnType<typeof askPoAssist>>, catalog: Product[]) => {
    const nextDraft: PoDraft = {
      poNumber: parsed.poNumber,
      poDate: parsed.poDate,
      contactName: parsed.contactName,
      companyName: parsed.companyName,
      email: parsed.email,
      phone: parsed.phone,
      billingAddress: parsed.billingAddress,
      shippingAddress: parsed.shippingAddress,
      city: parsed.city,
      state: parsed.state,
      country: parsed.country,
      zip: parsed.zip,
      comments: parsed.comments,
      paymentTerms: parsed.paymentTerms,
      freightTerms: parsed.freightTerms,
      taxExempt: parsed.taxExempt,
      shippingAmount: isFreightCollect(parsed.freightTerms) ? 0 : parsed.shippingAmount,
    }
    setDraft(nextDraft)
    const next: LineItem[] = parsed.items.map((it) => {
      const hit = matchProduct(it.partNumber, catalog)
      return {
        id: createId(),
        partNumber: hit?.partNumber || it.partNumber,
        description: hit?.description || it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice > 0 ? it.unitPrice : hit?.listPrice || 0,
        mapped: Boolean(hit),
        kind: "item",
      }
    })
    const shipAmt = nextDraft.shippingAmount
    if (shipAmt > 0) {
      const ship = matchProduct("S&H", catalog)
      next.push({
        id: createId(),
        partNumber: ship?.partNumber || "S&H",
        description: ship?.description || "Shipping & Handling",
        quantity: 1,
        unitPrice: shipAmt,
        mapped: Boolean(ship),
        kind: "shipping",
      })
    }
    setLines(next)
    setTermId("")
    setResultLink("")
    setExtracted(true)
    setWarnings(parsed.warnings || [])
  }

  const ingestFile = async (file: File | undefined) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) {
      setError("Drop a PDF purchase order.")
      return
    }
    setFileName(file.name)
    setError("")
    setDupes([])
    setWarnings([])
    setExtracted(false)
    setBusy("Reading PDF…")
    try {
      const text = await extractPdfText(file)
      if (text.length < 40) {
        throw new Error("Could not read text from this PDF. It may be a scan.")
      }
      if (!claudeReady) {
        throw new Error("Ask Claude is unavailable. Put CLAUDE_API_KEY in po-invoice/.env and restart.")
      }
      setBusy("Extracting with Claude…")
      const parsed = await askPoAssist(text)
      applyExtract(parsed, products)
      if (parsed.poNumber) {
        try {
          setDupes(await fetchInvoicesByPo(parsed.poNumber))
        } catch {
          setDupes([])
        }
      }
      setNote(
        `${formatClaudeModel(parsed.model)} extracted ${parsed.items.length} line${parsed.items.length === 1 ? "" : "s"} from ${file.name}. Review before creating the QBO invoice.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extract failed.")
    } finally {
      setBusy("")
    }
  }

  const updateLine = (id: string, patch: Partial<LineItem>) => {
    setLines((rows) =>
      rows.map((row) => {
        if (row.id !== id) return row
        const next = { ...row, ...patch }
        if (patch.partNumber != null) {
          const hit = matchProduct(patch.partNumber, products)
          if (hit) {
            next.partNumber = hit.partNumber
            next.description = hit.description
            next.mapped = true
          } else {
            next.mapped = false
          }
        }
        return next
      }),
    )
  }

  const createInvoice = async (force = false) => {
    setError("")
    setResultLink("")
    if (!draft.poNumber.trim()) {
      setError("PO number is required.")
      return
    }
    if (!draft.contactName.trim() || !draft.companyName.trim()) {
      setError("Contact name and company are required.")
      return
    }
    if (lines.length === 0) {
      setError("Add at least one line item.")
      return
    }
    if (unmapped.length) {
      setError(`${unmapped.length} SKU(s) are not in the QBO catalog. Fix part numbers first.`)
      return
    }
    setBusy("Creating QBO invoice…")
    try {
      const paymentTerms = matchedTerm?.name || draft.paymentTerms
      const result = await createQboInvoice({
        jobId: `POI-${draft.poNumber.trim()}`,
        source: "po-pdf",
        poNumber: draft.poNumber.trim(),
        invoiceDate: draft.poDate,
        force,
        customer: {
          name: draft.contactName.trim(),
          companyName: draft.companyName.trim(),
          email: draft.email.trim(),
          telephoneNumber: draft.phone.trim(),
          fullAddress: (draft.shippingAddress || draft.billingAddress).trim(),
          city: draft.city.trim(),
          state: draft.state.trim(),
          country: draft.country.trim(),
          zip: draft.zip.trim(),
          comments: draft.comments.trim(),
          billingAddress: draft.billingAddress.trim(),
          shippingAddress: draft.shippingAddress.trim(),
        },
        items: lines.map((l, i) => ({
          line: i + 1,
          partNumber: l.partNumber,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.quantity * l.unitPrice,
          taxable: l.kind === "item",
        })),
        subtotal,
        terms: { paymentTerms },
      })
      setResultLink(result.link)
      setNote(
        `Created QBO invoice ${result.docNumber || result.invoiceId}${result.term ? ` · ${result.term.name}` : ""}.`,
      )
      setDupes([])
    } catch (e) {
      const err = e as Error & { status?: number; body?: { matches?: PoMatch[] } }
      if (err.status === 409 && err.body?.matches) {
        setDupes(err.body.matches)
        setError(err.message)
      } else {
        setError(err.message || "Create invoice failed.")
      }
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={homeHref()} title="Return Home">
          <img className="brand-logo" src="/packetmicro-logo.png" alt="PacketMicro" />
        </a>
        <a className="btn btn-home" href={homeHref()}>
          Return Home
        </a>
        <nav className="view-toggle" aria-label="Views">
          <button type="button" className={view === "builder" ? "active" : ""} onClick={() => setView("builder")}>
            PO to Invoice
          </button>
          <button
            type="button"
            className={view === "created" ? "active" : ""}
            onClick={() => {
              setView("created")
              void refreshCreated()
            }}
          >
            Created Invoices
          </button>
        </nav>
      </header>

      {view === "created" ? (
        <section className="panel">
          <header className="step-head">
            <span className="step-num">E</span>
            <div>
              <h2>Created Invoices</h2>
              <p className="hint">Invoices created from this tool, newest first.</p>
            </div>
          </header>
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={() => void refreshCreated()}>
              Refresh
            </button>
          </div>
          {createdErr && <div className="notice notice-error">{createdErr}</div>}
          {created.length === 0 && !createdErr && <p className="hint">No invoices created yet.</p>}
          {created.length > 0 && (
            <table className="cart-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>PO</th>
                  <th>Customer</th>
                  <th>Company</th>
                  <th>Subtotal</th>
                  <th>QBO</th>
                </tr>
              </thead>
              <tbody>
                {created.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.poNumber || "—"}</td>
                    <td>{row.customerName || "—"}</td>
                    <td>{row.companyName || "—"}</td>
                    <td>{formatMoney(row.subtotal)}</td>
                    <td>
                      <a href={row.link} target="_blank" rel="noreferrer">
                        {row.docNumber || "Open"}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <>
          <section className="panel">
            <header className="step-head">
              <span className="step-num">1</span>
              <div>
                <h2>Drop customer PO</h2>
                <p className="hint">
                  PDF only. Claude extracts PO number, customer, terms, and lines. Review before writing to QuickBooks.
                  {claudeReady && claudeModel ? ` · ${formatClaudeModel(claudeModel)}` : ""}
                </p>
              </div>
            </header>
            <div
              className={`drop${over ? " over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                void ingestFile(e.dataTransfer.files[0])
              }}
            >
              <div>
                <strong>{fileName || "Drop a PO PDF here"}</strong>
                <div>or click to choose a file</div>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                void ingestFile(e.target.files?.[0])
                e.currentTarget.value = ""
              }}
            />
            {busy && <p className="hint" style={{ marginTop: 12 }}>{busy}</p>}
          </section>

          {note && <div className="notice">{note}</div>}
          {error && <div className="notice notice-error">{error}</div>}
          {reviewIssues.length > 0 && (
            <div className="notice notice-warn">
              <strong>Needs review — some PO details could not be read or matched.</strong>
              <ul className="issues">
                {reviewIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {dupes.length > 0 && (
            <div className="notice notice-warn">
              This P.O. already has {dupes.length} invoice{dupes.length === 1 ? "" : "s"}:{" "}
              {dupes.map((d) => d.docNumber || d.invoiceId).join(", ")}
            </div>
          )}

          <section className="panel">
            <header className="step-head">
              <span className="step-num">2</span>
              <div>
                <h2>Customer and terms</h2>
                <p className="hint">
                  Keep ship-to as one complete address. QBO splits it into street / city / state / ZIP /
                  country on create. Bill-to only if there is no ship-to.
                  {matchedTerm ? ` Term → ${matchedTerm.name}.` : ""}
                </p>
              </div>
            </header>
            <div className="grid-2">
              {field("PO number", draft.poNumber, (v) => set({ poNumber: v }), { warn: missing.poNumber })}
              {field("PO / invoice date", draft.poDate, (v) => set({ poDate: v }))}
              {field("Contact name", draft.contactName, (v) => set({ contactName: v }), {
                warn: missing.contactName,
              })}
              {field("Company", draft.companyName, (v) => set({ companyName: v }), {
                warn: missing.companyName,
              })}
              {field("Ship-to email", draft.email, (v) => set({ email: v }), { warn: missing.email })}
              {field("Phone", draft.phone, (v) => set({ phone: v }))}
              {field("Ship-to (complete)", draft.shippingAddress, (v) => set({ shippingAddress: v }), {
                wide: true,
                textarea: true,
                warn: missing.shipAddress,
              })}
              {field("Bill-to (complete)", draft.billingAddress, (v) => set({ billingAddress: v }), {
                wide: true,
                textarea: true,
              })}
              {field("Payment terms on PO", draft.paymentTerms, (v) => set({ paymentTerms: v }), {
                warn: missing.paymentTerms || missing.qboTerm,
              })}
              <div className={`field${missing.qboTerm || missing.paymentTerms ? " has-error" : ""}`}>
                <label>QBO Term</label>
                <select
                  value={matchedTerm?.id || ""}
                  onChange={(e) => {
                    setTermId(e.target.value)
                    const t = terms.find((x) => x.id === e.target.value)
                    if (t) set({ paymentTerms: t.name })
                  }}
                >
                  <option value="">Select…</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              {field("Freight terms", draft.freightTerms, (v) => set({ freightTerms: v }))}
              {field("Comments", draft.comments, (v) => set({ comments: v }), { wide: true, textarea: true })}
            </div>
          </section>

          <section className="panel">
            <header className="step-head">
              <span className="step-num">3</span>
              <div>
                <h2>Line items</h2>
                <p className="hint">
                  Each SKU is matched to live QBO items ({products.length} in catalog).
                  Rows with no QBO item are marked red — create is blocked until they match.
                </p>
              </div>
            </header>
            {unmapped.length > 0 && (
              <div className="notice notice-error">
                {unmapped.length} line{unmapped.length === 1 ? "" : "s"} have no QBO item:{" "}
                {unmapped.map((l) => l.partNumber || "(blank)").join(", ")}
              </div>
            )}
            <table className="cart-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={l.kind === "item" && !l.mapped ? "is-miss" : ""}>
                    <td>
                      <input
                        value={l.partNumber}
                        onChange={(e) => updateLine(l.id, { partNumber: e.target.value })}
                      />
                      <div className={l.mapped ? "badge badge-ok" : "badge badge-miss"}>
                        {l.kind !== "item" ? l.kind : l.mapped ? "QBO item" : "No QBO item"}
                      </div>
                    </td>
                    <td>
                      <input
                        value={l.description}
                        onChange={(e) => updateLine(l.id, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.quantity}
                        onChange={(e) => updateLine(l.id, { quantity: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>{formatMoney(l.quantity * l.unitPrice)}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => setLines((rows) => rows.filter((r) => r.id !== l.id))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="totals">Subtotal {formatMoney(subtotal)}</p>
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy)}
                onClick={() => void createInvoice(false)}
              >
                {busy.startsWith("Creating") ? "Creating…" : "Create QBO Invoice"}
              </button>
              {dupes.length > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => void createInvoice(true)}>
                  Create anyway
                </button>
              )}
              {resultLink && (
                <a className="btn btn-home" href={resultLink} target="_blank" rel="noreferrer">
                  Open in QuickBooks
                </a>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
