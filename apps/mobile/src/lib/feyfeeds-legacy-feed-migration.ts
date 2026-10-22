import { FeedService } from "@follow/database/services/feed"
import { SubscriptionService } from "@follow/database/services/subscription"
import { whoami } from "@follow/store/user/getters"

/** Reads URLs from the active Folo user's local subscriptions without sending that identity. */
export const getLegacyFeedSubscriptions = async () => {
  const legacyUserId = whoami()?.id
  if (!legacyUserId) return []

  const [subscriptions, feeds] = await Promise.all([
    SubscriptionService.getSubscriptionAll(),
    FeedService.getFeedAll(),
  ])
  const feedIds = new Set(
    subscriptions
      .filter(
        (subscription) => subscription.userId === legacyUserId && subscription.type === "feed",
      )
      .map((subscription) => subscription.feedId)
      .filter((feedId): feedId is string => Boolean(feedId)),
  )
  const seenUrls = new Set<string>()

  return feeds.flatMap((feed) => {
    const url = feed.url.trim()
    if (!feedIds.has(feed.id) || !/^https?:\/\//i.test(url) || seenUrls.has(url)) return []
    seenUrls.add(url)
    return [{ url, title: feed.title ?? null }]
  })
}

const escapeXmlAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const createFeedMigrationOpml = (feeds: Array<{ url: string; title: string | null }>) =>
  `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>FeyFeeds local subscription migration</title></head><body>${feeds
    .map(
      ({ url, title }) =>
        `<outline text="${escapeXmlAttribute(title ?? url)}" type="rss" xmlUrl="${escapeXmlAttribute(url)}" />`,
    )
    .join("")}</body></opml>`
