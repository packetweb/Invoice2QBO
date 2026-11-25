import { useEffect, useMemo, useRef, useState } from "react"
import "./App.css"
import type { LineItem, PoDraft, Product, QboCustomerMatch, QboTerm } from "./types"
import { askPoAssist, fetchPoAssistStatus, formatClaudeModel } from "./lib/assist"
import {
  createQboInvoice,
  fetchCreatedInvoices,
  fetchEstimatesForCustomer,
  fetchInvoicesByPo,
  fetchQboCatalogItems,
  fetchQboClasses,
  fetchQboTerms,
  searchQboCustomers,
  type CreatedInvoice,
  type EstimateMatch,
  type PoMatch,
} from "./lib/crm"
import { createId, formatMoney } from "./lib/format"
import { isFreightCollect, matchProduct, normalizeSku } from "./lib/match"
import { rankQuotes } from "./lib/quoteMatch"
import { matchQboTerm } from "./lib/terms"
import { extractPdfText } from "./lib/pdfText"
import { CatalogSkuList, PartSkuField } from "./components/PartSkuField"
import { classNameForSku, lineClassName, QBO_CLASS_NAMES } from "./lib/qboClass"

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
  qboCustomerId: "",
  allowOnlinePayment: false,
})

function homeHref() {
  return `${window.location.protocol}//${window.location.hostname}:4000/`
}

function formatEstimateQty(qty: number | null | undefined) {
  const n = Number(qty)
  if (!Number.isFinite(n) || n <= 0) return ""
  return Number.isInteger(n) ? ` × ${n}` : ` × ${n}`
}

const QUOTE_ITEM_DISPLAY = 10

