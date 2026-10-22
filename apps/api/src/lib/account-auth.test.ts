import { describe, expect, it } from "vitest"

import { hashPassword, hashSessionToken, verifyPassword } from "./account-auth"

describe("FeyFeeds account credentials", () => {
  it("hashes passwords with a random salt and verifies only the matching password", async () => {
    const firstHash = await hashPassword("correct horse battery staple")
    const secondHash = await hashPassword("correct horse battery staple")

    expect(firstHash).not.toContain("correct horse battery staple")
    expect(firstHash).not.toBe(secondHash)
    expect(firstHash).toMatch(/^pbkdf2-sha256\$100000\$/)
    await expect(verifyPassword("correct horse battery staple", firstHash)).resolves.toBe(true)
    await expect(verifyPassword("incorrect password", firstHash)).resolves.toBe(false)
  })

  it("stores only a one-way digest of the session token", async () => {
    await expect(hashSessionToken("opaque-session")).resolves.not.toBe("opaque-session")
    await expect(hashSessionToken("opaque-session")).resolves.toBe(
      await hashSessionToken("opaque-session"),
    )
  })

  it("rejects malformed or excessive password hash parameters before deriving a key", async () => {
    await expect(
      verifyPassword(
        "password",
        "pbkdf2-sha256$999999999$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000",
      ),
    ).resolves.toBe(false)
    await expect(verifyPassword("password", "pbkdf2-sha256$100000$bad$bad")).resolves.toBe(false)
  })
})
