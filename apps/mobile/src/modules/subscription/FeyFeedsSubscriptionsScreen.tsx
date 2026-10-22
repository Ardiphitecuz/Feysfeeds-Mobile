import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system/legacy"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { NavigationBlurEffectHeaderView } from "@/src/components/layouts/views/SafeNavigationScrollView"
import { GroupedInsetListCard } from "@/src/components/ui/grouped/GroupedList"
import { BottomModal } from "@/src/components/ui/modal/BottomModal"
import { Text } from "@/src/components/ui/typography/Text"
import { AddCuteReIcon } from "@/src/icons/add_cute_re"
import { Delete2CuteReIcon } from "@/src/icons/delete_2_cute_re"
import { FolderOpenCuteReIcon } from "@/src/icons/folder_open_cute_re"
import { Refresh2CuteReIcon } from "@/src/icons/refresh_2_cute_re"
import { RssCuteFiIcon } from "@/src/icons/rss_cute_fi"
import { Search2CuteReIcon } from "@/src/icons/search_2_cute_re"
import { feyFeedsApi } from "@/src/lib/feyfeeds-api"
import type {
  FeyFeedsDiscoveredFeed,
  FeyFeedsFeed,
  FeyFeedsFolder,
  FeyFeedsList,
  FeyFeedsUser,
} from "@/src/lib/feyfeeds-api-client"
import { FeyFeedsApiError } from "@/src/lib/feyfeeds-api-client"
import {
  cacheFeyFeedsCollections,
  cacheFeyFeedsData,
  enqueueFeyFeedsMutation,
  getCachedFeyFeedsCollections,
  getCachedFeyFeedsData,
  replayFeyFeedsMutations,
} from "@/src/lib/feyfeeds-feed-sync"
import { kv } from "@/src/lib/kv"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { toast } from "@/src/lib/toast"
import { FeyFeedsCloudScreen } from "@/src/modules/settings/routes/FeyFeedsCloud"

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be completed"

