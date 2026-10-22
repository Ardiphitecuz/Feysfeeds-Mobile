import type { JotaiSyncStorage } from "@follow/utils"
import Storage from "expo-sqlite/kv-store"

export { createAtomAccessor, createAtomHooks, jotaiStore } from "@follow/utils"

export const JotaiPersistSyncStorage = {
  getItem: <Value>(key: string, defaultValue: Value): Value => {
    try {
      const res = Storage.getItemSync(key)
      if (res === null) {
        return defaultValue
      }
      return JSON.parse(res)
    } catch {
      return defaultValue
    }
  },
  setItem: (key: string, value: unknown) => {
    try {
      return Storage.setItemSync(key, JSON.stringify(value))
    } catch {
      Storage.setItem(key, JSON.stringify(value)).catch(() => null)
    }
  },
  removeItem: (key: string) => {
    try {
      return Storage.removeItemSync(key)
    } catch {
      Storage.removeItem(key).catch(() => null)
    }
  },
  subscribe() {
    return () => {}
  },
} satisfies JotaiSyncStorage<unknown>
