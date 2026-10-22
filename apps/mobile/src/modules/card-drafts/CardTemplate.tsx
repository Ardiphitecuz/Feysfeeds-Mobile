import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useFonts } from "expo-font"
import { useMemo, useState } from "react"
import { Platform, Text, View, useWindowDimensions } from "react-native"
import Svg, { Path } from "react-native-svg"
import MaskedView from "@react-native-masked-view/masked-view"
import { Polygon } from "react-native-svg"
import { ColorMatrix } from "react-native-color-matrix-image-filters"
import { useVideoPlayer, VideoView } from "expo-video"

import figmaPaths from "./assets/figma-paths"
import type { CardDesignState } from "./store"

export const POST_W = 1740
export const POST_H = 2320
export const VIDEO_W = 1856
export const VIDEO_H = 3298

const contentTexture = require("./assets/figma-content.png")
const identityTexture = require("./assets/figma-identity-bar.png")
const badgeTexture = require("./assets/figma-rectangle7.png")
const defaultBackground = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1764&auto=format&fit=crop"
const defaultCollageBackground = "https://images.unsplash.com/photo-1614850523296-d8c1af93d400?q=80&w=1740&auto=format&fit=crop"
const matrixBias = Platform.OS === "ios" ? 1 : 255
const multiplyMatrix = (textureOpacity: number): never => {
  const baseOpacity = 1 - textureOpacity
  return [
    textureOpacity, 0, 0, 0, baseOpacity * matrixBias,
    0, textureOpacity, 0, 0, baseOpacity * (116 / 255) * matrixBias,
    0, 0, textureOpacity, 0, baseOpacity * (47 / 255) * matrixBias,
    0, 0, 0, 1, 0,
  ] as never
}
const contentMultiply = multiplyMatrix(0.25)
const badgeMultiply = multiplyMatrix(0.45)

type Props = {
  title: string
  summary?: string
  category: string
  sourceTitle: string
  imageUrl?: string
  sourceUrl?: string
  design?: CardDesignState
  maxWidth?: number
  onCaptureReady?: (ref: View | null) => void
}

