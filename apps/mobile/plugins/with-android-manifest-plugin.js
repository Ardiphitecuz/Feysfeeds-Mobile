const { withAndroidManifest } = require("expo/config-plugins")

// Ported from https://github.com/bluesky-social/social-app/blob/a5e25a7a16cdcde64628e942c073a119bc1d7a1e/plugins/withAndroidManifestPlugin.js
module.exports = function withAndroidManifestPlugin(appConfig) {
  return withAndroidManifest(appConfig, (decoratedAppConfig) => {
    try {
      const application = decoratedAppConfig.modResults.manifest.application[0]
      application.$["android:largeHeap"] = "true"
      application["meta-data"] = [
        ...(application["meta-data"] ?? []).filter(
          ({ $ }) => $["android:name"] !== "firebase_analytics_collection_deactivated",
        ),
        {
          $: {
            "android:name": "firebase_analytics_collection_deactivated",
            "android:value": "true",
            "tools:replace": "android:value",
          },
        },
      ]
    } catch (e) {
      console.error(`withAndroidManifestPlugin failed`, e)
    }
    return decoratedAppConfig
  })
}
