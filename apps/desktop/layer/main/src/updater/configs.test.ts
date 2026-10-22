import { describe, expect, it } from "vitest"

import { appUpdaterConfig } from "./configs"

describe("app updater configuration", () => {
  it("disables app and renderer updates", () => {
    expect(appUpdaterConfig).toMatchObject({
      enableAppUpdate: false,
      enableCoreUpdate: false,
      enableDistributionStoreUpdate: false,
      enableRenderHotUpdate: false,
      app: {
        autoCheckUpdate: false,
        autoDownloadUpdate: false,
      },
    })
  })
})
