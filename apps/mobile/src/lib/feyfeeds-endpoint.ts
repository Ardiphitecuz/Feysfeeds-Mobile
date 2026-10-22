export const requireFeyFeedsApiUrl = (value: string | undefined, production: boolean) => {
  if (!value) {
    throw new Error("Set the profile-specific EXPO_PUBLIC_FEYFEEDS_API_URL_* for this environment")
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(value)
  } catch {
    throw new Error("FeyFeeds API URL must be a valid HTTP or HTTPS URL")
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error("FeyFeeds API URL must be a valid HTTP or HTTPS URL")
  }
  if (production && parsedUrl.protocol !== "https:") {
    throw new Error("Production FeyFeeds API URL must use HTTPS")
  }

  return value.replace(/\/$/, "")
}
