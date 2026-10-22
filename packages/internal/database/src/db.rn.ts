import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"
import { drizzle } from "drizzle-orm/expo-sqlite"
import * as SQLite from "expo-sqlite"

import { SQLITE_DB_NAME } from "./constant"
import migrations from "./drizzle/migrations"
import { migrateExpoSQLite } from "./migrator"
import * as schema from "./schemas"

const configurePragmas = (dbClient: SQLite.SQLiteDatabase) => {
  try {
    dbClient.execSync("PRAGMA journal_mode = WAL;")
    dbClient.execSync("PRAGMA busy_timeout = 5000;")
  } catch (error) {
    console.warn("Failed to configure SQLite PRAGMAs:", error)
  }
}

export let sqlite = SQLite.openDatabaseSync(SQLITE_DB_NAME)
configurePragmas(sqlite)

let db: ExpoSQLiteDatabase<typeof schema> & {
  $client: SQLite.SQLiteDatabase
}

export function initializeDB() {
  configurePragmas(sqlite)
  db = drizzle(sqlite, {
    schema,
    logger: false,
  })
}
export { db }

export async function migrateDB(): Promise<void> {
  try {
    configurePragmas(sqlite)
    await migrateExpoSQLite(sqlite, migrations)
  } catch (error) {
    console.error("Failed to migrate database:", error)
    await deleteDB()
    sqlite = SQLite.openDatabaseSync(SQLITE_DB_NAME)
    configurePragmas(sqlite)
    initializeDB()
    await migrateExpoSQLite(sqlite, migrations)
  }
}

export async function getDBFile() {}
export async function exportDB() {}
export async function deleteDB() {
  try {
    sqlite.closeSync()
  } catch {
    /* empty */
  }
  SQLite.deleteDatabaseSync(SQLITE_DB_NAME)
}
