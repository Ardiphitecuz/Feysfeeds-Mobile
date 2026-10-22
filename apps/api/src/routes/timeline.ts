import { Hono } from "hono"

import { sanitizeFeedHtml } from "../lib/rss"
import type { AppEnv } from "../middleware/auth"
import { requireFeyFeedsUser } from "../middleware/auth"

type TimelineRow = {
  id: string
  feed_id: string
  feed_title: string | null
  feed_url: string
  title: string | null
  url: string | null
  content: string | null
  summary: string | null
  author: string | null
  published_at: number
  categories_json: string
  attachments_json: string
  is_read: number | null
  is_bookmarked: number | null
}

type TimelineCursor = {
  publishedAt: number
  id: string
}

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

const encodeCursor = (cursor: TimelineCursor): string =>
  btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const decodeCursor = (value: string | undefined): TimelineCursor | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (value.length > 512) {
    return undefined
  }

  // Support ISO date strings or numeric timestamp strings directly
  const asTime = Date.parse(value)
  if (!Number.isNaN(asTime) && asTime > 0 && (value.includes("-") || value.includes(":"))) {
    return {
      publishedAt: asTime,
      id: "rss_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }
  }

  const asNum = Number(value)
  if (Number.isSafeInteger(asNum) && asNum > 100_000_000_000) {
    return {
      publishedAt: asNum,
      id: "rss_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const parsed: unknown = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    )
    if (!parsed || typeof parsed !== "object") {
      return undefined
    }

    const cursor = parsed as Record<string, unknown>
    if (Number.isSafeInteger(cursor.publishedAt)) {
      const id =
        typeof cursor.id === "string" && /^rss_[a-f0-9]{64}$/.test(cursor.id)
          ? cursor.id
          : "rss_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
      return { publishedAt: Number(cursor.publishedAt), id }
    }
    return undefined
  } catch {
    return undefined
  }
}

export const timelineRoute = new Hono<AppEnv>()
  .use("*", requireFeyFeedsUser)
  .get("/", async (context) => {
    const rawLimit = context.req.query("limit")
    const limit = rawLimit === undefined ? DEFAULT_PAGE_SIZE : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      return context.json({ error: `limit must be between 1 and ${MAX_PAGE_SIZE}` }, 400)
    }

    const rawCursor = context.req.query("cursor")
    const cursor = decodeCursor(rawCursor)
    if (rawCursor !== undefined && !cursor) {
      return context.json({ error: "Invalid timeline cursor" }, 400)
    }

    const feedId = context.req.query("feedId")
    const user = context.get("user")
    const result = await context.env.DB.prepare(
      `SELECT e.id, e.feed_id, f.title AS feed_title, f.url AS feed_url,
              e.title, e.url, e.content, e.summary, e.author, e.published_at,
              e.categories_json, e.attachments_json,
              s.is_read, s.is_bookmarked
       FROM feed_entries e
       JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
       LEFT JOIN entry_states s ON s.user_id = e.user_id AND s.entry_id = e.id
       WHERE e.user_id = ?
         AND (? IS NULL OR e.feed_id = ? OR f.url = ?)
         AND (? IS NULL OR e.published_at < ? OR (e.published_at = ? AND e.id < ?))
       ORDER BY e.published_at DESC, e.id DESC
       LIMIT ?`,
    )
      .bind(
        user.id,
        feedId ?? null,
        feedId ?? null,
        feedId ?? null,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      )
      .all<TimelineRow>()

    const hasMore = result.results.length > limit
    const entries = result.results.slice(0, limit)
    const lastEntry = entries.at(-1)

    return context.json({
      data: entries.map((entry) => ({
        id: entry.id,
        feedId: entry.feed_id,
        feedTitle: entry.feed_title,
        feedUrl: entry.feed_url,
        title: entry.title,
        url: entry.url,
        content: sanitizeFeedHtml(entry.content, entry.feed_url),
        summary: sanitizeFeedHtml(entry.summary, entry.feed_url),
        author: entry.author,
        publishedAt: entry.published_at,
        categories: JSON.parse(entry.categories_json) as string[],
        attachments: JSON.parse(entry.attachments_json) as {
          url: string
          mimeType: string | null
          title: string | null
          sizeInBytes: number | null
        }[],
        isRead: entry.is_read === 1,
        isBookmarked: entry.is_bookmarked === 1,
      })),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && lastEntry
            ? encodeCursor({ publishedAt: lastEntry.published_at, id: lastEntry.id })
            : null,
      },
    })
  })
