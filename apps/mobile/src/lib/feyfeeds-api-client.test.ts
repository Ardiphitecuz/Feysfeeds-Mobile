import { describe, expect, it, vi } from "vitest"

import { createFeyFeedsApiClient } from "./feyfeeds-api-client"

describe("FeyFeeds API client", () => {
  it("registers and stores the returned FeyFeeds session token", async () => {
    const setSessionToken = vi.fn(async () => undefined)
    const fetcher: typeof fetch = vi.fn(async () =>
      Response.json(
        {
          data: {
            user: { id: "user-1", email: "reader@example.com", name: null },
            token: "opaque-token",
            expiresAt: 123,
          },
        },
        { status: 201 },
      ),
    )
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com/",
      getSessionToken: async () => null,
      setSessionToken,
      fetcher,
    })

    await expect(client.register("reader@example.com", "secure-password")).resolves.toMatchObject({
      id: "user-1",
    })
    expect(setSessionToken).toHaveBeenCalledWith("opaque-token")
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/auth/register",
      expect.objectContaining({ method: "POST" }),
    )
    expect(new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(
      false,
    )
  })

  it("uses the stored FeyFeeds session for private requests", async () => {
    const fetcher: typeof fetch = vi.fn(async () => Response.json({ data: [] }))
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com",
      getSessionToken: async () => "feyfeeds-session",
      setSessionToken: async () => undefined,
      fetcher,
    })

    await client.listFeeds()
    expect(new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer feyfeeds-session",
    )
  })

  it("refuses private requests when no FeyFeeds session exists", async () => {
    const fetcher = vi.fn()
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com",
      getSessionToken: async () => null,
      setSessionToken: async () => undefined,
      fetcher,
    })

    await expect(client.listFeeds()).rejects.toMatchObject({ status: 401 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("clears the local token after logout", async () => {
    const setSessionToken = vi.fn(async () => undefined)
    const fetcher: typeof fetch = vi.fn(async () => Response.json({ data: { success: true } }))
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com",
      getSessionToken: async () => "token-to-revoke",
      setSessionToken,
      fetcher,
    })

    await client.logout()
    expect(setSessionToken).toHaveBeenCalledWith(null)
    expect(new Headers(vi.mocked(fetcher).mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer token-to-revoke",
    )
  })

  it("deletes the FeyFeeds account and clears its token only after success", async () => {
    const setSessionToken = vi.fn(async () => undefined)
    const fetcher: typeof fetch = vi.fn(async () => Response.json({ data: { deleted: true } }))
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com",
      getSessionToken: async () => "token",
      setSessionToken,
      fetcher,
    })
    await client.deleteAccount()
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/account",
      expect.objectContaining({ method: "DELETE" }),
    )
    expect(setSessionToken).toHaveBeenCalledWith(null)
  })

  it("surfaces API errors", async () => {
    const fetcher: typeof fetch = vi.fn(async () =>
      Response.json({ error: "Invalid email or password" }, { status: 401 }),
    )
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com",
      getSessionToken: async () => null,
      setSessionToken: async () => undefined,
      fetcher,
    })

    await expect(client.login("reader@example.com", "wrong-password")).rejects.toThrow(
      "Invalid email or password",
    )
  })

  it("does not retry a failed FeyFeeds request against the legacy Folo API", async () => {
    const fetcher: typeof fetch = vi.fn(async () =>
      Response.json({ error: "Unavailable" }, { status: 503 }),
    )
    const client = createFeyFeedsApiClient({
      baseUrl: "https://feyfeeds-api.feyfeeds.workers.dev",
      getSessionToken: async () => "token",
      setSessionToken: async () => undefined,
      fetcher,
    })

    await expect(client.listFeeds()).rejects.toMatchObject({ status: 503 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(
      "https://feyfeeds-api.feyfeeds.workers.dev/v1/feeds",
    )
  })

  it("rejects missing endpoint configuration instead of guessing a production URL", async () => {
    const missing = createFeyFeedsApiClient({
      baseUrl: "",
      getSessionToken: async () => "token",
      setSessionToken: async () => undefined,
      fetcher: vi.fn(),
    })
    await expect(missing.listFeeds()).rejects.toThrow("missing or malformed")
  })

  it("requires HTTPS when configured for a production build", async () => {
    const client = createFeyFeedsApiClient({
      baseUrl: "http://localhost:8787",
      requireHttps: true,
      getSessionToken: async () => "token",
      setSessionToken: async () => undefined,
      fetcher: vi.fn(),
    })
    await expect(client.listFeeds()).rejects.toThrow("Production FeyFeeds API URL must use HTTPS")
  })

  it("clears an expired session token after an unauthorized private request", async () => {
    const setSessionToken = vi.fn(async () => undefined)
    const client = createFeyFeedsApiClient({
      baseUrl: "https://api.example.com",
      getSessionToken: async () => "expired-token",
      setSessionToken,
      fetcher: vi.fn(async () =>
        Response.json({ error: "Authentication required" }, { status: 401 }),
      ),
    })

    await expect(client.getSession()).rejects.toThrow("Authentication required")
    expect(setSessionToken).toHaveBeenCalledWith(null)
  })
})