export const FeyFeedsSubscriptionsScreen = () => {
  const { t } = useTranslation("settings")
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()

  const [user, setUser] = useState<FeyFeedsUser | null>(null)
  const activeUserIdRef = useRef<string | null>(null)

  const [feeds, setFeeds] = useState<FeyFeedsFeed[]>([])
  const [folders, setFolders] = useState<FeyFeedsFolder[]>([])
  const [lists, setLists] = useState<FeyFeedsList[]>([])
  const [folderFeeds, setFolderFeeds] = useState<Record<string, string[]>>({})
  const [listFeeds, setListFeeds] = useState<Record<string, string[]>>({})

  const [searchQuery, setSearchQuery] = useState("")
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  // Add Feed Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [feedUrlInput, setFeedUrlInput] = useState("")
  const [discoveredFeeds, setDiscoveredFeeds] = useState<FeyFeedsDiscoveredFeed[]>([])

  // Restore user session
  const restoreSession = useCallback(async () => {
    try {
      const sessionUser = await feyFeedsApi.getSession()
      activeUserIdRef.current = sessionUser.id
      setUser(sessionUser)
    } catch (error) {
      if (error instanceof FeyFeedsApiError && error.status === 401) {
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

  // Load collections
  const loadCollections = useCallback(async () => {
    if (!user) return
    try {
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
      await cacheFeyFeedsCollections(
        user.id,
        nextFolders,
        nextLists,
        nextFolderFeeds,
        nextListFeeds,
      )
    } catch {
      // offline fallback
      const cached = await getCachedFeyFeedsCollections(user.id)
      setFolders(cached.folders)
      setLists(cached.lists)
      setFolderFeeds(cached.folderFeeds)
      setListFeeds(cached.listFeeds)
    }
  }, [user])

  // Load feeds
  const loadFeeds = useCallback(
    async (manual = false) => {
      if (!user) return
      if (manual) setIsRefreshing(true)
      try {
        const nextFeeds = await feyFeedsApi.listFeeds()
        setFeeds(nextFeeds)
        await loadCollections()
      } catch (error) {
        if (!manual) {
          const cached = await getCachedFeyFeedsData(user.id)
          setFeeds(cached.feeds)
        } else {
          toast.error(getErrorMessage(error))
        }
      } finally {
        if (manual) setIsRefreshing(false)
      }
    },
    [user, loadCollections],
  )

  useEffect(() => {
    if (user) {
      void loadFeeds()
    }
  }, [user, loadFeeds])

  // Single feed refresh
  const handleRefreshSingleFeed = async (feedId: string) => {
    setIsBusy(true)
    try {
      await feyFeedsApi.refreshFeed(feedId)
      toast.success("Feed refreshed")
      await loadFeeds(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsBusy(false)
    }
  }

  // Remove feed
  const handleRemoveFeed = (feed: FeyFeedsFeed) => {
    if (!user) return
    Alert.alert("Unfollow Feed", `Are you sure you want to unfollow "${feed.title || feed.url}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unfollow",
        style: "destructive",
        onPress: async () => {
          const nextFeeds = feeds.filter((item) => item.id !== feed.id)
          setFeeds(nextFeeds)
          await enqueueFeyFeedsMutation(user.id, { type: "deleteFeed", feedId: feed.id })
          await replayFeyFeedsMutations(user.id)
          toast.success("Feed removed")
        },
      },
    ])
  }

  // Add feed
  const handleAddFeed = async (overrideUrl?: string) => {
    if (!user) return
    const url = (overrideUrl || feedUrlInput).trim()
    if (!url) return
    setIsBusy(true)
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
      setFeeds((prev) => [optimisticFeed, ...prev.filter((item) => item.url !== url)])
      setFeedUrlInput("")
      setDiscoveredFeeds([])
      setIsAddModalOpen(false)
      await replayFeyFeedsMutations(user.id)
      toast.success("Feed added")
      await loadFeeds(true)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsBusy(false)
    }
  }

  // Discover feeds
  const handleDiscover = async () => {
    const url = feedUrlInput.trim()
    if (!url) return
    setIsBusy(true)
    try {
      const result = await feyFeedsApi.discoverFeeds(url)
      setDiscoveredFeeds(result)
      if (result.length === 0) toast.error("No feeds discovered")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsBusy(false)
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
      setIsBusy(true)
      const importResult = await feyFeedsApi.importOpml(xml)
      toast.success(`Imported ${importResult.data.imported} feeds`)
      setIsAddModalOpen(false)
      await loadFeeds(true)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsBusy(false)
    }
  }

  // Filtered feeds list
  const filteredFeeds = useMemo(() => {
    if (!searchQuery.trim()) return feeds
    const q = searchQuery.toLowerCase().trim()
    return feeds.filter(
      (feed) =>
        (feed.title && feed.title.toLowerCase().includes(q)) || feed.url.toLowerCase().includes(q),
    )
  }, [feeds, searchQuery])

  if (!user) {
    return (
      <View className="flex-1 items-center justify-center bg-system-background px-6">
        <Text className="text-xl font-bold text-label mb-2">Subscriptions</Text>
        <Text className="text-sm text-secondary-label text-center mb-6">
          Sign in to view and manage your feed subscriptions.
        </Text>
        <Pressable
          onPress={() => navigation.pushControllerView(FeyFeedsCloudScreen)}
          className="rounded-xl bg-accent px-6 py-3"
        >
          <Text className="text-sm font-semibold text-white">Sign In</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-system-background">
      <NavigationBlurEffectHeaderView
        headerLeft={() => (
          <Text className="text-xl font-bold tracking-tight text-label pl-3">Subscriptions</Text>
        )}
        headerRight={() => (
          <View className="flex-row items-center gap-1 pr-2">
            <Pressable
              onPress={() => setIsAddModalOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-secondary-system-background"
            >
              <AddCuteReIcon color="#2563EB" width={22} height={22} />
            </Pressable>
            <Pressable
              disabled={isRefreshing}
              onPress={() => void loadFeeds(true)}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-secondary-system-background"
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" />
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
          paddingHorizontal: 16,
        }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => void loadFeeds(true)} />
        }
      >
        {/* Search Bar */}
        <View className="flex-row items-center rounded-xl bg-secondary-system-background px-3 py-2.5 my-3 gap-2">
          <Search2CuteReIcon color="#8E8E93" width={16} height={16} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search subscriptions..."
            className="flex-1 text-sm text-label py-0"
            placeholderTextColor="#8E8E93"
          />
        </View>

        {/* Folders Summary */}
        {folders.length > 0 ? (
          <View className="mb-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-secondary-label mb-2 px-1">
              Folders
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
              {folders.map((folder) => {
                const count = (folderFeeds[folder.id] ?? []).length
                return (
                  <View
                    key={folder.id}
                    className="flex-row items-center gap-1.5 rounded-xl bg-secondary-system-background px-3 py-2 border border-separator/30"
                  >
                    <FolderOpenCuteReIcon color="#2563EB" width={14} height={14} />
                    <Text className="text-xs font-semibold text-label">{folder.name}</Text>
                    <Text className="text-xs text-secondary-label">({count})</Text>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Subscribed Feeds List */}
        <View className="mb-2">
          <Text className="text-xs font-bold uppercase tracking-wider text-secondary-label mb-2 px-1">
            All Feeds ({filteredFeeds.length})
          </Text>

          {filteredFeeds.length === 0 ? (
            <View className="items-center justify-center py-12">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary-system-background mb-3">
                <RssCuteFiIcon color="#8E8E93" width={24} height={24} />
              </View>
              <Text className="text-sm font-semibold text-label mb-1">
                {searchQuery ? "No matching feeds" : "No subscriptions yet"}
              </Text>
              <Text className="text-xs text-secondary-label text-center max-w-[240px] mb-4">
                {searchQuery
                  ? "Try searching for a different keyword or URL."
                  : "Tap + in the top right to follow your favorite RSS feed."}
              </Text>
              {!searchQuery ? (
                <Pressable
                  onPress={() => setIsAddModalOpen(true)}
                  className="rounded-xl bg-accent px-4 py-2"
                >
                  <Text className="text-xs font-semibold text-white">+ Follow Feed</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="rounded-2xl bg-secondary-system-background/60 overflow-hidden border border-separator/30">
              {filteredFeeds.map((feed, index) => (
                <View
                  key={feed.id}
                  className={`flex-row items-center justify-between p-3.5 bg-system-background ${
                    index > 0 ? "border-t border-separator/20" : ""
                  }`}
                >
                  <View className="flex-row items-center gap-3 flex-1 mr-2">
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-secondary-system-background border border-separator/20">
                      <Text className="text-xs font-bold text-accent">
                        {(feed.title || feed.url).charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-sm font-semibold text-label">
                        {feed.title || feed.url}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-secondary-label mt-0.5">
                        {feed.url}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2">
                    <Pressable
                      disabled={isBusy}
                      onPress={() => void handleRefreshSingleFeed(feed.id)}
                      className="h-8 w-8 items-center justify-center rounded-full active:bg-secondary-system-background"
                    >
                      <Refresh2CuteReIcon color="#8E8E93" width={16} height={16} />
                    </Pressable>
                    <Pressable
                      disabled={isBusy}
                      onPress={() => handleRemoveFeed(feed)}
                      className="h-8 w-8 items-center justify-center rounded-full active:bg-secondary-system-background"
                    >
                      <Delete2CuteReIcon color="#EF4444" width={16} height={16} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add Feed Modal */}
      <BottomModal visible={isAddModalOpen} onClose={() => setIsAddModalOpen(false)}>
        <View className="m-4 mb-8 gap-4 rounded-2xl bg-system-background p-5">
          <Text className="text-lg font-bold text-label">Follow New Feed</Text>

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
              disabled={isBusy || !feedUrlInput.trim()}
              onPress={() => void handleAddFeed()}
              className="flex-1 rounded-xl bg-accent py-3 items-center justify-center active:opacity-80"
            >
              {isBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text className="text-sm font-semibold text-white">Follow</Text>
              )}
            </Pressable>
            <Pressable
              disabled={isBusy || !feedUrlInput.trim()}
              onPress={() => void handleDiscover()}
              className="rounded-xl bg-secondary-system-background px-4 py-3 items-center justify-center active:opacity-80"
            >
              <Text className="text-sm font-medium text-label">Discover</Text>
            </Pressable>
          </View>

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
    </View>
  )
}
