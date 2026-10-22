import { jotaiStore } from "@follow/utils"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSettingAtom } from "./helper"

const mocks = vi.hoisted(() => {
  // Read by the shared constants at import
  vi.stubGlobal("ELECTRON", false)
  return {
    storage: new Map<string, string>(),
    dispatch: vi.fn(),
  }
})

vi.mock("@/src/lib/jotai", () => ({
  JotaiPersistSyncStorage: {
    getItem: <Value>(key: string, defaultValue: Value): Value => {
      const value = mocks.storage.get(key)
      return value === undefined ? defaultValue : JSON.parse(value)
    },
    setItem: (key: string, value: unknown) => {
      mocks.storage.set(key, JSON.stringify(value))
    },
    removeItem: (key: string) => {
      mocks.storage.delete(key)
    },
    subscribe: () => () => {},
  },
}))

// The hooks package reads the browser window at import
vi.mock("@follow/hooks", () => ({
  useRefValue: <T>(value: T) => ({ current: value }),
}))

vi.mock("@follow/utils/event-bus", () => ({
  EventBus: { dispatch: mocks.dispatch },
}))

const createDefaults = () => ({ translation: false, summary: true, unreadOnly: false })
const { getSettings, setSetting, settingAtom } = createSettingAtom("general", createDefaults)
const saved = () => jotaiStore.get(settingAtom)

describe("createSettingAtom settings", () => {
  beforeEach(() => {
    mocks.dispatch.mockClear()
    jotaiStore.set(settingAtom, { translation: true, summary: false, unreadOnly: true })
  })

  it("reads all saved settings without role-based restrictions", () => {
    expect(getSettings()).toMatchObject({ translation: true, summary: false, unreadOnly: true })
  })

  it("allows any setting to be enabled", () => {
    jotaiStore.set(settingAtom, createDefaults())

    setSetting("translation", true)

    expect(getSettings().translation).toBe(true)
    expect(mocks.dispatch).toHaveBeenCalledWith("SETTING_CHANGE_EVENT", {
      key: "general",
      payload: { translation: true },
    })
  })
})
