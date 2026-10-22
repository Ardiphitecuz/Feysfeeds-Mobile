import { XMLParser, XMLValidator } from "fast-xml-parser"
import sanitizeHtml from "sanitize-html"

import { isPublicHttpUrl } from "./url-security"

const MAX_FEED_BYTES = 1_500_000
const MAX_FEED_ITEMS = 100
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 12_000
const MAX_CATEGORIES = 32
const MAX_ATTACHMENTS = 16

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  textNodeName: "#text",
  trimValues: true,
})

export class FeedFetchError extends Error {
  readonly status: 400 | 413 | 422

  constructor(message: string, status: 400 | 413 | 422 = 422) {
    super(message)
    this.name = "FeedFetchError"
    this.status = status
  }
}

export type ParsedFeedEntry = {
  guid: string
  title: string | null
  url: string | null
  content: string | null
  summary: string | null
  author: string | null
  categories: string[]
  attachments: {
    url: string
    mimeType: string | null
    title: string | null
    sizeInBytes: number | null
  }[]
  publishedAt: number
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const nodes = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value]
const decodeXmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    switch (entity.toLowerCase()) {
      case "amp":
        return "&"
      case "lt":
        return "<"
      case "gt":
        return ">"
      case "quot":
        return '"'
      case "apos":
        return "'"
      default: {
        const codePoint = entity.startsWith("#x")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10)
        return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : match
      }
    }
  })
const text = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number")
    return decodeXmlEntities(String(value)).trim() || null
  const raw = asRecord(value)?.["#text"]
  return typeof raw === "string" || typeof raw === "number"
    ? decodeXmlEntities(String(raw)).trim() || null
    : null
}
const limited = (value: string | null, max: number): string | null => value?.slice(0, max) ?? null
const safeArticleUrl = (value: unknown, baseUrl: string): string | null => {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate, baseUrl)
    return isPublicHttpUrl(url.href) ? url.href : null
  } catch {
    return null
  }
}
const entryLink = (value: unknown, baseUrl: string): string | null => {
  for (const item of nodes(value)) {
    const record = asRecord(item)
    if (!record || !text(record["@_rel"]) || text(record["@_rel"]) === "alternate") {
      const found = safeArticleUrl(record?.["@_href"] ?? item, baseUrl)
      if (found) return found
    }
  }
  return null
}
const readDate = (record: Record<string, unknown>): number => {
  const value =
    text(record.pubDate) ??
    text(record.published) ??
    text(record.updated) ??
    text(record["dc:date"]) ??
    text(record.date) ??
    text(record.date_published) ??
    text(record.date_modified)
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}
const authorName = (value: unknown): string | null => {
  const direct = text(value)
  const name = direct ?? text(asRecord(value)?.name) ?? text(asRecord(value)?.["#text"])
  return limited(name, 256)
}
export const sanitizeFeedHtml = (value: string | null, baseUrl: string): string | null => {
  if (!value) return null
  return sanitizeHtml(value, {
    allowedTags: [
      "a",
      "article",
      "aside",
      "b",
      "blockquote",
      "br",
      "caption",
      "code",
      "dd",
      "del",
      "details",
      "div",
      "dl",
      "dt",
      "em",
      "figcaption",
      "figure",
      "footer",
      "header",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "iframe",
      "img",
      "li",
      "main",
      "mark",
      "nav",
      "ol",
      "p",
      "picture",
      "pre",
      "q",
      "s",
      "section",
      "small",
      "source",
      "span",
      "strong",
      "sub",
      "summary",
      "sup",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
      "video",
      "audio",
    ],
    allowedAttributes: {
      "*": ["style", "class", "dir", "lang", "title"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading", "data-src", "data-original", "srcset", "sizes"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      video: ["src", "controls", "poster", "autoplay", "loop", "muted", "width", "height"],
      audio: ["src", "controls", "autoplay", "loop", "muted"],
      source: ["src", "type"],
      iframe: ["src", "width", "height", "allowfullscreen"],
    },
    allowedIframeHostnames: [
      "www.youtube.com",
      "youtube.com",
      "player.vimeo.com",
      "open.spotify.com",
      "soundcloud.com",
      "www.bilibili.com",
      "player.bilibili.com",
    ],
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          ...(attributes.href
            ? { href: safeContentHref(attributes.href, baseUrl, true) ?? undefined }
            : {}),
        },
      }),
      img: (_tagName, attributes) => {
        const rawSrc = attributes.src?.trim()
        const isPlaceholder = !rawSrc || rawSrc.startsWith("data:image/svg") || rawSrc.includes("blank.gif") || rawSrc.includes("spacer.gif")
        const effectiveSrc = isPlaceholder
          ? attributes["data-src"] || attributes["data-original"] || rawSrc
          : rawSrc
        return {
          tagName: "img",
          attribs: {
            ...attributes,
            ...(effectiveSrc
              ? { src: safeContentHref(effectiveSrc, baseUrl, false) ?? undefined }
              : {}),
          },
        }
      },
    },
  })
}
const safeContentHref = (value: string, baseUrl: string, allowMailto: boolean): string | null => {
  if (allowMailto && value.startsWith("mailto:")) return value
  return safeArticleUrl(value, baseUrl)
}
const strings = (value: unknown): string[] =>
  nodes(value)
    .map((item) => {
      const record = asRecord(item)
      return text(record?.term) ?? text(record?.label) ?? text(record?.["#text"]) ?? text(item)
    })
    .filter((item): item is string => Boolean(item))
    .map((item) => item.slice(0, 256))
    .slice(0, MAX_CATEGORIES)
