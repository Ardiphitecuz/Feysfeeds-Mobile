import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => {
  let value: string | null = null
  return {
    get: vi.fn(async (_key: string) => value),
    set: vi.fn(async (_key: string, nextValue: string) => {
      value = nextValue
    }),
    reset: (nextValue: string | null = null) => {
      value = nextValue
    },
  }
})

vi.mock("@/src/lib/kv", () => ({
  kv: {
    get: storage.get,
    set: storage.set,
  },
}))

vi.mock("@follow/utils", async () => {
  const { createStore } = await import("jotai")
  return { jotaiStore: createStore() }
})

describe("card draft storage", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    storage.reset()
    vi.stubGlobal("ELECTRON", false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("persists new drafts, updates existing ones, and deletes drafts", async () => {
    const { jotaiStore } = await import("@follow/utils")
    const { cardDraftsAtom, defaultCardDesign, deleteCardDraft, saveCardDraft } = await import("./store")
    const draft = {
      id: "draft-1",
      sourceEntryId: "entry-1",
      sourceTitle: "Source",
      sourceUrl: "https://example.com",
      title: "First title",
      summary: "Summary",
      content: "Rewritten content",
      category: "News",
      design: defaultCardDesign,
      updatedAt: 1,
    }

    await saveCardDraft(draft)
    await saveCardDraft({ ...draft, title: "Updated title", updatedAt: 2 })
    expect(jotaiStore.get(cardDraftsAtom)).toEqual([
      { ...draft, title: "Updated title", updatedAt: 2 },
    ])
    expect(JSON.parse((await storage.get("feyfeeds.card-drafts.v1")) || "[]")).toEqual([
      { ...draft, title: "Updated title", updatedAt: 2 },
    ])

    await deleteCardDraft("draft-1")
    expect(jotaiStore.get(cardDraftsAtom)).toEqual([])
    expect(JSON.parse((await storage.get("feyfeeds.card-drafts.v1")) || "[]")).toEqual([])
  })

  it("surfaces malformed persisted data instead of hiding it", async () => {
    storage.reset("{")
    const { loadCardDrafts } = await import("./store")

    await expect(loadCardDrafts()).rejects.toThrow("Saved card drafts contain invalid JSON.")
  })

  it("persists all template layout fields for restoration", async () => {
    const { jotaiStore } = await import("@follow/utils")
    const { cardDraftsAtom, defaultCardDesign, saveCardDraft } = await import("./store")
    const layout = {
      ...defaultCardDesign,
      template: "video" as const,
      videoAspectRatio: "9:16" as const,
      bgMode: "collage" as const,
      bgSrc: "https://example.com/bg.png",
      bg2Src: "https://example.com/bg2.png",
      bgTransform: { x: 12, y: -8, scale: 1.3 },
      stickers: [{ id: "sticker-1", src: "https://example.com/sticker.png", x: 45, y: 30, size: 240, rotation: 15, shape: "circle" as const, outlineWidth: 2, outlineColor: "#fff", shadowBlur: 8 }],
      extraTexts: [{ id: "text-1", text: "Overlay", x: 40, y: 60, rotation: 0, fontSize: 48, fontWeight: "700", color: "#fff", shadowBlur: 4 }],
      titleFormatting: "bold italic",
    }
    await saveCardDraft({ id: "round-trip", sourceEntryId: "entry", sourceTitle: "Source", sourceUrl: "https://example.com", title: "Before reload", summary: "", content: "Body", category: "News", design: layout, renderedImage: "file:///card.png", updatedAt: 1 })

    const persisted = JSON.parse((await storage.get("feyfeeds.card-drafts.v1")) || "[]")
    expect(persisted[0]?.design).toEqual(layout)
    expect(persisted[0]?.renderedImage).toBe("file:///card.png")
    expect(jotaiStore.get(cardDraftsAtom)[0]?.design).toEqual(layout)
  })
})
