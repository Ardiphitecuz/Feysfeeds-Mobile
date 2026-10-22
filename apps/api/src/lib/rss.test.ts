import { afterEach, describe, expect, it, vi } from "vitest"

import {
  FeedFetchError,
  fetchAndParseFeed,
  hashFeedEntryId,
  parseJsonFeed,
  parseRssFeed,
} from "./rss"
import { isPublicHttpUrl } from "./url-security"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("isPublicHttpUrl", () => {
  it.each([
    "http://localhost/feed.xml",
    "http://127.0.0.1/feed.xml",
    "http://10.0.0.2/feed.xml",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/feed.xml",
    "http://100.64.0.1/feed.xml",
    "http://example.com:8080/feed.xml",
    "file:///etc/passwd",
    "https://user:password@example.com/feed.xml",
  ])("rejects unsafe URL %s", (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })

  it.each(["https://example.com/feed.xml", "http://feeds.example.org/rss"])(
    "accepts public HTTP feed URL %s",
    (url) => {
      expect(isPublicHttpUrl(url)).toBe(true)
    },
  )
})

describe("parseRssFeed", () => {
  it("parses RSS items and resolves relative links", () => {
    const entries = parseRssFeed(
      `<?xml version="1.0"?>
       <rss version="2.0"><channel><item>
         <guid>story-1</guid><title>Example story</title>
         <link>/stories/1</link><description>&lt;p&gt;Summary&lt;/p&gt;</description>
         <pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate>
       </item></channel></rss>`,
      "https://example.com/feed.xml",
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      guid: "story-1",
      title: "Example story",
      url: "https://example.com/stories/1",
      summary: "<p>Summary</p>",
      content: "<p>Summary</p>",
      publishedAt: Date.parse("Mon, 19 Oct 2026 00:00:00 GMT"),
    })
  })

  it("parses Atom entries and ignores non-public article links", () => {
    const entries = parseRssFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom">
         <entry><id>tag:example.com,2026:one</id><title>Atom story</title>
           <link href="http://127.0.0.1/private" rel="alternate"/>
           <updated>2026-10-19T00:00:00Z</updated><summary>Atom summary</summary>
         </entry>
       </feed>`,
      "https://example.com/atom.xml",
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      guid: "tag:example.com,2026:one",
      title: "Atom story",
      url: null,
      summary: "Atom summary",
    })
  })

  it("rejects XML that is not a supported feed", () => {
    expect(() => parseRssFeed("<html></html>", "https://example.com/")).toThrow(
      "does not contain a supported",
    )
  })

  it("parses namespace content, categories, authors and safe enclosures", () => {
    const [entry] = parseRssFeed(
      `<rss><channel><item><guid>ns-1</guid><content:encoded>&lt;b&gt;Full&lt;/b&gt;</content:encoded><dc:creator>Ada</dc:creator><category>News</category><enclosure url="/audio.mp3" type="audio/mpeg" length="123"/></item></channel></rss>`,
      "https://example.com/feed",
    )
    expect(entry).toMatchObject({
      content: "<b>Full</b>",
      author: "Ada",
      categories: ["News"],
      attachments: [
        { url: "https://example.com/audio.mp3", mimeType: "audio/mpeg", sizeInBytes: 123 },
      ],
    })
  })

  it("sanitizes untrusted HTML and resolves only public content URLs", () => {
    const [entry] = parseRssFeed(
      `<rss><channel><item><guid>x</guid><description>&lt;script&gt;alert(1)&lt;/script&gt;&lt;a href="javascript:alert(1)" onclick="run()"&gt;story&lt;/a&gt;&lt;img src="/cover.png" onerror="run()"&gt;</description></item></channel></rss>`,
      "https://example.com/feed.xml",
    )
    expect(entry?.content).not.toContain("<script")
    expect(entry?.content).not.toContain("onclick")
    expect(entry?.content).not.toContain("javascript:")
    expect(entry?.content).toContain('src="https://example.com/cover.png"')
  })

  it.each(["1", "1.1"])("parses JSON Feed %s with deduplication and optional fields", (version) => {
    const entries = parseJsonFeed(
      JSON.stringify({
        version: `https://jsonfeed.org/version/${version}`,
        items: [
          {
            id: "stable-id",
            url: "/article",
            title: "Story",
            authors: [{ name: "Ada" }],
            tags: ["news"],
            date_published: "2026-10-19T00:00:00Z",
            attachments: [{ url: "/media.mp3", mime_type: "audio/mpeg", size_in_bytes: 10 }],
          },
          { id: "stable-id" },
        ],
      }),
      "https://example.com/feed.json",
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      guid: "stable-id",
      url: "https://example.com/article",
      author: "Ada",
      categories: ["news"],
      publishedAt: Date.parse("2026-10-19T00:00:00Z"),
      attachments: [{ url: "https://example.com/media.mp3", sizeInBytes: 10 }],
    })
  })

  it("rejects malformed XML and JSON and handles empty feeds", () => {
    expect(() => parseRssFeed("<rss><channel><item>", "https://example.com/feed")).toThrow(
      "invalid XML",
    )
    expect(() => parseJsonFeed("{", "https://example.com/feed.json")).toThrow("invalid JSON")
    expect(parseRssFeed("<rss><channel/></rss>", "https://example.com/feed")).toEqual([])
  })
})

describe("hashFeedEntryId", () => {
  it("keeps entry IDs stable for the same feed GUID and separates feed ownership", async () => {
    const firstId = await hashFeedEntryId("feed-1", "story-1")
    await expect(hashFeedEntryId("feed-1", "story-1")).resolves.toBe(firstId)
    await expect(hashFeedEntryId("feed-2", "story-1")).resolves.not.toBe(firstId)
    expect(firstId).toMatch(/^rss_[a-f0-9]{64}$/)
  })
})

describe("fetchAndParseFeed", () => {
  it("refuses private URLs before issuing a request", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchAndParseFeed("http://127.0.0.1/feed.xml")).rejects.toBeInstanceOf(
      FeedFetchError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects redirects to private URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }),
      ),
    )

    await expect(fetchAndParseFeed("https://example.com/feed.xml")).rejects.toThrow(
      "redirected to a disallowed URL",
    )
  })

  it("follows a bounded public redirect and parses the response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/rss.xml" } }))
      .mockResolvedValueOnce(
        new Response("<rss><channel><item><guid>one</guid></item></channel></rss>", {
          headers: { "content-type": "application/rss+xml" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const entries = await fetchAndParseFeed("https://example.com/feed")

    expect(entries).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" })
  })

  it("rejects responses larger than the configured limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(1_500_001), { headers: { "content-type": "application/xml" } }),
      ),
    )

    await expect(fetchAndParseFeed("https://example.com/feed.xml")).rejects.toThrow(
      "exceeds the 1.5 MB limit",
    )
  })

  it("rejects explicit non-feed content types and hides origin details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { headers: { "content-type": "text/html" } })),
    )
    await expect(fetchAndParseFeed("https://example.com/feed")).rejects.toThrow(
      "recognized feed content type",
    )
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret network detail")))
    await expect(fetchAndParseFeed("https://example.com/feed")).rejects.toThrow(
      "Could not retrieve the feed",
    )
  })
})
