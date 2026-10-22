import * as SecureStore from "expo-secure-store"

import { createFeyFeedsApiClient } from "./feyfeeds-api-client"
import { requireFeyFeedsApiUrl as validateFeyFeedsApiUrl } from "./feyfeeds-endpoint"
import { proxyEnv } from "./proxy-env"

export const CLOUD_FEYFEEDS_API_URL = "https://feyfeeds-api.feyfeeds.workers.dev"

const FEYFEEDS_API_URL = () => {
  const url = proxyEnv.FEYFEEDS_API_URL
  if (!url || url.includes("localhost") || url.includes("127.0.0.1")) {
    return CLOUD_FEYFEEDS_API_URL
  }
  return url.replace(/\/$/, "")
}
const sessionTokenKey = "feyfeeds_session_token"

export const publicListShareUrl = (token: string) =>
  `${FEYFEEDS_API_URL()}/v1/public/lists/${encodeURIComponent(token)}`

export const feyFeedsApi = createFeyFeedsApiClient({
  baseUrl: FEYFEEDS_API_URL,
  getSessionToken: () => SecureStore.getItemAsync(sessionTokenKey),
  setSessionToken: async (token) => {
    if (token) await SecureStore.setItemAsync(sessionTokenKey, token)
    else await SecureStore.deleteItemAsync(sessionTokenKey)
  },
})