const xmlAttachments = (
  record: Record<string, unknown>,
  base: string,
): ParsedFeedEntry["attachments"] => {
  const enclosureItems = [
    ...nodes(record.enclosure),
    ...nodes(record["media:content"]),
    ...nodes(record["media:thumbnail"]),
  ]
  return enclosureItems
    .flatMap((item) => {
      const enc = asRecord(item)
      const url = safeArticleUrl(enc?.["@_url"] ?? enc?.["@_href"], base)
      if (!url) return []
      const rawSize = Number(enc?.["@_length"] ?? enc?.["@_fileSize"])
      return [
        {
          url,
          mimeType: limited(text(enc?.["@_type"] ?? enc?.["@_medium"]), 128),
          title: limited(text(enc?.["@_title"]), 512),
          sizeInBytes: Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : null,
        },
      ]
    })
    .slice(0, MAX_ATTACHMENTS)
}
const normalizedXmlEntry = (item: unknown, feedUrl: string): ParsedFeedEntry | undefined => {
  const record = asRecord(item)
  if (!record) return undefined
  const url = entryLink(record.link, feedUrl)
  const guid =
    text(record.guid) ??
    text(record.id) ??
    url ??
    [text(record.title), readDate(record)].filter(Boolean).join(":")
  if (!guid || guid.length > 2048) return undefined
  const content =
    text(record["content:encoded"]) ??
    text(asRecord(record.content)?.["#text"]) ??
    text(record.content) ??
    text(record.description) ??
    text(record.summary)
  const summary = text(record.summary) ?? text(record.description)
  const categories = [...strings(record.category), ...strings(record["dc:subject"])].slice(
    0,
    MAX_CATEGORIES,
  )
  return {
    guid,
    title: limited(text(record.title), 2048),
    url,
    content: sanitizeFeedHtml(limited(content, 100_000), feedUrl),
    summary: sanitizeFeedHtml(limited(summary, 20_000), feedUrl),
    author: authorName(record.author ?? record["dc:creator"]),
    categories,
    attachments: xmlAttachments(record, feedUrl),
    publishedAt: readDate(record),
  }
}

export const parseRssFeed = (xml: string, feedUrl: string): ParsedFeedEntry[] => {
  if (XMLValidator.validate(xml) !== true) throw new FeedFetchError("The feed contains invalid XML")
  let document: unknown
  try {
    document = parser.parse(xml)
  } catch {
    throw new FeedFetchError("The feed contains invalid XML")
  }
  const root = asRecord(document)
  const rss = asRecord(root?.rss)
  const channel = asRecord(rss?.channel)
  const atom = asRecord(root?.feed)
  const rawItems = channel?.item ?? atom?.entry
  if (!rss && !atom)
    throw new FeedFetchError("The URL does not contain a supported RSS or Atom feed")
  if (rawItems === undefined) return []
  const seen = new Set<string>()
  return nodes(rawItems)
    .slice(0, MAX_FEED_ITEMS)
    .map((item) => normalizedXmlEntry(item, feedUrl))
    .filter((entry): entry is ParsedFeedEntry => {
      if (!entry || seen.has(entry.guid)) return false
      seen.add(entry.guid)
      return true
    })
}

