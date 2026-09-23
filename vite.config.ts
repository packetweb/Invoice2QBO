import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { assistPo, assistStatus, readBody } from "./server/assist.ts"

function json(res: import("http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(body))
}

function poAssistPlugin(): Plugin {
  const attach = (middlewares: {
    use: (
      path: string,
      fn: (req: import("http").IncomingMessage, res: import("http").ServerResponse) => void,
    ) => void
  }) => {
    middlewares.use("/api/po/status", async (_req, res) => {
      try {
        json(res, 200, await assistStatus())
      } catch (err) {
        json(res, 503, { error: err instanceof Error ? err.message : String(err) })
      }
    })
    middlewares.use("/api/po/assist", async (req, res) => {
      try {
        if (req.method !== "POST") {
          json(res, 405, { error: "POST only" })
          return
        }
        const body = JSON.parse((await readBody(req)) || "{}") as { pdfText?: string }
        json(res, 200, await assistPo(body))
      } catch (err) {
        json(res, 503, { error: err instanceof Error ? err.message : String(err) })
      }
    })
  }
  return {
    name: "po-assist",
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [react(), poAssistPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5176,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5176,
  },
})
