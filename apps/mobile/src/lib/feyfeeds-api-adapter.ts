import { FeedViewType } from "@follow/constants"
import type { MediaModel } from "@follow/database/schemas/types"
import { collectionActions } from "@follow/store/collection/store"
import { entryActions, useEntryStore } from "@follow/store/entry/store"
import { feedActions, useFeedStore } from "@follow/store/feed/store"
import { subscriptionActions, useSubscriptionStore } from "@follow/store/subscription/store"
import type { SyncAPI, SyncDeltaResponse } from "@follow/store/sync/types"
import type { ModuleAPIs as FollowAPI } from "@follow-app/client-sdk"
import { userActions } from "@follow/store/user/store"

import { rawFollowApi, setGlobalFollowApi } from "./api-client"
import { feyFeedsApi } from "./feyfeeds-api"
import { FeyFeedsApiError, type FeyFeedsFeed } from "./feyfeeds-api-client"
import { replayFeyFeedsMutations } from "./feyfeeds-feed-sync"
import { getRssHubCategoryRoutes, searchRssHubRoutes } from "./rsshub-routes"

const normalizeRssUrl = (urlOrRoute: string): string => {
  const trimmed = urlOrRoute.trim()
  if (trimmed.startsWith("rsshub://")) {
    const route = trimmed.replace(/^rsshub:\/\//, "").replace(/^\/+/, "")
    return `https://rsshub.app/${route}`
  }
  return trimmed
}

function getFallbackFavicon(urlOrSite: string | null | undefined): string | null {
  if (!urlOrSite) return null
  try {
    const trimmed = urlOrSite.trim()
    const parsed = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`)
    const host = parsed.hostname
    if (host && host.includes(".")) {
      return `https://www.google.com/s2/favicons?domain=${host}&sz=128`
    }
  } catch {
    // Ignore error
  }
  return null
}

function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return ""
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim()
}

function extractMediaFromEntry(
  content: string | null | undefined,
  attachments: any[] | null | undefined,
): MediaModel[] | null {
  const mediaList: MediaModel[] = []
  const seenUrls = new Set<string>()

  const addMedia = (item: MediaModel) => {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url)
      mediaList.push(item)
    }
  }

  // 1. Check attachments
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      if (!a?.url) continue
      const url = String(a.url)
      const mime = (a.mimeType || a.mime_type || "").toLowerCase()
      if (
        mime.startsWith("image/") ||
        /\.(jpe?g|png|gif|webp|svg|avif)(\?.*)?$/i.test(url)
      ) {
        addMedia({ url, type: "photo" })
      } else if (
        mime.startsWith("video/") ||
        /\.(mp4|webm|mov|mkv)(\?.*)?$/i.test(url)
      ) {
        addMedia({ url, type: "video" })
      }
    }
  }

  // 2. Parse <img> tags from content
  if (content && typeof content === "string") {
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let match: RegExpExecArray | null
    while ((match = imgRegex.exec(content)) !== null) {
      const src = match[1]?.trim()
      if (
        src &&
        !src.startsWith("data:image/svg") &&
        !src.includes("1x1") &&
        !src.includes("spacer") &&
        !src.includes("blank.gif") &&
        !src.includes("feedburner.com") &&
        !src.includes("statcounter.com") &&
        (src.startsWith("http://") || src.startsWith("https://"))
      ) {
        addMedia({ url: src, type: "photo" })
      }
    }

    const dataSrcRegex = /<img[^>]+(?:data-src|data-original)=["']([^"']+)["'][^>]*>/gi
    while ((match = dataSrcRegex.exec(content)) !== null) {
      const src = match[1]?.trim()
      if (src && (src.startsWith("http://") || src.startsWith("https://"))) {
        addMedia({ url: src, type: "photo" })
      }
    }

    // 3. Parse <video> tags from content
    const videoRegex = /<video[^>]*?(?:src=["']([^"']+)["']|poster=["']([^"']+)["'])?[^>]*>/gi
    while ((match = videoRegex.exec(content)) !== null) {
      const src = match[1]?.trim()
      const poster = match[2]?.trim()
      if (src && (src.startsWith("http://") || src.startsWith("https://"))) {
        addMedia({ url: src, type: "video", preview_image_url: poster })
      }
    }
  }

  return mediaList.length > 0 ? mediaList : null
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function safeBtoa(input: string): string {
  try {
    if (typeof btoa === "function") return btoa(input)
  } catch {
    // fallback to manual encoding
  }
  let str = input
  let output = ""
  for (
    let block = 0, charCode: number, i = 0, map = B64_CHARS;
    str.charAt(i | 0) || ((map = "="), i % 1);
    output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))
  ) {
    charCode = str.charCodeAt((i += 3 / 4))
    if (charCode > 0xff) {
      throw new Error("String contains characters outside of the Latin1 range.")
    }
    block = (block << 8) | charCode
  }
  return output
}

type FeedlyFeedResult = {
  feedId?: string
  id?: string
  title?: string
  website?: string
  description?: string
  iconUrl?: string
  visualUrl?: string
  subscribers?: number
  velocity?: number
  lastUpdated?: number
}

async function lookupFeedlyFeed(feedUrl: string): Promise<{
  title: string | null
  website: string | null
  description: string | null
  image: string | null
  subscribers: number
  velocity: number | null
} | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const targetUrl = feedUrl.startsWith("feed/") ? feedUrl : `feed/${feedUrl}`
    const res = await fetch(`https://cloud.feedly.com/v3/feeds/${encodeURIComponent(targetUrl)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const json = (await res.json()) as FeedlyFeedResult
    return {
      title: json.title || null,
      website: json.website || null,
      description: json.description || null,
      image: json.iconUrl || json.visualUrl || null,
      subscribers: typeof json.subscribers === "number" ? json.subscribers : 0,
      velocity: typeof json.velocity === "number" ? Math.round(json.velocity) : null,
    }
  } catch {
    return null
  }
}

async function searchPublicFeeds(keyword: string): Promise<any[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const encoded = encodeURIComponent(keyword.trim())
    const res = await fetch(`https://cloud.feedly.com/v3/search/feeds?q=${encoded}&n=20`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
    clearTimeout(timer)
    if (!res.ok) return []
    const json = (await res.json()) as { results?: FeedlyFeedResult[] }
    const results = json.results || []

    return results
      .map((item) => {
        const rawFeedUrl = item.feedId || item.id || ""
        const cleanUrl = rawFeedUrl.startsWith("feed/") ? rawFeedUrl.slice(5) : rawFeedUrl
        if (!cleanUrl || !cleanUrl.includes("://")) return null

        return {
          feed: {
            id: cleanUrl,
            title: item.title || cleanUrl,
            url: cleanUrl,
            siteUrl: item.website || cleanUrl,
            description: item.description || null,
            image: item.iconUrl || item.visualUrl || null,
            ownerUserId: null,
            type: "feed" as const,
          },
          analytics: {
            subscriptionCount: typeof item.subscribers === "number" ? item.subscribers : 0,
            updatesPerWeek: typeof item.velocity === "number" ? Math.round(item.velocity) : null,
            latestEntryPublishedAt: item.lastUpdated ? new Date(item.lastUpdated).toISOString() : null,
          },
        }
      })
      .filter(Boolean)
  } catch (err) {
    console.warn("[searchPublicFeeds] failed:", err)
    return []
  }
}

