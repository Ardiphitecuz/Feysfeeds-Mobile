import { useAtomValue } from "jotai"
import { AddCuteReIcon } from "@/src/icons/add_cute_re"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ActivityIndicator, Alert, Pressable, View } from "react-native"

import {
  NavigationBlurEffectHeaderView,
  SafeNavigationScrollView,
} from "@/src/components/layouts/views/SafeNavigationScrollView"
import { Text } from "@/src/components/ui/typography/Text"
import { useNavigation } from "@/src/lib/navigation/hooks"
import { CardPreview } from "@/src/modules/card-drafts/CardPreview"
import {
  cardDraftsAtom,
  cardDraftsLoadedAtom,
  deleteCardDraft,
  loadCardDrafts,
} from "@/src/modules/card-drafts/store"
import { CardEditorScreen } from "@/src/screens/(stack)/card-editor/CardEditorScreen"

export const DraftsTabScreen = () => {
  const { t } = useTranslation("default")
  const navigation = useNavigation()
  const drafts = useAtomValue(cardDraftsAtom)
  const loaded = useAtomValue(cardDraftsLoadedAtom)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    loadCardDrafts().catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : String(error))
    })
  }, [])

  const confirmDelete = (draftId: string) => {
    Alert.alert(t("drafts.delete"), t("drafts.delete_confirm"), [
      { text: t("drafts.cancel"), style: "cancel" },
      {
        text: t("drafts.delete"),
        style: "destructive",
        onPress: () => {
          deleteCardDraft(draftId).catch((error: unknown) => {
            Alert.alert(t("drafts.error"), error instanceof Error ? error.message : String(error))
          })
        },
      },
    ])
  }

  return (
    <SafeNavigationScrollView
      className="bg-system-grouped-background"
      contentContainerClassName="gap-4 px-4 pb-8 pt-4"
      Header={<NavigationBlurEffectHeaderView title={t("drafts.title")} headerRight={<Pressable accessibilityRole="button" accessibilityLabel="Create new card" className="mr-1 h-10 w-10 items-center justify-center rounded-full bg-secondary-system-grouped-background" onPress={() => navigation.pushControllerView(CardEditorScreen, {})}><AddCuteReIcon width={22} height={22} /></Pressable>} />}
    >
      {!loaded && !loadError ? (
        <ActivityIndicator className="mt-12" />
      ) : loadError ? (
        <Text className="px-2 text-red">{loadError}</Text>
      ) : drafts.length === 0 ? (
        <View className="items-center gap-3 rounded-3xl bg-secondary-system-grouped-background px-6 py-12">
          <Text className="text-lg font-semibold">{t("drafts.empty_title")}</Text>
          <Text className="text-center text-secondary-label">{t("drafts.empty_description")}</Text>
        </View>
      ) : (
        drafts.map((draft) => (
          <View key={draft.id} className="gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("drafts.edit_accessibility", { title: draft.title })}
              onPress={() => navigation.pushControllerView(CardEditorScreen, { draftId: draft.id })}
            >
              <CardPreview
                title={draft.title}
                summary={draft.summary}
                category={draft.category}
                sourceTitle={draft.sourceTitle}
                sourceUrl={draft.sourceUrl}
                imageUrl={draft.imageUrl}
                design={draft.design}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="self-end px-3 py-2"
              onPress={() => confirmDelete(draft.id)}
            >
              <Text className="font-medium text-red">{t("drafts.delete")}</Text>
            </Pressable>
          </View>
        ))
      )}
    </SafeNavigationScrollView>
  )
}

export default DraftsTabScreen
