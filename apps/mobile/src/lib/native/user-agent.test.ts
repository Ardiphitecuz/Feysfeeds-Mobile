import { describe, expect, it, vi } from "vitest"

vi.mock("expo-application", () => ({
  nativeApplicationVersion: "1.2.3",
  nativeBuildVersion: "4",
}))

vi.mock("expo-constants", () => ({
  default: {
    getWebViewUserAgentAsync: vi.fn(async () => "Mozilla/5.0"),
  },
}))

describe("getUserAgent", () => {
  it("identifies the mobile app as FeyFeeds", async () => {
    const { getUserAgent } = await import("./user-agent")

    await expect(getUserAgent()).resolves.toBe("Mozilla/5.0 FeyFeeds/1.2.3.4")
  })
})
