import { CardTemplate } from "./CardTemplate"
import type { CardDesignState } from "./store"
import type { View } from "react-native"

export const CardPreview = ({
  title,
  summary: _summary,
  category,
  sourceTitle,
  sourceUrl,
  imageUrl,
  design,
  onCaptureReady,
}: {
  title: string
  summary?: string
  category: string
  sourceTitle: string
  sourceUrl?: string
  imageUrl?: string
  design?: CardDesignState
  onCaptureReady?: (ref: View | null) => void
}) => (
  <CardTemplate
    title={title}
    category={category}
    sourceTitle={sourceTitle}
    sourceUrl={sourceUrl}
    imageUrl={imageUrl}
    design={design}
    onCaptureReady={onCaptureReady}
  />
)
