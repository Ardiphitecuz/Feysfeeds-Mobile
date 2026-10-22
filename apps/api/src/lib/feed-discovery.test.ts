import { describe, expect, it, vi } from "vitest"

import { discoverWebsiteFeeds, resolveRssHubUrl } from "./feed-discovery"

describe("discoverWebsiteFeeds", () => {
  it("finds RSS, Atom and JSON Feed alternate links, resolving relative URLs", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `<html><head>
      <link rel="alternate" type="application/rss+xml" title="News" href="/rss.xml">
      <link href="atom.xml" title="Atom" type="application/atom+xml" rel="alternate">
      <link rel="alternate" type="application/feed+json" href="https://feeds.example.org/feed.json">
      <link rel="alternate" type="text/html" href="/page">
    </head></html>`,
          { headers: { "content-type": "text/html" } },
        ),
    )
    await expect(discoverWebsiteFeeds("https://example.com/news", fetcher)).resolves.toEqual([
      { url: "https://example.com/rss.xml", title: "News", type: "rss" },
      { url: "https://example.com/atom.xml", title: "Atom", type: "atom" },
      { url: "https://feeds.example.org/feed.json", title: null, type: "json" },
    ])
  })

  it("validates every redirect and refuses private destinations", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }),
    )
    await expect(discoverWebsiteFeeds("https://example.com", fetcher)).rejects.toThrow(
      "disallowed URL",
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe("resolveRssHubUrl", () => {
  it("resolves a route at the configured self-hosted origin", () => {
    expect(
      resolveRssHubUrl("rsshub://github/trending/daily", "https://feeds.example.org/rsshub"),
    ).toBe("https://feeds.example.org/rsshub/github/trending/daily")
  })

  it("does not fall back to public RSSHub and rejects traversal", () => {
    expect(() => resolveRssHubUrl("rsshub://github/user", undefined)).toThrow("not configured")
    expect(() => resolveRssHubUrl("rsshub://../admin", "https://feeds.example.org")).toThrow(
      "Invalid RSSHub route",
    )
    expect(() => resolveRssHubUrl("rsshub://github/user", "http://localhost:3000")).toThrow(
      "not configured",
    )
  })

  it.each([
    "rsshub://",
    "rsshub://../admin",
    "rsshub://%2e%2e/admin",
    "rsshub://https://attacker.example/feed",
    "rsshub://github/user?next=https://attacker.example",
    "rsshub://github/\u0000user",
    "rsshub://github//user",
  ])("rejects unsafe route %s", (route) => {
    expect(() => resolveRssHubUrl(route, "https://feeds.example.org/rsshub")).toThrow(
      "Invalid RSSHub route",
    )
  })

  it("keeps the configured base path and accepts ordinary route characters", () => {
    expect(resolveRssHubUrl("rsshub://github/user/name", "https://feeds.example.org/rsshub/")).toBe(
      "https://feeds.example.org/rsshub/github/user/name",
    )
  })
})
