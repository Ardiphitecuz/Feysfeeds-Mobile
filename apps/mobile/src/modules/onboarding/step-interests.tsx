import { useTranslation } from "react-i18next"
import { View } from "react-native"

import { Text } from "@/src/components/ui/typography/Text"
import { Search3CuteReIcon } from "@/src/icons/search_3_cute_re"
import { accentColor } from "@/src/theme/colors"

import { OnboardingSectionScreenContainer } from "./shared"

export const StepInterests = () => {
  const { t } = useTranslation()
  const { t: tSettings } = useTranslation("settings")
  return (
    <OnboardingSectionScreenContainer>
      <View className="flex items-center gap-4">
        <Search3CuteReIcon height={80} width={80} color={accentColor} />
        <Text className="mt-2 text-2xl font-bold text-text">{t("onboarding.interests_title")}</Text>
        <Text className="mb-8 px-6 text-center text-lg text-label">
          {t("onboarding.interests_description")}
        </Text>
      </View>

      <Text className="mb-4 px-6 text-center text-secondary-label">
        {tSettings("discover.disabled.description")}
      </Text>
    </OnboardingSectionScreenContainer>
  )
}
