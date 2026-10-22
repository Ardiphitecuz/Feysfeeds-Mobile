import { Hono } from "hono"

import type { AppEnv } from "../middleware/auth"
import { requireFeyFeedsUser } from "../middleware/auth"

const supportedLanguages = new Set(["en", "ja", "zh-CN"])
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key))

export const accountRoute = new Hono<AppEnv>()
  .use("*", requireFeyFeedsUser)
  .get("/profile", async (context) => {
    const user = context.get("user")
    const row = await context.env.DB.prepare(
      "SELECT id, email, name, created_at FROM users WHERE id = ?",
    ).bind(user.id).first<{ id: string; email: string; name: string | null; created_at: number }>()
    if (!row) return context.json({ error: "Account not found" }, 404)
    return context.json({ data: { id: row.id, email: row.email, name: row.name, createdAt: row.created_at } })
  })
  .put("/profile", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) return context.json({ error: "Expected a JSON object" }, 400)
    const payload = body as Record<string, unknown>
    if (!Object.keys(payload).length || !hasOnlyKeys(payload, ["name"])) return context.json({ error: "Provide supported profile fields" }, 400)
    if ("name" in payload && payload.name !== null && (typeof payload.name !== "string" || payload.name.trim().length > 80)) return context.json({ error: "Name must be a string of at most 80 characters" }, 400)
    const user = context.get("user")
    const assignments = ["name = ?"]
    const values = [typeof payload.name === "string" ? payload.name.trim() || null : null, user.id]
    await context.env.DB.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).bind(...values).run()
    return context.json({ data: { success: true } })
  })
  .get("/preferences", async (context) => {
    const user = context.get("user")
    const row = await context.env.DB.prepare("SELECT language, updated_at FROM user_preferences WHERE user_id = ?").bind(user.id).first<{ language: string; updated_at: number }>()
    return context.json({ data: { language: row?.language ?? "en", updatedAt: row?.updated_at ?? null } })
  })
  .put("/preferences", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) return context.json({ error: "Expected a JSON object" }, 400)
    const payload = body as Record<string, unknown>
    if (!Object.keys(payload).length || !hasOnlyKeys(payload, ["language"]) || typeof payload.language !== "string" || !supportedLanguages.has(payload.language)) return context.json({ error: "A supported language is required" }, 400)
    const user = context.get("user")
    await context.env.DB.prepare("INSERT INTO user_preferences (user_id, language, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at").bind(user.id, payload.language, Date.now()).run()
    return context.json({ data: { language: payload.language } })
  })
  .delete("/", async (context) => {
    const user = context.get("user")
    await context.env.DB.batch([
      context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      context.env.DB.prepare("DELETE FROM entry_states WHERE user_id = ?").bind(user.id),
      context.env.DB.prepare("DELETE FROM ai_summaries WHERE user_id = ?").bind(user.id),
      context.env.DB.prepare("DELETE FROM ai_summary_usage WHERE user_id = ?").bind(user.id),
      context.env.DB.prepare("DELETE FROM feeds WHERE user_id = ?").bind(user.id),
      context.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    ])
    return context.json({ data: { deleted: true } })
  })
