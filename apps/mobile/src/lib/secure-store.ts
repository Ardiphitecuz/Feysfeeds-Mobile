import * as SecureStore from "expo-secure-store"
import Storage from "expo-sqlite/kv-store"

const fallbackPrefix = "follow_secure_store_fallback"
const warnedFallbackKeys = new Set<string>()
let forceFallback = false

const getFallbackKey = (key: string) => `${fallbackPrefix}:${key}`

const isSecureStoreUnavailable = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes("KeyChainException") ||
    error.message.includes("required entitlement") ||
    error.message.includes("keychain")
  )
}

const warnFallback = (
  action: "getItem" | "setItem" | "removeItem",
  key: string,
  error: unknown,
) => {
  const warnKey = `${action}:${key}`
  if (warnedFallbackKeys.has(warnKey)) {
    return
  }

  warnedFallbackKeys.add(warnKey)

  if (!(error instanceof Error)) {
    console.warn(`[auth-storage] SecureStore ${action} fallback enabled for ${key}`)
    return
  }

  console.warn(`[auth-storage] SecureStore ${action} fallback enabled for ${key}: ${error.message}`)
}

const getFallbackValue = (key: string) => {
  try {
    return Storage.getItemSync(getFallbackKey(key))
  } catch {
    return null
  }
}

const deleteSecureStoreItem = async (key: string) => {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch (error) {
    if (isSecureStoreUnavailable(error)) {
      forceFallback = true
      warnFallback("removeItem", key, error)
      return
    }

    console.warn(
      `[auth-storage] SecureStore removeItem failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export const safeSecureStore = {
  getItem(key: string) {
    if (forceFallback) {
      return getFallbackValue(key)
    }

    try {
      const value = SecureStore.getItem(key)
      if (value != null) {
        return value
      }
    } catch (error) {
      if (isSecureStoreUnavailable(error)) {
        forceFallback = true
        warnFallback("getItem", key, error)
        return getFallbackValue(key)
      }

      throw error
    }

    return getFallbackValue(key)
  },
  setItem(key: string, value: string) {
    if (forceFallback) {
      try {
        Storage.setItemSync(getFallbackKey(key), value)
      } catch {
        Storage.setItem(getFallbackKey(key), value).catch(() => null)
      }
      return
    }

    try {
      SecureStore.setItem(key, value)
      try {
        Storage.removeItemSync(getFallbackKey(key))
      } catch {
        Storage.removeItem(getFallbackKey(key)).catch(() => null)
      }
      return
    } catch (error) {
      if (isSecureStoreUnavailable(error)) {
        forceFallback = true
        warnFallback("setItem", key, error)
        try {
          Storage.setItemSync(getFallbackKey(key), value)
        } catch {
          Storage.setItem(getFallbackKey(key), value).catch(() => null)
        }
        return
      }

      throw error
    }
  },
  removeItem(key: string) {
    try {
      Storage.removeItemSync(getFallbackKey(key))
    } catch {
      Storage.removeItem(getFallbackKey(key)).catch(() => null)
    }

    if (forceFallback) {
      return
    }

    void deleteSecureStoreItem(key)
  },
  async removeItemAsync(key: string) {
    try {
      Storage.removeItemSync(getFallbackKey(key))
    } catch {
      Storage.removeItem(getFallbackKey(key)).catch(() => null)
    }

    if (forceFallback) {
      return
    }

    await deleteSecureStoreItem(key)
  },
}
