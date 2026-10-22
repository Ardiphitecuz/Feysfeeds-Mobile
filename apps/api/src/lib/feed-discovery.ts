import { isPublicHttpUrl } from "./url-security"

const MAX_DISCOVERY_BYTES = 512_000
const MAX_REDIRECTS = 3

export type DiscoveredFeed = { url: string; title: string | null; type: "rss" | "atom" | "json" }

const attributes = (tag: string): Record<string, string> => {
  const result: Record<string, string> = {}
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase()
    const value = match[2] ?? match[3] ?? match[4]
    if (name && value !== undefined) result[name] = value
  }
  return result
}

const boundedText = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Discovery response was empty")
  let total = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DISCOVERY_BYTES) {
        await reader.cancel()
        throw new Error("Discovery response too large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
}

export const discoverWebsiteFeeds = async (
  websiteUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscoveredFeed[]> => {
  if (!isPublicHttpUrl(websiteUrl))
    throw new Error("A public HTTP or HTTPS website URL is required")
  let currentUrl = websiteUrl
  let response: Response | undefined
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    try {
      response = await fetcher(currentUrl, {
        headers: { accept: "text/html", "user-agent": "FeyFeeds/1.0 (+https://feyfeeds.app)" },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      throw new Error("Could not inspect this website")
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location")
      if (!location || redirectCount === MAX_REDIRECTS)
        throw new Error("The website redirected too many times")
      try {
        currentUrl = new URL(location, currentUrl).href
      } catch {
        throw new Error("The website redirected to a disallowed URL")
      }
      if (!isPublicHttpUrl(currentUrl))
        throw new Error("The website redirected to a disallowed URL")
      continue
    }
    break
  }
  if (!response?.ok) throw new Error("Could not inspect this website")
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType && !contentType.includes("html") && !contentType.startsWith("text/plain")) {
    throw new Error("The URL did not return a website document")
  }
  const html = await boundedText(response)
  const feeds = new Map<string, DiscoveredFeed>()
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0])
    if (!attrs.rel?.toLowerCase().split(/\s+/).includes("alternate") || !attrs.href) continue
    const type = attrs.type?.toLowerCase().split(";", 1)[0]?.trim()
    const format =
      type === "application/atom+xml"
        ? "atom"
        : type === "application/feed+json" || type === "application/json"
          ? "json"
          : type === "application/rss+xml" || type === "application/xml" || type === "text/xml"
            ? "rss"
            : null
    if (!format) continue
    try {
      const url = new URL(attrs.href, currentUrl).href
      if (isPublicHttpUrl(url))
        feeds.set(url, { url, title: attrs.title?.slice(0, 256) || null, type: format })
    } catch {
      // Ignore malformed discovery links and continue scanning.
    }
  }
  return [...feeds.values()].slice(0, 10)
}

export const resolveRssHubUrl = (input: string, baseUrl: string | undefined): string | null => {
  if (!input.toLowerCase().startsWith("rsshub://")) return null
  if (!baseUrl || !isPublicHttpUrl(baseUrl) || new URL(baseUrl).protocol !== "https:")
    throw new Error("RSSHub is not configured for this service")
  const route = input.slice("rsshub://".length)
  const decodedRoute = (() => {
    try {
      return decodeURIComponent(route)
    } catch {
      return ""
    }
  })()
  const hasTraversal = decodedRoute
    .split("/")
    .some((segment) => segment === "." || segment === "..")
  const hasControl = (value: string) =>
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  if (
    !route ||
    !decodedRoute ||
    route.length > 1024 ||
    hasControl(route) ||
    hasControl(decodedRoute) ||
    /[\\\s?#]/.test(route) ||
    /[\\?#]/.test(decodedRoute) ||
    route.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(route) ||
    route.includes("//") ||
    decodedRoute.includes("//") ||
    hasTraversal ||
    decodedRoute.includes("\\")
  ) {
    throw new Error("Invalid RSSHub route")
  }
  let resolved: URL
  try {
    const base = new URL(baseUrl)
    resolved = new URL(route, `${base.origin}${base.pathname.replace(/\/?$/, "/")}`)
    if (
      resolved.origin !== base.origin ||
      !resolved.pathname.startsWith(base.pathname.replace(/\/?$/, "/"))
    ) {
      throw new Error("Invalid route")
    }
  } catch {
    throw new Error("Invalid RSSHub route")
  }
  if (!isPublicHttpUrl(resolved.href)) throw new Error("Invalid RSSHub route")
  return resolved.href
}
