import { feyFeedsApi } from "./feyfeeds-api"
import type {
  FeyFeedsFeed,
  FeyFeedsFolder,
  FeyFeedsList,
  FeyFeedsTimelineEntry,
} from "./feyfeeds-api-client"
import { FeyFeedsApiError } from "./feyfeeds-api-client"
import { kv } from "./kv"

type Mutation =
  | { id: string; userId: string; type: "addFeed"; url: string }
  | { id: string; userId: string; type: "deleteFeed"; feedId: string }
  | {
      id: string
      userId: string
      type: "entryState"
      entryId: string
      state: { isRead?: boolean; isBookmarked?: boolean }
    }
  | { id: string; userId: string; type: "importOpml"; opml: string; migrationKey: string }
  | { id: string; userId: string; type: "createFolder"; folderId: string; name: string }
  | { id: string; userId: string; type: "renameFolder"; folderId: string; name: string }
  | { id: string; userId: string; type: "deleteFolder"; folderId: string }
  | { id: string; userId: string; type: "addFolderFeed"; folderId: string; feedId: string }
  | { id: string; userId: string; type: "removeFolderFeed"; folderId: string; feedId: string }
  | { id: string; userId: string; type: "reorderFolders"; ids: string[] }
  | { id: string; userId: string; type: "createList"; listId: string; name: string }
  | { id: string; userId: string; type: "renameList"; listId: string; name: string }
  | { id: string; userId: string; type: "deleteList"; listId: string }
  | { id: string; userId: string; type: "addListFeed"; listId: string; feedId: string }
  | { id: string; userId: string; type: "removeListFeed"; listId: string; feedId: string }
  | { id: string; userId: string; type: "reorderLists"; ids: string[] }

type NewMutation =
  | { type: "addFeed"; url: string }
  | { type: "deleteFeed"; feedId: string }
  | {
      type: "entryState"
      entryId: string
      state: { isRead?: boolean; isBookmarked?: boolean }
    }
  | { type: "importOpml"; opml: string; migrationKey: string }
  | { type: "createFolder"; folderId: string; name: string }
  | { type: "renameFolder"; folderId: string; name: string }
  | { type: "deleteFolder"; folderId: string }
  | { type: "addFolderFeed"; folderId: string; feedId: string }
  | { type: "removeFolderFeed"; folderId: string; feedId: string }
  | { type: "reorderFolders"; ids: string[] }
  | { type: "createList"; listId: string; name: string }
  | { type: "renameList"; listId: string; name: string }
  | { type: "deleteList"; listId: string }
  | { type: "addListFeed"; listId: string; feedId: string }
  | { type: "removeListFeed"; listId: string; feedId: string }
  | { type: "reorderLists"; ids: string[] }

const replayingUsers = new Set<string>()

const key = (userId: string, name: string) => `feyfeeds:${userId}:${name}`
const readJson = async <T>(storageKey: string, fallback: T): Promise<T> => {
  const value = await kv.get(storageKey)
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
const writeJson = (storageKey: string, value: unknown) => kv.set(storageKey, JSON.stringify(value))
const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value)
    url.hash = ""
    return url.href.replace(/\/$/, "")
  } catch {
    return value.trim()
  }
}

const enqueue = async (userId: string, mutation: NewMutation) => {
  const storageKey = key(userId, "outbox")
  const queue = await readJson<Mutation[]>(storageKey, [])
  const nextMutation: Mutation = {
    ...mutation,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId,
  }

  const nextQueue = [...queue, nextMutation]
  await writeJson(storageKey, nextQueue)
}

export const getCachedFeyFeedsData = async (userId: string) => {
  const [feeds, entries] = await Promise.all([
    readJson<FeyFeedsFeed[]>(key(userId, "feeds"), []),
    readJson<FeyFeedsTimelineEntry[]>(key(userId, "timeline"), []),
  ])
  return { feeds, entries }
}

export const getCachedFeyFeedsCollections = async (userId: string) => {
  const [folders, lists, folderFeeds, listFeeds] = await Promise.all([
    readJson<FeyFeedsFolder[]>(key(userId, "folders"), []),
    readJson<FeyFeedsList[]>(key(userId, "lists"), []),
    readJson<Record<string, string[]>>(key(userId, "folder-feeds"), {}),
    readJson<Record<string, string[]>>(key(userId, "list-feeds"), {}),
  ])
  return { folders, lists, folderFeeds, listFeeds }
}

export const cacheFeyFeedsData = async (
  userId: string,
  feeds: FeyFeedsFeed[],
  entries: FeyFeedsTimelineEntry[],
) => {
  await Promise.all([
    writeJson(key(userId, "feeds"), feeds),
    writeJson(key(userId, "timeline"), entries),
  ])
}

export const cacheFeyFeedsCollections = async (
  userId: string,
  folders: FeyFeedsFolder[],
  lists: FeyFeedsList[],
  folderFeeds: Record<string, string[]> = {},
  listFeeds: Record<string, string[]> = {},
) =>
  Promise.all([
    writeJson(key(userId, "folders"), folders),
    writeJson(key(userId, "lists"), lists),
    writeJson(key(userId, "folder-feeds"), folderFeeds),
    writeJson(key(userId, "list-feeds"), listFeeds),
  ])

