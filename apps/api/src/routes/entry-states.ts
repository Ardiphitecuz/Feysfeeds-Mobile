import { Hono } from "hono"

import type { AppEnv } from "../middleware/auth"
import { requireFeyFeedsUser } from "../middleware/auth"

type EntryStateRow = {
  entry_id: string
  is_read: number
  is_bookmarked: number
  updated_at: number
}

const MAX_PAGE_SIZE = 100

export const entryStatesRoute = new Hono<AppEnv>()
  .use("*", requireFeyFeedsUser)
  .get("/", async (context) => {
    const requestedLimit = Number(context.req.query("limit") ?? 100)
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE_SIZE) {
      return context.json({ error: `limit must be between 1 and ${MAX_PAGE_SIZE}` }, 400)
    }

    const filter = context.req.query("filter")
    if (filter && filter !== "read" && filter !== "bookmarked") {
      return context.json({ error: "filter must be read or bookmarked" }, 400)
    }

    const user = context.get("user")
    const result = await context.env.DB.prepare(
      `SELECT entry_id, is_read, is_bookmarked, updated_at
       FROM entry_states s
       JOIN feed_entries e ON e.id = s.entry_id AND e.user_id = s.user_id
       JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
       WHERE s.user_id = ?${filter === "read" ? " AND s.is_read = 1" : filter === "bookmarked" ? " AND s.is_bookmarked = 1" : ""}
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
      .bind(user.id, requestedLimit)
      .all<EntryStateRow>()

    return context.json({
      data: result.results.map((row) => ({
        entryId: row.entry_id,
        isRead: row.is_read === 1,
        isBookmarked: row.is_bookmarked === 1,
        updatedAt: row.updated_at,
      })),
    })
  })
  .put("/:entryId", async (context) => {
    const entryId = context.req.param("entryId")
    if (entryId.length === 0 || entryId.length > 512) {
      return context.json({ error: "Invalid entry ID" }, 400)
    }

    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Expected a JSON object" }, 400)
    }

    const payload = body as Record<string, unknown>
    const hasReadValue = Object.hasOwn(payload, "isRead")
    const hasBookmarkedValue = Object.hasOwn(payload, "isBookmarked")
    if (
      (!hasReadValue && !hasBookmarkedValue) ||
      (hasReadValue && typeof payload.isRead !== "boolean") ||
      (hasBookmarkedValue && typeof payload.isBookmarked !== "boolean")
    ) {
      return context.json({ error: "Provide at least one boolean entry state" }, 400)
    }

    const user = context.get("user")
    const updatedAt = Date.now()
    const result = await context.env.DB.prepare(
      `INSERT INTO entry_states (user_id, entry_id, is_read, is_bookmarked, updated_at)
       SELECT ?, e.id, COALESCE(?, 0), COALESCE(?, 0), ?
       FROM feed_entries e
       JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
       WHERE e.id = ? AND e.user_id = ?
       ON CONFLICT (user_id, entry_id) DO UPDATE SET
         is_read = CASE WHEN ? IS NOT NULL THEN excluded.is_read ELSE entry_states.is_read END,
         is_bookmarked = CASE WHEN ? IS NOT NULL THEN excluded.is_bookmarked ELSE entry_states.is_bookmarked END,
         updated_at = excluded.updated_at`,
    )
      .bind(
        user.id,
        hasReadValue ? Number(payload.isRead) : null,
        hasBookmarkedValue ? Number(payload.isBookmarked) : null,
        updatedAt,
        entryId,
        user.id,
        hasReadValue ? Number(payload.isRead) : null,
        hasBookmarkedValue ? Number(payload.isBookmarked) : null,
      )
      .run()

    if ((result.meta.changes ?? 0) === 0) {
      return context.json({ error: "Entry not found" }, 404)
    }

    return context.json({
      data: {
        entryId,
        ...(hasReadValue && { isRead: payload.isRead }),
        ...(hasBookmarkedValue && { isBookmarked: payload.isBookmarked }),
        updatedAt,
      },
    })
  })
