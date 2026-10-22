import type { FeedIconFeed } from "../components/ui/icon/feed-icon"

/**
 * get feed icon source
 */
export const getFeedIconSource = (
  feed?: FeedIconFeed,
  siteUrl?: string,
  _fallback = false,
): string | undefined => {
  if (feed?.image) return feed.image

  const targetUrl = siteUrl || feed?.siteUrl || feed?.url
  if (targetUrl) {
    try {
      const trimmed = targetUrl.trim()
      const url = trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? new URL(trimmed)
        : new URL(`https://${trimmed}`)
      const host = url.hostname
      if (host && host.includes(".")) {
        return `https://www.google.com/s2/favicons?domain=${host}&sz=128`
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  return undefined
}
