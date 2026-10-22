import { Hono } from "hono"
import { describe, expect, it } from "vitest"

import type { Env } from "../env"
import { hashSessionToken } from "../lib/account-auth"
import { authRoute } from "./auth"

const createAuthApp = () => {
  const users = new Map<string, { id: string; email: string; name: null; password_hash: string }>()
  const sessions = new Map<string, { userId: string; expiresAt: number }>()
  const loginAttempts = new Map<string, { window_started_at: number; attempt_count: number }>()
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...args: unknown[]) {
          values = args
          return statement
        },
        async run() {
          if (sql.startsWith("INSERT INTO users")) {
            const [id, email, passwordHash] = values as [string, string, string, number]
            if (users.has(email)) throw new Error("duplicate email")
            users.set(email, { id, email, name: null, password_hash: passwordHash })
          } else if (sql.startsWith("INSERT INTO sessions")) {
            const [, userId, tokenHash, expiresAt] = values as [
              string,
              string,
              string,
              number,
              number,
            ]
            sessions.set(tokenHash, { userId, expiresAt })
          } else if (sql.startsWith("DELETE FROM sessions")) {
            sessions.delete(String(values[0]))
          } else if (sql.startsWith("INSERT INTO login_attempts")) {
            const [key, started, window, now, resetAt] = values as [string, number, number, number, number, number, number]
            const previous = loginAttempts.get(key)
            if (!previous || previous.window_started_at + window <= now) {
              loginAttempts.set(key, { window_started_at: resetAt, attempt_count: 1 })
            } else {
              loginAttempts.set(key, { ...previous, attempt_count: previous.attempt_count + 1 })
            }
            void started
          }
          return { meta: { changes: 1 } }
        },
        async first<T>() {
          if (sql.startsWith("SELECT window_started_at")) {
            return (loginAttempts.get(String(values[0])) ?? null) as T | null
          }
          if (sql.startsWith("SELECT id, email, name, password_hash FROM users")) {
            return (users.get(String(values[0])) ?? null) as T | null
          }
          if (sql.startsWith("SELECT users.id")) {
            const session = sessions.get(String(values[0]))
            if (!session || session.expiresAt <= Number(values[1])) return null
            const user = [...users.values()].find((candidate) => candidate.id === session.userId)
            return user ? ({ id: user.id, email: user.email, name: user.name } as T) : null
          }
          return null
        },
      }
      return statement
    },
  } as unknown as D1Database
  const app = new Hono<{ Bindings: Env }>().route("/v1/auth", authRoute)
  const env = { DB }
  return { app, env, users, sessions }
}

describe("FeyFeeds account endpoints", () => {
  it("registers, authenticates, returns the session, and revokes it on logout", async () => {
    const { app, env } = createAuthApp()
    const register = await app.request(
      "/v1/auth/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "Reader@Example.com",
          password: "correct horse battery staple",
        }),
      },
      env,
    )
    expect(register.status).toBe(201)
    const created = (await register.json()) as { data: { user: { email: string }; token: string } }
    expect(created.data.user.email).toBe("reader@example.com")
    expect(created.data.token).toMatch(/^[a-f0-9]{64}$/)

    const login = await app.request(
      "/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "reader@example.com",
          password: "correct horse battery staple",
        }),
      },
      env,
    )
    expect(login.status).toBe(200)
    const loggedIn = (await login.json()) as { data: { token: string } }

    const session = await app.request(
      "/v1/auth/session",
      {
        headers: { authorization: `Bearer ${loggedIn.data.token}` },
      },
      env,
    )
    expect(session.status).toBe(200)
    await expect(session.json()).resolves.toMatchObject({ data: { email: "reader@example.com" } })

    const logout = await app.request(
      "/v1/auth/logout",
      {
        method: "POST",
        headers: { authorization: `Bearer ${loggedIn.data.token}` },
      },
      env,
    )
    expect(logout.status).toBe(200)
    const revoked = await app.request(
      "/v1/auth/session",
      {
        headers: { authorization: `Bearer ${loggedIn.data.token}` },
      },
      env,
    )
    expect(revoked.status).toBe(401)
  })

  it("uses a generic login error for unknown emails and wrong passwords", async () => {
    const { app, env } = createAuthApp()
    const response = await app.request(
      "/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "missing@example.com", password: "incorrect password" }),
      },
      env,
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Invalid email or password" })
  })

  it("rejects invalid registration input and duplicate email addresses", async () => {
    const { app, env } = createAuthApp()
    const send = (email: string, password: string) => app.request(
      "/v1/auth/register",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) },
      env,
    )
    expect((await send("not-an-email", "short")).status).toBe(400)
    expect((await send("reader@example.com", "correct horse battery staple")).status).toBe(201)
    expect((await send("READER@example.com", "correct horse battery staple")).status).toBe(400)
  })

  it("rate limits repeated login failures without revealing account existence", async () => {
    const { app, env } = createAuthApp()
    const request = () => app.request(
      "/v1/auth/login",
      { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" }, body: JSON.stringify({ email: "missing@example.com", password: "wrong-password" }) },
      env,
    )
    for (let count = 0; count < 10; count += 1) expect((await request()).status).toBe(401)
    const limited = await request()
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({ error: "Invalid email or password" })
  })

  it("rejects missing, invalid, expired, and revoked sessions", async () => {
    const { app, env, users, sessions } = createAuthApp()
    users.set("reader@example.com", {
      id: "user-1",
      email: "reader@example.com",
      name: null,
      password_hash: "unused",
    })
    sessions.set(await hashSessionToken("expired-token"), {
      userId: "user-1",
      expiresAt: Date.now() - 1,
    })
    for (const authorization of [
      undefined,
      "Bearer not-a-session",
      "Bearer expired-token",
      "Bearer revoked-token",
    ]) {
      const response = await app.request(
        "/v1/auth/session",
        {
          headers: authorization ? { authorization } : {},
        },
        env,
      )
      expect(response.status).toBe(401)
    }
  })
})
