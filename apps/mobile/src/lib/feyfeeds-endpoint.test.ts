import { describe, expect, it } from "vitest"

import { requireFeyFeedsApiUrl } from "./feyfeeds-endpoint"

describe("FeyFeeds API endpoint configuration", () => {
  it("requires an explicit profile URL without falling back to another service", () => {
    expect(() => requireFeyFeedsApiUrl(undefined, false)).toThrow("profile-specific")
  })

  it("accepts HTTP for local development and trims a trailing slash", () => {
    expect(requireFeyFeedsApiUrl("http://127.0.0.1:8787/", false)).toBe("http://127.0.0.1:8787")
  })

  it("rejects malformed URLs and non-HTTP schemes", () => {
    expect(() => requireFeyFeedsApiUrl("not a URL", false)).toThrow("valid HTTP or HTTPS")
    expect(() => requireFeyFeedsApiUrl("file:///tmp/api", false)).toThrow("valid HTTP or HTTPS")
  })

  it("requires HTTPS for production", () => {
    expect(() => requireFeyFeedsApiUrl("http://api.example", true)).toThrow("must use HTTPS")
    expect(requireFeyFeedsApiUrl("https://api.example", true)).toBe("https://api.example")
  })
})
