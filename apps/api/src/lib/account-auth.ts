const encoder = new TextEncoder()
// Cloudflare Workers Web Crypto currently accepts PBKDF2 counts up to 100,000.
// Keep the verifier threshold aligned with the deployed runtime.
const passwordIterations = 100_000
const maximumPasswordIterations = 100_000
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000
const workerSubtle = crypto.subtle as SubtleCrypto & {
  timingSafeEqual: (a: ArrayBufferView, b: ArrayBufferView) => boolean
}

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false
  if (typeof workerSubtle.timingSafeEqual === "function") {
    return workerSubtle.timingSafeEqual(left, right)
  }
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

const fromHex = (value: string) =>
  new Uint8Array(value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])

export const hashPassword = async (
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
  iterations = passwordIterations,
) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  )
  return `pbkdf2-sha256$${iterations}$${toHex(salt)}$${toHex(new Uint8Array(bits))}`
}

export const verifyPassword = async (password: string, encoded: string) => {
  const [algorithm, iterationText, saltText, expectedText] = encoded.split("$")
  const iterations = Number(iterationText)
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < passwordIterations ||
    iterations > maximumPasswordIterations ||
    !/^[a-f0-9]{32}$/i.test(saltText ?? "") ||
    !/^[a-f0-9]{64}$/i.test(expectedText ?? "")
  ) {
    return false
  }
  const actualText = (await hashPassword(password, fromHex(saltText ?? ""), iterations)).split(
    "$",
  )[3]
  const expected = fromHex(expectedText ?? "")
  const actual = fromHex(actualText ?? "")
  return constantTimeEqual(expected, actual)
}

export const hashSessionToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token))
  return toHex(new Uint8Array(digest))
}

export const hashText = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
  return toHex(new Uint8Array(digest))
}

export const createSessionToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export const getSessionExpiry = () => Date.now() + sessionLifetimeMs

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const isValidEmail = (email: string) => {
  if (email.length > 254 || /\s/.test(email)) return false
  const [local, domain, ...extra] = email.split("@")
  if (!local || local.length > 64 || !domain || domain.length > 253 || extra.length > 0) {
    return false
  }
  const labels = domain.split(".")
  return labels.length > 1 && labels.every((label) => label.length > 0 && label.length <= 63)
}

export const isValidPassword = (password: string) => password.length >= 8 && password.length <= 128
