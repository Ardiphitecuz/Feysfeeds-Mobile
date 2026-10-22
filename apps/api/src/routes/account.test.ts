import { Hono } from "hono"
import { describe, expect, it } from "vitest"

import type { Env } from "../env"
import { accountRoute } from "./account"

const createApp = () => {
  const writes: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    prepare(sql: string) {
      const values: unknown[] = []
      return {
        sql,
        bind(...bound: unknown[]) { values.push(...bound); return this },
        async first() {
          if (sql.includes("JOIN users")) return { id: "owner", email: "owner@example.com", name: "Owner" }
          if (sql.includes("SELECT id, email, name, created_at")) return { id: "owner", email: "owner@example.com", name: "Owner", created_at: 1 }
          if (sql.includes("SELECT language")) return { language: "ja", updated_at: 2 }
          return null
        },
        async run() { writes.push({ sql, values }); return { meta: { changes: 1 } } },
      }
    },
    async batch(statements: Array<{ sql?: string }>) {
      writes.push(...statements.map((statement) => ({ sql: statement.sql ?? "", values: [] })))
      return []
    },
  } as unknown as D1Database
  const app = new Hono<{ Bindings: Env }>().route("/v1/account", accountRoute)
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, { DB: db })
  return { request, writes }
}

const auth = { authorization: "Bearer test-session", "content-type": "application/json" }

describe("FeyFeeds account profile and preferences", () => {
  it("returns the authenticated user's profile and preferences", async () => {
    const { request } = createApp()
    const profile = await request("/v1/account/profile", { headers: auth })
    expect(await profile.json()).toMatchObject({ data: { id: "owner", name: "Owner" } })
    const preferences = await request("/v1/account/preferences", { headers: auth })
    expect(await preferences.json()).toMatchObject({ data: { language: "ja" } })
  })

  it("rejects missing sessions and unsupported, empty, malformed, or out-of-range profile/preferences", async () => {
    const { request } = createApp()
    expect((await request("/v1/account/profile")).status).toBe(401)
    for (const body of [{}, { userId: "other", name: "x" }, { name: 4 }, { name: "n".repeat(81) }]) {
      expect((await request("/v1/account/profile", { method: "PUT", headers: auth, body: JSON.stringify(body) })).status).toBe(400)
    }
    for (const body of [{}, { userId: "other", language: "en" }, { language: 1 }, { language: "fr" }]) {
      expect((await request("/v1/account/preferences", { method: "PUT", headers: auth, body: JSON.stringify(body) })).status).toBe(400)
    }
  })

  it("writes only the session user's profile/preferences and deletes all owned data in one batch", async () => {
    const { request, writes } = createApp()
    expect((await request("/v1/account/profile", { method: "PUT", headers: auth, body: JSON.stringify({ name: "New name" }) })).status).toBe(200)
    expect(writes[0]).toMatchObject({ values: ["New name", "owner"] })
    await request("/v1/account/preferences", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en" }) })
    expect(writes[1]?.values).toEqual(["owner", "en", expect.any(Number)])
    expect((await request("/v1/account", { method: "DELETE", headers: auth })).status).toBe(200)
    expect(writes.slice(2).map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining("DELETE FROM sessions"),
      expect.stringContaining("DELETE FROM entry_states"),
      expect.stringContaining("DELETE FROM ai_summaries"),
      expect.stringContaining("DELETE FROM feeds"),
      expect.stringContaining("DELETE FROM users"),
    ]))
  })
})
