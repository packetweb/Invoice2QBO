import * as pdfjs from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type PdfItem = { str: string; x: number; y: number }

function itemsToLines(items: PdfItem[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: { y: number; parts: PdfItem[] }[] = []
  for (const it of sorted) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last.y - it.y) <= 5) last.parts.push(it)
    else rows.push({ y: it.y, parts: [it] })
  }
  return rows.map((row) =>
    row.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  ).filter(Boolean)
}

export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []
  const max = Math.min(doc.numPages, 8)
  for (let i = 1; i <= max; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const items: PdfItem[] = []
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue
      const transform = "transform" in item ? (item.transform as number[]) : [0, 0, 0, 0, 0, 0]
      items.push({ str: item.str, x: transform[4], y: transform[5] })
    }
    pages.push(itemsToLines(items).join("\n"))
  }
  return pages.join("\n\n").trim()
}
