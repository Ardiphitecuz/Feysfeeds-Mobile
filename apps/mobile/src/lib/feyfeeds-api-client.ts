export type FeyFeedsUser = { id: string; email: string; name: string | null }
export type FeyFeedsProfile = FeyFeedsUser & { createdAt: number }
export type FeyFeedsPreferences = { language: "en" | "ja" | "zh-CN"; updatedAt?: number | null }
export type FeyFeedsSession = { user: FeyFeedsUser; token: string; expiresAt: number }

export type FeyFeedsFeed = {
  id: string
  url: string
  title: string | null
  createdAt: number
  lastFetchedAt: number | null
  lastError: string | null
}

export type FeyFeedsTimelineEntry = {
  id: string
  feedId: string
  feedTitle: string | null
  feedUrl: string
  title: string | null
  url: string | null
  content: string | null
  summary: string | null
  author: string | null
  categories?: string[]
  attachments?: {
    url: string
    mimeType: string | null
    title: string | null
    sizeInBytes: number | null
  }[]
  publishedAt: number
  isRead: boolean
  isBookmarked: boolean
}

export type FeyFeedsTimelinePage = {
  data: FeyFeedsTimelineEntry[]
  pagination: { hasMore: boolean; nextCursor: string | null }
}

export type FeyFeedsImportResult = { imported: number; skipped: number }
export type FeyFeedsDiscoveredFeed = {
  url: string
  title: string | null
  type: "rss" | "atom" | "json"
}
export type FeyFeedsFolder = { id: string; name: string; position: number }
export type FeyFeedsList = {
  id: string
  name: string
  description: string | null
  visibility: "private" | "link"
  position: number
}
export type FeyFeedsSearchResult = {
  feeds: FeyFeedsFeed[]
  entries: {
    id: string
    feed_id: string
    feed_title: string | null
    feed_url: string
    title: string | null
    url: string | null
    published_at: number
  }[]
  pagination: {
    offset: number
    limit: number
    feedsHasMore: boolean
    entriesHasMore: boolean
    nextOffset: number
  }
}

type FeyFeedsApiDependencies = {
  baseUrl: string | (() => string)
  requireHttps?: boolean
  getSessionToken: () => Promise<string | null>
  setSessionToken: (token: string | null) => Promise<void>
  fetcher?: typeof fetch
}
type ApiEnvelope<T> = { data: T }

export class FeyFeedsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "FeyFeedsApiError"
  }
}

const readErrorMessage = async (response: Response): Promise<string> => {
  const body = await response.text()
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body)
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        const message = Reflect.get(parsed, "error")
        if (typeof message === "string" && message) return message
      }
    } catch {
      return `FeyFeeds API returned HTTP ${response.status}`
    }
  }
  return `FeyFeeds API returned HTTP ${response.status}`
}

