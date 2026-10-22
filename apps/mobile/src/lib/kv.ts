import * as SQLite from "expo-sqlite"
import Storage from "expo-sqlite/kv-store"

const configureStoragePragmas = () => {
  try {
    const db = SQLite.openDatabaseSync("ExpoSQLiteStorage")
    db.execSync("PRAGMA journal_mode = WAL;")
    db.execSync("PRAGMA busy_timeout = 5000;")
  } catch (error) {
    console.warn("[kv] failed to configure ExpoSQLiteStorage PRAGMAs:", error)
  }
}

configureStoragePragmas()

class KV {
  setSync(key: string, value: string) {
    try {
      Storage.setItemSync(key, value)
    } catch (err) {
      console.warn(`[kv.setSync] error for key "${key}":`, err)
      Storage.setItem(key, value).catch(() => null)
    }
  }

  getSync(key: string) {
    try {
      return Storage.getItemSync(key)
    } catch (err) {
      console.warn(`[kv.getSync] error for key "${key}":`, err)
      return null
    }
  }

  set(key: string, value: string) {
    return Storage.setItem(key, value).catch((err) => {
      console.warn(`[kv.set] error for key "${key}":`, err)
    })
  }

  get(key: string) {
    return Storage.getItem(key).catch((err) => {
      console.warn(`[kv.get] error for key "${key}":`, err)
      return null
    })
  }

  delete(key: string) {
    return Storage.removeItem(key).catch((err) => {
      console.warn(`[kv.delete] error for key "${key}":`, err)
      return false
    })
  }

  clear() {
    return Storage.clear().catch((err) => {
      console.warn(`[kv.clear] error:`, err)
      return false
    })
  }

  keys() {
    try {
      return Storage.getAllKeysSync()
    } catch (err) {
      console.warn(`[kv.keys] error:`, err)
      return []
    }
  }

  [Symbol.iterator]() {
    try {
      return Storage.getAllKeysSync().values()
    } catch (err) {
      console.warn(`[kv.iterator] error:`, err)
      return [][Symbol.iterator]()
    }
  }
}

export const kv = new KV()
