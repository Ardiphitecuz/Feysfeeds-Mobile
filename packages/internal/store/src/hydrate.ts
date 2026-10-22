import { initializeDB, migrateDB } from "@follow/database/db"

import type { Hydratable } from "./lib/base"
import { actionActions } from "./modules/action/store"
import { collectionActions } from "./modules/collection/store"
import { entryActions } from "./modules/entry/store"
import { feedActions } from "./modules/feed/store"
import { imageActions } from "./modules/image/store"
import { inboxActions } from "./modules/inbox/store"
import { listActions } from "./modules/list/store"
import { subscriptionActions } from "./modules/subscription/store"
import { summaryActions } from "./modules/summary/store"
import { translationActions } from "./modules/translation/store"
import { unreadActions } from "./modules/unread/store"
import { userActions } from "./modules/user/store"
import { syncEngine } from "./sync/sync-engine"
import { transactionQueue } from "./sync/transaction-queue"

const hydrates: Hydratable[] = [
  feedActions,
  subscriptionActions,
  inboxActions,
  listActions,
  unreadActions,
  userActions,
  entryActions,
  collectionActions,
  summaryActions,
  translationActions,
  imageActions,
  actionActions,
]

export const hydrateDatabaseToStore = async (options?: { migrateDatabase?: boolean }) => {
  if (options?.migrateDatabase) {
    await initializeDB()
    await migrateDB()
  }
  // Hydrate sequentially to avoid SQLite prepared statement and finalization lock contention
  for (const h of hydrates) {
    try {
      await h.hydrate()
    } catch (e) {
      console.warn("[hydrateDatabaseToStore] store hydration error:", e)
    }
  }
  // Replay mutations that were recorded but not acknowledged by the server before the last exit.
  try {
    await transactionQueue.restore()
  } catch (e) {
    console.warn("[hydrateDatabaseToStore] transactionQueue.restore error:", e)
  }
  // Pull the changes recorded on the server since the last session.
  try {
    await syncEngine.start()
  } catch (e) {
    console.warn("[hydrateDatabaseToStore] syncEngine.start error:", e)
  }
}
