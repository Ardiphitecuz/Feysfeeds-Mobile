import type { Context } from "hono"
import { Hono } from "hono"

import type { Env } from "../env"
import {
  createSessionToken,
  getSessionExpiry,
  hashPassword,
  hashSessionToken,
  hashText,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  verifyPassword,
} from "../lib/account-auth"
import { requireFeyFeedsUser } from "../middleware/auth"

type UserRow = { id: string; email: string; name: string | null; password_hash: string }
type PublicUser = Pick<UserRow, "id" | "email" | "name">
const loginWindowMs = 15 * 60 * 1000
const loginLimit = 10

export const authRoute = new Hono<{ Bindings: Env }>()
  .post("/register", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Expected a JSON object" }, 400)
    }
    const emailValue = Reflect.get(body, "email")
    const password = Reflect.get(body, "password")
    if (typeof emailValue !== "string" || typeof password !== "string") {
      return context.json({ error: "Email and password are required" }, 400)
    }
    const email = normalizeEmail(emailValue)
    if (!isValidEmail(email) || !isValidPassword(password)) {
      return context.json({ error: "Unable to create account with these details" }, 400)
    }

    const id = crypto.randomUUID()
    const passwordHash = await hashPassword(password)
    try {
      await context.env.DB.prepare(
        "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, NULL, ?, ?)",
      )
        .bind(id, email, passwordHash, Date.now())
        .run()
    } catch {
      return context.json({ error: "Unable to create account with these details" }, 400)
    }
    return createSession(context.env.DB, context, { id, email, name: null }, 201)
  })
  .post("/login", async (context) => {
    const body: unknown = await context.req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Invalid email or password" }, 401)
    }
    const emailValue = Reflect.get(body, "email")
    const password = Reflect.get(body, "password")
    if (typeof emailValue !== "string" || typeof password !== "string" || password.length > 128) {
      return context.json({ error: "Invalid email or password" }, 401)
    }
    const email = normalizeEmail(emailValue)
    if (!isValidEmail(email)) return context.json({ error: "Invalid email or password" }, 401)

    const attemptKey = await hashText(
      `${email}\n${context.req.header("cf-connecting-ip") ?? "unknown"}`,
    )
    const now = Date.now()
    const attempt = await context.env.DB.prepare(
      "SELECT window_started_at, attempt_count FROM login_attempts WHERE attempt_key = ?",
    )
      .bind(attemptKey)
      .first<{ window_started_at: number; attempt_count: number }>()
    if (
      attempt &&
      attempt.window_started_at + loginWindowMs > now &&
      attempt.attempt_count >= loginLimit
    ) {
      return context.json({ error: "Invalid email or password" }, 429)
    }

    const user = await context.env.DB.prepare(
      "SELECT id, email, name, password_hash FROM users WHERE email = ?",
    )
      .bind(email)
      .first<UserRow>()
    const passwordMatches = await verifyPassword(
      password,
      user?.password_hash ??
        "pbkdf2-sha256$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000",
    )
    if (!user || !passwordMatches) {
      await context.env.DB.prepare(
        "INSERT INTO login_attempts (attempt_key, window_started_at, attempt_count) VALUES (?, ?, 1) ON CONFLICT(attempt_key) DO UPDATE SET window_started_at = CASE WHEN login_attempts.window_started_at + ? <= ? THEN ? ELSE login_attempts.window_started_at END, attempt_count = CASE WHEN login_attempts.window_started_at + ? <= ? THEN 1 ELSE login_attempts.attempt_count + 1 END",
      )
        .bind(attemptKey, now, loginWindowMs, now, now, loginWindowMs, now)
        .run()
      return context.json({ error: "Invalid email or password" }, 401)
    }
    await context.env.DB.prepare("DELETE FROM login_attempts WHERE attempt_key = ?")
      .bind(attemptKey)
      .run()
    return createSession(context.env.DB, context, user, 200)
  })
  .get("/session", requireFeyFeedsUser, (context) => context.json({ data: context.get("user") }))
  .post("/logout", requireFeyFeedsUser, async (context) => {
    const token = context.req.header("authorization")?.match(/^Bearer (\S+)$/i)?.[1]
    if (token) {
      await context.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await hashSessionToken(token))
        .run()
    }
    return context.json({ data: { success: true } })
  })

const createSession = async (
  db: D1Database,
  context: Context<{ Bindings: Env }>,
  user: PublicUser,
  status: 200 | 201,
) => {
  const token = createSessionToken()
  const expiresAt = getSessionExpiry()
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), user.id, await hashSessionToken(token), expiresAt, Date.now())
    .run()
  return context.json({ data: { user, token, expiresAt } }, status)
}
