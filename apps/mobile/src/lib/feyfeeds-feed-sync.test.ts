import { beforeEach, describe, expect, it, vi } from "vitest"

import { FeyFeedsApiError } from "./feyfeeds-api-client"
import {
  cacheFeyFeedsData,
  cacheFeyFeedsCollections,
  clearFeyFeedsAccountData,
  enqueueFeyFeedsMutation,
  getCachedFeyFeedsData,
  getCachedFeyFeedsCollections,
  pendingFeyFeedsMutationCount,
  replayFeyFeedsMutations,
} from "./feyfeeds-feed-sync"

const { storage, api } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  api: {
    addFeed: vi.fn(),
    listFeeds: vi.fn(),
    deleteFeed: vi.fn(),
    updateEntryState: vi.fn(),
    importOpml: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    addFeedToFolder: vi.fn(),
    removeFeedFromFolder: vi.fn(),
    reorderFolders: vi.fn(),
    createList: vi.fn(),
    updateList: vi.fn(),
    deleteList: vi.fn(),
    addFeedToList: vi.fn(),
    removeFeedFromList: vi.fn(),
    reorderLists: vi.fn(),
  },
}))

vi.mock("./kv", () => ({
  kv: {
    get: async (key: string) => storage.get(key) ?? null,
    set: async (key: string, value: string) => void storage.set(key, value),
    delete: async (key: string) => void storage.delete(key),
    keys: () => [...storage.keys()],
  },
}))
vi.mock("./feyfeeds-api", () => ({ feyFeedsApi: api }))

