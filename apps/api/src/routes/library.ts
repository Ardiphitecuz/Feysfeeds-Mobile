import type { Context } from "hono"
import { Hono } from "hono"

import type { AppEnv } from "../middleware/auth"
import { requireFeyFeedsUser } from "../middleware/auth"

const MAX_PAGE = 50
const validName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120
const validClientId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9_-]{16,64}$/i.test(value)
const objectBody = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))
const tokenHash = async (token: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

export const libraryRoute = new Hono<AppEnv>().use("*", requireFeyFeedsUser)

libraryRoute.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? ""
  if (!q || q.length > 100) return c.json({ error: "q must contain 1 to 100 characters" }, 400)
  const limit = Number(c.req.query("limit") ?? 20)
  const offset = Number(c.req.query("offset") ?? 0)
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    return c.json({ error: "Invalid pagination" }, 400)
  const user = c.get("user")
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`
  const [feeds, entries] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,url,title,created_at FROM feeds WHERE user_id=? AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\') ORDER BY COALESCE(title,url) COLLATE NOCASE,id LIMIT ? OFFSET ?",
    )
      .bind(user.id, pattern, pattern, limit + 1, offset)
      .all<{ id: string; url: string; title: string | null; created_at: number }>(),
    c.env.DB.prepare(
      "SELECT e.id,e.feed_id,f.title feed_title,f.url feed_url,e.title,e.url,e.published_at FROM feed_entries e JOIN feeds f ON f.id=e.feed_id AND f.user_id=e.user_id WHERE e.user_id=? AND (e.title LIKE ? ESCAPE '\\' OR e.url LIKE ? ESCAPE '\\') ORDER BY e.published_at DESC,e.id DESC LIMIT ? OFFSET ?",
    )
      .bind(user.id, pattern, pattern, limit + 1, offset)
      .all<{
        id: string
        feed_id: string
        feed_title: string | null
        feed_url: string
        title: string | null
        url: string | null
        published_at: number
      }>(),
  ])
  return c.json({
    data: {
      feeds: feeds.results.slice(0, limit),
      entries: entries.results.slice(0, limit),
      pagination: {
        offset,
        limit,
        feedsHasMore: feeds.results.length > limit,
        entriesHasMore: entries.results.length > limit,
        nextOffset: offset + limit,
      },
    },
  })
})

libraryRoute.get("/folders", async (c) => {
  const user = c.get("user")
  const rows = await c.env.DB.prepare(
    "SELECT id,name,position,created_at,updated_at FROM feed_folders WHERE user_id=? ORDER BY position,created_at,id",
  )
    .bind(user.id)
    .all()
  return c.json({ data: rows.results })
})
libraryRoute.post("/folders", async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  if (
    !objectBody(body) ||
    !validName(body.name) ||
    (body.id !== undefined && !validClientId(body.id))
  )
    return c.json({ error: "Invalid folder name" }, 400)
  const user = c.get("user"),
    now = Date.now(),
    id = typeof body.id === "string" ? body.id : crypto.randomUUID()
  await c.env.DB.prepare(
    "INSERT INTO feed_folders(id,user_id,name,position,created_at,updated_at) VALUES(?,?,?,COALESCE((SELECT MAX(position)+1 FROM feed_folders WHERE user_id=?),0),?,?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(id, user.id, body.name.trim(), user.id, now, now)
    .run()
  const owned = await c.env.DB.prepare(
    "SELECT id,name,position,created_at,updated_at FROM feed_folders WHERE id=? AND user_id=?",
  )
    .bind(id, user.id)
    .first()
  if (!owned) return c.json({ error: "Folder not found" }, 404)
  return c.json({ data: { ...owned, createdAt: now, updatedAt: now } }, 201)
})
libraryRoute.put("/folders/:id", async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  if (!objectBody(body) || !validName(body.name))
    return c.json({ error: "Invalid folder name" }, 400)
  const user = c.get("user"),
    r = await c.env.DB.prepare(
      "UPDATE feed_folders SET name=?,updated_at=? WHERE id=? AND user_id=?",
    )
      .bind(body.name.trim(), Date.now(), c.req.param("id"), user.id)
      .run()
  return (r.meta.changes ?? 0)
    ? c.json({ data: { success: true } })
    : c.json({ error: "Folder not found" }, 404)
})
libraryRoute.put("/folders/reorder", async (c) => reorder(c, "feed_folders"))
libraryRoute.delete("/folders/:id", async (c) => {
  const u = c.get("user"),
    r = await c.env.DB.prepare("DELETE FROM feed_folders WHERE id=? AND user_id=?")
      .bind(c.req.param("id"), u.id)
      .run()
  return (r.meta.changes ?? 0) ? c.body(null, 204) : c.json({ error: "Folder not found" }, 404)
})
libraryRoute.get("/folders/:id/feeds", async (c) => {
  const u = c.get("user"),
    rows = await c.env.DB.prepare(
      "SELECT f.id,f.url,f.title,f.created_at FROM feed_folder_members m JOIN feeds f ON f.id=m.feed_id AND f.user_id=m.user_id WHERE m.folder_id=? AND m.user_id=? ORDER BY m.position,f.id",
    )
      .bind(c.req.param("id"), u.id)
      .all()
  return c.json({ data: rows.results })
})
libraryRoute.post("/folders/:id/feeds", async (c) => {
  const b: unknown = await c.req.json().catch(() => null)
  if (!objectBody(b) || typeof b.feedId !== "string" || b.feedId.length > 128)
    return c.json({ error: "Invalid feedId" }, 400)
  const u = c.get("user"),
    now = Date.now()
  const r = await c.env.DB.prepare(
    "INSERT INTO feed_folder_members(folder_id,feed_id,user_id,position,created_at) SELECT ?,?, ?,COALESCE((SELECT MAX(position)+1 FROM feed_folder_members WHERE folder_id=? AND user_id=?),0),? WHERE EXISTS(SELECT 1 FROM feed_folders WHERE id=? AND user_id=?) AND EXISTS(SELECT 1 FROM feeds WHERE id=? AND user_id=?) ON CONFLICT(folder_id,feed_id) DO NOTHING",
  )
    .bind(
      c.req.param("id"),
      b.feedId,
      u.id,
      c.req.param("id"),
      u.id,
      now,
      c.req.param("id"),
      u.id,
      b.feedId,
      u.id,
    )
    .run()
  if (r.meta.changes ?? 0) return c.json({ data: { success: true } }, 201)
  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM feed_folder_members WHERE folder_id=? AND feed_id=? AND user_id=?",
  )
    .bind(c.req.param("id"), b.feedId, u.id)
    .first()
  return exists
    ? c.json({ data: { success: true } })
    : c.json({ error: "Folder or feed not found" }, 404)
})
libraryRoute.delete("/folders/:id/feeds/:feedId", async (c) => {
  const u = c.get("user"),
    r = await c.env.DB.prepare(
      "DELETE FROM feed_folder_members WHERE folder_id=? AND feed_id=? AND user_id=?",
    )
      .bind(c.req.param("id"), c.req.param("feedId"), u.id)
      .run()
  return (r.meta.changes ?? 0) ? c.body(null, 204) : c.json({ error: "Membership not found" }, 404)
})
libraryRoute.put("/folders/:id/feeds/reorder", async (c) =>
  reorderMembership(c, "feed_folder_members", "folder_id"),
)
libraryRoute.put("/folders/:id/feeds/:feedId/move", async (c) =>
  moveMembership(c, "feed_folder_members", "folder_id"),
)

libraryRoute.get("/lists", async (c) => {
  const u = c.get("user"),
    rows = await c.env.DB.prepare(
      "SELECT id,name,description,visibility,position,created_at,updated_at FROM user_lists WHERE user_id=? ORDER BY position,created_at,id",
    )
      .bind(u.id)
      .all()
  return c.json({ data: rows.results })
})
libraryRoute.post("/lists", async (c) => {
  const b: unknown = await c.req.json().catch(() => null)
  if (
    !objectBody(b) ||
    !validName(b.name) ||
    (b.id !== undefined && !validClientId(b.id)) ||
    (b.description !== undefined &&
      b.description !== null &&
      (typeof b.description !== "string" || b.description.length > 500))
  )
    return c.json({ error: "Invalid list" }, 400)
  const u = c.get("user"),
    now = Date.now(),
    id = typeof b.id === "string" ? b.id : crypto.randomUUID()
  await c.env.DB.prepare(
    "INSERT INTO user_lists(id,user_id,name,description,visibility,position,created_at,updated_at) VALUES(?,?,?,?, 'private',COALESCE((SELECT MAX(position)+1 FROM user_lists WHERE user_id=?),0),?,?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(id, u.id, b.name.trim(), b.description ?? null, u.id, now, now)
    .run()
  const owned = await c.env.DB.prepare(
    "SELECT id,name,description,visibility,position,created_at,updated_at FROM user_lists WHERE id=? AND user_id=?",
  )
    .bind(id, u.id)
    .first()
  if (!owned) return c.json({ error: "List not found" }, 404)
  return c.json({ data: { ...owned, createdAt: now, updatedAt: now } }, 201)
})
libraryRoute.put("/lists/reorder", async (c) => reorder(c, "user_lists"))
libraryRoute.put("/lists/:id", async (c) => {
  const b: unknown = await c.req.json().catch(() => null)
  if (
    !objectBody(b) ||
    ("name" in b && !validName(b.name)) ||
    ("description" in b &&
      b.description !== null &&
      (typeof b.description !== "string" || b.description.length > 500)) ||
    ("visibility" in b && b.visibility !== "private" && b.visibility !== "link")
  )
    return c.json({ error: "Invalid list" }, 400)
  const u = c.get("user"),
    id = c.req.param("id")
  const r = await c.env.DB.prepare(
    "UPDATE user_lists SET name=COALESCE(?,name),description=CASE WHEN ? THEN ? ELSE description END,visibility=COALESCE(?,visibility),updated_at=? WHERE id=? AND user_id=?",
  )
    .bind(
      b.name ?? null,
      "description" in b,
      b.description ?? null,
      b.visibility ?? null,
      Date.now(),
      id,
      u.id,
    )
    .run()
  return (r.meta.changes ?? 0)
    ? c.json({ data: { success: true } })
    : c.json({ error: "List not found" }, 404)
})
libraryRoute.delete("/lists/:id", async (c) => {
  const u = c.get("user"),
    r = await c.env.DB.prepare("DELETE FROM user_lists WHERE id=? AND user_id=?")
      .bind(c.req.param("id"), u.id)
      .run()
  return (r.meta.changes ?? 0) ? c.body(null, 204) : c.json({ error: "List not found" }, 404)
})
libraryRoute.get("/lists/:id", async (c) => {
  const u = c.get("user"),
    list = await c.env.DB.prepare(
      "SELECT id,name,description,visibility,position,created_at,updated_at FROM user_lists WHERE id=? AND user_id=?",
    )
      .bind(c.req.param("id"), u.id)
      .first()
  if (!list) return c.json({ error: "List not found" }, 404)
  const feeds = await c.env.DB.prepare(
    "SELECT f.id,f.url,f.title,m.position FROM user_list_feeds m JOIN feeds f ON f.id=m.feed_id AND f.user_id=m.user_id WHERE m.list_id=? AND m.user_id=? ORDER BY m.position,f.id",
  )
    .bind(c.req.param("id"), u.id)
    .all()
  return c.json({ data: { ...list, feeds: feeds.results } })
})
libraryRoute.post("/lists/:id/feeds", async (c) => {
  const b: unknown = await c.req.json().catch(() => null)
  if (!objectBody(b) || typeof b.feedId !== "string" || b.feedId.length > 128)
    return c.json({ error: "Invalid feedId" }, 400)
  const u = c.get("user"),
    id = c.req.param("id"),
    r = await c.env.DB.prepare(
      "INSERT INTO user_list_feeds(list_id,feed_id,user_id,position,created_at) SELECT ?,?, ?,COALESCE((SELECT MAX(position)+1 FROM user_list_feeds WHERE list_id=? AND user_id=?),0),? WHERE EXISTS(SELECT 1 FROM user_lists WHERE id=? AND user_id=?) AND EXISTS(SELECT 1 FROM feeds WHERE id=? AND user_id=?) ON CONFLICT(list_id,feed_id) DO NOTHING",
    )
      .bind(id, b.feedId, u.id, id, u.id, Date.now(), id, u.id, b.feedId, u.id)
      .run()
  if (r.meta.changes ?? 0) return c.json({ data: { success: true } }, 201)
  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM user_list_feeds WHERE list_id=? AND feed_id=? AND user_id=?",
  )
    .bind(id, b.feedId, u.id)
    .first()
  return exists
    ? c.json({ data: { success: true } })
    : c.json({ error: "List or feed not found" }, 404)
})
libraryRoute.delete("/lists/:id/feeds/:feedId", async (c) => {
  const u = c.get("user"),
    r = await c.env.DB.prepare(
      "DELETE FROM user_list_feeds WHERE list_id=? AND feed_id=? AND user_id=?",
    )
      .bind(c.req.param("id"), c.req.param("feedId"), u.id)
      .run()
  return (r.meta.changes ?? 0) ? c.body(null, 204) : c.json({ error: "Membership not found" }, 404)
})
libraryRoute.put("/lists/:id/feeds/reorder", async (c) =>
  reorderMembership(c, "user_list_feeds", "list_id"),
)
libraryRoute.put("/lists/:id/feeds/:feedId/move", async (c) =>
  moveMembership(c, "user_list_feeds", "list_id"),
)
libraryRoute.post("/lists/:id/share", async (c) => {
  const u = c.get("user"),
    id = c.req.param("id"),
    exists = await c.env.DB.prepare("SELECT id FROM user_lists WHERE id=? AND user_id=?")
      .bind(id, u.id)
      .first()
  if (!exists) return c.json({ error: "List not found" }, 404)
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    hash = await tokenHash(token),
    now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO list_share_tokens(id,list_id,user_id,token_hash,active,created_at) VALUES(?,?,?,?,1,?)",
    ).bind(crypto.randomUUID(), id, u.id, hash, now),
    c.env.DB.prepare(
      "UPDATE user_lists SET visibility='link',updated_at=? WHERE id=? AND user_id=?",
    ).bind(now, id, u.id),
  ])
  return c.json({ data: { token, visibility: "link" } }, 201)
})
libraryRoute.delete("/lists/:id/share", async (c) => {
  const u = c.get("user"),
    id = c.req.param("id")
  const now = Date.now()
  const active = await c.env.DB.prepare(
    "SELECT id FROM list_share_tokens WHERE list_id=? AND user_id=? AND active=1 LIMIT 1",
  )
    .bind(id, u.id)
    .first()
  if (!active) return c.json({ error: "Active share link not found" }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE list_share_tokens SET active=0,revoked_at=? WHERE list_id=? AND user_id=? AND active=1",
    ).bind(now, id, u.id),
    c.env.DB.prepare(
      "UPDATE user_lists SET visibility='private',updated_at=? WHERE id=? AND user_id=?",
    ).bind(now, id, u.id),
  ])
  return c.body(null, 204)
})

async function reorder(c: Context<AppEnv>, table: "feed_folders" | "user_lists") {
  const b: unknown = await c.req.json().catch(() => null)
  if (
    !objectBody(b) ||
    !Array.isArray(b.ids) ||
    b.ids.length > 500 ||
    b.ids.some((id) => typeof id !== "string" || id.length > 128) ||
    new Set(b.ids).size !== b.ids.length
  )
    return c.json({ error: "Invalid ordered ids" }, 400)
  const ids = b.ids as string[]
  const u = c.get("user")
  const existing = await c.env.DB.prepare(
    `SELECT id FROM ${table} WHERE user_id=? ORDER BY position,id`,
  )
    .bind(u.id)
    .all<{ id: string }>()
  if (
    existing.results.length !== ids.length ||
    existing.results.some((row) => !ids.includes(row.id))
  )
    return c.json({ error: "Ordered ids must contain every owned collection exactly once" }, 400)
  const stmts = ids.map((id, index) =>
    c.env.DB.prepare(`UPDATE ${table} SET position=?,updated_at=? WHERE id=? AND user_id=?`).bind(
      index,
      Date.now(),
      id,
      u.id,
    ),
  )
  if (stmts.length) await c.env.DB.batch(stmts)
  return c.json({ data: { success: true } })
}

async function reorderMembership(
  c: Context<AppEnv>,
  table: "feed_folder_members" | "user_list_feeds",
  parentColumn: "folder_id" | "list_id",
) {
  const body: unknown = await c.req.json().catch(() => null)
  if (
    !objectBody(body) ||
    !Array.isArray(body.feedIds) ||
    body.feedIds.length > 500 ||
    body.feedIds.some((id) => typeof id !== "string" || id.length > 128) ||
    new Set(body.feedIds).size !== body.feedIds.length
  )
    return c.json({ error: "Invalid ordered feed IDs" }, 400)
  const feedIds = body.feedIds as string[]
  const user = c.get("user")
  const existing = await c.env.DB.prepare(
    `SELECT feed_id FROM ${table} WHERE ${parentColumn}=? AND user_id=? ORDER BY position,feed_id`,
  )
    .bind(c.req.param("id"), user.id)
    .all<{ feed_id: string }>()
  if (
    existing.results.length !== feedIds.length ||
    existing.results.some((row) => !feedIds.includes(row.feed_id))
  )
    return c.json({ error: "Ordered feed IDs must contain every member exactly once" }, 400)
  const statements = feedIds.map((id, position) =>
    c.env.DB.prepare(
      `UPDATE ${table} SET position=? WHERE ${parentColumn}=? AND feed_id=? AND user_id=?`,
    ).bind(position, c.req.param("id"), id, user.id),
  )
  if (statements.length) await c.env.DB.batch(statements)
  return c.json({ data: { success: true } })
}

async function moveMembership(
  c: Context<AppEnv>,
  table: "feed_folder_members" | "user_list_feeds",
  parentColumn: "folder_id" | "list_id",
) {
  const body: unknown = await c.req.json().catch(() => null)
  if (
    !objectBody(body) ||
    typeof body.fromId !== "string" ||
    body.fromId.length > 128 ||
    body.fromId === c.req.param("id")
  )
    return c.json({ error: "Invalid source collection" }, 400)
  const user = c.get("user"),
    targetId = c.req.param("id"),
    feedId = c.req.param("feedId")
  const source = await c.env.DB.prepare(
    `SELECT 1 AS owned FROM ${table} m JOIN feeds f ON f.id=m.feed_id AND f.user_id=m.user_id WHERE m.${parentColumn}=? AND m.feed_id=? AND m.user_id=?`,
  )
    .bind(body.fromId, feedId, user.id)
    .first()
  const alreadyAtTarget = await c.env.DB.prepare(
    `SELECT 1 AS owned FROM ${table} WHERE ${parentColumn}=? AND feed_id=? AND user_id=?`,
  )
    .bind(targetId, feedId, user.id)
    .first()
  const target = await c.env.DB.prepare(
    `SELECT 1 AS owned FROM ${parentColumn === "folder_id" ? "feed_folders" : "user_lists"} WHERE id=? AND user_id=?`,
  )
    .bind(targetId, user.id)
    .first()
  if (!target || (!source && !alreadyAtTarget))
    return c.json({ error: "Collection or membership not found" }, 404)
  if (!source) return c.json({ data: { success: true } })
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM ${table} WHERE ${parentColumn}=? AND feed_id=? AND user_id=?`,
    ).bind(body.fromId, feedId, user.id),
    c.env.DB.prepare(
      `INSERT INTO ${table}(${parentColumn},feed_id,user_id,position,created_at) VALUES(?,?,?,COALESCE((SELECT MAX(position)+1 FROM ${table} WHERE ${parentColumn}=? AND user_id=?),0),?) ON CONFLICT(${parentColumn},feed_id) DO NOTHING`,
    ).bind(targetId, feedId, user.id, targetId, user.id, now),
  ])
  return c.json({ data: { success: true } })
}

