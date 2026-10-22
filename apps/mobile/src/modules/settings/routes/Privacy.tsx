import { useTranslation } from "react-i18next"

import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import { Text } from "@/src/components/ui/typography/Text"
import {
  GroupedInsetListBaseCell,
  GroupedInsetListCard,
} from "@/src/components/ui/grouped/GroupedList"

export const PrivacyScreen = () => {
  const { t } = useTranslation("settings")
  return (
    <SafeNavigationScrollView
      className="bg-system-grouped-background"
      Header={<NavigationBlurEffectHeaderView title={t("titles.privacy")} />}
    >
      <GroupedInsetListCard className="mt-4">
        <GroupedInsetListBaseCell>
          <Text className="text-sm text-secondary-label">{t("privacy.unavailable")}</Text>
        </GroupedInsetListBaseCell>
      </GroupedInsetListCard>
    </SafeNavigationScrollView>
  )
}
