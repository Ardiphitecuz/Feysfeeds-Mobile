import * as FileSystem from "expo-file-system/legacy"
import { useTranslation } from "react-i18next"
import { Alert } from "react-native"

import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import {
  GroupedInsetListActionCell,
  GroupedInsetListCard,
  GroupedInsetListSectionHeader,
} from "@/src/components/ui/grouped/GroupedList"
import { getDbPath } from "@/src/database"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { reloadApp } from "@/src/lib/reload-app"
import { toast } from "@/src/lib/toast"

import { exportLocalDatabase } from "../utils"
import { FeyFeedsCloudScreen } from "./FeyFeedsCloud"

export const DataScreen = () => {
  const { t } = useTranslation("settings")
  const navigation = useNavigation()

  return (
    <SafeNavigationScrollView
      className="bg-system-grouped-background"
      Header={<NavigationBlurEffectHeaderView title={t("titles.data_control")} />}
    >
      {/* Data Sources */}

      <GroupedInsetListSectionHeader label={t("data_control.data_sources")} />
      <GroupedInsetListCard>
        <GroupedInsetListActionCell
          onPress={() => navigation.pushControllerView(FeyFeedsCloudScreen)}
          label={t("feyfeeds_cloud.import_to_cloud")}
          description={t("feyfeeds_cloud.import_to_cloud_description")}
        />

        <GroupedInsetListActionCell
          onPress={exportLocalDatabase}
          label={t("data_control.export_local_database.label")}
        />
      </GroupedInsetListCard>

      {/* Utils */}

      <GroupedInsetListSectionHeader label={t("data_control.utils")} />

      <GroupedInsetListCard>
        <GroupedInsetListActionCell
          onPress={() => {
            Alert.alert(
              t("general.rebuild_database.title"),
              t("general.rebuild_database.warning.line1"),
              [
                {
                  text: t("general.rebuild_database.cancel"),
                  style: "cancel",
                },
                {
                  text: t("general.rebuild_database.button"),
                  style: "destructive",
                  onPress: async () => {
                    const dbPath = getDbPath()
                    await FileSystem.deleteAsync(dbPath)
                    await reloadApp("Clear Sqlite Data")
                  },
                },
              ],
            )
          }}
          label={t("general.rebuild_database.label")}
          description={t("general.rebuild_database.description")}
        />

        <GroupedInsetListActionCell
          onPress={() => {
            Alert.alert(
              t("data_control.clean_cache.button"),
              t("data_control.clean_cache.description"),
              [
                {
                  text: t("data_control.clean_cache.cancel"),
                  style: "cancel",
                },
                {
                  text: t("data_control.clean_cache.clear"),
                  isPreferred: true,
                  onPress: async () => {
                    const cacheDir = FileSystem.cacheDirectory
                    if (cacheDir) {
                      await FileSystem.deleteAsync(cacheDir, { idempotent: true })
                    }
                    toast.success(t("data_control.clean_cache.success"))
                  },
                },
              ],
            )
          }}
          label={t("data_control.clean_cache.button")}
          description={t("data_control.clean_cache.description")}
        />
      </GroupedInsetListCard>
    </SafeNavigationScrollView>
  )
}
