import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system/legacy"
import { nanoid } from "nanoid"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  Share,
  TextInput,
  View,
} from "react-native"

import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import { GroupedInsetListCard } from "@/src/components/ui/grouped/GroupedList"
import { PlatformActivityIndicator } from "@/src/components/ui/loading/PlatformActivityIndicator"
import { BottomModal } from "@/src/components/ui/modal/BottomModal"
import { Text } from "@/src/components/ui/typography/Text"
import { feyFeedsApi, publicListShareUrl } from "@/src/lib/feyfeeds-api"
import type {
  FeyFeedsDiscoveredFeed,
  FeyFeedsFeed,
  FeyFeedsFolder,
  FeyFeedsList,
  FeyFeedsTimelineEntry,
  FeyFeedsUser,
} from "@/src/lib/feyfeeds-api-client"
import { FeyFeedsApiError } from "@/src/lib/feyfeeds-api-client"
import {
  cacheFeyFeedsCollections,
  cacheFeyFeedsData,
  cancelPendingFeyFeedsAdd,
  clearFeyFeedsAccountData,
  enqueueFeyFeedsMutation,
  getCachedFeyFeedsCollections,
  getCachedFeyFeedsData,
  pendingFeyFeedsMutationCount,
  replayFeyFeedsMutations,
} from "@/src/lib/feyfeeds-feed-sync"
import {
  createFeedMigrationOpml,
  getLegacyFeedSubscriptions,
} from "@/src/lib/feyfeeds-legacy-feed-migration"
import { kv } from "@/src/lib/kv"
import { toast } from "@/src/lib/toast"

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be completed"

const LEGACY_MIGRATION_KEY = "legacy-feed-urls-v1"

