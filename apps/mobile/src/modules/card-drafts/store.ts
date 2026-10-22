import { jotaiStore } from "@follow/utils"
import { atom } from "jotai"

import { kv } from "@/src/lib/kv"

export interface CardDraft {
  id: string
  sourceEntryId: string
  sourceTitle: string
  sourceUrl: string
  imageUrl?: string
  title: string
  summary: string
  content: string
  category: string
  design: CardDesignState
  renderedImage?: string
  updatedAt: number
}

export interface CardDesignState {
  template: "post" | "video"
  videoAspectRatio: "3:4" | "9:16"
  bgMode: "single" | "collage"
  bgSrc: string
  bg2Src: string
  videoUrl?: string
  bgTransform: { x: number; y: number; scale: number }
  bg2Transform: { x: number; y: number; scale: number }
  splitAngle: number
  stickers: Array<{ id: string; src: string; x: number; y: number; size: number; rotation: number; shape: "original" | "square" | "circle"; outlineWidth: number; outlineColor: string; shadowBlur: number }>
  extraTexts: Array<{ id: string; text: string; x: number; y: number; rotation: number; fontSize: number; fontWeight: string; fontStyle?: string; color: string; shadowBlur: number }>
  titleFormatting: string
}

export const defaultCardDesign: CardDesignState = {
  template: "post", videoAspectRatio: "3:4", bgMode: "single", bgSrc: "", bg2Src: "", videoUrl: undefined,
  bgTransform: { x: 0, y: 0, scale: 1 }, bg2Transform: { x: 0, y: 0, scale: 1 },
  splitAngle: 0, stickers: [], extraTexts: [], titleFormatting: "",
}

const STORAGE_KEY = "feyfeeds.card-drafts.v1"
export const cardDraftsAtom = atom<CardDraft[]>([])
export const cardDraftsLoadedAtom = atom(false)

let loadPromise: Promise<void> | undefined

const isTransform = (value: unknown): value is CardDesignState["bgTransform"] =>
  typeof value === "object" && value !== null &&
  typeof (value as Record<string, unknown>).x === "number" &&
  typeof (value as Record<string, unknown>).y === "number" &&
  typeof (value as Record<string, unknown>).scale === "number"

const isCardDesignState = (value: unknown): value is CardDesignState => {
  if (typeof value !== "object" || value === null) return false
  const design = value as Record<string, unknown>
  return (
    (design.template === "post" || design.template === "video") &&
    (design.videoAspectRatio === "3:4" || design.videoAspectRatio === "9:16") &&
    (design.bgMode === "single" || design.bgMode === "collage") &&
    typeof design.bgSrc === "string" && typeof design.bg2Src === "string" &&
    (design.videoUrl === undefined || typeof design.videoUrl === "string") &&
    isTransform(design.bgTransform) && isTransform(design.bg2Transform) &&
    typeof design.splitAngle === "number" && Array.isArray(design.stickers) &&
    Array.isArray(design.extraTexts) && typeof design.titleFormatting === "string"
  )
}

const isCardDraft = (value: unknown): value is CardDraft => {
  if (typeof value !== "object" || value === null) return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.id === "string" &&
    typeof draft.sourceEntryId === "string" &&
    typeof draft.sourceTitle === "string" &&
    typeof draft.sourceUrl === "string" &&
    (draft.imageUrl === undefined || typeof draft.imageUrl === "string") &&
    typeof draft.title === "string" &&
    typeof draft.summary === "string" &&
    typeof draft.content === "string" &&
    typeof draft.category === "string" &&
    (draft.design === undefined || isCardDesignState(draft.design)) &&
    (draft.renderedImage === undefined || typeof draft.renderedImage === "string") &&
    typeof draft.updatedAt === "number"
  )
}

export const loadCardDrafts = () => {
  if (!loadPromise) {
    loadPromise = (async () => {
      const stored = await kv.get(STORAGE_KEY)
      if (!stored) {
        jotaiStore.set(cardDraftsAtom, [])
        jotaiStore.set(cardDraftsLoadedAtom, true)
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(stored)
      } catch (error) {
        throw new Error("Saved card drafts contain invalid JSON.", { cause: error })
      }

      if (!Array.isArray(parsed) || !parsed.every(isCardDraft)) {
        throw new Error("Saved card drafts have an invalid format.")
      }

      jotaiStore.set(
        cardDraftsAtom,
        [...parsed].map((draft) => ({ ...draft, design: draft.design ?? defaultCardDesign })).sort((a, b) => b.updatedAt - a.updatedAt),
      )
      jotaiStore.set(cardDraftsLoadedAtom, true)
    })().catch((error: unknown) => {
      loadPromise = undefined
      throw error
    })
  }

  return loadPromise
}

export const saveCardDraft = async (draft: CardDraft) => {
  draft = { ...draft, design: draft.design ?? defaultCardDesign }
  await loadCardDrafts()
  const drafts = jotaiStore.get(cardDraftsAtom)
  const nextDrafts = [draft, ...drafts.filter((existing) => existing.id !== draft.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )

  await kv.set(STORAGE_KEY, JSON.stringify(nextDrafts))
  jotaiStore.set(cardDraftsAtom, nextDrafts)
}

export const deleteCardDraft = async (draftId: string) => {
  await loadCardDrafts()
  const nextDrafts = jotaiStore.get(cardDraftsAtom).filter((draft) => draft.id !== draftId)

  await kv.set(STORAGE_KEY, JSON.stringify(nextDrafts))
  jotaiStore.set(cardDraftsAtom, nextDrafts)
}

export const createCardDraftId = () =>
  `card-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