function convertMarkdownToHtml(markdown: string, baseUrl?: string): string {
  if (!markdown) return ""

  let text = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  // Code blocks
  const codeBlocks: string[] = []
  text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
    codeBlocks.push(`<pre><code class="${lang ? `language-${lang}` : ""}">${escaped}</code></pre>`)
    return placeholder
  })

  // Inline code
  const inlineCodes: string[] = []
  text = text.replace(/`([^`]+)`/g, (_match, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
    inlineCodes.push(`<code>${escaped}</code>`)
    return placeholder
  })

  // Headers # to ######
  text = text.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
  text = text.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
  text = text.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
  text = text.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
  text = text.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
  text = text.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")

  // Blockquotes
  text = text.replace(/^>\s+(.+)$/gm, "<blockquote><p>$1</p></blockquote>")

  // Horizontal rules
  text = text.replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr />")

  // Images ![alt](url)
  text = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img alt="$1" src="$2" style="max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0;" />',
  )

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Bold & Italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  text = text.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>")
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>")
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>")

  // Unordered list items
  text = text.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>")

  // Paragraphs
  const blocks = text.split(/\n\s*\n/)
  const formattedBlocks = blocks.map((block) => {
    const trimmed = block.trim()
    if (!trimmed) return ""
    if (
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<pre") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<hr") ||
      trimmed.startsWith("<li") ||
      trimmed.startsWith("<img") ||
      trimmed.startsWith("__CODE_BLOCK_")
    ) {
      if (trimmed.startsWith("<li>")) {
        return `<ul>${trimmed}</ul>`
      }
      return trimmed
    }
    return `<p>${trimmed.replace(/\n/g, "<br />")}</p>`
  })

  let html = formattedBlocks.filter(Boolean).join("\n")

  // Restore code blocks and inline code
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]!)
  }
  for (let i = 0; i < inlineCodes.length; i++) {
    html = html.replace(`__INLINE_CODE_${i}__`, inlineCodes[i]!)
  }

  return `<article class="readability-container">${html}</article>`
}

async function fetchFeedPreviewEntries(
  feedUrl: string,
  count = 30,
): Promise<{
  title: string
  siteUrl: string | null
  description: string | null
  image: string | null
  entries: Array<{
    id: string
    title: string
    url: string
    content: string
    summary: string
    author: string | null
    publishedAt: string
    isRead: boolean
    isBookmarked: boolean
    feedId: string
    feedUrl: string
    feedTitle: string
    attachments: any[] | null
  }>
} | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 7000)
    const targetUrl = feedUrl.startsWith("feed/") ? feedUrl : `feed/${feedUrl}`
    const res = await fetch(
      `https://cloud.feedly.com/v3/streams/contents?streamId=${encodeURIComponent(targetUrl)}&count=${count}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    )
    clearTimeout(timer)
    if (!res.ok) return null
    const json = (await res.json()) as any
    const streamTitle = json.title || feedUrl
    const streamSiteUrl = json.alternate?.[0]?.href || feedUrl
    const streamItems = json.items || []

    const entries = streamItems.map((item: any, idx: number) => {
      const entryUrl = item.alternate?.[0]?.href || item.originId || feedUrl
      const entryId = item.id || `preview_${encodeURIComponent(entryUrl)}_${idx}`
      const content = item.content?.content || item.summary?.content || ""
      const summary = item.summary?.content || item.content?.content || ""
      const published = item.published
        ? new Date(item.published).toISOString()
        : new Date().toISOString()
      const author = item.author || null

      let attachments: any[] | null = null
      if (item.visual?.url) {
        attachments = [{ url: item.visual.url, mimeType: item.visual.contentType || "image/jpeg" }]
      } else if (item.enclosure && item.enclosure.length > 0) {
        attachments = item.enclosure.map((e: any) => ({
          url: e.href,
          mimeType: e.type,
          sizeInBytes: e.length,
        }))
      }

      return {
        id: entryId,
        title: item.title || "Untitled",
        url: entryUrl,
        content,
        summary,
        author,
        publishedAt: published,
        isRead: false,
        isBookmarked: false,
        feedId: feedUrl,
        feedUrl,
        feedTitle: streamTitle,
        attachments,
      }
    })

    return {
      title: streamTitle,
      siteUrl: streamSiteUrl,
      description: json.description || null,
      image: null,
      entries,
    }
  } catch (err) {
    console.warn("[fetchFeedPreviewEntries] error:", err)
    return null
  }
}

export const feyFeedsSyncApi: SyncAPI = {
  state: async () => ({
    code: 0,
    data: { lastSyncId: 0 },
  }),
  delta: async (): Promise<SyncDeltaResponse> => ({
    code: 0,
    data: { actions: [], reset: false, lastSyncId: 0, hasMore: false },
  }),
}

export const syncFeyFeedsToStore = async (explicitUserId?: string) => {
  try {
    const user = await feyFeedsApi.getSession().catch(() => null)
    if (!user) return

    const userId = explicitUserId || user.id

    // 1. Sync user into store & SQLite
    await userActions.upsertMany([
      {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split("@")[0],
        handle: user.email.split("@")[0],
        image: null,
        isMe: true,
        emailVerified: true,
        bio: null,
        website: null,
        socialLinks: null,
      } as any,
    ])

    // 2. Fetch Feeds from FeyFeeds Cloud
    const feeds = await feyFeedsApi.listFeeds().catch(() => [])
    if (feeds && feeds.length > 0) {
      // Auto-refresh any feeds that haven't been fetched yet
      const unfetched = feeds.filter((f) => !f.lastFetchedAt)
      if (unfetched.length > 0) {
        await Promise.allSettled(
          unfetched.slice(0, 5).map((f) => feyFeedsApi.refreshFeed(f.id)),
        )
      }

      const existingFeeds = useFeedStore.getState().feeds
      const feedModels = feeds.map((f) => {
        const existing =
          (existingFeeds[f.id] as any) || (f.url ? (existingFeeds[f.url] as any) : null)
        const image = existing?.image || getFallbackFavicon(f.url)
        return {
          id: f.id,
          title: f.title || f.url,
          url: f.url,
          siteUrl: f.url,
          description: null,
          image,
          errorAt: f.lastError ? new Date().toISOString() : null,
          errorMessage: f.lastError,
          ownerUserId: userId,
          subscriptionCount: 1,
          updatesPerWeek: null,
          latestEntryPublishedAt: null,
          tipUserIds: null,
          updatedAt: null,
        }
      })
      await feedActions.upsertMany(feedModels as any)

      const existingSubs = useSubscriptionStore.getState().data
      const subModels = feeds.map((f) => {
        const existingSub = existingSubs[f.id] || (f.url ? existingSubs[f.url] : null)
        const view =
          typeof existingSub?.view === "number" ? existingSub.view : FeedViewType.Articles
        const isPrivate = existingSub?.isPrivate ?? false
        const hideFromTimeline = existingSub?.hideFromTimeline ?? false
        const category = existingSub?.category ?? null

        return {
          id: f.id,
          feedId: f.id,
          listId: null,
          inboxId: null,
          userId,
          view,
          isPrivate,
          hideFromTimeline,
          title: f.title || f.url,
          category,
          createdAt: new Date(f.createdAt).toISOString(),
          type: "feed" as const,
        }
      })
      await subscriptionActions.upsertMany(subModels as any)
    }

    // 3. Fetch Timeline entries from FeyFeeds Cloud
    const timeline = await feyFeedsApi.getTimeline({ limit: 100 }).catch(() => null)
    if (timeline && timeline.data && timeline.data.length > 0) {
      const entryModels = timeline.data.flatMap((entry) => {
        const base = {
          id: entry.id,
          title: entry.title,
          url: entry.url,
          content: entry.content,
          readabilityContent: null,
          readabilityUpdatedAt: null,
          description: stripHtmlToText(entry.summary) || stripHtmlToText(entry.content),
          guid: entry.id,
          author: entry.author,
          authorUrl: null,
          authorAvatar: null,
          insertedAt: new Date(entry.publishedAt),
          publishedAt: new Date(entry.publishedAt),
          media: extractMediaFromEntry(entry.content, entry.attachments),
          categories: entry.categories || null,
          attachments: entry.attachments ? (entry.attachments as any) : null,
          extra: null,
          language: "en",
          feedId: entry.feedId,
          inboxHandle: null,
          read: entry.isRead,
          sources: null,
          settings: null,
        }
        return [
          base,
          ...(entry.feedUrl && entry.feedUrl !== entry.feedId
            ? [{ ...base, feedId: entry.feedUrl }]
            : []),
        ]
      })
      await entryActions.upsertMany(entryModels as any)

      // Bookmarked entries
      const bookmarked = timeline.data.filter((e) => e.isBookmarked)
      if (bookmarked.length > 0) {
        await collectionActions.upsertMany(
          bookmarked.map((e) => ({
            entryId: e.id,
            feedId: e.feedId,
            createdAt: new Date(e.publishedAt).toISOString(),
            view: FeedViewType.Articles,
          })) as any,
        )
      }
    }

    // 4. Replay pending offline mutations if any
    await replayFeyFeedsMutations(userId).catch(() => null)
  } catch (err) {
    console.warn("[syncFeyFeedsToStore] error:", err)
  }
}

