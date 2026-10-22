import { resolveReaderTextColor } from "@follow/shared/settings/reader-style"
import { useEntry } from "@follow/store/entry/hooks"
import { useEffect, useMemo, useRef, useState } from "react"
import { PixelRatio } from "react-native"

import { useSpotlightSettingKey } from "@/src/atoms/settings/spotlight"
import { useUISettingKey } from "@/src/atoms/settings/ui"

import { prepareEntryRenderWebView } from "./index"
import { WebViewManager } from "./webview-manager"

interface UseWebViewEntryOptions {
  entryId: string
  noMedia?: boolean
}

/**
 * Hook to prepare the entry render WebView with proper cleanup and error handling
 * Ensures the WebView is only initialized once per component lifecycle
 */
export const usePrepareEntryRenderWebView = () => {
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current) return

    try {
      prepareEntryRenderWebView()
      initializedRef.current = true
    } catch (error) {
      console.error("Failed to prepare entry render WebView:", error)
    }
  }, [])

  return initializedRef.current
}

/**
 * Custom hook to manage WebView entry content and settings
 * Handles all WebView JavaScript bridge calls in a centralized way
 */
export function useWebViewEntry({ entryId, noMedia }: UseWebViewEntryOptions) {
  const entry = useEntry(entryId, (state) => state)

  // UI Settings
  const codeThemeLight = useUISettingKey("codeHighlightThemeLight")
  const codeThemeDark = useUISettingKey("codeHighlightThemeDark")
  const readerRenderInlineStyle = useUISettingKey("readerRenderInlineStyle")
  const spotlightRules = useSpotlightSettingKey("spotlights")
  const useSystemFontScaling = useUISettingKey("useSystemFontScaling")
  const customFontScale = useUISettingKey("fontScale")
  const useDifferentFontSizeForContent = useUISettingKey("useDifferentFontSizeForContent")
  const mobileContentFontSize = useUISettingKey("mobileContentFontSize")
  const readerFontFamily = useUISettingKey("readerFontFamily")
  const contentLineHeight = useUISettingKey("contentLineHeight")
  const readerTextColor = useUISettingKey("readerTextColor")

  useEffect(() => {
    const fontScale = useSystemFontScaling ? PixelRatio.getFontScale() : customFontScale
    WebViewManager.setRootFontSize(fontScale * 16)
  }, [useSystemFontScaling, customFontScale])

  // Handle content-specific font size
  useEffect(() => {
    if (useDifferentFontSizeForContent) {
      WebViewManager.setRootFontSize(mobileContentFontSize)
    } else {
      // Reset to use the global font scaling
      const fontScale = useSystemFontScaling ? PixelRatio.getFontScale() : customFontScale
      WebViewManager.setRootFontSize(fontScale * 16)
    }
  }, [useDifferentFontSizeForContent, mobileContentFontSize, useSystemFontScaling, customFontScale])

  // Prepare entry data for WebView
  const entryInWebview = useMemo(() => {
    if (!entry) return null

    return {
      ...entry,
      spotlightRules,
    }
  }, [entry, spotlightRules])

  // Update WebView settings when dependencies change
  useEffect(() => {
    WebViewManager.setNoMedia(!!noMedia)
  }, [noMedia])

  useEffect(() => {
    WebViewManager.setReaderRenderInlineStyle(readerRenderInlineStyle)
  }, [readerRenderInlineStyle])

  useEffect(() => {
    WebViewManager.setCodeTheme(codeThemeLight, codeThemeDark)
  }, [codeThemeLight, codeThemeDark])

  useEffect(() => {
    WebViewManager.setReaderStyle({
      fontFamily: readerFontFamily || "inherit",
      lineHeight: contentLineHeight,
      textColor: resolveReaderTextColor(readerTextColor),
    })
  }, [readerFontFamily, contentLineHeight, readerTextColor])

  useEffect(() => {
    WebViewManager.setSpotlights(spotlightRules)
  }, [spotlightRules])

  useEffect(() => {
    WebViewManager.setEntry(entryInWebview)
  }, [entryInWebview])

  return {
    entry,
    entryInWebview,
    isLoading: !entry?.content,
  }
}

/**
 * Hook for managing WebView mode switching (debug/normal)
 */
export function useWebViewMode() {
  const [mode, setMode] = useState<"normal" | "debug">("normal")
  const handleModeSwitch = (mode: "normal" | "debug") => {
    setMode(mode)
    if (mode === "debug") {
      WebViewManager.loadUrl("http://localhost:5173/")
    } else {
      const { htmlUrl } = require("./constants")
      WebViewManager.loadUrl(htmlUrl)
    }
  }

  return { handleModeSwitch, mode }
}
