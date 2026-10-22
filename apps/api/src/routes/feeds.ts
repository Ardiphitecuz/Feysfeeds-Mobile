import { Hono } from "hono"

import { discoverWebsiteFeeds, resolveRssHubUrl } from "../lib/feed-discovery"
import { parseOpmlFeeds } from "../lib/opml"
import { refreshFeed } from "../lib/refresh-feed"
import { FeedFetchError } from "../lib/rss"
import { isPublicHttpUrl } from "../lib/url-security"
import type { AppEnv } from "../middleware/auth"
import { requireFeyFeedsUser } from "../middleware/auth"

type FeedRow = {
  id: string
  url: string
  title: string | null
  created_at: number
  last_fetched_at: number | null
  last_attempt_at: number | null
  last_error: string | null
}

export const feedsRoute = new Hono<AppEnv>()
  .use("*", requireFeyFeedsUser)
  .post("/discover", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    const url =
      body && typeof body === "object" && !Array.isArray(body) ? Reflect.get(body, "url") : null
    if (typeof url !== "string" || url.length > 2048) {
      return context.json({ error: "A public website URL is required" }, 400)
    }
    try {
      const data = await discoverWebsiteFeeds(url)
      return context.json({ data })
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "Could not inspect this website" },
        400,
      )
    }
  })
  .get("/", async (context) => {
    const user = context.get("user")
    const result = await context.env.DB.prepare(
      "SELECT id, url, title, created_at, last_fetched_at, last_error FROM feeds WHERE user_id = ? ORDER BY created_at DESC",
    )
      .bind(user.id)
      .all<FeedRow>()

    return context.json({
      data: result.results.map((feed) => ({
        id: feed.id,
        url: feed.url,
        title: feed.title,
        createdAt: feed.created_at,
        lastFetchedAt: feed.last_fetched_at,
        lastError: feed.last_error,
      })),
    })
  })
  .post("/import", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Expected a JSON object" }, 400)
    }

    const opml = Reflect.get(body, "opml")
    if (typeof opml !== "string") {
      return context.json({ error: "Expected OPML XML in the opml field" }, 400)
    }

    let feeds
    try {
      feeds = parseOpmlFeeds(opml)
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "Invalid OPML document" },
        400,
      )
    }

    const user = context.get("user")
    const createdAt = Date.now()
    const validFeeds = feeds.filter(
      (feed) => isPublicHttpUrl(feed.url) && (feed.title === null || feed.title.length <= 256),
    )
    const statements = validFeeds.map((feed) =>
      context.env.DB.prepare(
        "INSERT OR IGNORE INTO feeds (id, user_id, url, title, created_at, last_fetched_at, last_error) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
      ).bind(crypto.randomUUID(), user.id, feed.url, feed.title, createdAt),
    )

    let imported = 0
    for (let offset = 0; offset < statements.length; offset += 40) {
      const result = await context.env.DB.batch(statements.slice(offset, offset + 40))
      imported += result.reduce((total, item) => total + (item.meta.changes ?? 0), 0)
    }

    return context.json({
      data: {
        imported,
        skipped: feeds.length - imported,
      },
    })
  })
  .post("/", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Expected a JSON object" }, 400)
    }

    const payload = body as Record<string, unknown>
    const submittedUrl = typeof payload.url === "string" ? payload.url.trim() : ""
    let url: string
    try {
      url = resolveRssHubUrl(submittedUrl, context.env.RSSHUB_BASE_URL) ?? submittedUrl
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "Invalid feed URL" },
        400,
      )
    }
    if (!isPublicHttpUrl(url)) {
      return context.json({ error: "A public HTTP or HTTPS feed URL is required" }, 400)
    }

    const title =
      payload.title == null
        ? null
        : typeof payload.title === "string" && payload.title.trim().length <= 256
          ? payload.title.trim()
          : undefined
    if (title === undefined) {
      return context.json({ error: "Feed titles must be at most 256 characters" }, 400)
    }

    const user = context.get("user")
    const feed = {
      id: crypto.randomUUID(),
      url,
      title,
      createdAt: Date.now(),
      lastFetchedAt: null,
      lastError: null,
    }

    try {
      await context.env.DB.prepare(
        "INSERT INTO feeds (id, user_id, url, title, created_at, last_fetched_at, last_error) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
      )
        .bind(feed.id, user.id, feed.url, feed.title, feed.createdAt)
        .run()
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ""
      if (message.includes("unique constraint")) {
        return context.json({ error: "This feed is already followed" }, 409)
      }

      throw error
    }

    // Refresh immediately so initial entries are populated in feed_entries
    try {
      await refreshFeed(context.env.DB, { ...feed, userId: user.id })
    } catch {
      // Don't fail feed creation if initial fetch fails
    }

    return context.json({ data: feed }, 201)
  })
  .post("/:feedId/refresh", async (context) => {
    const feedId = context.req.param("feedId")
    if (feedId.length === 0 || feedId.length > 128) {
      return context.json({ error: "Invalid feed ID" }, 400)
    }

    const user = context.get("user")
    const now = Date.now()
    const feedRefreshCutoff = now - 15 * 60 * 1000
    const userRefreshCutoff = now - 60 * 60 * 1000
    const recentRefreshes = await context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM feeds WHERE user_id = ? AND last_attempt_at > ?",
    )
      .bind(user.id, userRefreshCutoff)
      .first<{ count: number }>()
    if ((recentRefreshes?.count ?? 0) >= 20) {
      return context.json({ error: "Refresh limit reached. Try again later." }, 429, {
        "Retry-After": "3600",
      })
    }

    const feed = await context.env.DB.prepare(
      "SELECT id, url, last_attempt_at, last_fetched_at FROM feeds WHERE id = ? AND user_id = ?",
    )
      .bind(feedId, user.id)
      .first<{ id: string; url: string; last_attempt_at: number | null; last_fetched_at: number | null }>()

    if (!feed) {
      return context.json({ error: "Feed not found" }, 404)
    }

    // Never lock out feeds that have never been fetched (last_fetched_at IS NULL)
    const claim = await context.env.DB.prepare(
      `UPDATE feeds SET last_attempt_at = ? WHERE id = ? AND user_id = ?
       AND (last_fetched_at IS NULL OR COALESCE(last_attempt_at, last_fetched_at, 0) < ?)`,
    )
      .bind(now, feed.id, user.id, feedRefreshCutoff)
      .run()
    if ((claim.meta.changes ?? 0) === 0) {
      return context.json({ error: "This feed was refreshed recently. Try again later." }, 429, {
        "Retry-After": "900",
      })
    }

    try {
      const result = await refreshFeed(context.env.DB, { ...feed, userId: user.id })
      return context.json({ data: { feedId: feed.id, ...result } })
    } catch (error) {
      if (!(error instanceof FeedFetchError)) {
        throw error
      }
      return context.json({ error: error.message }, error.status)
    }
  })
  .delete("/:feedId", async (context) => {
    const feedId = context.req.param("feedId")
    if (feedId.length === 0 || feedId.length > 128) {
      return context.json({ error: "Invalid feed ID" }, 400)
    }

    const user = context.get("user")
    const result = await context.env.DB.prepare("DELETE FROM feeds WHERE id = ? AND user_id = ?")
      .bind(feedId, user.id)
      .run()

    if ((result.meta.changes ?? 0) === 0) {
      return context.json({ error: "Feed not found" }, 404)
    }

    return context.body(null, 204)
  })
