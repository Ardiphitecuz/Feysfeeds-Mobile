import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system/legacy"
import * as WebBrowser from "expo-web-browser"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { NavigationBlurEffectHeaderView } from "@/src/components/layouts/views/SafeNavigationScrollView"
import { PlatformActivityIndicator } from "@/src/components/ui/loading/PlatformActivityIndicator"
import { BottomModal } from "@/src/components/ui/modal/BottomModal"
import { Text } from "@/src/components/ui/typography/Text"
import { AddCuteReIcon } from "@/src/icons/add_cute_re"
import { AiCuteFiIcon } from "@/src/icons/ai_cute_fi"
import { CheckCircleCuteReIcon } from "@/src/icons/check_circle_cute_re"
import { CheckCircleFilledIcon } from "@/src/icons/check_circle_filled"
import { Refresh2CuteReIcon } from "@/src/icons/refresh_2_cute_re"
import { RssCuteFiIcon } from "@/src/icons/rss_cute_fi"
import { StarCuteFiIcon } from "@/src/icons/star_cute_fi"
import { StarCuteReIcon } from "@/src/icons/star_cute_re"
import { User3CuteFiIcon } from "@/src/icons/user_3_cute_fi"
import { feyFeedsApi } from "@/src/lib/feyfeeds-api"
import type {
  FeyFeedsDiscoveredFeed,
  FeyFeedsFeed,
  FeyFeedsTimelineEntry,
  FeyFeedsUser,
} from "@/src/lib/feyfeeds-api-client"
import { FeyFeedsApiError } from "@/src/lib/feyfeeds-api-client"
import {
  cacheFeyFeedsData,
  enqueueFeyFeedsMutation,
  getCachedFeyFeedsData,
  pendingFeyFeedsMutationCount,
  replayFeyFeedsMutations,
} from "@/src/lib/feyfeeds-feed-sync"
import { kv } from "@/src/lib/kv"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { toast } from "@/src/lib/toast"
import { FeyFeedsCloudScreen } from "@/src/modules/settings/routes/FeyFeedsCloud"

type TimelineFilter = "all" | "unread" | "starred"

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be completed"

