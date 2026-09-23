import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let loaded = false

async function loadOne(path: string) {
  try {
    const text = await readFile(path, "utf8")
    for (const raw of text.split("\n")) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq < 1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    /* missing file is fine */
  }
}

export async function loadEnv() {
  const hasKey = Boolean(
    (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim(),
  )
  if (loaded && hasKey) return
  loaded = true
  await loadOne(join(ROOT, ".env"))
  await loadOne(join(ROOT, "..", "quote-web", "quote-app", ".env"))
  await loadOne(join(ROOT, "..", "label-checker", ".env"))
}
