export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  RSSHUB_BASE_URL?: string
}

export type ScheduledFeed = { id: string; user_id: string; url: string }

export type AuthenticatedUser = {
  id: string
  email: string | null
  name: string | null
}