describe("FeyFeeds offline mutation queue", () => {
  beforeEach(() => {
    storage.clear()
    vi.resetAllMocks()
  })

  it("keeps failed work for retry and removes it only after server acknowledgement", async () => {
    api.updateEntryState.mockRejectedValueOnce(new TypeError("Network unavailable"))
    await enqueueFeyFeedsMutation("user-a", {
      type: "entryState",
      entryId: "rss_entry-id",
      state: { isRead: true },
    })

    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 0,
      remaining: 1,
      error: "Network unavailable",
    })
    expect(await pendingFeyFeedsMutationCount("user-b")).toBe(0)

    api.updateEntryState.mockResolvedValueOnce(undefined)
    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 1,
      remaining: 0,
    })
    expect(await pendingFeyFeedsMutationCount("user-a")).toBe(0)
    expect(api.updateEntryState).toHaveBeenCalledTimes(2)
  })

  it("keeps account caches and offline queues isolated across account changes", async () => {
    const feed = (id: string) => ({
      id,
      url: `https://${id}.example/rss`,
      title: null,
      createdAt: 1,
      lastFetchedAt: null,
      lastError: null,
    })
    await cacheFeyFeedsData("user-a", [feed("feed-a")], [])
    await cacheFeyFeedsData("user-b", [feed("feed-b")], [])
    await cacheFeyFeedsCollections("user-a", [{ id: "folder-a", name: "A", position: 0 }], [], {
      "folder-a": ["feed-a"],
    })
    await cacheFeyFeedsCollections("user-b", [{ id: "folder-b", name: "B", position: 0 }], [], {
      "folder-b": ["feed-b"],
    })
    await enqueueFeyFeedsMutation("user-a", { type: "addFeed", url: "https://a.example/rss" })
    await enqueueFeyFeedsMutation("user-b", { type: "addFeed", url: "https://b.example/rss" })

    await expect(getCachedFeyFeedsData("user-a")).resolves.toMatchObject({
      feeds: [{ id: "feed-a" }],
      entries: [],
    })
    await expect(getCachedFeyFeedsData("user-b")).resolves.toMatchObject({
      feeds: [{ id: "feed-b" }],
      entries: [],
    })
    expect(await pendingFeyFeedsMutationCount("user-a")).toBe(1)
    expect(await pendingFeyFeedsMutationCount("user-b")).toBe(1)
    await expect(getCachedFeyFeedsCollections("user-a")).resolves.toMatchObject({
      folders: [{ id: "folder-a" }],
      folderFeeds: { "folder-a": ["feed-a"] },
    })
    await expect(getCachedFeyFeedsCollections("user-b")).resolves.toMatchObject({
      folders: [{ id: "folder-b" }],
      folderFeeds: { "folder-b": ["feed-b"] },
    })
  })

  it("clears only the deleted or signed-out account cache and queue", async () => {
    await cacheFeyFeedsData("user-a", [], [])
    await cacheFeyFeedsData("user-b", [], [])
    await enqueueFeyFeedsMutation("user-a", { type: "addFeed", url: "https://a.example/rss" })
    await enqueueFeyFeedsMutation("user-b", { type: "addFeed", url: "https://b.example/rss" })
    await storage.set("feyfeeds:last-user", JSON.stringify({ id: "user-a" }))

    await clearFeyFeedsAccountData("user-a")

    expect(await pendingFeyFeedsMutationCount("user-a")).toBe(0)
    expect(await pendingFeyFeedsMutationCount("user-b")).toBe(1)
    await expect(getCachedFeyFeedsData("user-a")).resolves.toEqual({ feeds: [], entries: [] })
    expect(storage.has("feyfeeds:user-b:feeds")).toBe(true)
    expect(storage.has("feyfeeds:last-user")).toBe(false)
  })

  it("treats duplicate feed creation as acknowledged only when that account owns the URL", async () => {
    api.addFeed.mockRejectedValueOnce(new FeyFeedsApiError("Already followed", 409))
    api.listFeeds.mockResolvedValueOnce([{ id: "feed-1", url: "https://example.com/rss" }])
    await enqueueFeyFeedsMutation("user-a", { type: "addFeed", url: "https://example.com/rss" })

    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 1,
      remaining: 0,
    })
  })

  it("treats an already removed feed as an idempotent delete", async () => {
    api.deleteFeed.mockRejectedValueOnce(new FeyFeedsApiError("Feed not found", 404))
    await enqueueFeyFeedsMutation("user-a", { type: "deleteFeed", feedId: "feed-1" })

    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 1,
      remaining: 0,
    })
  })

  it("acknowledges a legacy import once and records its migration marker", async () => {
    api.importOpml.mockResolvedValueOnce(undefined)
    await enqueueFeyFeedsMutation("user-a", {
      type: "importOpml",
      opml: "<opml />",
      migrationKey: "legacy-feed-urls-v1",
    })

    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 1,
      remaining: 0,
    })
    expect(await storage.get("feyfeeds:user-a:migration:legacy-feed-urls-v1")).toBe("complete")
    await replayFeyFeedsMutations("user-a")
    expect(api.importOpml).toHaveBeenCalledTimes(1)
  })

  it("replays collection mutations per account and retries safely by client id", async () => {
    api.createFolder.mockRejectedValueOnce(new TypeError("Network unavailable"))
    await enqueueFeyFeedsMutation("user-a", {
      type: "createFolder",
      folderId: "folder-client-id-1234",
      name: "News",
    })
    await enqueueFeyFeedsMutation("user-a", {
      type: "addFolderFeed",
      folderId: "folder-client-id-1234",
      feedId: "feed-a",
    })

    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 0,
      remaining: 2,
    })
    expect(api.addFeedToFolder).not.toHaveBeenCalled()

    api.createFolder.mockResolvedValueOnce({ id: "folder-client-id-1234" })
    api.addFeedToFolder.mockResolvedValueOnce(undefined)
    await expect(replayFeyFeedsMutations("user-a")).resolves.toMatchObject({
      completed: 2,
      remaining: 0,
    })
    expect(api.createFolder).toHaveBeenLastCalledWith("News", "folder-client-id-1234")
    expect(api.addFeedToFolder).toHaveBeenCalledWith("folder-client-id-1234", "feed-a")
  })
})