const formatRelativeTime = (timestamp: number): string => {
  const diffMs = Date.now() - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export const FeyFeedsHomeScreen = () => {
  const { t, i18n } = useTranslation("settings")
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()

  const [user, setUser] = useState<FeyFeedsUser | null>(null)
  const activeUserIdRef = useRef<string | null>(null)

  const [feeds, setFeeds] = useState<FeyFeedsFeed[]>([])
  const [timeline, setTimeline] = useState<FeyFeedsTimelineEntry[]>([])
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null)

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>("all")
  const [pendingCount, setPendingCount] = useState(0)
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null)

  // Add Feed Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [feedUrlInput, setFeedUrlInput] = useState("")
  const [discoveredFeeds, setDiscoveredFeeds] = useState<FeyFeedsDiscoveredFeed[]>([])
  const [isAddingFeed, setIsAddingFeed] = useState(false)

  // AI Summary Modal State
  const [summaryArticle, setSummaryArticle] = useState<FeyFeedsTimelineEntry | null>(null)
  const [articleSummary, setArticleSummary] = useState("")
  const [summaryError, setSummaryError] = useState("")
  const [isSummarizing, setIsSummarizing] = useState(false)

  // Restore session
  const restoreSession = useCallback(async () => {
    try {
      const sessionUser = await feyFeedsApi.getSession()
      if (activeUserIdRef.current && activeUserIdRef.current !== sessionUser.id) {
        setFeeds([])
        setTimeline([])
      }
      activeUserIdRef.current = sessionUser.id
      setUser(sessionUser)
      await kv.set("feyfeeds:last-user", JSON.stringify(sessionUser))
    } catch (error) {
      if (error instanceof FeyFeedsApiError && error.status === 401) {
        await kv.delete("feyfeeds:last-user")
        setUser(null)
        activeUserIdRef.current = null
        return
      }
      const cached = await kv.get("feyfeeds:last-user")
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as FeyFeedsUser
          setUser(parsed)
          activeUserIdRef.current = parsed.id
        } catch {
          setUser(null)
        }
      }
    }
  }, [])

  useEffect(() => {
    void restoreSession()
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void restoreSession()
    })
    return () => {
      subscription.remove()
    }
  }, [restoreSession])

  // Load cached and live data
  const loadData = useCallback(
    async (isManualRefresh = false) => {
      if (!user) return
      if (isManualRefresh) setIsRefreshing(true)

      try {
        // Load cache first if available
        if (!isManualRefresh) {
          const cached = await getCachedFeyFeedsData(user.id)
          if (cached.feeds.length || cached.entries.length) {
            setFeeds(cached.feeds)
            setTimeline(cached.entries)
          }
        }

        // Replay outbox
        const replay = await replayFeyFeedsMutations(user.id)
        setPendingCount(replay.remaining)
        if (replay.error) {
          setOfflineMessage(`Sync pending: ${replay.error}`)
        } else {
          setOfflineMessage(null)
        }

        // Fetch live from server
        const [nextFeeds, nextTimeline] = await Promise.all([
          feyFeedsApi.listFeeds(),
          feyFeedsApi.getTimeline(),
        ])

        setFeeds(nextFeeds)
        setTimeline(nextTimeline.data)
        setTimelineCursor(nextTimeline.pagination.nextCursor)
        await cacheFeyFeedsData(user.id, nextFeeds, nextTimeline.data)
      } catch (error) {
        setOfflineMessage(getErrorMessage(error))
      } finally {
        if (isManualRefresh) setIsRefreshing(false)
      }
    },
    [user],
  )

  useEffect(() => {
    if (user) {
      void loadData()
    }
  }, [user, loadData])

  // Load more timeline
  const loadMore = async () => {
    if (!timelineCursor || isLoadingMore || !user) return
    setIsLoadingMore(true)
    try {
      const nextTimeline = await feyFeedsApi.getTimeline({ cursor: timelineCursor })
      const merged = [...timeline, ...nextTimeline.data]
      setTimeline(merged)
      setTimelineCursor(nextTimeline.pagination.nextCursor)
      await cacheFeyFeedsData(user.id, feeds, merged)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Toggle Read / Bookmark state
  const toggleEntryState = async (
    entry: FeyFeedsTimelineEntry,
    field: "isRead" | "isBookmarked",
  ) => {
    if (!user) return
    const nextValue = !entry[field]
    const nextTimeline = timeline.map((item) =>
      item.id === entry.id ? { ...item, [field]: nextValue } : item,
    )
    setTimeline(nextTimeline)
    await cacheFeyFeedsData(user.id, feeds, nextTimeline)

    await enqueueFeyFeedsMutation(user.id, {
      type: "entryState",
      entryId: entry.id,
      state: { [field]: nextValue },
    })

    const replay = await replayFeyFeedsMutations(user.id)
    setPendingCount(replay.remaining)
  }

  // Open article
  const openArticle = async (entry: FeyFeedsTimelineEntry) => {
    if (!entry.url) return
    if (!entry.isRead) {
      void toggleEntryState(entry, "isRead")
    }
    try {
      await WebBrowser.openBrowserAsync(entry.url)
    } catch {
      await Linking.openURL(entry.url).catch((err: unknown) => {
        toast.error(getErrorMessage(err))
      })
    }
  }

  // Show AI Summary
  const showSummary = async (entry: FeyFeedsTimelineEntry) => {
    const language = i18n.language === "zh" ? "zh-CN" : i18n.language.split("-")[0] || "en"
    setSummaryArticle(entry)
    setArticleSummary("")
    setSummaryError("")
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

  // Add Feed
  const handleAddFeed = async (overrideUrl?: string) => {
    if (!user) return
    const url = (overrideUrl || feedUrlInput).trim()
    if (!url) return

    setIsAddingFeed(true)
    try {
      await enqueueFeyFeedsMutation(user.id, { type: "addFeed", url })
      const optimisticFeed: FeyFeedsFeed = {
        id: `pending:${url}`,
        url,
        title: null,
        createdAt: Date.now(),
        lastFetchedAt: null,
        lastError: null,
      }
      const nextFeeds = [optimisticFeed, ...feeds.filter((item) => item.url !== url)]
      setFeeds(nextFeeds)
      await cacheFeyFeedsData(user.id, nextFeeds, timeline)
      setFeedUrlInput("")
      setDiscoveredFeeds([])
      setIsAddModalOpen(false)

      const replay = await replayFeyFeedsMutations(user.id)
      setPendingCount(replay.remaining)
      if (replay.remaining === 0) {
        toast.success("Feed subscribed successfully")
        await loadData(true)
      } else {
        toast.success("Feed saved locally; will sync when connected")
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsAddingFeed(false)
    }
  }

  // Discover feeds
  const handleDiscover = async () => {
    const url = feedUrlInput.trim()
    if (!url) return
    setIsAddingFeed(true)
    try {
      const result = await feyFeedsApi.discoverFeeds(url)
      setDiscoveredFeeds(result)
      if (result.length === 0) {
        toast.error("No RSS or Atom feeds found at this URL")
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsAddingFeed(false)
    }
  }

  // Import OPML
  const handleImportOpml = async () => {
    if (!user) return
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/xml", "text/xml", "text/x-opml", "application/octet-stream"],
      })
      if (result.canceled || !result.assets[0]) return
      const file = result.assets[0]
      const xml = await FileSystem.readAsStringAsync(file.uri)
      setIsAddingFeed(true)
      const importResult = await feyFeedsApi.importOpml(xml)
      toast.success(`Imported ${importResult.data.imported} feeds`)
      setIsAddModalOpen(false)
      await loadData(true)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsAddingFeed(false)
    }
  }

  // Filtered timeline
  const filteredTimeline = useMemo(() => {
    if (activeFilter === "unread") return timeline.filter((item) => !item.isRead)
    if (activeFilter === "starred") return timeline.filter((item) => item.isBookmarked)
    return timeline
  }, [timeline, activeFilter])

  // Not signed in state
  if (!user) {
    return (
      <View className="flex-1 items-center justify-center bg-system-background px-6">
        <View className="h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10 mb-4">
          <RssCuteFiIcon color="#F97316" width={36} height={36} />
        </View>
        <Text className="text-2xl font-bold text-label text-center mb-2">Welcome to FeyFeeds</Text>
        <Text className="text-sm text-secondary-label text-center leading-5 mb-8">
          Sign in to your FeyFeeds Cloud account to sync subscriptions, read articles, and use AI
          summaries.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.pushControllerView(FeyFeedsCloudScreen)}
          className="w-full rounded-2xl bg-accent py-3.5 items-center justify-center active:opacity-80"
        >
          <Text className="text-base font-semibold text-white">Sign In / Create Account</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-system-background">
      <NavigationBlurEffectHeaderView
        headerLeft={() => (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.pushControllerView(FeyFeedsCloudScreen)}
            className="flex-row items-center gap-2 pl-2"
          >
            <View className="h-8 w-8 items-center justify-center rounded-full bg-accent/15">
              <User3CuteFiIcon color="#2563EB" width={18} height={18} />
            </View>
            <Text className="text-lg font-bold tracking-tight text-label">FeyFeeds</Text>
          </Pressable>
        )}
        headerRight={() => (
          <View className="flex-row items-center gap-1 pr-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsAddModalOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-secondary-system-background"
            >
              <AddCuteReIcon color="#2563EB" width={22} height={22} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isRefreshing}
              onPress={() => void loadData(true)}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-secondary-system-background"
            >
              {isRefreshing ? (
                <PlatformActivityIndicator />
              ) : (
                <Refresh2CuteReIcon color="#8E8E93" width={20} height={20} />
              )}
            </Pressable>
          </View>
        )}
      />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 54,
          paddingBottom: insets.bottom + 80,
        }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => void loadData(true)} />
        }
      >
        {/* Offline / Pending banner */}
        {offlineMessage ? (
          <View className="mx-4 mt-2 rounded-xl bg-orange-500/10 px-3 py-2">
            <Text className="text-xs text-orange-600 dark:text-orange-400">{offlineMessage}</Text>
          </View>
        ) : null}
        {pendingCount > 0 ? (
          <View className="mx-4 mt-1 rounded-xl bg-secondary-system-background px-3 py-1.5">
            <Text className="text-xs text-secondary-label">
              {pendingCount} change(s) syncing in background...
            </Text>
          </View>
        ) : null}

        {/* Filter Tabs */}
        <View className="flex-row items-center gap-2 px-4 py-3 border-b border-separator/30">
          {(
            [
              { id: "all", label: "All" },
              { id: "unread", label: "Unread" },
              { id: "starred", label: "Saved" },
            ] as const
          ).map((filter) => {
            const isActive = activeFilter === filter.id
            return (
              <Pressable
                key={filter.id}
                onPress={() => setActiveFilter(filter.id)}
                className={`rounded-full px-4 py-1.5 ${
                  isActive
                    ? "bg-accent"
                    : "bg-secondary-system-background active:bg-tertiary-system-background"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    isActive ? "text-white" : "text-secondary-label"
                  }`}
                >
                  {filter.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {/* Empty State */}
        {feeds.length === 0 ? (
          <View className="items-center justify-center px-6 py-16">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-secondary-system-background mb-4">
              <RssCuteFiIcon color="#8E8E93" width={32} height={32} />
            </View>
            <Text className="text-xl font-bold text-label mb-2 text-center">
              Your Timeline is Empty
            </Text>
            <Text className="text-sm text-secondary-label text-center leading-5 mb-6 max-w-[280px]">
              Follow your favorite RSS feeds, websites, or import an OPML file to read articles
              here.
            </Text>
            <Pressable
              onPress={() => setIsAddModalOpen(true)}
              className="rounded-xl bg-accent px-6 py-3 items-center active:opacity-80 mb-3"
            >
              <Text className="text-sm font-semibold text-white">+ Follow Your First Feed</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleImportOpml()}
              className="rounded-xl bg-secondary-system-background px-6 py-3 items-center active:opacity-80"
            >
              <Text className="text-sm font-medium text-label">Import OPML Backup</Text>
            </Pressable>
          </View>
        ) : filteredTimeline.length === 0 ? (
          <View className="items-center justify-center px-6 py-16">
            <Text className="text-base font-medium text-secondary-label">
              {activeFilter === "unread"
                ? "All caught up! No unread articles."
                : activeFilter === "starred"
                  ? "No saved articles yet."
                  : "No articles to show."}
            </Text>
          </View>
        ) : (
          /* Timeline Article Cards */
          <View>
            {filteredTimeline.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => void openArticle(entry)}
                className="border-b border-separator/30 px-4 py-3.5 bg-system-background active:bg-secondary-system-background/60"
              >
                {/* Feed info & Time */}
                <View className="flex-row items-center justify-between mb-1.5">
                  <View className="flex-row items-center gap-2 flex-1 mr-2">
                    <View className="h-5 w-5 items-center justify-center rounded-md bg-secondary-system-background">
                      <Text className="text-[10px] font-bold text-secondary-label">
                        {(entry.feedTitle || entry.feedUrl || "F").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={1}
                      className="text-xs font-semibold text-secondary-label flex-1"
                    >
                      {entry.feedTitle || entry.feedUrl}
                    </Text>
                    <Text className="text-xs text-secondary-label/60">·</Text>
                    <Text className="text-xs text-secondary-label/80">
                      {formatRelativeTime(entry.publishedAt)}
                    </Text>
                  </View>

                  {!entry.isRead ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
                </View>

                {/* Article Title */}
                <Text
                  numberOfLines={2}
                  className={`text-base leading-snug font-semibold ${
                    entry.isRead ? "text-secondary-label font-normal" : "text-label"
                  }`}
                >
                  {entry.title || entry.url || "Untitled"}
                </Text>

                {/* Snippet preview */}
                {entry.summary ? (
                  <Text numberOfLines={2} className="mt-1 text-xs leading-4 text-secondary-label">
                    {entry.summary}
                  </Text>
                ) : null}

                {/* Actions Row */}
                <View className="flex-row items-center justify-between mt-3 pt-1">
                  <View className="flex-row items-center gap-4">
                    {/* Read / Unread */}
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation()
                        void toggleEntryState(entry, "isRead")
                      }}
                      className="flex-row items-center gap-1.5 active:opacity-60"
                    >
                      {entry.isRead ? (
                        <CheckCircleFilledIcon color="#10B981" width={16} height={16} />
                      ) : (
                        <CheckCircleCuteReIcon color="#8E8E93" width={16} height={16} />
                      )}
                      <Text
                        className={`text-xs ${
                          entry.isRead ? "text-emerald-600 font-medium" : "text-secondary-label"
                        }`}
                      >
                        {entry.isRead ? "Read" : "Mark read"}
                      </Text>
                    </Pressable>

                    {/* Bookmark */}
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation()
                        void toggleEntryState(entry, "isBookmarked")
                      }}
                      className="flex-row items-center gap-1.5 active:opacity-60"
                    >
                      {entry.isBookmarked ? (
                        <StarCuteFiIcon color="#F59E0B" width={16} height={16} />
                      ) : (
                        <StarCuteReIcon color="#8E8E93" width={16} height={16} />
                      )}
                      <Text
                        className={`text-xs ${
                          entry.isBookmarked ? "text-amber-500 font-medium" : "text-secondary-label"
                        }`}
                      >
                        {entry.isBookmarked ? "Saved" : "Save"}
                      </Text>
                    </Pressable>
                  </View>

                  {/* AI Summary Badge */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation()
                      void showSummary(entry)
                    }}
                    className="flex-row items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 active:bg-accent/20"
                  >
                    <AiCuteFiIcon color="#2563EB" width={12} height={12} />
                    <Text className="text-[11px] font-semibold text-accent">AI Summary</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}

            {/* Pagination Load More */}
            {timelineCursor ? (
              <View className="p-4 items-center">
                <Pressable
                  disabled={isLoadingMore}
                  onPress={() => void loadMore()}
                  className="rounded-xl bg-secondary-system-background px-6 py-3 active:opacity-70"
                >
                  {isLoadingMore ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text className="text-sm font-semibold text-link">Load More Articles</Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Add Feed Modal */}
      <BottomModal visible={isAddModalOpen} onClose={() => setIsAddModalOpen(false)}>
        <View className="m-4 mb-8 gap-4 rounded-2xl bg-system-background p-5">
          <Text className="text-lg font-bold text-label">Follow New Feed</Text>
          <Text className="text-xs text-secondary-label -mt-2">
            Enter an RSS, Atom, or JSON Feed URL, or any website address.
          </Text>

          <TextInput
            value={feedUrlInput}
            onChangeText={setFeedUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://example.com/feed.xml"
            className="rounded-xl bg-secondary-system-background px-4 py-3 text-label text-sm"
          />

          <View className="flex-row gap-2">
            <Pressable
              disabled={isAddingFeed || !feedUrlInput.trim()}
              onPress={() => void handleAddFeed()}
              className="flex-1 rounded-xl bg-accent py-3 items-center justify-center active:opacity-80"
            >
              {isAddingFeed ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-sm font-semibold text-white">Follow Feed</Text>
              )}
            </Pressable>
            <Pressable
              disabled={isAddingFeed || !feedUrlInput.trim()}
              onPress={() => void handleDiscover()}
              className="rounded-xl bg-secondary-system-background px-4 py-3 items-center justify-center active:opacity-80"
            >
              <Text className="text-sm font-medium text-label">Discover</Text>
            </Pressable>
          </View>

          {/* Discovered Feeds List */}
          {discoveredFeeds.length > 0 ? (
            <View className="gap-2 pt-2 border-t border-separator/40">
              <Text className="text-xs font-semibold text-secondary-label">Found Feeds:</Text>
              {discoveredFeeds.map((item) => (
                <Pressable
                  key={item.url}
                  onPress={() => void handleAddFeed(item.url)}
                  className="rounded-xl bg-secondary-system-background p-3 active:bg-tertiary-system-background"
                >
                  <Text className="text-sm font-semibold text-label">
                    {item.title || "Discovered Feed"}
                  </Text>
                  <Text numberOfLines={1} className="text-xs text-secondary-label mt-0.5">
                    {item.type.toUpperCase()} · {item.url}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="items-center pt-2">
            <Pressable onPress={() => void handleImportOpml()} className="py-2">
              <Text className="text-xs font-semibold text-link">Or Import OPML file</Text>
            </Pressable>
          </View>
        </View>
      </BottomModal>

      {/* AI Summary Modal */}
      <BottomModal visible={!!summaryArticle} onClose={() => setSummaryArticle(null)}>
        <View className="m-4 mb-8 gap-4 rounded-2xl bg-system-background p-5">
          <View className="flex-row items-center gap-2">
            <AiCuteFiIcon color="#2563EB" width={20} height={20} />
            <Text className="text-lg font-bold text-label">AI Summary</Text>
          </View>
          <Text numberOfLines={2} className="text-sm font-semibold text-secondary-label">
            {summaryArticle?.title || "Article"}
          </Text>

          {isSummarizing ? (
            <View className="py-8 items-center justify-center">
              <ActivityIndicator size="large" color="#2563EB" />
              <Text className="text-xs text-secondary-label mt-3">
                Generating Gemini summary...
              </Text>
            </View>
          ) : summaryError ? (
            <View className="py-4">
              <Text className="text-sm text-red mb-3">{summaryError}</Text>
              <Pressable
                onPress={() => summaryArticle && void showSummary(summaryArticle)}
                className="rounded-xl bg-secondary-system-background py-2.5 items-center"
              >
                <Text className="text-sm font-semibold text-link">Retry</Text>
              </Pressable>
            </View>
          ) : (
            <View className="rounded-xl bg-secondary-system-background/60 p-4">
              <Text selectable className="text-sm leading-6 text-label">
                {articleSummary || "No summary available."}
              </Text>
            </View>
          )}
        </View>
      </BottomModal>
    </View>
  )
}
