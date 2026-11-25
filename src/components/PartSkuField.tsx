import type { Product } from "../types"

export function PartSkuField({
  value,
  onChange,
}: {
  value: string
  onChange: (partNumber: string) => void
}) {
  return (
    <input
      list="qbo-catalog-skus"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      spellCheck={false}
      placeholder="Search QBO SKU"
    />
  )
}

export function CatalogSkuList({ products }: { products: Product[] }) {
  return (
    <datalist id="qbo-catalog-skus">
      {products.map((p) => (
        <option key={p.partNumber} value={p.partNumber}>
          {p.description}
        </option>
      ))}
    </datalist>
  )
}
