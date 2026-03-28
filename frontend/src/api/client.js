export async function apiGet(path) {
  const resp = await fetch(path)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}
