import { UrlBuilder as UrlBuilderClass } from "@follow/utils/url-builder"

import { proxyEnv } from "./proxy-env"

export const UrlBuilder = new UrlBuilderClass(proxyEnv.FOLO_LEGACY_WEB_URL)