export const parseJsonFeed = (json: string, feedUrl: string): ParsedFeedEntry[] => {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new FeedFetchError("The feed contains invalid JSON")
  }
  const root = asRecord(value)
  if (
    !root ||
    !/^https:\/\/jsonfeed\.org\/version\/1(?:\.1)?$/.test(String(root.version ?? "")) ||
    !Array.isArray(root.items)
  ) {
    throw new FeedFetchError("The URL does not contain a supported JSON Feed")
  }
  const seen = new Set<string>()
  return root.items.slice(0, MAX_FEED_ITEMS).flatMap((raw) => {
    const item = asRecord(raw)
    if (!item) return []
    const url = safeArticleUrl(item.url ?? item.external_url, feedUrl)
    const guid = text(item.id) ?? url
    if (!guid || guid.length > 2048 || seen.has(guid)) return []
    seen.add(guid)
    const attachments = nodes(item.attachments)
      .flatMap((rawAttachment) => {
        const attachment = asRecord(rawAttachment)
        const attachmentUrl = safeArticleUrl(attachment?.url, feedUrl)
        if (!attachmentUrl) return []
        const size = attachment?.size_in_bytes
        return [
          {
            url: attachmentUrl,
            mimeType: limited(text(attachment?.mime_type), 128),
            title: null,
            sizeInBytes:
              typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null,
          },
        ]
      })
      .slice(0, MAX_ATTACHMENTS)
    const authors = Array.isArray(item.authors) ? item.authors : []
    const author = authorName(item.author) ?? authorName(authors[0])
    const date = readDate({
      date_published: item.date_published,
      date_modified: item.date_modified,
    })
    return [
      {
        guid,
        title: limited(text(item.title), 2048),
        url,
        content: sanitizeFeedHtml(
          limited(text(item.content_html) ?? text(item.content_text), 100_000),
          feedUrl,
        ),
        summary: sanitizeFeedHtml(limited(text(item.summary), 20_000), feedUrl),
        author,
        categories: strings(item.tags),
        attachments,
        publishedAt: date,
      },
    ]
  })
}

const readBoundedBody = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) throw new FeedFetchError("The feed response has no body")
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_FEED_BYTES) {
        await reader.cancel()
        throw new FeedFetchError("The feed exceeds the 1.5 MB limit", 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "")
  } catch {
    throw new FeedFetchError("The feed response uses invalid text encoding")
  }
}

export const fetchAndParseFeed = async (feedUrl: string): Promise<ParsedFeedEntry[]> => {
  let currentUrl = feedUrl
  if (!isPublicHttpUrl(currentUrl))
    throw new FeedFetchError("The feed URL must be a public HTTP or HTTPS URL", 400)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response
    try {
      response = await fetch(currentUrl, {
        headers: {
          accept:
            "application/feed+json, application/json;q=0.9, application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.8, text/plain;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; FeyFeeds/1.0; +https://feyfeeds.app)",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch {
      throw new FeedFetchError("Could not retrieve the feed")
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location")
      if (!location || redirectCount === MAX_REDIRECTS)
        throw new FeedFetchError("The feed redirected too many times")
      let nextUrl: string
      try {
        nextUrl = new URL(location, currentUrl).href
      } catch {
        throw new FeedFetchError("The feed redirected to a disallowed URL", 400)
      }
      if (!isPublicHttpUrl(nextUrl))
        throw new FeedFetchError("The feed redirected to a disallowed URL", 400)
      currentUrl = nextUrl
      continue
    }
    if (!response.ok) throw new FeedFetchError("The feed server returned an unsuccessful response")
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    const mediaType = contentType.split(";", 1)[0]?.trim()
    const jsonType = [
      "application/feed+json",
      "text/feed+json",
      "application/json",
      "text/json",
    ].includes(mediaType ?? "")
    const body = await readBoundedBody(response)
    if (jsonType || (/^\s*\{/.test(body) && !body.includes("<rss") && !body.includes("<feed"))) {
      try {
        return parseJsonFeed(body, currentUrl)
      } catch (err) {
        if (jsonType) throw err
      }
    }
    try {
      return parseRssFeed(body, currentUrl)
    } catch (err) {
      if (contentType && !contentType.includes("xml") && !contentType.includes("rss") && !contentType.includes("atom")) {
        throw new FeedFetchError("The feed URL did not return a recognized feed content type")
      }
      throw err
    }
  }
  throw new FeedFetchError("The feed redirected too many times")
}

export const hashFeedEntryId = async (feedId: string, guid: string): Promise<string> => {
  const input = new TextEncoder().encode(`${feedId}\n${guid}`)
  const digest = await crypto.subtle.digest("SHA-256", input)
  return `rss_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}
