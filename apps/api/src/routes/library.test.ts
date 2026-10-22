import { beforeEach, describe, expect, it, vi } from "vitest"

import { app } from "../index"

vi.mock("../middleware/auth", async (load) => {
  const actual = await load<typeof import("../middleware/auth")>()
  return {
    ...actual,
    requireFeyFeedsUser: async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("user", { id: "owner-a", email: null, name: null })
      await next()
    },
  }
})

const statement = { bind: vi.fn(), all: vi.fn(), first: vi.fn(), run: vi.fn() }
const env = { DB: { prepare: vi.fn(), batch: vi.fn() } }

describe("library API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    statement.bind.mockReturnValue(statement)
    env.DB.prepare.mockReturnValue(statement)
  })

  it("validates private search input and scopes both result queries to session ownership", async () => {
    const invalid = await app.request(
      "/v1/library/search?q=",
      { headers: { authorization: "Bearer test" } },
      env,
    )
    expect(invalid.status).toBe(400)
    statement.all.mockResolvedValue({ results: [] })
    const response = await app.request(
      "/v1/library/search?q=hello&limit=10&offset=20",
      { headers: { authorization: "Bearer test" } },
      env,
    )
    expect(response.status).toBe(200)
    expect(env.DB.prepare).toHaveBeenCalledTimes(2)
    for (const [sql] of env.DB.prepare.mock.calls) expect(sql).toContain("user_id=?")
    expect(statement.bind).toHaveBeenCalledWith("owner-a", "%hello%", "%hello%", 11, 20)
  })

  it("does not resolve malformed public share tokens", async () => {
    const response = await app.request("/v1/public/lists/not-a-token", {}, env)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Not found" })
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })

  it("revokes owned list tokens and switches the list back to private in one D1 batch", async () => {
    statement.first.mockResolvedValue({ id: "token-id" })
    env.DB.batch.mockResolvedValue([])
    const response = await app.request(
      "/v1/library/lists/list-id/share",
      { method: "DELETE", headers: { authorization: "Bearer test" } },
      env,
    )
    expect(response.status).toBe(204)
    expect(statement.bind).toHaveBeenCalledWith("list-id", "owner-a")
    expect(env.DB.batch).toHaveBeenCalledTimes(1)
    const [statements] = env.DB.batch.mock.calls[0] as unknown as [{ sql: string }[]]
    expect(statements).toHaveLength(2)
  })

  it("redacts public share tokens from unexpected error logs", async () => {
    const token = "a".repeat(64)
    statement.first.mockRejectedValue(new Error(`failure for ${token}`))
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const response = await app.request(`/v1/public/lists/${token}`, {}, env)
    expect(response.status).toBe(500)
    expect(JSON.stringify(log.mock.calls)).not.toContain(token)
    log.mockRestore()
  })
})
