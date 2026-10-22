import { useEntry } from "@follow/store/entry/hooks"
import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import { useAtomValue } from "jotai"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ActivityIndicator, Pressable, TextInput, View } from "react-native"
import { captureRef } from "react-native-view-shot"

import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import { Text } from "@/src/components/ui/typography/Text"
import type { NavigationControllerView } from "@/src/lib/navigation/types"
import { safeSecureStore } from "@/src/lib/secure-store"
import { CardPreview } from "@/src/modules/card-drafts/CardPreview"
import {
  cardDraftsAtom,
  cardDraftsLoadedAtom,
  createCardDraftId,
  defaultCardDesign,
  loadCardDrafts,
  saveCardDraft,
} from "@/src/modules/card-drafts/store"

export const CardEditorScreen: NavigationControllerView<{
  entryId?: string
  draftId?: string
}> = ({ entryId, draftId }) => {
  const { t } = useTranslation("default")
  const drafts = useAtomValue(cardDraftsAtom)
  const draftsLoaded = useAtomValue(cardDraftsLoadedAtom)
  const entry = useEntry(entryId, (state) => ({
    title: state.title,
    url: state.url,
    content: state.content,
    readabilityContent: state.readabilityContent,
    description: state.description,
    media: state.media,
  }))
  const existingDraft = draftId ? drafts.find((draft) => draft.id === draftId) : undefined
  const [currentDraftId, setCurrentDraftId] = useState(draftId)
  const [title, setTitle] = useState("")
  const [summary, setSummary] = useState("")
  const [content, setContent] = useState("")
  const [category, setCategory] = useState("")
  const [sourceTitle, setSourceTitle] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [imageUrl, setImageUrl] = useState<string | undefined>()
  const [design, setDesign] = useState(defaultCardDesign)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const previewRef = useRef<View | null>(null)
  const [renderedImage, setRenderedImage] = useState<string | undefined>()
  const [stickerUrl, setStickerUrl] = useState("")
  const [overlayText, setOverlayText] = useState("")
  useEffect(() => {
    void safeSecureStore.removeItemAsync("feyfeeds.gemini.api-key").catch(() => undefined)
    loadCardDrafts().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    })
  }, [])

  useEffect(() => {
    if (!draftId || !draftsLoaded) return
    if (!existingDraft) {
      setError(t("drafts.not_found"))
      return
    }

    setTitle(existingDraft.title)
    setSummary(existingDraft.summary)
    setContent(existingDraft.content)
    setCategory(existingDraft.category)
    setSourceTitle(existingDraft.sourceTitle)
    setSourceUrl(existingDraft.sourceUrl)
    setImageUrl(existingDraft.imageUrl)
    setDesign(existingDraft.design ?? defaultCardDesign)
    setRenderedImage(existingDraft.renderedImage)
  }, [draftId, draftsLoaded, existingDraft, t])

  useEffect(() => {
    if (!entryId || !entry || draftId) return
    setSourceTitle(entry.title || "")
    setSourceUrl(entry.url || "")
    setImageUrl(entry.media?.find((media) => media.type === "photo")?.url)
  }, [draftId, entryId, entry])

  const saveDraft = async () => {
    if (!title.trim() || !content.trim()) {
      setError(t("drafts.content_required"))
      return
    }
    setIsSaving(true)
    setError("")
    try {
      const savedDraftId = existingDraft?.id || currentDraftId || createCardDraftId()
      await saveCardDraft({
        id: savedDraftId,
        sourceEntryId: entryId || existingDraft?.sourceEntryId || "",
        sourceTitle,
        sourceUrl,
        imageUrl,
        title: title.trim(),
        summary: summary.trim(),
        content: content.trim(),
        category: category.trim(),
        design,
        renderedImage,
        updatedAt: Date.now(),
      })
      setCurrentDraftId(savedDraftId)
      setStatus(t("drafts.saved"))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const exportCard = async () => {
    if (!previewRef.current) return
    try {
      const width = design.template === "post" || design.videoAspectRatio === "3:4" ? 1740 : 1856
      const height = design.template === "post" || design.videoAspectRatio === "3:4" ? 2320 : 3298
      const temporaryUri = await captureRef(previewRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
        width,
        height,
      })
      const exportId = currentDraftId || createCardDraftId()
      const directory = `${FileSystem.documentDirectory}card-exports/`
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
      const uri = `${directory}${exportId}.png`
      await FileSystem.copyAsync({ from: temporaryUri, to: uri })
      setRenderedImage(uri)
      setCurrentDraftId(exportId)
      if (existingDraft || draftId) {
        await saveCardDraft({
          id: exportId,
          sourceEntryId: existingDraft?.sourceEntryId || entryId || "",
          sourceTitle,
          sourceUrl,
          imageUrl,
          title: title.trim(),
          summary: summary.trim(),
          content: content.trim(),
          category: category.trim(),
          design,
          renderedImage: uri,
          updatedAt: Date.now(),
        })
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: "Share card",
      })
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError))
    }
  }

  return (
    <SafeNavigationScrollView
      className="bg-system-grouped-background"
      contentContainerClassName="gap-5 px-4 pb-10 pt-4"
      Header={<NavigationBlurEffectHeaderView title={t("drafts.editor_title")} />}
    >
      <CardPreview
        title={title}
        summary={summary}
        category={category}
        sourceTitle={sourceTitle}
        imageUrl={imageUrl}
        sourceUrl={sourceUrl}
        design={design}
        onCaptureReady={(ref) => {
          previewRef.current = ref
        }}
      />

      <View className="gap-3 rounded-2xl bg-secondary-system-grouped-background p-4">
        <Text className="font-semibold">{t("drafts.edit_card")}</Text>
        <TextInput
          accessibilityLabel={t("drafts.title_label")}
          className="rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          onChangeText={setTitle}
          placeholder={t("drafts.title_label")}
          value={title}
        />
        <View className="flex-row flex-wrap gap-2">
          {(["bold", "italic"] as const).map((format) => (
            <Pressable
              key={format}
              onPress={() =>
                setDesign((current) => ({
                  ...current,
                  titleFormatting: current.titleFormatting.includes(format)
                    ? current.titleFormatting.replace(format, "").trim()
                    : `${current.titleFormatting} ${format}`.trim(),
                }))
              }
              className={`rounded-full px-4 py-2 ${design.titleFormatting.includes(format) ? "bg-[#ff742f]" : "bg-tertiary-system-grouped-background"}`}
            >
              <Text
                className={design.titleFormatting.includes(format) ? "text-white" : "text-label"}
              >
                {format}
              </Text>
            </Pressable>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {(["post", "video"] as const).map((template) => (
            <Pressable
              key={template}
              onPress={() =>
                setDesign((current) => ({
                  ...current,
                  template,
                  videoAspectRatio: template === "video" ? current.videoAspectRatio : "3:4",
                }))
              }
              className={`rounded-full px-4 py-2 ${design.template === template ? "bg-[#ff742f]" : "bg-tertiary-system-grouped-background"}`}
            >
              <Text className={design.template === template ? "text-white" : "text-label"}>
                {template.toUpperCase()}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() =>
              setDesign((current) => ({
                ...current,
                videoAspectRatio: current.videoAspectRatio === "9:16" ? "3:4" : "9:16",
              }))
            }
            className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
          >
            <Text>{design.videoAspectRatio}</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="Background image URL"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          onChangeText={(bgSrc) => setDesign((current) => ({ ...current, bgSrc }))}
          placeholder="Background image URL"
          value={design.bgSrc}
        />
        <TextInput
          accessibilityLabel="Second background image URL"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          onChangeText={(bg2Src) => setDesign((current) => ({ ...current, bg2Src }))}
          placeholder="Second image URL (collage)"
          value={design.bg2Src}
        />
        {design.template === "video" ? (
          <TextInput
            accessibilityLabel="Video URL"
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
            onChangeText={(videoUrl) => setDesign((current) => ({ ...current, videoUrl }))}
            placeholder="Video URL (poster uses selected background)"
            value={design.videoUrl}
          />
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            onPress={() =>
              setDesign((current) => ({
                ...current,
                bgMode: current.bgMode === "single" ? "collage" : "single",
              }))
            }
            className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
          >
            <Text>{design.bgMode === "single" ? "Use collage" : "Use single background"}</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              setDesign((current) => ({
                ...current,
                bgTransform: {
                  ...current.bgTransform,
                  scale: Math.min(3, current.bgTransform.scale + 0.1),
                },
              }))
            }
            className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
          >
            <Text>Zoom background +</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              setDesign((current) => ({
                ...current,
                bgTransform: {
                  ...current.bgTransform,
                  scale: Math.max(0.5, current.bgTransform.scale - 0.1),
                },
              }))
            }
            className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
          >
            <Text>−</Text>
          </Pressable>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {([-1, 1] as const).map((direction) => (
            <Pressable
              key={direction}
              onPress={() =>
                setDesign((current) => ({
                  ...current,
                  bgTransform: {
                    ...current.bgTransform,
                    x: current.bgTransform.x + direction * 40,
                  },
                }))
              }
              className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
            >
              <Text>{direction < 0 ? "Move BG ←" : "Move BG →"}</Text>
            </Pressable>
          ))}
          {([-1, 1] as const).map((direction) => (
            <Pressable
              key={`split-${direction}`}
              onPress={() =>
                setDesign((current) => ({
                  ...current,
                  splitAngle: Math.max(-45, Math.min(45, current.splitAngle + direction * 5)),
                }))
              }
              className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
            >
              <Text>{direction < 0 ? "Split −" : "Split +"}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Sticker image URL"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          onChangeText={setStickerUrl}
          placeholder="Sticker image URL"
          value={stickerUrl}
        />
        <Pressable
          onPress={() => {
            if (!stickerUrl.trim()) return
            setDesign((current) => ({
              ...current,
              stickers: [
                ...current.stickers,
                {
                  id: `sticker-${Date.now()}`,
                  src: stickerUrl.trim(),
                  x: 50,
                  y: 35,
                  size: 240,
                  rotation: 0,
                  shape: "original",
                  outlineWidth: 0,
                  outlineColor: "#ffffff",
                  shadowBlur: 20,
                },
              ],
            }))
            setStickerUrl("")
          }}
          className="self-start rounded-full bg-tertiary-system-grouped-background px-4 py-2"
        >
          <Text>Add sticker</Text>
        </Pressable>
        {design.stickers.length ? (
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              onPress={() =>
                setDesign((current) => ({ ...current, stickers: current.stickers.slice(0, -1) }))
              }
              className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
            >
              <Text>Remove last sticker</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                setDesign((current) => ({
                  ...current,
                  stickers: current.stickers.map((item, index) =>
                    index === current.stickers.length - 1
                      ? { ...item, x: Math.max(0, item.x - 5) }
                      : item,
                  ),
                }))
              }
              className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
            >
              <Text>Move last sticker ←</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                setDesign((current) => ({
                  ...current,
                  stickers: current.stickers.map((item, index) =>
                    index === current.stickers.length - 1
                      ? { ...item, x: Math.min(100, item.x + 5) }
                      : item,
                  ),
                }))
              }
              className="rounded-full bg-tertiary-system-grouped-background px-4 py-2"
            >
              <Text>→</Text>
            </Pressable>
          </View>
        ) : null}
        <TextInput
          accessibilityLabel="Overlay text"
          className="rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          onChangeText={setOverlayText}
          placeholder="Extra text overlay"
          value={overlayText}
        />
        <Pressable
          onPress={() => {
            if (!overlayText.trim()) return
            setDesign((current) => ({
              ...current,
              extraTexts: [
                ...current.extraTexts,
                {
                  id: `text-${Date.now()}`,
                  text: overlayText.trim(),
                  x: 50,
                  y: 50,
                  rotation: 0,
                  fontSize: 48,
                  fontWeight: "700",
                  color: "#ffffff",
                  shadowBlur: 4,
                },
              ],
            }))
            setOverlayText("")
          }}
          className="self-start rounded-full bg-tertiary-system-grouped-background px-4 py-2"
        >
          <Text>Add text</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={t("drafts.summary_label")}
          className="min-h-20 rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          multiline
          onChangeText={setSummary}
          placeholder={t("drafts.summary_label")}
          textAlignVertical="top"
          value={summary}
        />
        <TextInput
          accessibilityLabel={t("drafts.content_label")}
          className="min-h-48 rounded-xl bg-tertiary-system-grouped-background px-4 py-3 text-label"
          multiline
          onChangeText={setContent}
          placeholder={t("drafts.content_label")}
          textAlignVertical="top"
          value={content}
        />
      </View>

      {error ? <Text className="text-red">{error}</Text> : null}
      {status ? <Text className="text-green">{status}</Text> : null}

      <Pressable
        accessibilityRole="button"
        className="items-center rounded-full bg-[#ff742f] px-5 py-4"
        disabled={isSaving}
        onPress={() => void saveDraft()}
      >
        {isSaving ? <ActivityIndicator color="white" /> : null}
        <Text className="font-semibold text-white">
          {isSaving ? t("drafts.saving") : t("drafts.save")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        className="items-center rounded-full bg-secondary-system-grouped-background px-5 py-4"
        onPress={() => void exportCard()}
      >
        <Text className="font-semibold text-label">Export / Share PNG</Text>
      </Pressable>
    </SafeNavigationScrollView>
  )
}

CardEditorScreen.title = "CardEditorScreen"
