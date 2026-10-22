import {
  getImageProxyUrl as getImageProxyUrlUtils,
  replaceImgUrlIfNeed as replaceImgUrlIfNeedUtils,
} from "@follow/utils/img-proxy"

export const getImageProxyUrl = (
  params: Omit<Parameters<typeof getImageProxyUrlUtils>[0], "canUseProxy">,
) => {
  return getImageProxyUrlUtils({
    ...params,
    canUseProxy: false,
  })
}

export const replaceImgUrlIfNeed = (
  params: Omit<Parameters<typeof replaceImgUrlIfNeedUtils>[0], "canUseProxy">,
) => {
  return replaceImgUrlIfNeedUtils({
    ...params,
    canUseProxy: false,
  })
}
