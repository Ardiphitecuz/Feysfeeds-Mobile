import { Script } from "node:vm"

import { describe, expect, it } from "vitest"

import { getImageProxyUrl } from "../../../lib/img-proxy"
import { atStart } from "./injected-js"

describe("Android entry image proxy", () => {
  it("uses original source image URLs instead of the Folo proxy", () => {
    const url = "https://cdnfile.sspai.com/2025/01/01/a.png"

    expect(getImageProxyUrl({ url })).toBe(url)
    expect(atStart).not.toContain("img.folo.is")
  })

  it("keeps the Android document start script valid without image proxy fallback", () => {
    expect(() => new Script(atStart)).not.toThrow()
  })
})
