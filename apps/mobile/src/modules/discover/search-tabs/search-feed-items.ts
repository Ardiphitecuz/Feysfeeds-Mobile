import type { SearchFeedCardItem } from "./SearchFeedCard"

const isDirectFeedInput = (value: string) => {
  const trimmed = value.trim()
  return (
    trimmed.includes("://") ||
    (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed) && !trimmed.includes(" "))
  )
}

const normalizeFeedUrl = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.includes("://")) return trimmed
  return `https://${trimmed}`
}

export const resolveSearchFeedItems = <T extends SearchFeedCardItem>(
  discoveredItems: readonly T[],
  searchValue: string,
): readonly (T | SearchFeedCardItem)[] => {
  if (discoveredItems.length > 0) {
    return discoveredItems
  }

  if (!searchValue || !isDirectFeedInput(searchValue)) {
    return []
  }

  const normalized = normalizeFeedUrl(searchValue)
  return [
    {
      feed: {
        title: searchValue.trim(),
        url: normalized,
      },
    },
  ]
}
