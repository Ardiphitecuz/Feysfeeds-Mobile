import type { Context } from "hono"
import { Hono } from "hono"
import { cors } from "hono/cors"

import type { Env, ScheduledFeed } from "./env"
import { refreshFeed } from "./lib/refresh-feed"
import { FeedFetchError } from "./lib/rss"
import { requireFeyFeedsUser } from "./middleware/auth"
import { accountRoute } from "./routes/account"
import { aiRoute } from "./routes/ai"
import { authRoute } from "./routes/auth"
import { entryStatesRoute } from "./routes/entry-states"
import { feedsRoute } from "./routes/feeds"
import { libraryRoute, publicListRoute } from "./routes/library"
import { timelineRoute } from "./routes/timeline"

const app = new Hono<{ Bindings: Env }>()

app.use(
  "*",
  cors({
    origin: (origin: string, context: Context<{ Bindings: Env }>) => {
      const configuredOrigins = context.env.ALLOWED_ORIGINS
      if (!configuredOrigins) {
        return "*"
      }

      const allowlist = configuredOrigins
        .split(",")
        .map((value: string) => value.trim())
        .filter(Boolean)

      return origin && allowlist.includes(origin) ? origin : "null"
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
)

app.get("/health", (context) => context.json({ status: "ok" }))
app.route("/v1/auth", authRoute)
app.route("/v1/account", accountRoute)
app.get("/v1/me", requireFeyFeedsUser, (context) => {
  const user = context.get("user")
  return context.json({ data: user })
})
app.route("/v1/feeds", feedsRoute)
app.route("/v1/library", libraryRoute)
app.route("/v1/public/lists", publicListRoute)
app.route("/v1/entry-states", entryStatesRoute)
app.route("/v1/timeline", timelineRoute)
app.route("/v1/ai", aiRoute)
app.notFound((context) => context.json({ error: "Not found" }, 404))

app.onError((_error, context) => {
  // Do not serialize error objects: database/runtime errors may contain bound values.
  const path = context.req.path.startsWith("/v1/public/lists/")
    ? "/v1/public/lists/:token"
    : context.req.path
  console.error("[api] Request failed", { path, method: context.req.method })
  return context.json({ error: "Internal server error" }, 500)
})

const REFRESH_BATCH_SIZE = 5
const REFRESH_INTERVAL_MS = 15 * 60 * 1000

export { app }

const worker = {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _context: ExecutionContext) {
    const cutoff = Date.now() - REFRESH_INTERVAL_MS
    const feeds = await env.DB.prepare(
      `SELECT id, user_id, url FROM feeds
       WHERE COALESCE(last_attempt_at, last_fetched_at, 0) < ?
       ORDER BY COALESCE(last_attempt_at, last_fetched_at, 0) ASC, created_at ASC
       LIMIT ?`,
    )
      .bind(cutoff, REFRESH_BATCH_SIZE)
      .all<ScheduledFeed>()

    for (const feed of feeds.results) {
      const claimedAt = Date.now()
      const claim = await env.DB.prepare(
        `UPDATE feeds SET last_attempt_at = ? WHERE id = ? AND user_id = ?
         AND COALESCE(last_attempt_at, last_fetched_at, 0) < ?`,
      )
        .bind(claimedAt, feed.id, feed.user_id, cutoff)
        .run()
      if ((claim.meta.changes ?? 0) === 0) continue

      try {
        await refreshFeed(env.DB, { id: feed.id, userId: feed.user_id, url: feed.url })
      } catch (error) {
        if (!(error instanceof FeedFetchError)) throw error
        console.warn("[scheduler] Feed refresh failed", { feedId: feed.id, status: error.status })
      }
    }
  },
}

export default worker