export const publicListRoute = new Hono<{ Bindings: AppEnv["Bindings"] }>().get(
  "/:token",
  async (c) => {
    const token = c.req.param("token")
    if (!/^[a-f0-9]{64}$/.test(token)) return c.json({ error: "Not found" }, 404)
    const hash = await tokenHash(token),
      now = Date.now()
    const list = await c.env.DB.prepare(
      "SELECT l.id,l.name,l.description FROM list_share_tokens s JOIN user_lists l ON l.id=s.list_id AND l.user_id=s.user_id WHERE s.token_hash=? AND s.active=1 AND l.visibility='link'",
    )
      .bind(hash)
      .first<{ id: string; name: string; description: string | null }>()
    if (!list) return c.json({ error: "Not found" }, 404)
    const hit = await c.env.DB.prepare(
      "INSERT INTO public_share_limits(token_hash,window_started_at,request_count) VALUES(?,?,1) ON CONFLICT(token_hash) DO UPDATE SET request_count=CASE WHEN public_share_limits.window_started_at<? THEN 1 ELSE public_share_limits.request_count+1 END,window_started_at=CASE WHEN public_share_limits.window_started_at<? THEN excluded.window_started_at ELSE public_share_limits.window_started_at END RETURNING request_count",
    )
      .bind(hash, now, now - 60000, now - 60000)
      .first<{ request_count: number }>()
    if ((hit?.request_count ?? 0) > 60)
      return c.json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "60" })
    const feeds = await c.env.DB.prepare(
      "SELECT f.title,f.url FROM user_list_feeds m JOIN feeds f ON f.id=m.feed_id AND f.user_id=m.user_id WHERE m.list_id=? ORDER BY m.position,f.id",
    )
      .bind(list.id)
      .all<{ title: string | null; url: string }>()
    return c.json({
      data: { name: list.name, description: list.description, feeds: feeds.results },
    })
  },
)
