import { cn } from "@follow/utils/utils"
import type { Image as ExpoImage } from "expo-image"
import { useCallback } from "react"
import { Pressable, Text, View } from "react-native"
import { measure, runOnJS, runOnUI, useAnimatedRef } from "react-native-reanimated"

import { User4CuteFiIcon } from "@/src/icons/user_4_cute_fi"

import { Image } from "../image/Image"
import { useLightboxControls } from "../lightbox/lightboxState"

interface UserAvatarProps {
  image?: string | null
  size?: number
  name?: string | null
  className?: string
  color?: string
  preview?: boolean
}
export const UserAvatar = ({
  image,
  size = 24,
  name,
  className,
  color,
  preview = true,
}: UserAvatarProps) => {
  const { openLightbox } = useLightboxControls()
  const aviRef = useAnimatedRef<ExpoImage>()
  const onPreview = useCallback(() => {
    runOnUI(() => {
      "worklet"

      if (!image) {
        return
      }
      const rect = measure(aviRef)
      runOnJS(openLightbox)({
        images: [
          {
            uri: image,
            thumbUri: image,
            thumbDimensions: null,
            thumbRect: rect,
            dimensions: rect
              ? {
                  height: rect.height,
                  width: rect.width,
                }
              : null,
            type: "image",
          },
        ],
        index: 0,
      })
    })()
  }, [aviRef, image, openLightbox])
  if (!image) {
    return (
      <View
        // Without a fill, as while signed out, this view is flattened away. Android creates it with
        // only the props that changed once the name arrives, so it would lose its round corners.
        collapsable={false}
        className={cn(
          "items-center justify-center rounded-full",
          name && "bg-tertiary-system-fill",
          className,
        )}
        style={{
          width: size,
          height: size,
        }}
      >
        {name ? (
          <Text
            allowFontScaling={false}
            className="text-center uppercase text-secondary-label"
            style={{
              fontSize: size / 3,
            }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {name.slice(0, 2)}
          </Text>
        ) : (
          <User4CuteFiIcon width={size} height={size} color={color} />
        )}
      </View>
    )
  }
  const imageContent = (
    <View className="relative">
      <Image
        ref={aviRef}
        source={{
          uri: image,
        }}
        className={cn("rounded-full", className)}
        style={{
          width: size,
          height: size,
        }}
        proxy={{
          width: size,
          height: size,
        }}
      />
    </View>
  )
  return preview ? <Pressable onPress={onPreview}>{imageContent}</Pressable> : imageContent
}
