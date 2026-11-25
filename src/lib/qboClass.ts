export const QBO_CLASS_NAMES = [
  "AITT",
  "Corp.",
  "HSProbe",
  "Junkosha",
  "Lab Service",
  "USB",
] as const

function skuKey(sku: string) {
  return String(sku || "")
    .toUpperCase()
    .replace(/\s+/g, "")
}

function starts(s: string, prefixes: string[]) {
  return prefixes.some((p) => s.startsWith(p))
}

export function classNameForSku(sku: string): string {
  const s = skuKey(sku)
  if (!s) return "HSProbe"
  if (s.startsWith("AITT")) return "AITT"
  if (s.startsWith("MWX") || s.includes("JUNKOSHA")) return "Junkosha"
  if (starts(s, ["TFU", "TF0", "TF1", "TF2", "TFD", "TFH", "TFHD", "TFUB", "LL-USBC", "MEU-", "MET-", "MEW-"])) {
    return "USB"
  }
  if (s.startsWith("REPAIR") || s.startsWith("NRE") || s.startsWith("LAB") || s.includes("SERVICE")) {
    return "Lab Service"
  }
  if (
    s === "S&H" ||
    s.startsWith("SHIP") ||
    s.includes("FREIGHT") ||
    s.startsWith("DISCOUNT") ||
    s.startsWith("BALANCE") ||
    s.includes("CREDITCARD")
  ) {
    return "Corp."
  }
  return "HSProbe"
}

export function lineClassName(sku: string, className?: string): string {
  return String(className || "").trim() || classNameForSku(sku)
}