function existingQuoteNotice(
  quotes: EstimateMatch[],
  cart: { sku: string; qty: number }[],
  poTotal = 0,
) {
  if (quotes.length === 0) return null
  const ranked = rankQuotes(quotes, cart, poTotal)
  const cartKeys = new Set(cart.map((line) => normalizeSku(line.sku)).filter(Boolean))
  const hasBest = ranked.some((q) => q.match.best)
  const best = ranked.find((q) => q.match.best)
  return (
    <div className="notice">
      <p className="notice-text">
        {hasBest && best
          ? `Closest QBO estimate for this PO is listed first (${best.match.skuHits} of ${best.match.cartCount} SKUs match). Open to compare before Create — this does not convert the quote.`
          : `QBO already has ${quotes.length === 1 ? "an estimate" : "estimates"} for this customer. Open to compare before Create — this does not convert the quote.`}
      </p>
      <ul className="issues">
        {ranked.map((q) => {
          const items = q.items?.length
            ? q.items
            : (q.skus || []).map((sku) => ({ sku, qty: null }))
          const shown = items.slice(0, QUOTE_ITEM_DISPLAY)
          const extra = Math.max(0, items.length - shown.length) + (q.extra || 0)
          return (
            <li
              key={q.estimateId || q.docNumber}
              className={q.match.best ? "quote-best" : undefined}
            >
              {q.link ? (
                <a href={q.link} target="_blank" rel="noreferrer">
                  Estimate {q.docNumber || q.estimateId}
                  {q.txnDate ? ` · ${q.txnDate}` : ""}
                  {q.total ? ` · ${formatMoney(q.total)}` : ""}
                  {q.converted ? " · already invoiced" : q.status ? ` · ${q.status}` : ""}
                  {" →"}
                </a>
              ) : (
                `Estimate ${q.docNumber || q.estimateId}`
              )}
              {q.match.best ? <span className="quote-best-tag">closest to this PO</span> : null}
              {shown.length > 0 ? (
                <div className="quote-items">
                  {shown.map((item, i) => {
                    const hit = cartKeys.has(normalizeSku(item.sku))
                    return (
                      <span key={`${item.sku}-${i}`} className={hit ? "quote-item-hit" : undefined}>
                        {i > 0 ? ", " : ""}
                        {item.sku}
                        {formatEstimateQty(item.qty)}
                      </span>
                    )
                  })}
                  {extra ? `, +${extra} more` : ""}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function existingInvoiceNotice(dupes: PoMatch[]) {
  if (dupes.length === 0) return null
  return (
    <div className="notice notice-warn">
      <p className="notice-text">
        Already in QBO. Open the existing invoice instead of creating another. Create anyway
        will add a second invoice.
      </p>
      <ul className="issues">
        {dupes.map((d) => (
          <li key={d.invoiceId || d.docNumber || d.poNumber}>
            {d.link ? (
              <a href={d.link} target="_blank" rel="noreferrer">
                Invoice {d.docNumber || d.invoiceId}
                {d.customerName ? ` · ${d.customerName}` : ""} →
              </a>
            ) : (
              `Invoice ${d.docNumber || d.invoiceId}`
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function qboCreatedNotice(note: string, link: string) {
  if (!note && !link) return null
  return (
    <div className="notice">
      {note ? <p className="notice-text">{note}</p> : null}
      {link ? (
        <p className="notice-text">
          <a href={link} target="_blank" rel="noreferrer">
            Open in QuickBooks Online →
          </a>
        </p>
      ) : null}
    </div>
  )
}

function extractBusyHint(busy: string) {
  if (busy.startsWith("Extracting")) return "Claude is reading the PDF. This can take a few seconds."
  if (busy.startsWith("Reading")) return "Pulling text from the PDF…"
  if (busy.startsWith("Loading")) return "Loading the QBO item catalog…"
  return "Please wait…"
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
  const ingestLock = useRef(false)
  const [view, setView] = useState<"builder" | "created">("builder")
  const [fileName, setFileName] = useState("")
  const [over, setOver] = useState(false)
  const [draft, setDraft] = useState<PoDraft>(emptyDraft)
  const [lines, setLines] = useState<LineItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [classNames, setClassNames] = useState<string[]>([...QBO_CLASS_NAMES])
  const [terms, setTerms] = useState<QboTerm[]>([])
  const [termId, setTermId] = useState("")
  const [customers, setCustomers] = useState<QboCustomerMatch[]>([])
  const [customerQuery, setCustomerQuery] = useState("")
  const [claudeReady, setClaudeReady] = useState(false)
  const [claudeModel, setClaudeModel] = useState("")
  const [busy, setBusy] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [dupes, setDupes] = useState<PoMatch[]>([])
  const [quotes, setQuotes] = useState<EstimateMatch[]>([])
  const [created, setCreated] = useState<CreatedInvoice[]>([])
  const [createdErr, setCreatedErr] = useState("")
  const [createdQuery, setCreatedQuery] = useState("")
  const [createdTempOnly, setCreatedTempOnly] = useState(false)
  const [resultLink, setResultLink] = useState("")
  const [extracted, setExtracted] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const companySearchRef = useRef("")

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
    void fetchQboClasses()
      .then((rows) => {
        const names = rows.map((r) => r.name).filter(Boolean)
        if (names.length) setClassNames(names)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!products.length) return
    setLines((rows) =>
      rows.map((row) => {
        if (row.kind === "shipping") {
          const hit = matchProduct(row.partNumber || "S&H", products)
          return hit ? { ...row, partNumber: hit.partNumber, mapped: true } : row
        }
        if (row.kind && row.kind !== "item") return row
        const hit = matchProduct(row.partNumber, products)
        if (!hit) return row.mapped ? { ...row, mapped: false } : row
        if (row.mapped && row.partNumber === hit.partNumber) return row
        return {
          ...row,
          partNumber: hit.partNumber,
          description: row.description.trim() ? row.description : hit.description,
          mapped: true,
        }
      }),
    )
  }, [products])

  const matchedTerm = useMemo(() => {
    if (termId) return terms.find((t) => t.id === termId) || null
    const fromDoc = matchQboTerm(terms, draft.paymentTerms)
    if (fromDoc) return fromDoc
    const picked = customers.find((c) => c.id === draft.qboCustomerId)
    if (picked?.termId) return terms.find((t) => t.id === picked.termId) || matchQboTerm(terms, picked.termName || "")
    if (picked?.termName) return matchQboTerm(terms, picked.termName)
    return null
  }, [termId, terms, draft.paymentTerms, draft.qboCustomerId, customers])

  useEffect(() => {
    const id = draft.qboCustomerId.trim()
    const company = draft.companyName.trim()
    if (!id) {
      setQuotes([])
      return
    }
    let cancelled = false
    void fetchEstimatesForCustomer(id, company)
      .then((rows) => {
        if (!cancelled) setQuotes(rows)
      })
      .catch(() => {
        if (!cancelled) setQuotes([])
      })
    return () => {
      cancelled = true
    }
  }, [draft.qboCustomerId, draft.companyName])

  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
  const unmapped = lines.filter((l) => l.kind === "item" && !l.mapped)
  const isExtracting = /^(Reading|Loading|Extracting)/.test(busy)
  const emptyPrice = lines.filter((l) => l.kind === "item" && !(l.unitPrice > 0))
  const missing = {
    poNumber: extracted && !draft.poNumber.trim(),
    contactName: extracted && !draft.contactName.trim(),
    companyName: extracted && !draft.companyName.trim(),
    email: extracted && !draft.email.trim(),
    shipAddress: extracted && !draft.shippingAddress.trim() && !draft.billingAddress.trim(),
    paymentTerms: extracted && !draft.paymentTerms.trim() && !matchedTerm,
    qboTerm: extracted && Boolean(draft.paymentTerms.trim()) && !matchedTerm,
  }
  const usingTemp = extracted && !draft.qboCustomerId.trim()
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
    if (usingTemp) {
      issues.push(
        "No QBO customer selected. Invoices are not filed under A Temp — search and pick the real customer (rename the quote customer first if needed).",
      )
    }
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
    usingTemp,
    draft.companyName,
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

  const filteredCreated = useMemo(() => {
    const q = createdQuery.trim().toLowerCase()
    return created.filter((row) => {
      if (createdTempOnly && !row.usedTempCustomer) return false
      if (!q) return true
      return [row.companyName, row.customerName, row.poNumber, row.docNumber, row.usedTempCustomer ? "暫放 a temp" : ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    })
  }, [created, createdQuery, createdTempOnly])

  const lookupCustomers = async (company: string, email: string) => {
    const first = company.trim().split(/\s+/)[0] || ""
    const queries = [first, company, email].map((s) => s.trim()).filter((s) => s.length >= 2)
    const found: QboCustomerMatch[] = []
    const seen = new Set<string>()
    for (const q of [...new Set(queries)]) {
      try {
        for (const row of await searchQboCustomers(q)) {
          if (seen.has(row.id)) continue
          if (row.displayName.replace(/\s+/g, " ").trim().toLowerCase() === "a temp") continue
          seen.add(row.id)
          found.push(row)
        }
      } catch {
        /* keep going */
      }
    }
    setCustomers(found)
    const real = found.filter((c) => c.displayName.replace(/\s+/g, " ").trim().toLowerCase() !== "a temp")
    const want = company.replace(/\s+/g, " ").trim().toLowerCase()
    const emailHit = email
      ? real.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase())
      : null
    const cards = real.filter((c) => !c.displayName.includes("/"))
    const exact = real.find((c) => c.displayName.replace(/\s+/g, " ").trim().toLowerCase() === want)
    const cardHit = cards.find((c) => {
      const name = c.displayName.replace(/\s+/g, " ").trim().toLowerCase()
      return name === want || name.startsWith(want) || (want.length >= 3 && want.startsWith(name))
    })
    const picked = exact || cardHit || emailHit || real[0] || null
    return { id: picked?.id || "", termName: picked?.termName || "", termId: picked?.termId || "" }
  }

  const applyCustomerHit = (hit: { id: string; termName: string; termId: string }) => {
    if (!hit.id) return
    setDraft((d) => {
      const fromDoc = matchQboTerm(terms, d.paymentTerms)
      return {
        ...d,
        qboCustomerId: hit.id,
        paymentTerms: hit.termName && !fromDoc ? hit.termName : d.paymentTerms,
      }
    })
    if (hit.termId) setTermId(hit.termId)
  }

  const searchFromCompany = (company: string) => {
    const q = company.trim()
    if (q.length < 2) return
    companySearchRef.current = q
    void lookupCustomers(q, draft.email).then(applyCustomerHit)
  }

  useEffect(() => {
    const q = draft.companyName.trim()
    if (q.length < 2 || q === companySearchRef.current) return
    const handle = window.setTimeout(() => searchFromCompany(q), 400)
    return () => window.clearTimeout(handle)
  }, [draft.companyName, draft.email])

  const applyExtract = async (parsed: Awaited<ReturnType<typeof askPoAssist>>, catalog: Product[]) => {
    companySearchRef.current = parsed.companyName.trim()
    const customerHit = await lookupCustomers(parsed.companyName, parsed.email)
    const qboCustomerId = customerHit.id
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
      paymentTerms: parsed.paymentTerms || customerHit.termName,
      freightTerms: parsed.freightTerms,
      taxExempt: parsed.taxExempt,
      shippingAmount: isFreightCollect(parsed.freightTerms) ? 0 : parsed.shippingAmount,
      qboCustomerId,
      allowOnlinePayment: false,
    }
    setDraft(nextDraft)
    setCustomerQuery(parsed.companyName)
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
        taxable: false,
        className: classNameForSku(hit?.partNumber || it.partNumber),
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
        taxable: false,
        className: classNameForSku(ship?.partNumber || "S&H"),
      })
    }
    setLines(next)
    setTermId("")
    setResultLink("")
    setExtracted(true)
    setWarnings(parsed.warnings || [])
  }

  const ingestFile = async (file: File | undefined) => {
    if (!file || ingestLock.current) return
    if (!/\.pdf$/i.test(file.name)) {
      setError("Drop a PDF purchase order.")
      return
    }
    ingestLock.current = true
    setFileName(file.name)
    setError("")
    setDupes([])
    setQuotes([])
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
      let catalog = products
      if (catalog.length === 0) {
        setBusy("Loading QBO catalog…")
        catalog = await fetchQboCatalogItems()
        setProducts(catalog)
      }
      setBusy("Extracting with Claude…")
      const parsed = await askPoAssist(text)
      await applyExtract(parsed, catalog)
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
      ingestLock.current = false
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
          if (patch.className == null) next.className = classNameForSku(next.partNumber)
        }
        return next
      }),
    )
  }

  const addLine = () => {
    setLines((rows) => [
      ...rows,
      {
        id: createId(),
        partNumber: "",
        description: "",
        quantity: 1,
        unitPrice: 0,
        mapped: false,
        kind: "item",
        taxable: false,
        className: "HSProbe",
      },
    ])
  }

  const createInvoice = async (force = false) => {
    setError("")
    setResultLink("")
    if (!draft.poNumber.trim()) {
      setError("PO number is required.")
      return
    }
    if (!draft.contactName.trim() && !draft.companyName.trim()) {
      setError("Contact name or company is required.")
      return
    }
    if (usingTemp) {
      setError("Pick a real QBO customer. Invoices are not filed under A Temp.")
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
        createCustomer: false,
        customer: {
          qboId: draft.qboCustomerId.trim() || undefined,
          name: draft.contactName.trim() || draft.companyName.trim() || "Customer",
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
          taxable: l.taxable === true,
          className: lineClassName(l.partNumber, l.className),
        })),
        subtotal,
        terms: { paymentTerms },
        allowOnlinePayment: draft.allowOnlinePayment,
      })
      setResultLink(result.link)
      setNote(
        result.usedTempCustomer
          ? `Created QBO invoice ${result.docNumber || result.invoiceId} under A Temp. Real company is in remarks — confirm in QBO later.`
          : `Created QBO invoice ${result.docNumber || result.invoiceId}${result.term ? ` · ${result.term.name}` : ""}.`,
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
              <p className="hint">Invoices created from this tool, newest first. Search Company from remarks, PO, or invoice #.</p>
            </div>
          </header>
          <div className="actions created-search">
            <input
              value={createdQuery}
              onChange={(e) => setCreatedQuery(e.target.value)}
              placeholder="Search Company / PO / invoice #"
            />
            <label>
              <input
                type="checkbox"
                checked={createdTempOnly}
                onChange={(e) => setCreatedTempOnly(e.target.checked)}
              />{" "}
              暫放 only
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => void refreshCreated()}>
              Refresh
            </button>
          </div>
          {createdErr && <div className="notice notice-error">{createdErr}</div>}
          {created.length === 0 && !createdErr && <p className="hint">No invoices created yet.</p>}
          {created.length > 0 && filteredCreated.length === 0 && (
            <p className="hint">No rows match that search.</p>
          )}
          {filteredCreated.length > 0 && (
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
                {filteredCreated.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.poNumber || "—"}</td>
                    <td>
                      {row.customerName || "—"}
                      {row.usedTempCustomer ? <div className="badge badge-temp">暫放 A Temp</div> : null}
                    </td>
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
              className={`drop${over ? " over" : ""}${isExtracting ? " is-busy" : ""}`}
              onClick={() => {
                if (!isExtracting) fileRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (!isExtracting) setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                if (!isExtracting) void ingestFile(e.dataTransfer.files[0])
              }}
            >
              {isExtracting ? (
                <div className="extract-status" role="status" aria-live="polite">
                  <span className="spinner" aria-hidden="true" />
                  <strong>{busy}</strong>
                  <div>{extractBusyHint(busy)}</div>
                </div>
              ) : (
                <div>
                  <strong>{fileName || "Drop a PO PDF here"}</strong>
                  <div>or click to choose a file</div>
                </div>
              )}
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
            {isExtracting ? null : busy ? <p className="hint" style={{ marginTop: 12 }}>{busy}</p> : null}
          </section>

          {qboCreatedNotice(note, resultLink)}
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
          {existingInvoiceNotice(dupes)}
          {existingQuoteNotice(
            quotes,
            lines
              .filter((l) => l.kind === "item" && l.partNumber.trim())
              .map((l) => ({ sku: l.partNumber, qty: l.quantity })),
            subtotal,
          )}

          <section className="panel">
            <header className="step-head">
              <span className="step-num">2</span>
              <div>
                <h2>Customer and terms</h2>
                <p className="hint">
                  Type the company name — QBO matches fill in below (DVT Solutions, not the
                  contact job). Invoices must use a real QBO customer (not A Temp). Payment
                  terms on the PO map to QBO Terms (NET 45 → Net 45); if the PO has none, the
                  customer’s QBO default is used.
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
              <div className={`field${missing.companyName ? " has-error" : ""}`}>
                <label>Company</label>
                <input
                  value={draft.companyName}
                  onChange={(e) => set({ companyName: e.target.value })}
                  onBlur={() => searchFromCompany(draft.companyName)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    e.preventDefault()
                    searchFromCompany(draft.companyName)
                  }}
                />
              </div>
              <div className={`field${usingTemp ? " has-error" : ""}`}>
                <label>QBO customer</label>
                <select
                  value={draft.qboCustomerId}
                  onChange={(e) => {
                    const id = e.target.value
                    const c = customers.find((x) => x.id === id)
                    const fromDoc = matchQboTerm(terms, draft.paymentTerms)
                    if (c?.termName && !fromDoc) {
                      set({ qboCustomerId: id, paymentTerms: c.termName })
                      if (c.termId) setTermId(c.termId)
                    } else {
                      set({ qboCustomerId: id })
                    }
                  }}
                >
                  <option value="">Select QBO customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                      {c.email ? ` · ${c.email}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Search QBO customers</label>
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    e.preventDefault()
                    const q = customerQuery.trim()
                    if (q.length >= 2) {
                      void searchQboCustomers(q)
                        .then((rows) =>
                          setCustomers(
                            rows.filter(
                              (c) => c.displayName.replace(/\s+/g, " ").trim().toLowerCase() !== "a temp",
                            ),
                          ),
                        )
                        .catch(() => setCustomers([]))
                    }
                  }}
                  onBlur={() => {
                    const q = customerQuery.trim()
                    if (q.length >= 2) {
                      void searchQboCustomers(q)
                        .then((rows) =>
                          setCustomers(
                            rows.filter(
                              (c) => c.displayName.replace(/\s+/g, " ").trim().toLowerCase() !== "a temp",
                            ),
                          ),
                        )
                        .catch(() => setCustomers([]))
                    }
                  }}
                  placeholder="Optional — Company above already searches QBO"
                />
              </div>
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
              <label className="field check">
                <input
                  type="checkbox"
                  checked={draft.allowOnlinePayment}
                  onChange={(e) => set({ allowOnlinePayment: e.target.checked })}
                />
                <span>Online payments — Cards, bank, PayPal, Affirm. Default off.</span>
              </label>
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
                  Edit SKU, qty, or price on any row. Add line to insert another QBO item.
                  Type in Part to search the catalog ({products.length} items). Rows with no QBO item stay
                  red — create is blocked until they match. Tax is off unless you check a line (or Tax in
                  the header for all). QBO gets TAX or NON from that box.
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
                  <th>Class</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                  <th className="tax">
                    <label>
                      <input
                        type="checkbox"
                        checked={lines.filter((row) => row.kind === "item").length > 0 && lines.filter((row) => row.kind === "item").every((row) => row.taxable)}
                        ref={(el) => {
                          if (!el) return
                          const items = lines.filter((row) => row.kind === "item")
                          el.indeterminate = items.some((row) => row.taxable) && items.some((row) => !row.taxable)
                        }}
                        onChange={(e) => {
                          const taxable = e.target.checked
                          setLines((rows) => rows.map((row) => ({ ...row, taxable: row.kind === "item" ? taxable : false })))
                        }}
                        aria-label="Tax all lines"
                      />
                      Tax
                    </label>
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={l.kind === "item" && !l.mapped ? "is-miss" : ""}>
                    <td>
                      <PartSkuField
                        value={l.partNumber}
                        onChange={(partNumber) => updateLine(l.id, { partNumber })}
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
                      <select
                        value={lineClassName(l.partNumber, l.className)}
                        onChange={(e) => updateLine(l.id, { className: e.target.value })}
                        aria-label={`Class for ${l.partNumber || "line"}`}
                      >
                        {(classNames.includes(lineClassName(l.partNumber, l.className))
                          ? classNames
                          : [lineClassName(l.partNumber, l.className), ...classNames]
                        ).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
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
                    <td className="tax">
                      <input
                        type="checkbox"
                        checked={l.taxable}
                        disabled={l.kind !== "item"}
                        onChange={(e) => updateLine(l.id, { taxable: e.target.checked })}
                        aria-label={`Tax ${l.partNumber || "line"}`}
                      />
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => setLines((rows) => rows.filter((r) => r.id !== l.id))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions">
              <button type="button" className="btn btn-ghost" onClick={addLine}>
                Add line
              </button>
            </div>
            <CatalogSkuList products={products} />
            <p className="totals">Subtotal {formatMoney(subtotal)}</p>
            {error && <div className="notice notice-error">{error}</div>}
            {qboCreatedNotice(note, resultLink)}
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={Boolean(busy) || unmapped.length > 0}
                onClick={() => void createInvoice(false)}
              >
                {busy.startsWith("Creating") ? (
                  <>
                    <span className="spinner spinner-sm" aria-hidden="true" />
                    Creating…
                  </>
                ) : (
                  "Create QBO Invoice"
                )}
              </button>
              {dupes.filter((d) => d.link).map((d) => (
                <a
                  key={d.invoiceId || d.docNumber}
                  className="btn btn-home"
                  href={d.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open {d.docNumber || "existing"} in QBO →
                </a>
              ))}
              {dupes.length > 0 && (
                <button type="button" className="btn btn-ghost" disabled={unmapped.length > 0} onClick={() => void createInvoice(true)}>
                  Create anyway (duplicate)
                </button>
              )}
              {resultLink && (
                <a className="btn btn-home" href={resultLink} target="_blank" rel="noreferrer">
                  Open in QuickBooks Online →
                </a>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
