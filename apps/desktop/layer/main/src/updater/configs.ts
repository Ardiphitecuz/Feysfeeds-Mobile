export const appUpdaterConfig = {
  // Disable renderer hot update will trigger app update when available
  enableRenderHotUpdate: false,
  enableCoreUpdate: false,

  // Disable app update will also disable renderer hot update and core update
  enableAppUpdate: false,
  enableDistributionStoreUpdate: false,

  app: {
    autoCheckUpdate: false,
    autoDownloadUpdate: false,
    checkUpdateInterval: 15 * 60 * 1000,
  },
}
