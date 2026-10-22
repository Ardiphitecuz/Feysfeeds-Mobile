import type { ReviewPromptState } from "@follow/shared/review-prompt"
import { normalizeReviewPromptState, recordReviewPromptOutcome } from "@follow/shared/review-prompt"
import { tracker } from "@follow/tracker"
import * as StoreReview from "expo-store-review"
import { Linking } from "react-native"

import { kv } from "@/src/lib/kv"
import { isAndroidApkInstall } from "@/src/lib/payment"
import { isAndroid, isIOS } from "@/src/lib/platform"

export const REVIEW_PROMPT_QUIET_WINDOW_MS = 5000

export type MobileReviewDistribution = "ios_app_store" | "google_play" | "unsupported"
export type MobileReviewRateTarget = "ios_app_store" | "google_play" | null

const GOOGLE_PLAY_REVIEW_URI = "market://details?id=com.feyfeeds.mobile&showAllReviews=true"
const GOOGLE_PLAY_REVIEW_URL = "https://play.google.com/store/apps/details?id=com.feyfeeds.mobile"
const REVIEW_PROMPT_STORAGE_PREFIX = "follow-rn-review-prompt"

export const getMobileReviewPlatform = () => (isIOS ? "ios" : isAndroid ? "android" : "mobile")

export const getMobileReviewDistribution = (): MobileReviewDistribution => {
  if (isIOS) {
    return "ios_app_store"
  }

  if (isAndroid && !isAndroidApkInstall()) {
    return "google_play"
  }

  return "unsupported"
}

export const getMobileReviewRateTarget = (): MobileReviewRateTarget => {
  if (isIOS) {
    return "ios_app_store"
  }

  if (isAndroid) {
    return "google_play"
  }

  return null
}

export const getMobileReviewStorageKey = (userId: string, distribution: MobileReviewDistribution) =>
  `${REVIEW_PROMPT_STORAGE_PREFIX}:${distribution}:${userId}`

export const readMobileReviewPromptState = (storageKey: string | null): ReviewPromptState => {
  if (!storageKey) {
    return normalizeReviewPromptState(null)
  }

  try {
    const raw = kv.getSync(storageKey)
    if (!raw) {
      return normalizeReviewPromptState(null)
    }
    return normalizeReviewPromptState(JSON.parse(raw) as Partial<ReviewPromptState>)
  } catch {
    return normalizeReviewPromptState(null)
  }
}

export const writeMobileReviewPromptState = (
  storageKey: string | null,
  state: ReviewPromptState,
) => {
  if (!storageKey) {
    return
  }

  try {
    kv.setSync(storageKey, JSON.stringify(state))
  } catch (error) {
    console.warn("Failed to write mobile review prompt state:", error)
  }
}

export const clearMobileReviewPromptState = (storageKey: string | null) => {
  if (!storageKey) {
    return
  }

  kv.delete(storageKey)
}

const openStoreUrl = async (target: MobileReviewRateTarget) => {
  switch (target) {
    case "ios_app_store":
      return false
    case "google_play": {
      try {
        await Linking.openURL(GOOGLE_PLAY_REVIEW_URI)
      } catch {
        await Linking.openURL(GOOGLE_PLAY_REVIEW_URL)
      }
      return true
    }
    default:
      return false
  }
}

export const isMobileNativeReviewAvailable = async (distribution: MobileReviewDistribution) => {
  if (distribution === "unsupported") {
    return false
  }

  try {
    return await StoreReview.isAvailableAsync()
  } catch {
    return false
  }
}

export const requestMobileNativeReview = async ({
  appVersion,
  distribution,
  platform,
  score,
  source,
  state,
  storageKey,
  trackPositive = false,
}: {
  appVersion: string
  distribution: MobileReviewDistribution
  platform: string
  score?: number
  source: "auto" | "manual"
  state: ReviewPromptState
  storageKey: string | null
  trackPositive?: boolean
}) => {
  const nextState = recordReviewPromptOutcome(state, "native_request", new Date(), appVersion)
  writeMobileReviewPromptState(storageKey, nextState)

  if (trackPositive) {
    tracker.reviewPromptPositive({ distribution, platform, source })
  }
  tracker.reviewPromptNativeRequested({ distribution, platform, score, source })
  await StoreReview.requestReview()
  return nextState
}

export const openMobileStoreReview = async ({
  appVersion,
  distribution,
  platform,
  source,
  state,
  storageKey,
  target,
}: {
  appVersion: string
  distribution: MobileReviewDistribution
  platform: string
  source: "auto" | "manual"
  state: ReviewPromptState
  storageKey: string | null
  target: MobileReviewRateTarget
}) => {
  if (!target) {
    return null
  }

  if (!(await openStoreUrl(target))) {
    return null
  }

  const nextState = recordReviewPromptOutcome(
    state,
    "positive_store_redirect",
    new Date(),
    appVersion,
  )
  writeMobileReviewPromptState(storageKey, nextState)

  tracker.reviewPromptPositive({ distribution, platform, source })
  tracker.reviewPromptStoreOpened({ distribution, platform, source })

  return nextState
}
