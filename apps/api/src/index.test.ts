import { beforeEach, describe, expect, it, vi } from "vitest"

import worker, { app } from "./index"

vi.mock("./middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./middleware/auth")>()
  return {
    ...actual,
    requireFeyFeedsUser: async (
      context: {
        req: { header: (name: string) => string | undefined }
        set: (key: string, value: unknown) => void
        json: (body: unknown, status: number) => Response
      },
      next: () => Promise<void>,
    ) => {
      if (!context.req.header("authorization"))
        return context.json({ error: "Authentication required" }, 401)
      context.set("user", { id: "feyfeeds-user-id", email: "reader@example.com", name: "Reader" })
      await next()
    },
  }
})

const env = {
  DB: {
    prepare: vi.fn(),
    batch: vi.fn(),
  },
}

const authorizedRequest = {
  headers: {
    authorization: "Bearer valid-feyfeeds-token",
  },
}

describe("FeyFeeds API", () => {
  beforeEach(() => {
    env.DB.prepare.mockReset()
    env.DB.batch.mockReset()
  })

  it("returns a public health response", async () => {
    const response = await app.request("/health", {}, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok" })
  })

  it("runs a bounded scheduled refresh selection", async () => {
    const statement = {
      bind: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    }
    statement.bind.mockReturnValue(statement)
    env.DB.prepare.mockReturnValueOnce(statement)

    await worker.scheduled({} as ScheduledController, env as never, {} as ExecutionContext)

    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("LIMIT ?"))
    expect(statement.bind.mock.calls[0]?.[1]).toBe(5)
  })

  it("allows a preflight request without an account session", async () => {
    const response = await app.request(
      "/v1/feeds",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "GET",
        },
      },
      env,
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("rejects protected requests without an account session", async () => {
    const response = await app.request("/v1/feeds", {}, env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" })
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })

  it("protects feed refresh, import, and timeline endpoints", async () => {
    const refreshResponse = await app.request("/v1/feeds/feed-id/refresh", { method: "POST" }, env)
    const timelineResponse = await app.request("/v1/timeline", {}, env)
    const importResponse = await app.request(
      "/v1/feeds/import",
      { ...authorizedRequest, headers: {} },
      env,
    )

    expect(refreshResponse.status).toBe(401)
    expect(timelineResponse.status).toBe(401)
    expect(importResponse.status).toBe(401)
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })

  it("scopes feed reads and deletes to the authenticated FeyFeeds user", async () => {
    const listStatement = {
      bind: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    }
    listStatement.bind.mockReturnValue(listStatement)
    env.DB.prepare.mockReturnValueOnce(listStatement)

    const listResponse = await app.request("/v1/feeds", authorizedRequest, env)

    expect(listResponse.status).toBe(200)
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("user_id = ?"))
    expect(listStatement.bind).toHaveBeenCalledWith("feyfeeds-user-id")

    const deleteStatement = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    }
    deleteStatement.bind.mockReturnValue(deleteStatement)
    env.DB.prepare.mockReturnValueOnce(deleteStatement)

    const deleteResponse = await app.request(
      "/v1/feeds/other-users-feed",
      { ...authorizedRequest, method: "DELETE" },
      env,
    )

    expect(deleteResponse.status).toBe(404)
    expect(env.DB.prepare).toHaveBeenCalledWith("DELETE FROM feeds WHERE id = ? AND user_id = ?")
    expect(deleteStatement.bind).toHaveBeenCalledWith("other-users-feed", "feyfeeds-user-id")
  })

  it("creates a feed under the authenticated FeyFeeds user", async () => {
    const statement = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }
    statement.bind.mockReturnValue(statement)
    env.DB.prepare.mockReturnValueOnce(statement)

    const response = await app.request(
      "/v1/feeds",
      {
        ...authorizedRequest,
        method: "POST",
        headers: { ...authorizedRequest.headers, "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/feed.xml" }),
      },
      env,
    )

    expect(response.status).toBe(201)
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO feeds"))
    expect(statement.bind.mock.calls[0]?.[1]).toBe("feyfeeds-user-id")
  })

  it("limits manual refresh volume per FeyFeeds user", async () => {
    const countStatement = {
      bind: vi.fn(),
      first: vi.fn().mockResolvedValue({ count: 20 }),
    }
    countStatement.bind.mockReturnValue(countStatement)
    env.DB.prepare.mockReturnValueOnce(countStatement)

    const response = await app.request(
      "/v1/feeds/feed-id/refresh",
      { ...authorizedRequest, method: "POST" },
      env,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("3600")
    expect(env.DB.prepare).toHaveBeenCalledTimes(1)
  })

  it("throttles repeated manual refresh for the same feed", async () => {
    const countStatement = {
      bind: vi.fn(),
      first: vi.fn().mockResolvedValue({ count: 0 }),
    }
    countStatement.bind.mockReturnValue(countStatement)
    const feedStatement = {
      bind: vi.fn(),
      first: vi.fn().mockResolvedValue({ id: "feed-id", url: "https://example.com/rss" }),
    }
    feedStatement.bind.mockReturnValue(feedStatement)
    const claimStatement = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    }
    claimStatement.bind.mockReturnValue(claimStatement)
    env.DB.prepare
      .mockReturnValueOnce(countStatement)
      .mockReturnValueOnce(feedStatement)
      .mockReturnValueOnce(claimStatement)

    const response = await app.request(
      "/v1/feeds/feed-id/refresh",
      { ...authorizedRequest, method: "POST" },
      env,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("900")
    expect(claimStatement.bind).toHaveBeenCalledWith(
      expect.any(Number),
      "feed-id",
      "feyfeeds-user-id",
      expect.any(Number),
    )
  })

  it("scopes entry-state updates and timeline reads to the authenticated FeyFeeds user", async () => {
    const updateStatement = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    }
    updateStatement.bind.mockReturnValue(updateStatement)
    env.DB.prepare.mockReturnValueOnce(updateStatement)

    const updateResponse = await app.request(
      "/v1/entry-states/entry-1",
      {
        ...authorizedRequest,
        method: "PUT",
        headers: {
          ...authorizedRequest.headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ isRead: true }),
      },
      env,
    )

    expect(updateResponse.status).toBe(200)
    expect(env.DB.prepare).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO entry_states"),
    )
    expect(env.DB.prepare.mock.calls[0]?.[0]).toContain("JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id")
    expect(env.DB.prepare.mock.calls[0]?.[0]).toContain("WHERE e.id = ? AND e.user_id = ?")
    expect(updateStatement.bind).toHaveBeenCalledWith(
      "feyfeeds-user-id", 1, null, expect.any(Number), "entry-1", "feyfeeds-user-id", 1, null,
    )

    const timelineStatement = {
      bind: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    }
    timelineStatement.bind.mockReturnValue(timelineStatement)
    env.DB.prepare.mockReturnValueOnce(timelineStatement)

    const timelineResponse = await app.request("/v1/timeline", authorizedRequest, env)

    expect(timelineResponse.status).toBe(200)
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("e.user_id = ?"))
    expect(timelineStatement.bind.mock.calls[0]?.[0]).toBe("feyfeeds-user-id")
  })

  it("rejects entry-state updates for entries not owned by the authenticated user", async () => {
    const updateStatement = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    }
    updateStatement.bind.mockReturnValue(updateStatement)
    env.DB.prepare.mockReturnValueOnce(updateStatement)

    const response = await app.request(
      "/v1/entry-states/other-users-entry",
      {
        ...authorizedRequest,
        method: "PUT",
        headers: {
          ...authorizedRequest.headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ isRead: true }),
      },
      env,
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Entry not found" })
    expect(updateStatement.bind).toHaveBeenCalledWith(
      "feyfeeds-user-id", 1, null, expect.any(Number), "other-users-entry", "feyfeeds-user-id", 1, null,
    )
    expect(env.DB.prepare).toHaveBeenCalledTimes(1)
  })

  it("lists only owned entry states while preserving state filters and limits", async () => {
    const listStatement = {
      bind: vi.fn(),
      all: vi.fn().mockResolvedValue({
        results: [{ entry_id: "owned-entry", is_read: 1, is_bookmarked: 0, updated_at: 10 }],
      }),
    }
    listStatement.bind.mockReturnValue(listStatement)
    env.DB.prepare.mockReturnValueOnce(listStatement)

    const response = await app.request(
      "/v1/entry-states?filter=read&limit=1",
      authorizedRequest,
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [{ entryId: "owned-entry", isRead: true, isBookmarked: false, updatedAt: 10 }],
    })
    const query = env.DB.prepare.mock.calls[0]?.[0] as string
    expect(query).toContain("JOIN feed_entries e ON e.id = s.entry_id AND e.user_id = s.user_id")
    expect(query).toContain("JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id")
    expect(query).toContain("s.is_read = 1")
    expect(query).toContain("LIMIT ?")
    expect(listStatement.bind).toHaveBeenCalledWith("feyfeeds-user-id", 1)
  })

  it("imports only public OPML feeds and scopes each record to the FeyFeeds user", async () => {
    const statement = {
      bind: vi.fn(),
    }
    statement.bind.mockReturnValue(statement)
    env.DB.prepare.mockReturnValue(statement)
    env.DB.batch.mockResolvedValue([{ meta: { changes: 1 } }])

    const response = await app.request(
      "/v1/feeds/import",
      {
        ...authorizedRequest,
        method: "POST",
        headers: {
          ...authorizedRequest.headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          opml: `<?xml version="1.0"?>
            <opml version="2.0"><body>
              <outline text="News">
                <outline text="Example" xmlUrl="https://example.com/feed.xml" />
              </outline>
              <outline text="Private" xmlUrl="http://127.0.0.1/private.xml" />
            </body></opml>`,
        }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { imported: 1, skipped: 1 } })
    expect(statement.bind).toHaveBeenCalledWith(
      expect.any(String),
      "feyfeeds-user-id",
      "https://example.com/feed.xml",
      "Example",
      expect.any(Number),
    )
    expect(env.DB.batch).toHaveBeenCalledWith([statement])
  })

  it("rejects malformed OPML before writing any feed", async () => {
    const response = await app.request(
      "/v1/feeds/import",
      {
        ...authorizedRequest,
        method: "POST",
        headers: {
          ...authorizedRequest.headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ opml: "<not-opml>" }),
      },
      env,
    )

    expect(response.status).toBe(400)
    expect(env.DB.prepare).not.toHaveBeenCalled()
    expect(env.DB.batch).not.toHaveBeenCalled()
  })

  it("rejects unknown routes", async () => {
    const response = await app.request("/not-a-route", {}, env)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Not found" })
  })
})
