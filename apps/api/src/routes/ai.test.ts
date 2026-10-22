import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Env } from "../env"
import { aiRoute } from "./ai"

vi.mock("../middleware/auth", () => ({
  requireFeyFeedsUser: async (
    context: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    context.set("user", { id: "user-a", email: null, name: null })
    await next()
  },
}))

const summaryCache = new Map<string, string>()
let articleOwned = true
let articleContent = "Article content"
let rateDenied = false
const database = {
  prepare: (sql: string) => {
    let values: unknown[] = []
    const statement = {
      bind: (...bound: unknown[]) => {
        values = bound
        return statement
      },
      first: async <T>() => {
        if (sql.includes("FROM feed_entries"))
          return (
            articleOwned ? { id: values[0], title: "Title", content: articleContent } : null
          ) as T | null
        if (sql.includes("FROM ai_summaries")) {
          const value = summaryCache.get(values.join(":"))
          return (value ? { summary: value } : null) as T | null
        }
        return null
      },
      run: async () => {
        if (sql.includes("INSERT INTO ai_summaries"))
          summaryCache.set(values.slice(0, 5).join(":"), String(values[5]))
        return { meta: { changes: rateDenied ? 0 : 1 } }
      },
    }
    return statement
  },
} as unknown as D1Database

const app = new Hono<{ Bindings: Env }>().route("/v1/ai", aiRoute)
const env = { DB: database, GEMINI_API_KEY: "test-secret", GEMINI_MODEL: "test-model" } as Env
const entryId = `rss_${"a".repeat(64)}`
const request = (body: unknown) =>
  app.request(
    "/v1/ai/summary",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  )

describe("article AI summaries", () => {
  beforeEach(() => {
    summaryCache.clear()
    articleOwned = true
    articleContent = "Article content"
    rateDenied = false
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ candidates: [{ content: { parts: [{ text: "A useful summary." }] } }] }),
      ),
    )
  })

  it("rejects an article that is not owned by the authenticated account", async () => {
    articleOwned = false
    const response = await request({ entryId, language: "en" })
    expect(response.status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("validates entry IDs and languages", async () => {
    expect((await request({ entryId: "wrong", language: "en" })).status).toBe(400)
    expect((await request({ entryId, language: "xx" })).status).toBe(400)
  })

  it("rejects article content above the configured size limit", async () => {
    articleContent = "x".repeat(40_001)
    const response = await request({ entryId, language: "en" })
    expect(response.status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns and reuses an account/language/model/prompt scoped cache", async () => {
    const first = await request({ entryId, language: "en" })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      data: { summary: "A useful summary.", cached: false },
    })
    const second = await request({ entryId, language: "en" })
    expect(await second.json()).toMatchObject({ data: { cached: true } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("returns a safe rate-limit error", async () => {
    rateDenied = true
    const response = await request({ entryId, language: "en" })
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("limit") })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("does not expose provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private provider detail", { status: 500 })),
    )
    const response = await request({ entryId, language: "en" })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain("private provider detail")
  })

  it("returns a safe error when the provider request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("provider secret detail")
      }),
    )
    const response = await request({ entryId, language: "en" })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain("provider secret detail")
  })
})
