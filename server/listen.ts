import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, join, normalize, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { assistPo, assistStatus, readBody } from "./assist.ts"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist")
const HOST = process.env.HOST || "0.0.0.0"
const PORT = Number(process.env.PORT || 5176)

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
}

const server = createServer((req, res) => {
  void handle(req, res)
})

async function handle(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    if (url.pathname === "/api/po/status") {
      return sendJson(res, 200, await assistStatus())
    }
    if (url.pathname === "/api/po/assist") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" })
      const body = JSON.parse((await readBody(req)) || "{}") as { pdfText?: string }
      return sendJson(res, 200, await assistPo(body))
    }
    await sendFile(res, url.pathname)
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

async function sendFile(res: import("http").ServerResponse, pathname: string) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  const filePath = safeJoin(ROOT, requested)
  try {
    const info = await stat(filePath)
    if (info.isFile()) {
      const body = await readFile(filePath)
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" })
      res.end(body)
      return
    }
  } catch {
    /* SPA fallback */
  }
  const index = join(ROOT, "index.html")
  const body = await readFile(index)
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(body)
}

function safeJoin(root: string, requested: string) {
  const resolved = normalize(join(root, requested))
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..") return join(root, "index.html")
  return resolved
}

function sendJson(res: import("http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

try {
  await stat(join(ROOT, "index.html"))
} catch {
  console.error(`No production build at ${ROOT}. Run: npm run build`)
  process.exit(1)
}

server.listen(PORT, HOST, () => {
  console.log(`PO to Invoice listening on http://127.0.0.1:${PORT}/`)
})