export const FeyFeedsCloudScreen = () => {
  const { t, i18n } = useTranslation("settings")
  const [user, setUser] = useState<FeyFeedsUser | null>(null)
  const activeUserIdRef = useRef<string | null>(null)
  const [profileName, setProfileName] = useState("")
  const [accountLanguage, setAccountLanguage] = useState<"en" | "ja" | "zh-CN">("en")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [feedUrl, setFeedUrl] = useState("")
  const [discoveredFeeds, setDiscoveredFeeds] = useState<FeyFeedsDiscoveredFeed[]>([])
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [feeds, setFeeds] = useState<FeyFeedsFeed[]>([])
  const [folders, setFolders] = useState<FeyFeedsFolder[]>([])
  const [lists, setLists] = useState<FeyFeedsList[]>([])
  const [folderFeeds, setFolderFeeds] = useState<Record<string, string[]>>({})
  const [listFeeds, setListFeeds] = useState<Record<string, string[]>>({})
  const [libraryQuery, setLibraryQuery] = useState("")
  const [libraryName, setLibraryName] = useState("")
  const [renameValue, setRenameValue] = useState("")
  const [editingCollection, setEditingCollection] = useState<{
    kind: "folder" | "list"
    id: string
  } | null>(null)
  const [libraryResults, setLibraryResults] = useState<{
    feeds: FeyFeedsFeed[]
    entries: { id: string; title: string | null; url: string | null }[]
    pagination: { feedsHasMore: boolean; entriesHasMore: boolean; nextOffset: number }
  } | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<FeyFeedsTimelineEntry[]>([])
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null)
  const [summaryArticle, setSummaryArticle] = useState<FeyFeedsTimelineEntry | null>(null)
  const [articleSummary, setArticleSummary] = useState("")
  const [summaryError, setSummaryError] = useState("")
  const [isSummarizing, setIsSummarizing] = useState(false)

  const showSummary = async (entry: FeyFeedsTimelineEntry) => {
    const language = i18n.language === "zh" ? "zh-CN" : i18n.language.split("-")[0] || "en"
    setSummaryArticle(entry)
    setArticleSummary("")
    setSummaryError("")
    setIsSummarizing(false)
    setIsSummarizing(true)
    try {
      const result = await feyFeedsApi.summarizeArticle(entry.id, language)
      setArticleSummary(result.summary)
    } catch (error) {
      setSummaryError(getErrorMessage(error))
    } finally {
      setIsSummarizing(false)
    }
  }

  useEffect(() => {
    let active = true
    const restoreSession = async () => {
      try {
        const sessionUser = await feyFeedsApi.getSession()
        if (active) {
          if (activeUserIdRef.current && activeUserIdRef.current !== sessionUser.id) {
            setFeeds([])
            setTimeline([])
            setFolders([])
            setLists([])
            setFolderFeeds({})
            setListFeeds({})
            setLibraryResults(null)
          }
          activeUserIdRef.current = sessionUser.id
          setUser(sessionUser)
        }
      } catch (error) {
        if (error instanceof FeyFeedsApiError && error.status === 401) {
          await kv.delete("feyfeeds:last-user")
          if (active) setUser(null)
          activeUserIdRef.current = null
          return
        }
        if (!(await feyFeedsApi.hasSessionToken())) {
          await kv.delete("feyfeeds:last-user")
          if (active) setUser(null)
          activeUserIdRef.current = null
          return
        }
        const cachedUser = await kv.get("feyfeeds:last-user")
        if (!active) return
        if (cachedUser) {
          try {
            setUser(JSON.parse(cachedUser) as FeyFeedsUser)
          } catch {
            setOfflineMessage("Saved FeyFeeds account data is invalid. Sign in again to continue.")
          }
        } else {
          setUser(null)
        }
      }
    }
    void restoreSession()
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void restoreSession()
    })
    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  const loadCollections = useCallback(async () => {
    const [nextFolders, nextLists] = await Promise.all([
      feyFeedsApi.listFolders(),
      feyFeedsApi.listLists(),
    ])
    const [folderMemberships, listMemberships] = await Promise.all([
      Promise.all(
        nextFolders.map(
          async (folder) =>
            [
              folder.id,
              (await feyFeedsApi.listFolderFeeds(folder.id)).map((feed) => feed.id),
            ] as const,
        ),
      ),
      Promise.all(
        nextLists.map(
          async (list) =>
            [
              list.id,
              (await feyFeedsApi.listDetail(list.id)).feeds.map((feed) => feed.id),
            ] as const,
        ),
      ),
    ])
    const nextFolderFeeds = Object.fromEntries(folderMemberships)
    const nextListFeeds = Object.fromEntries(listMemberships)
    setFolders(nextFolders)
    setLists(nextLists)
    setFolderFeeds(nextFolderFeeds)
    setListFeeds(nextListFeeds)
    if (user)
      await cacheFeyFeedsCollections(
        user.id,
        nextFolders,
        nextLists,
        nextFolderFeeds,
        nextListFeeds,
      )
  }, [user])

  const loadData = useCallback(async () => {
    const [nextFeeds, nextTimeline] = await Promise.all([
      feyFeedsApi.listFeeds(),
      feyFeedsApi.getTimeline(),
    ])
    setFeeds(nextFeeds)
    setTimeline(nextTimeline.data)
    setTimelineCursor(nextTimeline.pagination.nextCursor)
    await loadCollections()
    if (user) await cacheFeyFeedsData(user.id, nextFeeds, nextTimeline.data)
    setOfflineMessage(null)
  }, [loadCollections, user])

  const searchLibrary = (offset = 0) => {
    setLibraryError(null)
    return runBusy(async () => {
      try {
        const result = await feyFeedsApi.searchLibrary(libraryQuery.trim(), offset)
        setLibraryResults((current) => ({
          feeds: offset ? [...(current?.feeds ?? []), ...result.feeds] : result.feeds,
          entries: offset ? [...(current?.entries ?? []), ...result.entries] : result.entries,
          pagination: result.pagination,
        }))
      } catch (error) {
        setLibraryError(getErrorMessage(error))
        throw error
      }
    })
  }
  const createLibraryItem = (kind: "folder" | "list") =>
    runBusy(async () => {
      const name = libraryName.trim()
      if (!name) throw new Error("Enter a folder or list name")
      const id = nanoid()
      if (kind === "folder") {
        const folder: FeyFeedsFolder = { id, name, position: folders.length }
        const nextFolders = [...folders, folder]
        setFolders(nextFolders)
        await enqueueFeyFeedsMutation(user!.id, { type: "createFolder", folderId: id, name })
        await cacheFeyFeedsCollections(user!.id, nextFolders, lists, folderFeeds, listFeeds)
      } else {
        const list: FeyFeedsList = {
          id,
          name,
          description: null,
          visibility: "private",
          position: lists.length,
        }
        const nextLists = [...lists, list]
        setLists(nextLists)
        await enqueueFeyFeedsMutation(user!.id, { type: "createList", listId: id, name })
        await cacheFeyFeedsCollections(user!.id, folders, nextLists, folderFeeds, listFeeds)
      }
      setLibraryName("")
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      if (replay.error) setOfflineMessage(`Saved locally. Sync failed: ${replay.error}`)
      else if (replay.remaining === 0) await loadCollections()
      else setOfflineMessage("Saved locally; changes will sync when FeyFeeds is reachable.")
    })

  const addFeedToCollection = (kind: "folder" | "list", id: string, feedId: string) =>
    runBusy(async () => {
      if (kind === "folder") {
        const nextFolderFeeds = {
          ...folderFeeds,
          [id]: [...new Set([...(folderFeeds[id] ?? []), feedId])],
        }
        setFolderFeeds(nextFolderFeeds)
        await enqueueFeyFeedsMutation(user!.id, { type: "addFolderFeed", folderId: id, feedId })
        await cacheFeyFeedsCollections(user!.id, folders, lists, nextFolderFeeds, listFeeds)
      } else {
        const nextListFeeds = {
          ...listFeeds,
          [id]: [...new Set([...(listFeeds[id] ?? []), feedId])],
        }
        setListFeeds(nextListFeeds)
        await enqueueFeyFeedsMutation(user!.id, { type: "addListFeed", listId: id, feedId })
        await cacheFeyFeedsCollections(user!.id, folders, lists, folderFeeds, nextListFeeds)
      }
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      if (replay.error) setOfflineMessage(`Saved locally. Sync failed: ${replay.error}`)
      else if (replay.remaining === 0) toast.success("Feed added")
    })

  const removeFeedFromCollection = (kind: "folder" | "list", id: string, feedId: string) =>
    runBusy(async () => {
      if (kind === "folder") {
        const nextFolderFeeds = {
          ...folderFeeds,
          [id]: (folderFeeds[id] ?? []).filter((item) => item !== feedId),
        }
        setFolderFeeds(nextFolderFeeds)
        await enqueueFeyFeedsMutation(user!.id, { type: "removeFolderFeed", folderId: id, feedId })
        await cacheFeyFeedsCollections(user!.id, folders, lists, nextFolderFeeds, listFeeds)
      } else {
        const nextListFeeds = {
          ...listFeeds,
          [id]: (listFeeds[id] ?? []).filter((item) => item !== feedId),
        }
        setListFeeds(nextListFeeds)
        await enqueueFeyFeedsMutation(user!.id, { type: "removeListFeed", listId: id, feedId })
        await cacheFeyFeedsCollections(user!.id, folders, lists, folderFeeds, nextListFeeds)
      }
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      if (replay.error) setOfflineMessage(`Saved locally. Sync failed: ${replay.error}`)
    })

  const saveCollectionName = () => {
    if (!editingCollection || !renameValue.trim()) return
    void runBusy(async () => {
      const { kind, id } = editingCollection
      const name = renameValue.trim()
      if (kind === "folder") {
        const nextFolders = folders.map((folder) =>
          folder.id === id ? { ...folder, name } : folder,
        )
        setFolders(nextFolders)
        await enqueueFeyFeedsMutation(user!.id, { type: "renameFolder", folderId: id, name })
        await cacheFeyFeedsCollections(user!.id, nextFolders, lists, folderFeeds, listFeeds)
      } else {
        const nextLists = lists.map((list) => (list.id === id ? { ...list, name } : list))
        setLists(nextLists)
        await enqueueFeyFeedsMutation(user!.id, { type: "renameList", listId: id, name })
        await cacheFeyFeedsCollections(user!.id, folders, nextLists, folderFeeds, listFeeds)
      }
      setEditingCollection(null)
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      if (replay.error) setOfflineMessage(`Saved locally. Sync failed: ${replay.error}`)
    })
  }

  const deleteCollection = (kind: "folder" | "list", id: string) => {
    Alert.alert(`Delete ${kind}?`, "Its feed memberships will be removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void runBusy(async () => {
            if (kind === "folder") {
              const nextFolders = folders.filter((folder) => folder.id !== id)
              const nextFolderFeeds = Object.fromEntries(
                Object.entries(folderFeeds).filter(([folderId]) => folderId !== id),
              )
              setFolders(nextFolders)
              setFolderFeeds(nextFolderFeeds)
              await enqueueFeyFeedsMutation(user!.id, { type: "deleteFolder", folderId: id })
              await cacheFeyFeedsCollections(
                user!.id,
                nextFolders,
                lists,
                nextFolderFeeds,
                listFeeds,
              )
            } else {
              const nextLists = lists.filter((list) => list.id !== id)
              const nextListFeeds = Object.fromEntries(
                Object.entries(listFeeds).filter(([listId]) => listId !== id),
              )
              setLists(nextLists)
              setListFeeds(nextListFeeds)
              await enqueueFeyFeedsMutation(user!.id, { type: "deleteList", listId: id })
              await cacheFeyFeedsCollections(
                user!.id,
                folders,
                nextLists,
                folderFeeds,
                nextListFeeds,
              )
            }
            const replay = await replayFeyFeedsMutations(user!.id)
            setPendingCount(replay.remaining)
            if (replay.error) setOfflineMessage(`Saved locally. Sync failed: ${replay.error}`)
          }),
      },
    ])
  }

  const reorderCollection = (kind: "folder" | "list", id: string, direction: -1 | 1) =>
    runBusy(async () => {
      if (kind === "folder") {
        const index = folders.findIndex((folder) => folder.id === id),
          target = index + direction
        if (index < 0 || target < 0 || target >= folders.length) return
        const next = [...folders]
        ;[next[index], next[target]] = [next[target]!, next[index]!]
        setFolders(next)
        await cacheFeyFeedsCollections(user!.id, next, lists, folderFeeds, listFeeds)
        await enqueueFeyFeedsMutation(user!.id, {
          type: "reorderFolders",
          ids: next.map((item) => item.id),
        })
      } else {
        const index = lists.findIndex((list) => list.id === id),
          target = index + direction
        if (index < 0 || target < 0 || target >= lists.length) return
        const next = [...lists]
        ;[next[index], next[target]] = [next[target]!, next[index]!]
        setLists(next)
        await cacheFeyFeedsCollections(user!.id, folders, next, folderFeeds, listFeeds)
        await enqueueFeyFeedsMutation(user!.id, {
          type: "reorderLists",
          ids: next.map((item) => item.id),
        })
      }
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      if (replay.error) setOfflineMessage(`Saved locally. Sync failed: ${replay.error}`)
    })

  const shareList = (listId: string) =>
    runBusy(async () => {
      const { token } = await feyFeedsApi.createListShare(listId)
      setLists((current) =>
        current.map((list) => (list.id === listId ? { ...list, visibility: "link" } : list)),
      )
      const nextLists = lists.map((list) =>
        list.id === listId ? { ...list, visibility: "link" as const } : list,
      )
      await cacheFeyFeedsCollections(user!.id, folders, nextLists, folderFeeds, listFeeds)
      await Share.share({ message: publicListShareUrl(token) })
    })

  const revokeListShare = (listId: string) =>
    runBusy(async () => {
      await feyFeedsApi.revokeListShare(listId)
      setLists((current) =>
        current.map((list) => (list.id === listId ? { ...list, visibility: "private" } : list)),
      )
      const nextLists = lists.map((list) =>
        list.id === listId ? { ...list, visibility: "private" as const } : list,
      )
      await cacheFeyFeedsCollections(user!.id, folders, nextLists, folderFeeds, listFeeds)
      toast.success("Share link revoked")
    })

  useEffect(() => {
    if (!user) return

    const retry = async () => {
      const replay = await replayFeyFeedsMutations(user.id)
      setPendingCount(replay.remaining)

      if (replay.remaining > 0) {
        if (replay.error) {
          setOfflineMessage(`Pending sync failed: ${replay.error}`)
        }
        return
      }

      try {
        await loadData()
        setOfflineMessage(null)
      } catch (error) {
        setOfflineMessage(`Offline or sync failed. Showing saved data. ${getErrorMessage(error)}`)
      }
    }

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void retry().catch((error: unknown) => setOfflineMessage(getErrorMessage(error)))
    })
    const interval = setInterval(() => {
      void retry().catch((error: unknown) => setOfflineMessage(getErrorMessage(error)))
    }, 30_000)
    return () => {
      appStateSubscription.remove()
      clearInterval(interval)
    }
  }, [loadData, user])

  useEffect(() => {
    if (!user) {
      setFeeds([])
      setTimeline([])
      setFolders([])
      setLists([])
      setFolderFeeds({})
      setListFeeds({})
      setLibraryResults(null)
      setLibraryError(null)
      return
    }

    let active = true
    void (async () => {
      const cached = await getCachedFeyFeedsData(user.id)
      const cachedCollections = await getCachedFeyFeedsCollections(user.id)
      if (active) {
        setFeeds(cached.feeds)
        setTimeline(cached.entries)
        setFolders(cachedCollections.folders)
        setLists(cachedCollections.lists)
        setFolderFeeds(cachedCollections.folderFeeds)
        setListFeeds(cachedCollections.listFeeds)
        setPendingCount(await pendingFeyFeedsMutationCount(user.id))
      }
      try {
        const migrationMarkerKey = `feyfeeds:${user.id}:migration:${LEGACY_MIGRATION_KEY}`
        if (!(await kv.get(migrationMarkerKey))) {
          const legacyFeeds = await getLegacyFeedSubscriptions()
          if (legacyFeeds.length > 0) {
            await enqueueFeyFeedsMutation(user.id, {
              type: "importOpml",
              opml: createFeedMigrationOpml(legacyFeeds),
              migrationKey: LEGACY_MIGRATION_KEY,
            })
          }
        }
        const replay = await replayFeyFeedsMutations(user.id)
        if (replay.remaining > 0) {
          if (!active) return
          setPendingCount(replay.remaining)
          setOfflineMessage(
            replay.error
              ? `Showing saved data. Pending sync failed: ${replay.error}`
              : "Offline. Showing saved data; pending changes will retry automatically.",
          )
          return
        }
        const [nextFeeds, nextTimeline] = await Promise.all([
          feyFeedsApi.listFeeds(),
          feyFeedsApi.getTimeline(),
        ])
        await cacheFeyFeedsData(user.id, nextFeeds, nextTimeline.data)
        if (!active) return
        setFeeds(nextFeeds)
        setTimeline(nextTimeline.data)
        await loadCollections()
        setTimelineCursor(nextTimeline.pagination.nextCursor)
        setPendingCount(replay.remaining)
        setOfflineMessage(replay.remaining ? "Some changes are still waiting to sync." : null)
      } catch (error) {
        if (active) {
          setOfflineMessage(`Offline or sync failed. Showing saved data. ${getErrorMessage(error)}`)
        }
      }
    })().catch((error: unknown) => {
      if (active) setOfflineMessage(getErrorMessage(error))
    })
    return () => {
      active = false
    }
  }, [loadCollections, user])

  const runBusy = async (action: () => Promise<void>) => {
    setIsBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsBusy(false)
    }
  }

  const submitCredentials = () =>
    runBusy(async () => {
      const normalizedEmail = email.trim()
      const nextUser = isCreatingAccount
        ? await feyFeedsApi.register(normalizedEmail, password)
        : await feyFeedsApi.login(normalizedEmail, password)
      await kv.set("feyfeeds:last-user", JSON.stringify(nextUser))
      setFeeds([])
      setTimeline([])
      setFolders([])
      setLists([])
      setFolderFeeds({})
      setListFeeds({})
      setLibraryResults(null)
      setPendingCount(0)
      setUser(nextUser)
      activeUserIdRef.current = nextUser.id
    })

  const addFeed = () =>
    runBusy(async () => {
      const url = feedUrl.trim()
      await enqueueFeyFeedsMutation(user!.id, { type: "addFeed", url })
      const optimisticFeed: FeyFeedsFeed = {
        id: `pending:${url}`,
        url,
        title: null,
        createdAt: Date.now(),
        lastFetchedAt: null,
        lastError: null,
      }
      const nextFeeds = [optimisticFeed, ...feeds.filter((feed) => feed.url !== url)]
      setFeeds(nextFeeds)
      setPendingCount(await pendingFeyFeedsMutationCount(user!.id))
      await cacheFeyFeedsData(user!.id, nextFeeds, timeline)
      setFeedUrl("")
      const replay = await replayFeyFeedsMutations(user!.id)
      if (replay.remaining === 0) {
        await loadData()
        toast.success(t("feyfeeds_cloud.feed_added"))
      } else {
        setPendingCount(replay.remaining)
        setOfflineMessage(
          replay.error
            ? `Feed saved locally. Sync failed: ${replay.error}`
            : "Feed saved on this device and will sync when FeyFeeds is reachable.",
        )
      }
    })

  const discoverFeeds = () =>
    runBusy(async () => {
      const result = await feyFeedsApi.discoverFeeds(feedUrl.trim())
      setDiscoveredFeeds(result)
      if (result.length === 0) toast.error(t("feyfeeds_cloud.no_discovered_feeds"))
    })

  useEffect(() => {
    if (!user) return
    let active = true
    void Promise.all([feyFeedsApi.getProfile(), feyFeedsApi.getPreferences()])
      .then(([profile, preferences]) => {
        if (!active) return
        setProfileName(profile.name ?? "")
        setAccountLanguage(preferences.language)
      })
      .catch((error: unknown) => {
        if (active) setOfflineMessage(getErrorMessage(error))
      })
    return () => {
      active = false
    }
  }, [user])

  const importOpml = () =>
    runBusy(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/xml", "text/xml", "text/x-opml", "application/octet-stream"],
      })
      if (result.canceled) return

      const file = result.assets[0]
      if (!file) {
        throw new Error("The selected OPML file could not be read")
      }

      const opml = await FileSystem.readAsStringAsync(file.uri)
      const imported = await feyFeedsApi.importOpml(opml)
      await loadData()
      toast.success(
        t("feyfeeds_cloud.opml_imported", {
          imported: imported.data.imported,
          skipped: imported.data.skipped,
        }),
      )
    })

  const refreshFeed = (feedId: string) =>
    runBusy(async () => {
      const result = await feyFeedsApi.refreshFeed(feedId)
      await loadData()
      toast.success(t("feyfeeds_cloud.feed_refreshed", { count: result.fetched }))
    })

  const refreshTimeline = () => runBusy(loadData)

  const loadMore = () =>
    runBusy(async () => {
      if (!timelineCursor) return
      const nextPage = await feyFeedsApi.getTimeline({ cursor: timelineCursor })
      setTimeline((current) => {
        const entries = [
          ...current,
          ...nextPage.data.filter((entry) => !current.some((item) => item.id === entry.id)),
        ]
        if (user) void cacheFeyFeedsData(user.id, feeds, entries)
        return entries
      })
      setTimelineCursor(nextPage.pagination.nextCursor)
    })

  const toggleEntryState = (entry: FeyFeedsTimelineEntry, key: "isRead" | "isBookmarked") =>
    runBusy(async () => {
      const nextValue = !entry[key]
      const state: { isRead?: boolean; isBookmarked?: boolean } = { [key]: nextValue }
      const nextTimeline = timeline.map((item) =>
        item.id === entry.id ? { ...item, [key]: nextValue } : item,
      )
      setTimeline(nextTimeline)
      await enqueueFeyFeedsMutation(user!.id, { type: "entryState", entryId: entry.id, state })
      await cacheFeyFeedsData(user!.id, feeds, nextTimeline)
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      setOfflineMessage(
        replay.remaining
          ? replay.error
            ? `Reading change saved locally. Sync failed: ${replay.error}`
            : "Reading change saved on this device and will sync when FeyFeeds is reachable."
          : null,
      )
    })

  const removeFeed = (feed: FeyFeedsFeed) =>
    runBusy(async () => {
      const nextFeeds = feeds.filter((item) => item.id !== feed.id)
      setFeeds(nextFeeds)
      if (feed.id.startsWith("pending:")) {
        // A not-yet-synced add can be safely cancelled locally.
        const removed = await cancelPendingFeyFeedsAdd(user!.id, feed.url)
        if (removed > 0) {
          const remaining = await pendingFeyFeedsMutationCount(user!.id)
          setPendingCount(remaining)
          await cacheFeyFeedsData(user!.id, nextFeeds, timeline)
          return
        }
      }
      await enqueueFeyFeedsMutation(user!.id, { type: "deleteFeed", feedId: feed.id })
      await cacheFeyFeedsData(user!.id, nextFeeds, timeline)
      const replay = await replayFeyFeedsMutations(user!.id)
      setPendingCount(replay.remaining)
      setOfflineMessage(
        replay.remaining
          ? replay.error
            ? `Feed removal saved locally. Sync failed: ${replay.error}`
            : "Feed removal is saved and will sync when FeyFeeds is reachable."
          : null,
      )
    })

  return (
    <SafeNavigationScrollView
      className="bg-system-grouped-background"
      Header={<NavigationBlurEffectHeaderView title={t("titles.feyfeeds_cloud")} />}
    >
      <View className="mt-6 gap-6 px-4">
        <Text className="text-sm text-secondary-label">{t("feyfeeds_cloud.description")}</Text>
        {offlineMessage ? (
          <Text
            accessibilityRole="alert"
            className="rounded-xl bg-yellow/15 p-3 text-sm text-label"
          >
            {offlineMessage}
          </Text>
        ) : null}
        {pendingCount > 0 ? (
          <Text className="text-xs text-secondary-label">
            {pendingCount} change(s) waiting to sync
          </Text>
        ) : null}

        {!user ? (
          <>
            <GroupedInsetListCard>
              <View className="gap-3 p-4">
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholder={t("feyfeeds_cloud.email")}
                  className="rounded-xl bg-secondary-system-background px-4 py-3 text-label"
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoComplete={isCreatingAccount ? "new-password" : "current-password"}
                  secureTextEntry
                  placeholder={t("feyfeeds_cloud.password")}
                  className="rounded-xl bg-secondary-system-background px-4 py-3 text-label"
                />
                <ActionButton
                  disabled={isBusy || !email.trim() || password.length < 8}
                  label={
                    isCreatingAccount
                      ? t("feyfeeds_cloud.create_account")
                      : t("feyfeeds_cloud.sign_in")
                  }
                  isBusy={isBusy}
                  onPress={() => void submitCredentials()}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() => setIsCreatingAccount((current) => !current)}
                >
                  <Text className="py-2 text-center text-link">
                    {isCreatingAccount
                      ? t("feyfeeds_cloud.have_account")
                      : t("feyfeeds_cloud.need_account")}
                  </Text>
                </Pressable>
              </View>
            </GroupedInsetListCard>
          </>
        ) : (
          <>
            <GroupedInsetListCard>
              <View className="gap-3 p-4">
                <Text className="text-sm text-secondary-label">{user.email}</Text>
                <Text className="font-medium text-label">Profile</Text>
                <TextInput
                  value={profileName}
                  onChangeText={setProfileName}
                  maxLength={80}
                  placeholder="Display name"
                  className="rounded-xl bg-secondary-system-background px-4 py-3 text-label"
                />
                <ActionButton
                  disabled={isBusy}
                  label="Save profile"
                  isBusy={isBusy}
                  onPress={() =>
                    void runBusy(async () => {
                      await feyFeedsApi.updateProfile({ name: profileName.trim() || null })
                      toast.success("Profile saved")
                    })
                  }
                />
                <Text className="font-medium text-label">Account language: {accountLanguage}</Text>
                <View className="flex-row gap-2">
                  {(["en", "ja", "zh-CN"] as const).map((language) => (
                    <Pressable
                      key={language}
                      accessibilityRole="button"
                      onPress={() =>
                        void runBusy(async () => {
                          await feyFeedsApi.updatePreferences({ language })
                          setAccountLanguage(language)
                        })
                      }
                      className="rounded-lg bg-secondary-system-background px-3 py-2"
                    >
                      <Text className="text-label">{language}</Text>
                    </Pressable>
                  ))}
                </View>
                <ActionButton
                  disabled={isBusy}
                  label={t("feyfeeds_cloud.sign_out")}
                  isBusy={isBusy}
                  onPress={() =>
                    void runBusy(async () => {
                      try {
                        await feyFeedsApi.logout()
                      } finally {
                        // Keep that account's cache and outbox for a later sign-in.
                        // Namespaced keys ensure another FeyFeeds account cannot read them.
                        await kv.delete("feyfeeds:last-user")
                        setFeeds([])
                        setTimeline([])
                        setFolders([])
                        setLists([])
                        setFolderFeeds({})
                        setListFeeds({})
                        setLibraryResults(null)
                        setPendingCount(0)
                        setUser(null)
                      }
                    })
                  }
                />
                <ActionButton
                  disabled={isBusy}
                  label="Delete FeyFeeds account"
                  isBusy={isBusy}
                  onPress={() =>
                    Alert.alert(
                      "Delete FeyFeeds account?",
                      "This permanently removes your FeyFeeds profile, preferences, sessions, feeds, cached articles, reading states, AI summaries, and queued summary usage. Your Folo account and data are not affected.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete account",
                          style: "destructive",
                          onPress: () =>
                            void runBusy(async () => {
                              const deletedUserId = user.id
                              await feyFeedsApi.deleteAccount()
                              await clearFeyFeedsAccountData(deletedUserId)
                              setFeeds([])
                              setTimeline([])
                              setFolders([])
                              setLists([])
                              setFolderFeeds({})
                              setListFeeds({})
                              setLibraryResults(null)
                              setUser(null)
                              toast.success("FeyFeeds account deleted")
                            }),
                        },
                      ],
                    )
                  }
                />
              </View>
            </GroupedInsetListCard>

            <View className="gap-3">
              <Text className="px-1 text-lg font-semibold text-label">
                {t("feyfeeds_cloud.library_title")}
              </Text>
              <GroupedInsetListCard>
                <View className="gap-3 p-4">
                  <TextInput
                    value={libraryQuery}
                    onChangeText={setLibraryQuery}
                    placeholder={t("feyfeeds_cloud.search_placeholder")}
                    className="rounded-xl bg-secondary-system-background px-4 py-3 text-label"
                  />
                  <ActionButton
                    disabled={isBusy || !libraryQuery.trim()}
                    isBusy={isBusy}
                    label={t("feyfeeds_cloud.search_library")}
                    onPress={() => void searchLibrary()}
                  />
                  {libraryError ? (
                    <View className="gap-2 rounded-xl bg-secondary-system-background p-3">
                      <Text className="text-sm text-red">{libraryError}</Text>
                      <Pressable onPress={() => void searchLibrary()}>
                        <Text className="text-link">{t("feyfeeds_cloud.retry_search")}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {libraryResults ? (
                    <View className="gap-2">
                      <Text className="font-semibold text-label">
                        Feeds · {libraryResults.feeds.length}
                      </Text>
                      {libraryResults.feeds.map((item) => (
                        <Text key={item.id} className="text-sm text-secondary-label">
                          {item.title || item.url}
                        </Text>
                      ))}
                      <Text className="font-semibold text-label">
                        Articles · {libraryResults.entries.length}
                      </Text>
                      {libraryResults.entries.map((item) => (
                        <Text key={item.id} className="text-sm text-secondary-label">
                          {item.title || item.url || "Untitled"}
                        </Text>
                      ))}
                      {libraryResults.feeds.length === 0 && libraryResults.entries.length === 0 ? (
                        <Text className="text-sm text-secondary-label">
                          {t("feyfeeds_cloud.search_empty")}
                        </Text>
                      ) : null}
                      {libraryResults.pagination.feedsHasMore ||
                      libraryResults.pagination.entriesHasMore ? (
                        <Pressable
                          onPress={() => void searchLibrary(libraryResults.pagination.nextOffset)}
                        >
                          <Text className="text-center text-link">
                            {t("feyfeeds_cloud.load_more_results")}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  <TextInput
                    value={libraryName}
                    onChangeText={setLibraryName}
                    placeholder={t("feyfeeds_cloud.collection_name")}
                    className="rounded-xl bg-secondary-system-background px-4 py-3 text-label"
                  />
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <ActionButton
                        disabled={isBusy || !libraryName.trim()}
                        isBusy={isBusy}
                        label={t("feyfeeds_cloud.create_folder")}
                        onPress={() => void createLibraryItem("folder")}
                      />
                    </View>
                    <View className="flex-1">
                      <ActionButton
                        disabled={isBusy || !libraryName.trim()}
                        isBusy={isBusy}
                        label={t("feyfeeds_cloud.create_list")}
                        onPress={() => void createLibraryItem("list")}
                      />
                    </View>
                  </View>
                  {editingCollection ? (
                    <View className="gap-2 rounded-xl bg-secondary-system-background p-3">
                      <TextInput
                        value={renameValue}
                        onChangeText={setRenameValue}
                        placeholder={t("feyfeeds_cloud.rename_collection")}
                        className="rounded-lg bg-system-background px-3 py-2 text-label"
                      />
                      <View className="flex-row gap-3">
                        <Pressable onPress={saveCollectionName}>
                          <Text className="text-link">{t("feyfeeds_cloud.save_name")}</Text>
                        </Pressable>
                        <Pressable onPress={() => setEditingCollection(null)}>
                          <Text className="text-secondary-label">{t("feyfeeds_cloud.cancel")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  {folders.map((folder) => (
                    <View key={folder.id} className="gap-2 border-t border-separator py-2">
                      <View className="flex-row items-center justify-between">
                        <Text className="flex-1 text-sm font-semibold text-label">
                          {t("feyfeeds_cloud.folder_label", { name: folder.name })}
                        </Text>
                        <Pressable onPress={() => void reorderCollection("folder", folder.id, -1)}>
                          <Text className="text-link">↑</Text>
                        </Pressable>
                        <Pressable onPress={() => void reorderCollection("folder", folder.id, 1)}>
                          <Text className="text-link">↓</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setEditingCollection({ kind: "folder", id: folder.id })
                            setRenameValue(folder.name)
                          }}
                        >
                          <Text className="text-link">{t("feyfeeds_cloud.edit_collection")}</Text>
                        </Pressable>
                        <Pressable onPress={() => deleteCollection("folder", folder.id)}>
                          <Text className="text-red">{t("feyfeeds_cloud.delete_collection")}</Text>
                        </Pressable>
                      </View>
                      {feeds
                        .filter((feed) => !folderFeeds[folder.id]?.includes(feed.id))
                        .map((feed) => (
                          <Pressable
                            key={feed.id}
                            onPress={() => void addFeedToCollection("folder", folder.id, feed.id)}
                          >
                            <Text className="text-xs text-link">
                              {t("feyfeeds_cloud.add_feed_to_collection", {
                                name: feed.title || feed.url,
                              })}
                            </Text>
                          </Pressable>
                        ))}
                      {(folderFeeds[folder.id] ?? []).map((feedId) => {
                        const feed = feeds.find((item) => item.id === feedId)
                        return feed ? (
                          <Pressable
                            key={feedId}
                            onPress={() =>
                              void removeFeedFromCollection("folder", folder.id, feedId)
                            }
                          >
                            <Text className="text-xs text-secondary-label">
                              {t("feyfeeds_cloud.remove_feed_from_collection", {
                                name: feed.title || feed.url,
                              })}
                            </Text>
                          </Pressable>
                        ) : null
                      })}
                    </View>
                  ))}
                  {lists.map((list) => (
                    <View key={list.id} className="gap-2 border-t border-separator py-2">
                      <View className="flex-row items-center justify-between">
                        <Text className="flex-1 text-sm font-semibold text-label">
                          {t("feyfeeds_cloud.list_label", {
                            name: list.name,
                            visibility: list.visibility,
                          })}
                        </Text>
                        <Pressable onPress={() => void reorderCollection("list", list.id, -1)}>
                          <Text className="text-link">↑</Text>
                        </Pressable>
                        <Pressable onPress={() => void reorderCollection("list", list.id, 1)}>
                          <Text className="text-link">↓</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setEditingCollection({ kind: "list", id: list.id })
                            setRenameValue(list.name)
                          }}
                        >
                          <Text className="text-link">{t("feyfeeds_cloud.edit_collection")}</Text>
                        </Pressable>
                        <Pressable onPress={() => deleteCollection("list", list.id)}>
                          <Text className="text-red">{t("feyfeeds_cloud.delete_collection")}</Text>
                        </Pressable>
                      </View>
                      {feeds
                        .filter((feed) => !listFeeds[list.id]?.includes(feed.id))
                        .map((feed) => (
                          <Pressable
                            key={feed.id}
                            onPress={() => void addFeedToCollection("list", list.id, feed.id)}
                          >
                            <Text className="text-xs text-link">
                              {t("feyfeeds_cloud.add_feed_to_collection", {
                                name: feed.title || feed.url,
                              })}
                            </Text>
                          </Pressable>
                        ))}
                      {(listFeeds[list.id] ?? []).map((feedId) => {
                        const feed = feeds.find((item) => item.id === feedId)
                        return feed ? (
                          <Pressable
                            key={feedId}
                            onPress={() => void removeFeedFromCollection("list", list.id, feedId)}
                          >
                            <Text className="text-xs text-secondary-label">
                              {t("feyfeeds_cloud.remove_feed_from_collection", {
                                name: feed.title || feed.url,
                              })}
                            </Text>
                          </Pressable>
                        ) : null
                      })}
                      <Pressable onPress={() => void shareList(list.id)}>
                        <Text className="text-sm text-link">
                          {t("feyfeeds_cloud.share_json_link")}
                        </Text>
                      </Pressable>
                      {list.visibility === "link" ? (
                        <Pressable onPress={() => void revokeListShare(list.id)}>
                          <Text className="text-sm text-red">
                            {t("feyfeeds_cloud.revoke_share_link")}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              </GroupedInsetListCard>
            </View>

            <View className="gap-3">
              <Text className="px-1 text-lg font-semibold text-label">
                {t("feyfeeds_cloud.feeds")}
              </Text>
              <GroupedInsetListCard>
                <View className="gap-3 p-4">
                  <TextInput
                    value={feedUrl}
                    onChangeText={setFeedUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder={t("feyfeeds_cloud.feed_url")}
                    className="rounded-xl bg-secondary-system-background px-4 py-3 text-label"
                  />
                  <ActionButton
                    disabled={isBusy || !feedUrl.trim()}
                    label={t("feyfeeds_cloud.add_feed")}
                    isBusy={isBusy}
                    onPress={() => void addFeed()}
                  />
                  <ActionButton
                    disabled={isBusy || !feedUrl.trim()}
                    label={t("feyfeeds_cloud.discover_feeds")}
                    isBusy={isBusy}
                    onPress={() => void discoverFeeds()}
                  />
                  {discoveredFeeds.map((feed) => (
                    <Pressable
                      key={feed.url}
                      accessibilityRole="button"
                      onPress={() => {
                        setFeedUrl(feed.url)
                        setDiscoveredFeeds([])
                      }}
                      className="rounded-lg bg-secondary-system-background p-3"
                    >
                      <Text className="font-medium text-label">{feed.title || feed.url}</Text>
                      <Text className="text-xs text-secondary-label">
                        {feed.type} · {feed.url}
                      </Text>
                    </Pressable>
                  ))}
                  <ActionButton
                    disabled={isBusy}
                    label={t("feyfeeds_cloud.import_opml")}
                    isBusy={isBusy}
                    onPress={() => void importOpml()}
                  />
                </View>
                {feeds.length === 0 ? (
                  <Text className="px-4 pb-4 text-sm text-secondary-label">
                    {t("feyfeeds_cloud.no_feeds")}
                  </Text>
                ) : (
                  feeds.map((feed) => (
                    <View
                      key={feed.id}
                      className="flex-row items-center justify-between gap-2 border-t border-separator px-4 py-3"
                    >
                      <View className="flex-1">
                        <Text className="font-medium text-label">{feed.title || feed.url}</Text>
                        {feed.title ? (
                          <Text className="text-xs text-secondary-label">{feed.url}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isBusy}
                        onPress={() => void refreshFeed(feed.id)}
                      >
                        <Text className="text-link">{t("feyfeeds_cloud.refresh")}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isBusy}
                        onPress={() =>
                          Alert.alert(
                            t("feyfeeds_cloud.remove_feed_title"),
                            t("feyfeeds_cloud.remove_feed_confirm"),
                            [
                              { text: t("feyfeeds_cloud.cancel"), style: "cancel" },
                              {
                                text: t("feyfeeds_cloud.remove"),
                                style: "destructive",
                                onPress: () => void removeFeed(feed),
                              },
                            ],
                          )
                        }
                      >
                        <Text className="text-red">{t("feyfeeds_cloud.remove")}</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </GroupedInsetListCard>
            </View>

            <View className="gap-3">
              <View className="flex-row items-center justify-between px-1">
                <Text className="text-lg font-semibold text-label">
                  {t("feyfeeds_cloud.timeline")}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={() => void refreshTimeline()}
                >
                  <Text className="text-link">{t("feyfeeds_cloud.refresh")}</Text>
                </Pressable>
              </View>
              <GroupedInsetListCard>
                {timeline.length === 0 ? (
                  <Text className="p-4 text-sm text-secondary-label">
                    {t("feyfeeds_cloud.no_articles")}
                  </Text>
                ) : (
                  <>
                    {timeline.map((entry) => (
                      <View key={entry.id} className="gap-2 border-b border-separator p-4">
                        <Text className="font-semibold text-label">
                          {entry.title || entry.url || t("feyfeeds_cloud.untitled")}
                        </Text>
                        <Text className="text-xs text-secondary-label">
                          {entry.feedTitle || entry.feedUrl}
                          {entry.author ? ` · ${entry.author}` : ""}
                        </Text>
                        {entry.summary ? (
                          <Text numberOfLines={3} className="text-sm text-secondary-label">
                            {entry.summary}
                          </Text>
                        ) : null}
                        {entry.url ? (
                          <Pressable
                            accessibilityRole="link"
                            onPress={() => {
                              void Linking.openURL(entry.url!).catch((error: unknown) =>
                                toast.error(getErrorMessage(error)),
                              )
                            }}
                          >
                            <Text className="text-link">{t("feyfeeds_cloud.open_article")}</Text>
                          </Pressable>
                        ) : null}
                        <View className="flex-row gap-4">
                          <Pressable
                            accessibilityRole="button"
                            disabled={isBusy}
                            onPress={() => void showSummary(entry)}
                          >
                            <Text className="text-link">{t("feyfeeds_cloud.summary")}</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isBusy}
                            onPress={() => void toggleEntryState(entry, "isRead")}
                          >
                            <Text className="text-link">
                              {entry.isRead
                                ? t("feyfeeds_cloud.mark_unread")
                                : t("feyfeeds_cloud.mark_read")}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isBusy}
                            onPress={() => void toggleEntryState(entry, "isBookmarked")}
                          >
                            <Text className="text-link">
                              {entry.isBookmarked
                                ? t("feyfeeds_cloud.remove_bookmark")
                                : t("feyfeeds_cloud.bookmark")}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    {timelineCursor ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isBusy}
                        onPress={() => void loadMore()}
                        className="p-4"
                      >
                        <Text className="text-center text-link">
                          {t("feyfeeds_cloud.load_more")}
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </GroupedInsetListCard>
            </View>
          </>
        )}
      </View>
      <BottomModal visible={!!summaryArticle} onClose={() => setSummaryArticle(null)}>
        <View className="m-4 mb-8 gap-4 rounded-2xl bg-system-background p-5">
          <Text className="text-lg font-semibold text-label">{t("feyfeeds_cloud.ai_summary")}</Text>
          <Text className="text-sm text-secondary-label">{summaryArticle?.title || "Article"}</Text>
          {isSummarizing ? (
            <ActivityIndicator />
          ) : summaryError ? (
            <Text className="text-red">{summaryError}</Text>
          ) : (
            <Text selectable className="text-base leading-6 text-label">
              {articleSummary || t("feyfeeds_cloud.summary_empty")}
            </Text>
          )}
          {summaryError ? (
            <Pressable onPress={() => summaryArticle && void showSummary(summaryArticle)}>
              <Text className="text-link">{t("feyfeeds_cloud.summary_retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      </BottomModal>
    </SafeNavigationScrollView>
  )
}

const ActionButton = ({
  disabled,
  isBusy,
  label,
  onPress,
}: {
  disabled: boolean
  isBusy: boolean
  label: string
  onPress: () => void
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    className="min-h-12 flex-row items-center justify-center rounded-xl bg-blue px-4 py-3 disabled:opacity-50"
  >
    {isBusy ? (
      <PlatformActivityIndicator size="small" />
    ) : (
      <Text className="font-semibold text-white">{label}</Text>
    )}
  </Pressable>
)
