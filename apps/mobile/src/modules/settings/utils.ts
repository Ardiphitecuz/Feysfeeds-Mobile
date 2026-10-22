import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import { t } from "i18next"

import { getDbPath } from "@/src/database"
import { toast } from "@/src/lib/toast"

export const exportLocalDatabase = async () => {
  const dbPath = getDbPath()
  try {
    // The export carries the Folo name; the local database keeps follow.db so existing data stays
    const destinationUri = `${FileSystem.documentDirectory}folo.db`
    await FileSystem.copyAsync({
      from: dbPath,
      to: destinationUri,
    })
    // Earlier exports were saved as follow.db next to it; drop that stale copy of the database
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}follow.db`, {
      idempotent: true,
    }).catch(console.error)

    await FileSystem.getInfoAsync(destinationUri)
    await Sharing.shareAsync(destinationUri, {
      UTI: "public.database",
      mimeType: "application/x-sqlite3",
      dialogTitle: t("general.export_database.label", { ns: "settings" }),
    })
  } catch (error) {
    console.error(error)
    toast.error(t("data_control.export_local_database.failed", { ns: "settings" }))
  }
}
