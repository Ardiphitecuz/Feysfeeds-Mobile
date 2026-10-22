import { parseSafeUrl } from "@follow/utils"
import type { RefObject } from "react"
import { useCallback } from "react"
import type WebView from "react-native-webview"
import type { WebViewNavigation } from "react-native-webview"

import { openLink } from "../lib/native"
import { resolveVideoUrlForMobileOpen } from "../lib/video-url"

export function useWebViewNavigation({ webViewRef }: { webViewRef: RefObject<WebView> }) {
  const onNavigationStateChange = useCallback(
    (newNavState: WebViewNavigation) => {
      const { url: urlStr } = newNavState
      const url = parseSafeUrl(urlStr)
      if (!url) return
      if (url.protocol === "file:") return

      webViewRef.current?.stopLoading()

      const formattedUrl = resolveVideoUrlForMobileOpen(urlStr)
      if (formattedUrl) {
        openLink(formattedUrl)
        return
      }
      openLink(urlStr)
    },
    [webViewRef],
  )

  return { onNavigationStateChange }
}
