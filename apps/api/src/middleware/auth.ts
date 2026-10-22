import { createMiddleware } from "hono/factory"

import type { AuthenticatedUser, Env } from "../env"
import { hashSessionToken } from "../lib/account-auth"

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthenticatedUser
  }
}

export const requireFeyFeedsUser = createMiddleware<AppEnv>(async (context, next) => {
  const authorization = context.req.header("authorization")
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1]
  if (!token || token.length > 256) {
    return context.json({ error: "Authentication required" }, 401)
  }

  const tokenHash = await hashSessionToken(token)
  const session = await context.env.DB.prepare(
    "SELECT users.id, users.email, users.name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
  )
    .bind(tokenHash, Date.now())
    .first<AuthenticatedUser>()

  if (!session) {
    return context.json({ error: "Authentication required" }, 401)
  }

  context.set("user", session)
  await next()
})
