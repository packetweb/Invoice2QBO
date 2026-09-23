export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET"
  try {
    return await fetch(url, init)
  } catch (e) {
    console.error(`[apiFetch] ${method} ${url} — network request failed`, e)
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Could not reach ${url} (${reason}). Check that the server is running, reachable, and the URL is correct.`,
    )
  }
}