export const pendingFeyFeedsMutationCount = async (userId: string) =>
  (await readJson<Mutation[]>(key(userId, "outbox"), [])).length

export const clearFeyFeedsAccountData = async (userId: string) => {
  const prefix = `feyfeeds:${userId}:`
  await Promise.all(
    kv
      .keys()
      .filter((storageKey) => storageKey.startsWith(prefix))
      .map((storageKey) => kv.delete(storageKey)),
  )
  await kv.delete("feyfeeds:last-user")
}

export const enqueueFeyFeedsMutation = enqueue

export const cancelPendingFeyFeedsAdd = async (userId: string, url: string) => {
  const storageKey = key(userId, "outbox")
  const queue = await readJson<Mutation[]>(storageKey, [])
  const next = queue.filter(
    (mutation) =>
      !(mutation.type === "addFeed" && normalizeUrl(mutation.url) === normalizeUrl(url)),
  )
  await writeJson(storageKey, next)
  return queue.length - next.length
}

/** Replays idempotent operations in order and keeps the first failed operation and its tail. */
export const replayFeyFeedsMutations = async (userId: string) => {
  if (replayingUsers.has(userId)) {
    return { completed: 0, remaining: await pendingFeyFeedsMutationCount(userId), error: null }
  }
  replayingUsers.add(userId)
  const storageKey = key(userId, "outbox")
  let completed = 0
  let failure: string | null = null

  try {
    while (true) {
      const queue = await readJson<Mutation[]>(storageKey, [])
      const mutation = queue[0]
      if (!mutation) break
      if (mutation.userId !== userId) break
      try {
        if (mutation.type === "addFeed") {
          try {
            await feyFeedsApi.addFeed(mutation.url)
          } catch (error) {
            if (!(error instanceof FeyFeedsApiError) || error.status !== 409) throw error
            const feeds = await feyFeedsApi.listFeeds()
            if (!feeds.some((feed) => normalizeUrl(feed.url) === normalizeUrl(mutation.url)))
              throw error
          }
        } else if (mutation.type === "deleteFeed") {
          try {
            await feyFeedsApi.deleteFeed(mutation.feedId)
          } catch (error) {
            if (!(error instanceof FeyFeedsApiError) || error.status !== 404) throw error
          }
        } else if (mutation.type === "entryState") {
          await feyFeedsApi.updateEntryState(mutation.entryId, mutation.state)
        } else if (mutation.type === "createFolder") {
          await feyFeedsApi.createFolder(mutation.name, mutation.folderId)
        } else if (mutation.type === "renameFolder") {
          await feyFeedsApi.renameFolder(mutation.folderId, mutation.name)
        } else if (mutation.type === "deleteFolder") {
          try {
            await feyFeedsApi.deleteFolder(mutation.folderId)
          } catch (error) {
            if (!(error instanceof FeyFeedsApiError) || error.status !== 404) throw error
          }
        } else if (mutation.type === "addFolderFeed") {
          await feyFeedsApi.addFeedToFolder(mutation.folderId, mutation.feedId)
        } else if (mutation.type === "removeFolderFeed") {
          try {
            await feyFeedsApi.removeFeedFromFolder(mutation.folderId, mutation.feedId)
          } catch (error) {
            if (!(error instanceof FeyFeedsApiError) || error.status !== 404) throw error
          }
        } else if (mutation.type === "reorderFolders") {
          await feyFeedsApi.reorderFolders(mutation.ids)
        } else if (mutation.type === "createList") {
          await feyFeedsApi.createList(mutation.name, mutation.listId)
        } else if (mutation.type === "renameList") {
          await feyFeedsApi.updateList(mutation.listId, { name: mutation.name })
        } else if (mutation.type === "deleteList") {
          try {
            await feyFeedsApi.deleteList(mutation.listId)
          } catch (error) {
            if (!(error instanceof FeyFeedsApiError) || error.status !== 404) throw error
          }
        } else if (mutation.type === "addListFeed") {
          await feyFeedsApi.addFeedToList(mutation.listId, mutation.feedId)
        } else if (mutation.type === "removeListFeed") {
          try {
            await feyFeedsApi.removeFeedFromList(mutation.listId, mutation.feedId)
          } catch (error) {
            if (!(error instanceof FeyFeedsApiError) || error.status !== 404) throw error
          }
        } else if (mutation.type === "reorderLists") {
          await feyFeedsApi.reorderLists(mutation.ids)
        } else {
          await feyFeedsApi.importOpml(mutation.opml)
          await kv.set(key(userId, `migration:${mutation.migrationKey}`), "complete")
        }
        const latestQueue = await readJson<Mutation[]>(storageKey, [])
        const remainingQueue = latestQueue.filter((item) => item.id !== mutation.id)
        completed += 1
        await writeJson(storageKey, remainingQueue)
      } catch (error) {
        failure = error instanceof Error ? error.message : "Could not sync a pending change"
        break
      }
    }
  } finally {
    replayingUsers.delete(userId)
  }

  return { completed, remaining: await pendingFeyFeedsMutationCount(userId), error: failure }
}
