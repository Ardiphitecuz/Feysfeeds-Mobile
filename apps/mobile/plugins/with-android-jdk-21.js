const { withGradleProperties } = require("expo/config-plugins")

function setGradleProperty(config, key, value) {
  return withGradleProperties(config, (config) => {
    const keyIndex = config.modResults.findIndex(
      (item) => item.type === "property" && item.key === key,
    )

    const nextItem = {
      type: "property",
      key,
      value,
    }

    if (keyIndex === -1) {
      config.modResults.push(nextItem)
    } else {
      config.modResults.splice(keyIndex, 1, nextItem)
    }

    return config
  })
}

function removeGradleProperty(config, key) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => item.type !== "property" || item.key !== key,
    )
    return config
  })
}

module.exports = function withAndroidJdk21(config) {
  let nextConfig = removeGradleProperty(config, "react.internal.disableJavaVersionAlignment")
  nextConfig = setGradleProperty(nextConfig, "kotlin.jvm.target.validation.mode", "warning")
  return nextConfig
}
