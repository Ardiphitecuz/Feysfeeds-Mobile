import { afterEach, describe, expect, it, vi } from "vitest"

describe("mobile FeyFeeds environment profiles", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("uses only the URL configured for each target profile", async () => {
    vi.stubEnv("EXPO_PUBLIC_FEYFEEDS_API_URL_PRODUCTION", "https://prod.example")
    vi.stubEnv("EXPO_PUBLIC_FEYFEEDS_API_URL_DEVELOPMENT", "https://dev.example")
    vi.stubEnv("EXPO_PUBLIC_FEYFEEDS_API_URL_STAGING", "https://staging.example")
    vi.stubEnv("EXPO_PUBLIC_FEYFEEDS_API_URL_LOCAL", "http://192.168.1.10:8787")

    const { getEnvProfiles__dangerously } =
      await import("../../../../packages/internal/shared/src/env.rn")
    const profiles = getEnvProfiles__dangerously()

    expect(profiles.prod.FEYFEEDS_API_URL).toBe("https://prod.example")
    expect(profiles.dev.FEYFEEDS_API_URL).toBe("https://dev.example")
    expect(profiles.staging.FEYFEEDS_API_URL).toBe("https://staging.example")
    expect(profiles.local.FEYFEEDS_API_URL).toBe("http://192.168.1.10:8787")
    expect(profiles.local.FEYFEEDS_API_URL).not.toBe(profiles.prod.FEYFEEDS_API_URL)
  })

  it("leaves an unset development URL unset", async () => {
    const { getEnvProfiles__dangerously } =
      await import("../../../../packages/internal/shared/src/env.rn")
    expect(getEnvProfiles__dangerously().dev.FEYFEEDS_API_URL).toBeUndefined()
  })
})