export const feyFeedsApiAdapter: FollowAPI = new Proxy(rawFollowApi, {
  get(target, prop, receiver) {
    if (prop === "auth") {
      return {
        ...target.auth,
        getSession: async () => {
          try {
            const user = await feyFeedsApi.getSession()
            if (!user) return null
            return {
              code: 0,
              user: {
                id: user.id,
                email: user.email,
                name: user.name || user.email.split("@")[0],
                handle: user.email.split("@")[0],
                image: null,
                emailVerified: true,
                createdAt: new Date().toISOString(),
                role: null,
                roleEndAt: null,
              },
            }
          } catch (err) {
            if (err instanceof FeyFeedsApiError && err.status === 401) {
              return null
            }
            return null
          }
        },
      }
    }

    if (prop === "subscriptions") {
      return {
        ...target.subscriptions,
        get: async () => {
          try {
            const feeds = await feyFeedsApi.listFeeds()
            const user = await feyFeedsApi.getSession().catch(() => null)
            const userId = user?.id || ""

            const existingSubs = useSubscriptionStore.getState().data
            const existingFeeds = useFeedStore.getState().feeds
            const data = (feeds || []).map((feed) => {
              const existingSub =
                existingSubs[feed.id] || (feed.url ? existingSubs[feed.url] : null)
              const existingFeed =
                (existingFeeds[feed.id] as any) ||
                (feed.url ? (existingFeeds[feed.url] as any) : null)
              const view =
                typeof existingSub?.view === "number" ? existingSub.view : FeedViewType.Articles
              const category = existingSub?.category ?? null
              const isPrivate = existingSub?.isPrivate ?? false
              const hideFromTimeline = existingSub?.hideFromTimeline ?? false
              const image = existingFeed?.image || getFallbackFavicon(feed.url)

              return {
                id: feed.id,
                feedId: feed.id,
                listId: null,
                inboxId: null,
                userId,
                view,
                isPrivate,
                hideFromTimeline,
                title: feed.title || feed.url,
                category,
                createdAt: new Date(feed.createdAt).toISOString(),
                type: "feed" as const,
                feeds: {
                  id: feed.id,
                  title: feed.title || feed.url,
                  url: feed.url,
                  siteUrl: feed.url,
                  description: null,
                  image,
                  errorAt: feed.lastError ? new Date().toISOString() : null,
                  errorMessage: feed.lastError,
                  ownerUserId: userId,
                  type: "feed" as const,
                  subscriptionCount: 1,
                  updatesPerWeek: null,
                },
              }
            })
            return { code: 0, data }
          } catch {
            return { code: 0, data: [] }
          }
        },
        create: async (body: {
          url?: string
          feedId?: string
          view?: FeedViewType
          title?: string
          category?: string | null
        }) => {
          const rawUrl =
            body.url || (body.feedId && body.feedId.includes("://") ? body.feedId : "") || ""
          const trimmedRaw = rawUrl.trim()
          const url = normalizeRssUrl(trimmedRaw)

          const existingFeed =
            (url ? (useFeedStore.getState().feeds[url] as any) : null) ||
            (body.feedId ? (useFeedStore.getState().feeds[body.feedId] as any) : null)
          const existingTitle =
            existingFeed?.title && !existingFeed.title.startsWith("http")
              ? existingFeed.title
              : undefined
          const chosenTitle =
            (body.title && !body.title.startsWith("http") ? body.title : undefined) ||
            existingTitle ||
            undefined

          let feed: FeyFeedsFeed | null = null

          if (url) {
            try {
              feed = await feyFeedsApi.addFeed(url, chosenTitle)
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              if (
                msg.toLowerCase().includes("already followed") ||
                (err instanceof FeyFeedsApiError && err.status === 409)
              ) {
                const feeds = await feyFeedsApi.listFeeds().catch(() => [])
                feed = feeds.find((f) => f.url === url || f.url === trimmedRaw) || null
              } else {
                throw err
              }
            }
          }

          if (!feed && body.feedId) {
            const feeds = await feyFeedsApi.listFeeds().catch(() => [])
            feed = feeds.find((f) => f.id === body.feedId || f.url === body.feedId) || null
          }

          const user = await feyFeedsApi.getSession().catch(() => null)
          const userId = user?.id || ""

          const feedId = feed?.id || body.feedId || url
          const chosenView = typeof body.view === "number" ? body.view : FeedViewType.Articles
          const resolvedTitle =
            (feed?.title && !feed.title.startsWith("http") ? feed.title : null) ||
            chosenTitle ||
            body.title ||
            url
          const image = existingFeed?.image || getFallbackFavicon(feed?.url || url)
          const feedModel = {
            id: feedId,
            title: resolvedTitle,
            url: feed?.url || url,
            siteUrl: feed?.url || url,
            description: null,
            image,
            errorAt: null,
            errorMessage: null,
            ownerUserId: userId,
            type: "feed" as const,
            subscriptionCount: 1,
            updatesPerWeek: null,
            latestEntryPublishedAt: null,
          }

          // Also upsert by URL alias if different so searches and screens find it by URL or ID
          const modelsToUpsert = [feedModel]
          if (feed?.url && feed.url !== feedId) {
            modelsToUpsert.push({ ...feedModel, id: feed.url })
          }
          feedActions.upsertMany(modelsToUpsert as any)

          // Immediately upsert subscription with user's selected view - canonical single subscription
          const subModel = {
            id: feedId,
            feedId,
            listId: null,
            inboxId: null,
            userId,
            view: chosenView,
            isPrivate: false,
            hideFromTimeline: false,
            title: resolvedTitle,
            category: body.category || null,
            createdAt: new Date().toISOString(),
            type: "feed" as const,
          }
          subscriptionActions.upsertMany([subModel] as any)

          // Refresh feed on Cloudflare Worker to parse and insert entries into D1
          if (feed?.id) {
            try {
              await feyFeedsApi.refreshFeed(feed.id)
            } catch (err) {
              console.warn("[subscriptions.create] initial refresh error:", err)
            }
          }
          await syncFeyFeedsToStore(userId)

          return {
            code: 0,
            feed: feedModel,
            list: null,
            unread: {},
            data: {
              feed: feedModel,
            },
          }
        },
        update: async (body: any) => {
          if (body?.feedId || body?.id) {
            const id = body.feedId || body.id
            const existing = useSubscriptionStore.getState().data[id]
            if (existing) {
              subscriptionActions.upsertMany([
                {
                  ...existing,
                  ...body,
                },
              ] as any)
            }
          }
          return { code: 0, data: body }
        },
        delete: async (body: { feedId?: string; listId?: string }) => {
          if (body.feedId) {
            await feyFeedsApi.deleteFeed(body.feedId).catch(() => null)
          }
          return { code: 0, data: { success: true } }
        },
      }
    }

    if (prop === "entries") {
      return {
        ...target.entries,
        list: async (params: any = {}) => {
          try {
            // Trigger background sync on pull-to-refresh / initial load
            const isInitialPage = !params.publishedAfter && !params.publishedBefore
            if (isInitialPage) {
              const user = await feyFeedsApi.getSession().catch(() => null)
              if (user) {
                syncFeyFeedsToStore(user.id).catch(() => null)
              }
            }

            const limit = typeof params.limit === "number" ? Math.min(params.limit, 100) : 30

            // Format cursor for FeyFeeds backend (base64 JSON containing publishedAt and id)
            let cursor: string | undefined = undefined
            const rawAfter = params.publishedAfter || params.publishedBefore
            if (rawAfter) {
              const publishedAtMs = new Date(rawAfter).getTime()
              if (!Number.isNaN(publishedAtMs) && publishedAtMs > 0) {
                const stateData = useEntryStore.getState().data
                let matchingId: string | undefined
                for (const id in stateData) {
                  const e = stateData[id]
                  if (e) {
                    const eTime =
                      e.publishedAt instanceof Date
                        ? e.publishedAt.getTime()
                        : new Date(e.publishedAt).getTime()
                    if (eTime === publishedAtMs || e.id === rawAfter) {
                      if (typeof e.id === "string" && e.id.startsWith("rss_")) {
                        matchingId = e.id
                        break
                      }
                    }
                  }
                }
                const payload = matchingId
                  ? { publishedAt: publishedAtMs, id: matchingId }
                  : {
                      publishedAt: publishedAtMs - 1,
                      id: "rss_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    }
                cursor = safeBtoa(JSON.stringify(payload))
                  .replace(/\+/g, "-")
                  .replace(/\//g, "_")
                  .replace(/=+$/, "")
              }
            } else if (params.cursor) {
              cursor = params.cursor
            }

            const feedId = params.feedId || undefined

            // Resolve targetFeed and actual URLs for feedId
            const feeds = await feyFeedsApi.listFeeds().catch(() => [])
            const storeFeed = feedId ? (useFeedStore.getState().feeds[feedId] as any) : null
            const storeSub = feedId ? (useSubscriptionStore.getState().data[feedId] as any) : null
            const targetFeed = feedId
              ? feeds.find((f) => f.id === feedId || f.url === feedId) || null
              : null
            const targetFeedId =
              targetFeed?.id || (storeFeed && !storeFeed.id.startsWith("http") ? storeFeed.id : feedId)
            const targetFeedUrl =
              targetFeed?.url ||
              storeFeed?.url ||
              storeSub?.url ||
              (feedId && feedId.startsWith("http") ? feedId : null)

            let page = await feyFeedsApi
              .getTimeline({ limit, cursor, feedId: targetFeedId || feedId })
              .catch(() => null)

            // If a specific feed has 0 entries on initial page load, attempt auto-refresh
            if (isInitialPage && (!page || !page.data || page.data.length === 0) && targetFeed?.id) {
              await feyFeedsApi.refreshFeed(targetFeed.id).catch(() => null)
              page = await feyFeedsApi
                .getTimeline({ limit, cursor, feedId: targetFeed.id })
                .catch(() => null)
            }

            let rawEntries = page?.data || []
            if (feedId) {
              rawEntries = rawEntries.filter(
                (e) =>
                  e.feedId === feedId ||
                  e.feedUrl === feedId ||
                  (targetFeedId && e.feedId === targetFeedId) ||
                  (targetFeedUrl &&
                    (e.feedUrl === targetFeedUrl ||
                      e.feedUrl?.replace(/\/$/, "") === targetFeedUrl?.replace(/\/$/, ""))),
              )
            }

            const feedIdList =
              Array.isArray(params.feedIdList) && params.feedIdList.length > 0
                ? new Set(params.feedIdList)
                : null
            if (feedIdList) {
              rawEntries = rawEntries.filter(
                (e) => feedIdList.has(e.feedId) || (e.feedUrl && feedIdList.has(e.feedUrl)),
              )
            }

            // Fallback 1: If 0 entries and feedId is present (preview or newly added feed before background crawl)
            if (rawEntries.length === 0 && feedId) {
              const previewUrl = targetFeedUrl || (feedId.startsWith("http") ? feedId : null)
              if (previewUrl) {
                const preview = await fetchFeedPreviewEntries(previewUrl, limit)
                if (preview && preview.entries.length > 0) {
                  const resolvedFeedTitle =
                    preview.title || targetFeed?.title || storeFeed?.title || feedId

                  // Upsert real feed title so useFeedById displays actual website name instead of URL
                  const previewFeedModel = {
                    id: feedId,
                    title: resolvedFeedTitle,
                    url: previewUrl,
                    siteUrl: preview.siteUrl || previewUrl,
                    description: preview.description || null,
                    image: preview.image || getFallbackFavicon(previewUrl),
                    errorAt: null,
                    errorMessage: null,
                    ownerUserId: null,
                    type: "feed" as const,
                    subscriptionCount: 1,
                    updatesPerWeek: null,
                    latestEntryPublishedAt: preview.entries[0]?.publishedAt || null,
                  }
                  const feedModelsToUpsert = [
                    previewFeedModel,
                    ...(targetFeedId && targetFeedId !== feedId
                      ? [{ ...previewFeedModel, id: targetFeedId }]
                      : []),
                    ...(previewUrl !== feedId && previewUrl !== targetFeedId
                      ? [{ ...previewFeedModel, id: previewUrl }]
                      : []),
                  ]
                  feedActions.upsertMany(feedModelsToUpsert as any)

                  // Map preview entries to EntryModel and upsert into store under all relevant aliases
                  const previewEntryModels = preview.entries.flatMap((e) => {
                    const base = {
                      id: e.id,
                      title: e.title,
                      url: e.url,
                      content: e.content,
                      readabilityContent: null,
                      readabilityUpdatedAt: null,
                      description: stripHtmlToText(e.summary) || stripHtmlToText(e.content),
                      guid: e.id,
                      author: e.author,
                      authorUrl: null,
                      authorAvatar: null,
                      insertedAt: new Date(e.publishedAt),
                      publishedAt: new Date(e.publishedAt),
                      media: extractMediaFromEntry(e.content, e.attachments),
                      categories: null,
                      attachments: e.attachments,
                      extra: null,
                      language: "en",
                      feedId,
                      inboxHandle: null,
                      read: false,
                      sources: null,
                      settings: null,
                    }
                    return [
                      base,
                      ...(targetFeedId && targetFeedId !== feedId
                        ? [{ ...base, feedId: targetFeedId }]
                        : []),
                      ...(previewUrl !== feedId && previewUrl !== targetFeedId
                        ? [{ ...base, feedId: previewUrl }]
                        : []),
                    ]
                  })
                  entryActions.upsertMany(previewEntryModels as any)

                  const previewData = preview.entries.map((entry) => ({
                    entries: {
                      id: entry.id,
                      feedId,
                      title: entry.title,
                      url: entry.url,
                      content: entry.content,
                      readabilityContent: null,
                      description: stripHtmlToText(entry.summary) || stripHtmlToText(entry.content),
                      guid: entry.id,
                      author: entry.author,
                      authorUrl: null,
                      authorAvatar: null,
                      insertedAt: new Date(entry.publishedAt).toISOString(),
                      publishedAt: new Date(entry.publishedAt).toISOString(),
                      media: extractMediaFromEntry(entry.content, entry.attachments),
                      categories: null,
                      attachments: entry.attachments || null,
                      extra: null,
                      language: "en",
                      read: false,
                      settings: null,
                    },
                    read: false,
                    collections: null,
                    feeds: {
                      type: "feed" as const,
                      id: feedId,
                      title: resolvedFeedTitle,
                      url: previewUrl,
                      siteUrl: preview.siteUrl || previewUrl,
                      description: preview.description || null,
                      image: preview.image || getFallbackFavicon(previewUrl),
                      errorAt: null,
                      errorMessage: null,
                      ownerUserId: null,
                    },
                  }))

                  return { code: 0, data: previewData }
                }
              }
            }

            // Fallback 2: If 0 entries and !feedId (Home timeline before crawl completes)
            if (rawEntries.length === 0 && !feedId && isInitialPage) {
              const subData = useSubscriptionStore.getState().data
              const feedUrlsToFetch = new Set<string>()
              for (const id in subData) {
                const sub = subData[id]
                if (!sub) continue
                if (typeof params.view === "number" && params.view !== FeedViewType.All) {
                  if (sub.view !== params.view) continue
                }
                const targetFeedItem = sub.feedId ? useFeedStore.getState().feeds[sub.feedId] : null
                const url = targetFeedItem?.url || (id.startsWith("http") ? id : null)
                if (url) feedUrlsToFetch.add(url)
              }

              if (feedUrlsToFetch.size > 0) {
                const urls = Array.from(feedUrlsToFetch).slice(0, 5)
                const previews = await Promise.all(
                  urls.map((u) => fetchFeedPreviewEntries(u, 10).catch(() => null)),
                )
                const fallbackEntries: typeof rawEntries = []
                for (const p of previews) {
                  if (p && p.entries.length > 0) {
                    fallbackEntries.push(
                      ...p.entries.map((entry) => ({
                        ...entry,
                        publishedAt: new Date(entry.publishedAt).getTime(),
                        attachments: (entry.attachments as any) || undefined,
                      })),
                    )
                  }
                }
                if (fallbackEntries.length > 0) {
                  fallbackEntries.sort(
                    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
                  )
                  rawEntries = fallbackEntries.slice(0, limit)
                }
              }
            }

            // FILTER BY VIEW: If params.view is specified (and not a specific feed query or folder query),
            // filter entries so that only feeds belonging to that view are returned
            if (
              typeof params.view === "number" &&
              !feedId &&
              !feedIdList &&
              params.view !== FeedViewType.All
            ) {
              const subData = useSubscriptionStore.getState().data
              rawEntries = rawEntries.filter((e) => {
                const sub = subData[e.feedId] || (e.feedUrl ? subData[e.feedUrl] : null)
                if (sub && typeof sub.view === "number") {
                  return sub.view === params.view
                }
                for (const k in subData) {
                  const s = subData[k]
                  if (s && (s.feedId === e.feedId || s.feedId === e.feedUrl || k === e.feedId)) {
                    return s.view === params.view
                  }
                }
                return params.view === FeedViewType.Articles
              })
            }

            // Upsert entries into store so local queries and cache stay up-to-date
            if (rawEntries.length > 0) {
              const localModels = rawEntries.flatMap((e) => {
                const base = {
                  id: e.id,
                  title: e.title,
                  url: e.url,
                  content: e.content,
                  readabilityContent: null,
                  readabilityUpdatedAt: null,
                  description: stripHtmlToText(e.summary) || stripHtmlToText(e.content),
                  guid: e.id,
                  author: e.author,
                  authorUrl: null,
                  authorAvatar: null,
                  insertedAt: new Date(e.publishedAt),
                  publishedAt: new Date(e.publishedAt),
                  media: extractMediaFromEntry(e.content, e.attachments),
                  categories: e.categories || null,
                  attachments: e.attachments ? (e.attachments as any) : null,
                  extra: null,
                  language: "en",
                  feedId: e.feedId,
                  inboxHandle: null,
                  read: e.isRead,
                  sources: null,
                  settings: null,
                }
                return [
                  base,
                  ...(feedId && feedId !== e.feedId ? [{ ...base, feedId }] : []),
                  ...(e.feedUrl && e.feedUrl !== e.feedId && e.feedUrl !== feedId
                    ? [{ ...base, feedId: e.feedUrl }]
                    : []),
                ]
              })
              entryActions.upsertMany(localModels as any)
            }

            const data = rawEntries.map((entry) => {
              const existingFeed =
                (useFeedStore.getState().feeds[entry.feedId] as any) ||
                (entry.feedUrl ? (useFeedStore.getState().feeds[entry.feedUrl] as any) : null)
              const image = existingFeed?.image || getFallbackFavicon(entry.feedUrl)
              return {
                entries: {
                  id: entry.id,
                  feedId: feedId || entry.feedId,
                  title: entry.title,
                  url: entry.url,
                  content: entry.content,
                  readabilityContent: null,
                  description: stripHtmlToText(entry.summary) || stripHtmlToText(entry.content),
                  guid: entry.id,
                  author: entry.author,
                  authorUrl: null,
                  authorAvatar: null,
                  insertedAt: new Date(entry.publishedAt).toISOString(),
                  publishedAt: new Date(entry.publishedAt).toISOString(),
                  media: extractMediaFromEntry(entry.content, entry.attachments),
                  categories: entry.categories || null,
                  attachments: entry.attachments || null,
                  extra: null,
                  language: "en",
                  read: entry.isRead,
                  settings: null,
                },
                read: entry.isRead,
                collections: entry.isBookmarked
                  ? { createdAt: new Date(entry.publishedAt).toISOString() }
                  : null,
                feeds: {
                  type: "feed" as const,
                  id: feedId || entry.feedId,
                  title: entry.feedTitle || entry.feedUrl,
                  url: entry.feedUrl,
                  siteUrl: entry.feedUrl,
                  description: null,
                  image,
                  errorAt: null,
                  errorMessage: null,
                  ownerUserId: null,
                },
              }
            })
            return { code: 0, data }
          } catch (err) {
            console.error("[entries.list] error:", err)
            return { code: 0, data: [] }
          }
        },
        readability: async (query: { id?: string } = {}) => {
          const id = query.id
          if (!id) return { code: 0, data: null }

          const localEntry = useEntryStore.getState().data[id]
          if (localEntry?.readabilityContent) {
            return {
              code: 0,
              data: {
                content: localEntry.readabilityContent,
              },
            }
          }

          const url = localEntry?.url
          if (!url) {
            return {
              code: 0,
              data: {
                content: localEntry?.content || null,
              },
            }
          }

          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 12000)
            const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
              signal: controller.signal,
              headers: {
                Accept: "application/json",
                "X-Target-Selector": "article, main, .post-content, .entry-content, [role='main']",
              },
            })
            clearTimeout(timer)
            if (res.ok) {
              const json = (await res.json()) as any
              const md = json?.data?.content
              if (md && typeof md === "string" && md.length > 50) {
                const html = convertMarkdownToHtml(md, url)
                await entryActions.updateEntryContent({
                  entryId: id,
                  readabilityContent: html,
                })
                return {
                  code: 0,
                  data: {
                    content: html,
                  },
                }
              }
            }
          } catch (err) {
            console.warn("[entries.readability] Jina Reader fetch failed:", err)
          }

          return {
            code: 0,
            data: {
              content: localEntry?.content || null,
            },
          }
        },
        get: async (query: { id?: string } = {}) => {
          const id = query.id
          if (!id) return { code: 0, data: null }
          const timeline = await feyFeedsApi.getTimeline({ limit: 100 }).catch(() => null)
          const entry = timeline?.data?.find((e) => e.id === id)
          if (!entry) return { code: 0, data: null }
          const existingFeed =
            (useFeedStore.getState().feeds[entry.feedId] as any) ||
            (entry.feedUrl ? (useFeedStore.getState().feeds[entry.feedUrl] as any) : null)
          const image = existingFeed?.image || getFallbackFavicon(entry.feedUrl)
          return {
            code: 0,
            data: {
              entries: {
                id: entry.id,
                feedId: entry.feedId,
                title: entry.title,
                url: entry.url,
                content: entry.content,
                readabilityContent: null,
                description: stripHtmlToText(entry.summary) || stripHtmlToText(entry.content),
                guid: entry.id,
                author: entry.author,
                authorUrl: null,
                authorAvatar: null,
                insertedAt: new Date(entry.publishedAt).toISOString(),
                publishedAt: new Date(entry.publishedAt).toISOString(),
                media: extractMediaFromEntry(entry.content, entry.attachments),
                categories: entry.categories || null,
                attachments: entry.attachments || null,
                extra: null,
                language: "en",
                read: entry.isRead,
                settings: null,
              },
              read: entry.isRead,
              collections: entry.isBookmarked
                ? { createdAt: new Date(entry.publishedAt).toISOString() }
                : null,
              feeds: {
                type: "feed" as const,
                id: entry.feedId,
                title: entry.feedTitle || entry.feedUrl,
                url: entry.feedUrl,
                siteUrl: entry.feedUrl,
                description: null,
                image,
                errorAt: null,
                errorMessage: null,
                ownerUserId: null,
              },
            },
          }
        },
      }
    }

    if (prop === "reads") {
      return {
        ...target.reads,
        markAsRead: async ({ entryIds }: { entryIds: string[] }) => {
          for (const id of entryIds || []) {
            await feyFeedsApi.updateEntryState(id, { isRead: true }).catch(() => null)
          }
          return { code: 0, data: { success: true } }
        },
        markAsUnread: async ({ entryIds }: { entryIds: string[] }) => {
          for (const id of entryIds || []) {
            await feyFeedsApi.updateEntryState(id, { isRead: false }).catch(() => null)
          }
          return { code: 0, data: { success: true } }
        },
        markAllAsRead: async () => ({ code: 0, data: { success: true } }),
        get: async () => ({ code: 0, data: [] }),
      }
    }

    if (prop === "collections") {
      return {
        ...target.collections,
        post: async ({ entryId }: { entryId: string; view?: any }) => {
          await feyFeedsApi.updateEntryState(entryId, { isBookmarked: true }).catch(() => null)
          return { code: 0, data: { success: true } }
        },
        delete: async ({ entryId }: { entryId: string }) => {
          await feyFeedsApi.updateEntryState(entryId, { isBookmarked: false }).catch(() => null)
          return { code: 0, data: { success: true } }
        },
      }
    }

    if (prop === "ai") {
      return {
        ...target.ai,
        summary: async ({ id, language }: { id: string; language?: string }) => {
          const lang = language || "en"
          const result = await feyFeedsApi.summarizeArticle(id, lang)
          return { code: 0, data: result.summary }
        },
      }
    }

    if (prop === "status") {
      return {
        ...target.status,
        getConfigs: async () => ({
          code: 0,
          data: {
            PAYMENT_ENABLED: false,
            APP_CHECK_ENABLED: false,
          },
        }),
      }
    }

    if (prop === "profiles") {
      return {
        ...target.profiles,
        getBatch: async ({ ids }: { ids: string[] }) => {
          const user = await feyFeedsApi.getSession().catch(() => null)
          if (!user) return { code: 0, data: [] }
          return {
            code: 0,
            data: ids.map((id) => ({
              id: user.id,
              name: user.name || user.email.split("@")[0],
              handle: user.email.split("@")[0],
              image: null,
            })),
          }
        },
      }
    }

    if (prop === "feeds") {
      return {
        ...target.feeds,
        get: async (query: { url?: string; id?: string } = {}) => {
          const url = (query.url || "").trim()
          const id = (query.id || "").trim()
          const rawFeedUrl = url || (id.includes("://") ? id : "")
          const feedUrl = normalizeRssUrl(rawFeedUrl)

          // Check if feed is already in user's library
          const existingFeeds = await feyFeedsApi.listFeeds().catch(() => [])
          const existing = existingFeeds.find(
            (f) =>
              f.id === id ||
              (feedUrl && f.url === feedUrl) ||
              (rawFeedUrl && f.url === rawFeedUrl),
          )

          if (existing) {
            const existingFeed =
              (useFeedStore.getState().feeds[existing.id] as any) ||
              (existing.url ? (useFeedStore.getState().feeds[existing.url] as any) : null)
            const image = existingFeed?.image || getFallbackFavicon(existing.url)
            const feedModel = {
              id: existing.id,
              title: existing.title || existing.url,
              url: existing.url,
              siteUrl: existing.url,
              description: null,
              image,
              errorAt: existing.lastError ? new Date().toISOString() : null,
              errorMessage: existing.lastError,
              ownerUserId: null,
              subscriptionCount: 1,
              updatesPerWeek: null,
              latestEntryPublishedAt: null,
              type: "feed" as const,
            }
            return {
              code: 0,
              data: {
                feed: feedModel,
                entries: [],
                readCount: 0,
                subscriptionCount: 1,
                analytics: {
                  updatesPerWeek: 0,
                  subscriptionCount: 1,
                  latestEntryPublishedAt: null,
                },
              },
            }
          }

          // Not in user's library yet
          let resolvedTitle: string | null = null
          let resolvedSiteUrl: string | null = null
          let resolvedDescription: string | null = null
          let resolvedImage: string | null = null
          let resolvedUrl = feedUrl || id
          let subscriberCount = 1
          let updatesPerWeek: number | null = null

          if (rawFeedUrl.startsWith("rsshub://")) {
            const route = rawFeedUrl.replace(/^rsshub:\/\//, "").replace(/^\/+/, "")
            resolvedTitle = `[RSSHub] ${route}`
            resolvedSiteUrl = `https://rsshub.app/${route}`
          } else if (feedUrl && (feedUrl.startsWith("http://") || feedUrl.startsWith("https://"))) {
            // First check Feedly feed info for real title & metadata
            const feedlyInfo = await lookupFeedlyFeed(feedUrl)
            if (feedlyInfo) {
              resolvedTitle = feedlyInfo.title
              resolvedSiteUrl = feedlyInfo.website
              resolvedDescription = feedlyInfo.description
              resolvedImage = feedlyInfo.image
              subscriberCount = feedlyInfo.subscribers || 1
              updatesPerWeek = feedlyInfo.velocity
            } else {
              // Fallback to website autodiscovery
              try {
                const discovered = await feyFeedsApi.discoverFeeds(feedUrl)
                const firstDiscovered = discovered?.[0]
                if (firstDiscovered) {
                  resolvedUrl = firstDiscovered.url
                  resolvedTitle = firstDiscovered.title
                }
              } catch {
                // Direct feed URL or discovery failed; fallback to feedUrl
              }
            }
          }

          const feedModel = {
            id: id || rawFeedUrl || resolvedUrl,
            title: resolvedTitle || resolvedUrl,
            url: rawFeedUrl || resolvedUrl,
            siteUrl: resolvedSiteUrl || resolvedUrl,
            description: resolvedDescription,
            image: resolvedImage || getFallbackFavicon(resolvedUrl),
            errorAt: null,
            errorMessage: null,
            ownerUserId: null,
            subscriptionCount: subscriberCount,
            updatesPerWeek,
            latestEntryPublishedAt: null,
            type: "feed" as const,
          }
          feedActions.upsertMany([feedModel] as any)

          return {
            code: 0,
            data: {
              feed: feedModel,
              entries: [],
              readCount: 0,
              subscriptionCount: subscriberCount,
              analytics: {
                updatesPerWeek: updatesPerWeek || 0,
                subscriptionCount: subscriberCount,
                latestEntryPublishedAt: null,
              },
            },
          }
        },
        refresh: async ({ id }: { id: string }) => {
          if (id) {
            await feyFeedsApi.refreshFeed(id).catch(() => null)
          }
          return { code: 0, data: null }
        },
        reset: async () => ({ code: 0, data: null }),
        analytics: async () => ({ code: 0, data: { analytics: {} } }),
        claim: {
          challenge: async () => ({ code: 0, data: null }),
          list: async () => ({ code: 0, data: [] }),
          message: async () => ({ code: 0, data: null }),
        },
      }
    }

    if (prop === "discover") {
      return {
        ...target.discover,
        discover: async ({
          keyword,
          target: discTarget,
        }: {
          keyword: string
          target?: "feeds" | "lists"
        }) => {
          const trimmed = (keyword || "").trim()
          if (!trimmed) {
            return { code: 0, data: [] }
          }

          if (discTarget === "lists") {
            try {
              const lists = await feyFeedsApi.listLists().catch(() => [])
              const lower = trimmed.toLowerCase()
              const matched = lists.filter(
                (l) =>
                  l.name.toLowerCase().includes(lower) ||
                  (l.description && l.description.toLowerCase().includes(lower)),
              )
              return {
                code: 0,
                data: matched.map((list) => ({
                  list: {
                    type: "list" as const,
                    id: list.id,
                    title: list.name,
                    description: list.description,
                    image: null,
                    view: 0,
                    fee: 0,
                    ownerUserId: "",
                  },
                })),
              }
            } catch {
              return { code: 0, data: [] }
            }
          }

          // Feeds discovery
          // 1. Direct RSSHub route URL
          if (trimmed.startsWith("rsshub://")) {
            const route = trimmed.replace(/^rsshub:\/\//, "").replace(/^\/+/, "")
            return {
              code: 0,
              data: [
                {
                  feed: {
                    id: trimmed,
                    title: `[RSSHub] ${route}`,
                    url: trimmed,
                    siteUrl: `https://rsshub.app/${route}`,
                    description: "RSSHub Route",
                    image: getFallbackFavicon(`https://rsshub.app/${route}`),
                    ownerUserId: null,
                    type: "feed" as const,
                  },
                },
              ],
            }
          }

          // 2. Direct URL or domain input
          const looksLikeUrl =
            trimmed.includes("://") ||
            (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed) && !trimmed.includes(" "))

          if (looksLikeUrl) {
            const normalizedUrl = trimmed.includes("://") ? trimmed : `https://${trimmed}`
            const results: any[] = []
            const seenUrls = new Set<string>()

            const addResult = (item: any) => {
              const u = (item?.feed?.url || item?.feed?.id || "").toLowerCase()
              if (u && !seenUrls.has(u)) {
                seenUrls.add(u)
                results.push(item)
              }
            }

            // Concurrently query website autodiscovery, Feedly domain search, and RSSHub route search
            const [discovered, publicFeeds, rsshubMatches] = await Promise.all([
              feyFeedsApi.discoverFeeds(normalizedUrl).catch(() => []),
              searchPublicFeeds(trimmed).catch(() => []),
              Promise.resolve(searchRssHubRoutes(trimmed)),
            ])

            for (const item of discovered || []) {
              addResult({
                feed: {
                  id: item.url,
                  title: item.title || item.url,
                  url: item.url,
                  siteUrl: normalizedUrl,
                  description: null,
                  image: getFallbackFavicon(item.url),
                  ownerUserId: null,
                  type: "feed" as const,
                },
              })
            }

            for (const item of publicFeeds || []) {
              if (item?.feed && !item.feed.image) {
                item.feed.image = getFallbackFavicon(item.feed.url || item.feed.siteUrl)
              }
              addResult(item)
            }

            for (const item of rsshubMatches || []) {
              addResult(item)
            }

            if (results.length > 0) {
              const feedsToUpsert = results.map((r) => r.feed).filter(Boolean)
              if (feedsToUpsert.length > 0) {
                feedActions.upsertMany(feedsToUpsert as any)
              }
              return { code: 0, data: results }
            }

            // Fallback to direct input item
            const fallbackItem = {
              feed: {
                id: normalizedUrl,
                title: trimmed,
                url: normalizedUrl,
                siteUrl: normalizedUrl,
                description: null,
                image: getFallbackFavicon(normalizedUrl),
                ownerUserId: null,
                type: "feed" as const,
              },
            }
            feedActions.upsertMany([fallbackItem.feed] as any)
            return {
              code: 0,
              data: [fallbackItem],
            }
          }

          // 3. Keyword Search (Feedly worldwide RSS/Atom feeds, RSSHub curated routes, user's library)
          try {
            const [publicFeeds, rsshubRoutes, searchRes] = await Promise.all([
              searchPublicFeeds(trimmed).catch(() => []),
              Promise.resolve(searchRssHubRoutes(trimmed)),
              feyFeedsApi.searchLibrary(trimmed).catch(() => null),
            ])

            const results: any[] = []
            const seenUrls = new Set<string>()

            const addResult = (item: any) => {
              const u = (item?.feed?.url || item?.feed?.id || "").toLowerCase()
              if (u && !seenUrls.has(u)) {
                seenUrls.add(u)
                results.push(item)
              }
            }

            // User library feeds (matched locally)
            const libraryFeeds = searchRes?.feeds || []
            for (const f of libraryFeeds) {
              const existingFeed =
                (useFeedStore.getState().feeds[f.id] as any) ||
                (f.url ? (useFeedStore.getState().feeds[f.url] as any) : null)
              addResult({
                feed: {
                  id: f.id,
                  title: f.title || f.url,
                  url: f.url,
                  siteUrl: f.url,
                  description: null,
                  image: existingFeed?.image || getFallbackFavicon(f.url),
                  ownerUserId: null,
                  type: "feed" as const,
                },
              })
            }

            // Public Feedly feeds (RSS + Atom worldwide)
            for (const item of publicFeeds) {
              if (item?.feed && !item.feed.image) {
                item.feed.image = getFallbackFavicon(item.feed.url || item.feed.siteUrl)
              }
              addResult(item)
            }

            // RSSHub curated routes matching keyword
            for (const item of rsshubRoutes) {
              addResult(item)
            }

            const feedsToUpsert = results.map((r) => r.feed).filter(Boolean)
            if (feedsToUpsert.length > 0) {
              feedActions.upsertMany(feedsToUpsert as any)
            }

            return {
              code: 0,
              data: results,
            }
          } catch {
            return { code: 0, data: [] }
          }
        },
        rsshub: async (params?: { categories?: string; lang?: string }) => {
          const category = params?.categories || "all"
          const data = getRssHubCategoryRoutes(category)
          return { code: 0, data }
        },
        rsshubRoute: async () => ({ code: 0, data: {} }),
        rsshubAnalytics: async () => ({ code: 0, data: {} }),
      }
    }

    if (prop === "trending") {
      return {
        ...target.trending,
        getFeeds: async (params?: { language?: string; limit?: number }) => {
          const limit = params?.limit || 20
          const popular = await searchPublicFeeds("technology").catch(() => [])
          const sliced = popular.slice(0, limit).map((item) => {
            if (item?.feed && !item.feed.image) {
              item.feed.image = getFallbackFavicon(item.feed.url || item.feed.siteUrl)
            }
            return item
          })

          // Upsert all feeds into feed store so titles and metadata are immediately available
          const feedModels = sliced.map((item) => item.feed).filter(Boolean)
          if (feedModels.length > 0) {
            feedActions.upsertMany(feedModels as any)
          }

          // Attach view: FeedViewType.Articles
          const formatted = sliced.map((item) => ({
            ...item,
            view: FeedViewType.Articles,
          }))

          return { code: 0, data: formatted }
        },
      }
    }

    if (prop === "actions") {
      return {
        ...target.actions,
        get: async () => ({
          code: 0,
          data: { rules: [] },
        }),
        put: async (body: any) => ({
          code: 0,
          data: body || { rules: [] },
        }),
        delete: async () => ({
          code: 0,
          data: { success: true },
        }),
      }
    }

    if (prop === "inboxes") {
      return {
        ...target.inboxes,
        list: async () => ({ code: 0, data: [] }),
        get: async () => ({ code: 0, data: null }),
        post: async () => ({ code: 0, data: null }),
        put: async () => ({ code: 0, data: null }),
        delete: async () => ({ code: 0, data: { success: true } }),
      }
    }

    if (prop === "categories") {
      return {
        ...target.categories,
        update: async () => ({ code: 0, data: { success: true } }),
        delete: async () => ({ code: 0, data: { success: true } }),
      }
    }

    if (prop === "lists") {
      return {
        ...target.lists,
        get: async ({ listId }: { listId: string }) => {
          try {
            const list = await feyFeedsApi.listDetail(listId)
            return {
              code: 0,
              data: {
                list: {
                  id: list.id,
                  title: list.name,
                  description: list.description,
                  feedIds: list.feeds?.map((f) => f.id) || [],
                  view: 0,
                  fee: 0,
                  ownerUserId: "",
                  type: "list" as const,
                },
              },
            }
          } catch {
            return { code: 0, data: null }
          }
        },
        list: async () => {
          try {
            const lists = await feyFeedsApi.listLists().catch(() => [])
            return {
              code: 0,
              data: lists.map((l) => ({
                id: l.id,
                title: l.name,
                description: l.description,
                feedIds: [],
                view: 0,
                fee: 0,
                ownerUserId: "",
                type: "list" as const,
              })),
            }
          } catch {
            return { code: 0, data: [] }
          }
        },
        create: async (body: any) => {
          try {
            const list = await feyFeedsApi.createList(body.title, body.description)
            return {
              code: 0,
              data: {
                id: list.id,
                title: list.name,
                description: list.description,
                feedIds: [],
                view: 0,
                fee: 0,
                ownerUserId: "",
                type: "list" as const,
              },
            }
          } catch {
            return { code: 0, data: null }
          }
        },
        update: async (body: any) => ({ code: 0, data: body }),
        delete: async ({ listId }: { listId: string }) => {
          if (listId) {
            await feyFeedsApi.deleteList(listId).catch(() => null)
          }
          return { code: 0, data: { success: true } }
        },
        addFeeds: async () => ({ code: 0, data: [] }),
        removeFeed: async () => ({ code: 0, data: { success: true } }),
      }
    }

    if (prop === "settings") {
      return {
        ...target.settings,
        get: async () => ({
          code: 0,
          settings: {},
          updated: {},
          data: {
            settings: {},
            updated: {},
          },
        }),
        update: async (body: any) => ({
          code: 0,
          settings: body || {},
          updated: {},
          data: body || {},
        }),
      }
    }

    if (prop === "data") {
      return {
        ...target.data,
        sendAnalytics: async () => ({ code: 0, data: null }),
      }
    }

    return Reflect.get(target, prop, receiver)
  },
})

setGlobalFollowApi(feyFeedsApiAdapter)
