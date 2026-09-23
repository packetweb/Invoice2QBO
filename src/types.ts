export type Product = {
  partNumber: string
  description: string
  status: string
  type: string
  taxable: boolean
  listPrice: number
}

export type LineItem = {
  id: string
  partNumber: string
  description: string
  quantity: number
  unitPrice: number
  mapped: boolean
  kind: "item" | "shipping" | "tax"
}

export type PoDraft = {
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
}

export type QboTerm = {
  id: string
  name: string
  type: string
  dueDays: number | null
  active: boolean
}