export const CardTemplate = ({ title, category, sourceTitle, imageUrl, sourceUrl, design, maxWidth, onCaptureReady }: Props) => {
  const [fontsLoaded, fontError] = useFonts({ Gilroy: require("./assets/gilroy/Gilroy.woff2"), GilroyBold: require("./assets/gilroy/Gilroy-Bold.woff2"), GilroyItalic: require("./assets/gilroy/Gilroy-Italic.woff2"), GilroyBoldItalic: require("./assets/gilroy/Gilroy-BoldItalic.woff2") })
  const { width: windowWidth } = useWindowDimensions()
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const layout = design ?? { template: "post", videoAspectRatio: "3:4" } as CardDesignState
  const videoPlayer = useVideoPlayer(layout.videoUrl ?? null, (player) => {
    player.loop = true
    player.muted = true
    if (layout.videoUrl) player.play()
  })
  const [artW, artH] = useMemo(() => layout.template === "post" || layout.videoAspectRatio === "3:4" ? [POST_W, POST_H] : [VIDEO_W, VIDEO_H], [layout.template, layout.videoAspectRatio])
  const displayWidth = Math.min(maxWidth ?? windowWidth - 32, measuredWidth || maxWidth || windowWidth - 32)
  const scale = displayWidth / artW
  const top = layout.template === "post" || layout.videoAspectRatio === "3:4" ? 1600 : artH * 0.55
  const sourceY = artH === POST_H ? 2034 : 2544
  const identityY = artH === POST_H ? 1812.55 : 2310.55
  const left = artH === POST_H ? 89 : 136
  const titleBottom = artH === POST_H ? 469 : 949
  const titleSize = artH === POST_H ? 90 : 85
  const titleLine = artH === POST_H ? 112 : 108
  const bgTransform = layout.bgTransform ?? { x: 0, y: 0, scale: 1 }
  const secondTransform = layout.bg2Transform ?? { x: 0, y: 0, scale: 1 }

  if (!fontsLoaded && !fontError) return <View style={{ width: "100%", aspectRatio: artW / artH, backgroundColor: "#050505" }} />

  const background = (src: string, transform: typeof bgTransform, key: string) => (
    <View key={key} style={{ position: "absolute", left: 0, top: 0, width: artW, height: artH, overflow: "hidden" }}>
      {src ? <Image source={{ uri: src }} contentFit="cover" style={{ position: "absolute", width: artW, height: artH * transform.scale, left: transform.x, top: (artH - artH * transform.scale) / 2 + transform.y }} /> : <View style={{ flex: 1, backgroundColor: "#101014" }} />}
    </View>
  )

  return (
    <View ref={onCaptureReady} collapsable={false} onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)} style={{ width: displayWidth, alignSelf: "center", aspectRatio: artW / artH, overflow: "hidden", backgroundColor: "#050505" }}>
      <View style={{ position: "absolute", width: artW, height: artH, transform: [{ scale }], transformOrigin: "top left" as never }}>
        {layout.template === "video" && layout.videoUrl ? <VideoView player={videoPlayer} nativeControls={false} contentFit="cover" surfaceType="textureView" style={{ position: "absolute", left: bgTransform.x, top: (artH - artH * bgTransform.scale) / 2 + bgTransform.y, width: artW, height: artH * bgTransform.scale }} /> : layout.bgMode === "collage" ? (() => {
          const dy = Math.tan((layout.splitAngle * Math.PI) / 180) * (artH / 2)
          const leftMask = `0,0 ${artW / 2 - dy},0 ${artW / 2 + dy},${artH} 0,${artH}`
          const rightMask = `${artW / 2 - dy},0 ${artW},0 ${artW},${artH} ${artW / 2 + dy},${artH}`
          return <>
            <MaskedView style={{ position: "absolute", inset: 0 }} maskElement={<Svg width={artW} height={artH}><Polygon points={leftMask} fill="white" /></Svg>}>{background(layout.bgSrc || imageUrl || defaultBackground, bgTransform, "bg1")}</MaskedView>
            <MaskedView style={{ position: "absolute", inset: 0 }} maskElement={<Svg width={artW} height={artH}><Polygon points={rightMask} fill="white" /></Svg>}>{background(layout.bg2Src || defaultCollageBackground, secondTransform, "bg2")}</MaskedView>
          </>
        })() : background(layout.bgSrc || imageUrl || defaultBackground, bgTransform, "bg")}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} locations={[0, 1]} style={{ position: "absolute", top, left: 0, width: artW, height: artH - top }} />

        {layout.stickers?.map((sticker) => <Image key={sticker.id} source={{ uri: sticker.src }} contentFit="contain" style={{ position: "absolute", left: sticker.x / 100 * artW - sticker.size / 2, top: sticker.y / 100 * artH - sticker.size / 2, width: sticker.size, height: sticker.size, transform: [{ rotate: `${sticker.rotation}deg` }], borderRadius: sticker.shape === "circle" ? sticker.size / 2 : sticker.shape === "square" ? 0 : undefined }} />)}
        {layout.extraTexts?.map((item) => <Text key={item.id} style={{ position: "absolute", left: item.x / 100 * artW, top: item.y / 100 * artH, color: item.color, fontSize: item.fontSize, fontWeight: item.fontWeight as never, fontStyle: item.fontStyle as never, transform: [{ translateX: -50 }, { translateY: -50 }, { rotate: `${item.rotation}deg` }], textShadowColor: "rgba(0,0,0,.85)", textShadowRadius: item.shadowBlur }}>{item.text}</Text>)}

        <View style={{ position: "absolute", left: 88.5, bottom: titleBottom, width: 1563, gap: 85 }}>
          <View style={{ position: "relative", height: 82 }}>
            <View style={{ position: "absolute", left: 0, top: 0, width: 82, height: 82, borderRadius: 10, backgroundColor: "#ff742f" }}>
              <ColorMatrix matrix={badgeMultiply} style={{ width: 82, height: 82, borderRadius: 10, overflow: "hidden" }}><Image source={badgeTexture} contentFit="cover" style={{ width: 82, height: 82, borderRadius: 10 }} /></ColorMatrix>
            </View>
            <Svg viewBox="0 0 32.0528 62" style={{ position: "absolute", left: 82, top: 10, width: 36.5, height: 62 }}><Path d={figmaPaths.p18776b80} fill="white" /></Svg>
            <Svg viewBox="0 0 41.667 41.667" style={{ position: "absolute", left: 21.7, top: 21.7, width: 41.7, height: 41.7 }}><Path d={figmaPaths.p29f60d00} fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></Svg>
            <View style={{ position: "absolute", left: 82, top: 10, height: 62, backgroundColor: "white", paddingLeft: 24, paddingRight: 16, justifyContent: "center" }}><Text numberOfLines={1} style={{ color: "#060200", fontFamily: "GilroyItalic", fontSize: 33, letterSpacing: -0.18 }}>{category || "Update"}</Text></View>
          </View>
          <View style={{ borderRadius: 30, overflow: "hidden", backgroundColor: "#ff742f", paddingTop: 61, paddingBottom: 69, paddingHorizontal: 112, minHeight: 240, justifyContent: "center" }}>
            <ColorMatrix matrix={contentMultiply} style={{ position: "absolute", inset: 0 }}><Image source={contentTexture} contentFit="cover" style={{ width: "100%", height: "100%" }} /></ColorMatrix>
            <Text numberOfLines={4} style={{ color: "white", fontFamily: layout.titleFormatting?.includes("bold") ? layout.titleFormatting?.includes("italic") ? "GilroyBoldItalic" : "GilroyBold" : layout.titleFormatting?.includes("italic") ? "GilroyItalic" : "Gilroy", fontSize: titleSize, lineHeight: titleLine }}>{title || "Judul kartu berita"}</Text>
          </View>
        </View>

        <View style={{ position: "absolute", left, top: identityY, width: 1562.25, height: 133.45, borderRadius: 18, overflow: "hidden" }}>
          <Image source={identityTexture} contentFit="fill" style={{ position: "absolute", left: 0, top: -1076.47 / 100 * 133.45, width: "100%", height: 1176.47 / 100 * 133.45 }} />
        </View>
        <View style={{ position: "absolute", left, top: sourceY, flexDirection: "row", gap: 20 }}>
          {[sourceTitle || "FeyFeeds", sourceUrl].filter(Boolean).map((value, index) => <View key={`${value}-${index}`} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.14)", borderWidth: 1 }}><Svg viewBox="0 0 24.5 24.5" style={{ width: 30, height: 30 }}><Path d={figmaPaths.p3eb20f0} fill="white" /></Svg><Text numberOfLines={1} style={{ color: "white", fontSize: 20, fontWeight: "600", letterSpacing: -0.18 }}>{value}</Text></View>)}
        </View>
      </View>
    </View>
  )
}