export const createFeyFeedsApiClient = ({
  baseUrl,
  requireHttps = process.env.NODE_ENV === "production",
  getSessionToken,
  setSessionToken,
  fetcher = fetch,
}: FeyFeedsApiDependencies) => {
  const request = async <T>(
    path: string,
    init: RequestInit = {},
    authenticated = true,
  ): Promise<T> => {
    const headers = new Headers(init.headers)
    if (authenticated) {
      const token = await getSessionToken()
      if (!token) throw new FeyFeedsApiError("Authentication required", 401)
      headers.set("Authorization", `Bearer ${token}`)
    }
    if (init.body !== undefined) headers.set("Content-Type", "application/json")
    const configuredBaseUrl = typeof baseUrl === "function" ? baseUrl() : baseUrl
    let parsedBaseUrl: URL
    try {
      parsedBaseUrl = new URL(configuredBaseUrl)
    } catch {
      throw new Error("FeyFeeds API URL is missing or malformed for the selected environment")
    }
    if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
      throw new Error("FeyFeeds API URL must use HTTP or HTTPS")
    }
    if (requireHttps && parsedBaseUrl.protocol !== "https:") {
      throw new Error("Production FeyFeeds API URL must use HTTPS")
    }
    const response = await fetcher(`${configuredBaseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
    })
    if (!response.ok) {
      if (authenticated && response.status === 401) await setSessionToken(null)
      throw new FeyFeedsApiError(await readErrorMessage(response), response.status)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  const saveAuthResponse = async (promise: Promise<ApiEnvelope<FeyFeedsSession>>) => {
    const result = await promise
    await setSessionToken(result.data.token)
    return result.data.user
  }

  return {
    hasSessionToken: async () => Boolean(await getSessionToken()),
    register: (email: string, password: string) =>
      saveAuthResponse(
        request<ApiEnvelope<FeyFeedsSession>>(
          "/v1/auth/register",
          { method: "POST", body: JSON.stringify({ email, password }) },
          false,
        ),
      ),
    login: (email: string, password: string) =>
      saveAuthResponse(
        request<ApiEnvelope<FeyFeedsSession>>(
          "/v1/auth/login",
          { method: "POST", body: JSON.stringify({ email, password }) },
          false,
        ),
      ),
    getSession: async () => {
      const response = await request<ApiEnvelope<FeyFeedsUser>>("/v1/auth/session")
      return response.data
    },
    getProfile: async () =>
      (await request<ApiEnvelope<FeyFeedsProfile>>("/v1/account/profile")).data,
    updateProfile: async (profile: { name: string | null }) =>
      request<ApiEnvelope<{ success: boolean }>>("/v1/account/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      }),
    getPreferences: async () =>
      (await request<ApiEnvelope<FeyFeedsPreferences>>("/v1/account/preferences")).data,
    updatePreferences: async (preferences: FeyFeedsPreferences) =>
      request<ApiEnvelope<FeyFeedsPreferences>>("/v1/account/preferences", {
        method: "PUT",
        body: JSON.stringify(preferences),
      }),
    deleteAccount: async () => {
      await request<ApiEnvelope<{ deleted: boolean }>>("/v1/account", { method: "DELETE" })
      await setSessionToken(null)
    },
    logout: async () => {
      try {
        await request("/v1/auth/logout", { method: "POST" })
      } finally {
        await setSessionToken(null)
      }
    },
    listFeeds: async () => (await request<ApiEnvelope<FeyFeedsFeed[]>>("/v1/feeds")).data,
    searchLibrary: async (query: string, offset = 0) =>
      (
        await request<ApiEnvelope<FeyFeedsSearchResult>>(
          `/v1/library/search?q=${encodeURIComponent(query)}&offset=${offset}`,
        )
      ).data,
    listFolders: async () =>
      (await request<ApiEnvelope<FeyFeedsFolder[]>>("/v1/library/folders")).data,
    createFolder: async (name: string, id?: string) =>
      (
        await request<ApiEnvelope<FeyFeedsFolder>>("/v1/library/folders", {
          method: "POST",
          body: JSON.stringify({ name, ...(id ? { id } : {}) }),
        })
      ).data,
    renameFolder: (id: string, name: string) =>
      request(`/v1/library/folders/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    deleteFolder: (id: string) =>
      request<void>(`/v1/library/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),
    addFeedToFolder: (folderId: string, feedId: string) =>
      request(`/v1/library/folders/${encodeURIComponent(folderId)}/feeds`, {
        method: "POST",
        body: JSON.stringify({ feedId }),
      }),
    removeFeedFromFolder: (folderId: string, feedId: string) =>
      request<void>(
        `/v1/library/folders/${encodeURIComponent(folderId)}/feeds/${encodeURIComponent(feedId)}`,
        { method: "DELETE" },
      ),
    reorderFolders: (ids: string[]) =>
      request("/v1/library/folders/reorder", { method: "PUT", body: JSON.stringify({ ids }) }),
    createListShare: async (listId: string) =>
      (
        await request<ApiEnvelope<{ token: string; visibility: "link" }>>(
          `/v1/library/lists/${encodeURIComponent(listId)}/share`,
          { method: "POST", body: "{}" },
        )
      ).data,
    revokeListShare: (listId: string) =>
      request<void>(`/v1/library/lists/${encodeURIComponent(listId)}/share`, { method: "DELETE" }),
    addFeedToList: (listId: string, feedId: string) =>
      request(`/v1/library/lists/${encodeURIComponent(listId)}/feeds`, {
        method: "POST",
        body: JSON.stringify({ feedId }),
      }),
    listLists: async () => (await request<ApiEnvelope<FeyFeedsList[]>>("/v1/library/lists")).data,
    createList: async (name: string, id?: string) =>
      (
        await request<ApiEnvelope<FeyFeedsList>>("/v1/library/lists", {
          method: "POST",
          body: JSON.stringify({ name, ...(id ? { id } : {}) }),
        })
      ).data,
    updateList: (id: string, changes: { name?: string; description?: string | null }) =>
      request(`/v1/library/lists/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(changes),
      }),
    deleteList: (id: string) =>
      request<void>(`/v1/library/lists/${encodeURIComponent(id)}`, { method: "DELETE" }),
    removeFeedFromList: (listId: string, feedId: string) =>
      request<void>(
        `/v1/library/lists/${encodeURIComponent(listId)}/feeds/${encodeURIComponent(feedId)}`,
        { method: "DELETE" },
      ),
    reorderLists: (ids: string[]) =>
      request("/v1/library/lists/reorder", { method: "PUT", body: JSON.stringify({ ids }) }),
    listFolderFeeds: async (folderId: string) =>
      (
        await request<ApiEnvelope<{ id: string; url: string; title: string | null }[]>>(
          `/v1/library/folders/${encodeURIComponent(folderId)}/feeds`,
        )
      ).data,
    listDetail: async (listId: string) =>
      (
        await request<
          ApiEnvelope<
            FeyFeedsList & {
              feeds: { id: string; url: string; title: string | null; position: number }[]
            }
          >
        >(`/v1/library/lists/${encodeURIComponent(listId)}`)
      ).data,
    discoverFeeds: async (url: string) =>
      (
        await request<ApiEnvelope<FeyFeedsDiscoveredFeed[]>>("/v1/feeds/discover", {
          method: "POST",
          body: JSON.stringify({ url }),
        })
      ).data,
    addFeed: async (url: string, title?: string) =>
      (
        await request<ApiEnvelope<FeyFeedsFeed>>("/v1/feeds", {
          method: "POST",
          body: JSON.stringify({ url, ...(title ? { title } : {}) }),
        })
      ).data,
    importOpml: (opml: string) =>
      request<ApiEnvelope<FeyFeedsImportResult>>("/v1/feeds/import", {
        method: "POST",
        body: JSON.stringify({ opml }),
      }),
    deleteFeed: (feedId: string) =>
      request<void>(`/v1/feeds/${encodeURIComponent(feedId)}`, { method: "DELETE" }),
    refreshFeed: async (feedId: string) =>
      (
        await request<ApiEnvelope<{ feedId: string; fetched: number; fetchedAt: number }>>(
          `/v1/feeds/${encodeURIComponent(feedId)}/refresh`,
          { method: "POST" },
        )
      ).data,
    getTimeline: (options: { limit?: number; cursor?: string; feedId?: string } = {}) => {
      const query = new URLSearchParams()
      if (options.limit !== undefined) query.set("limit", String(options.limit))
      if (options.cursor) query.set("cursor", options.cursor)
      if (options.feedId) query.set("feedId", options.feedId)
      return request<FeyFeedsTimelinePage>(`/v1/timeline${query.size ? `?${query}` : ""}`)
    },
    summarizeArticle: async (entryId: string, language: string) =>
      (
        await request<ApiEnvelope<{ summary: string; cached: boolean }>>("/v1/ai/summary", {
          method: "POST",
          body: JSON.stringify({ entryId, language }),
        })
      ).data,
    updateEntryState: (entryId: string, state: { isRead?: boolean; isBookmarked?: boolean }) =>
      request<ApiEnvelope<{ entryId: string; updatedAt: number }>>(
        `/v1/entry-states/${encodeURIComponent(entryId)}`,
        { method: "PUT", body: JSON.stringify(state) },
      ),
  }
}
