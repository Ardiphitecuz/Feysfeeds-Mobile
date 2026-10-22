# FeyFeeds API Worker

The Cloudflare Worker uses Hono and D1 for FeyFeeds-owned accounts, sessions,
feeds, cached articles, and read/bookmark states. Account passwords are hashed
with PBKDF2-HMAC-SHA-256 through the Workers Web Crypto API. The database stores
only password hashes and SHA-256 digests of opaque, random session tokens.

## Cloud setup

1. Authenticate Wrangler with the Cloudflare account that owns the Worker:
   `pnpm --dir apps/api exec wrangler login`.
2. Set the D1 database ID in `wrangler.jsonc` if deploying to another database.
3. Apply migrations locally and remotely:
   `pnpm --filter @feyfeeds/api exec wrangler d1 migrations apply feyfeeds --local`
   and `pnpm --filter @feyfeeds/api exec wrangler d1 migrations apply feyfeeds --remote`.
4. Deploy with `pnpm --filter @feyfeeds/api exec wrangler deploy`.

Feed refresh runs from the Worker Cron Trigger every minute. Each run claims at
most five due feeds from D1 and refreshes them independently; a failed
feed records its error and attempt time, then becomes eligible after 15 minutes.
The fetcher follows at most three validated redirects, times out each request
after 12 seconds, reads at most 1.5 MB, and stores at most 100 entries per feed.
Entry IDs are deterministic hashes of the FeyFeeds feed ID and feed GUID, and
upserts preserve those IDs across refreshes. This bounds each invocation while
spreading work over later cron runs. The five-feed batch keeps concurrent
external requests below the Workers free-plan subrequest ceiling, but currently
supports about 75 feeds at the 15-minute refresh interval; higher sustained
volume needs Queue consumers or a larger paid-plan batch before deployment.
For local development, `pnpm --filter @feyfeeds/api dev` loads the cron trigger
from `wrangler.jsonc`; manually trigger it with
`curl "http://localhost:8787/cdn-cgi/local/scheduled"`.
On remote deploy, the configured cron
trigger is installed with `wrangler deploy`; confirm it in the Cloudflare
Worker Triggers dashboard. Apply migrations with `wrangler d1 migrations apply
feyfeeds --local` or `--remote` before running/deploying.

No Firebase project secret or Folo auth service is required for FeyFeeds API
authentication. Keep Worker observability and request logging free of
Authorization headers and session tokens.

## Article summaries

`POST /v1/ai/summary` requires a FeyFeeds session and accepts
`{ "entryId": "rss_<64 lowercase hex characters>", "language": "en" }`.
The Worker checks that the entry and its feed belong to the authenticated user
before reading content. It accepts supported language codes, summarizes at most
40,000 characters, allows 20 uncached generations per user per hour, and times
out the provider request after 20 seconds. Results are cached in D1 by user,
entry, language, Gemini model, and prompt version. Cached results do not spend
the generation limit. Provider failures return safe 502/503 errors.

Set `GEMINI_API_KEY` as a Worker secret; never place it in `wrangler.jsonc`, a
committed env file, or the mobile app:

```sh
pnpm --filter @feyfeeds/api exec wrangler secret put GEMINI_API_KEY
```

For local Wrangler development, create the ignored `apps/api/.dev.vars` file
with `GEMINI_API_KEY=...`. Optionally set `GEMINI_MODEL` as a non-secret
environment variable; it defaults to `gemini-3.8-flash`. Apply the new D1
migration locally and remotely before using the endpoint.

## Authentication API

- `POST /v1/auth/register` — JSON `{ "email": "...", "password": "..." }`.
- `POST /v1/auth/login` — returns the same session shape for valid credentials.
- `GET /v1/auth/session` — returns the current user.
- `POST /v1/auth/logout` — revokes the current session.

Register/login return `{ "data": { "user": {...}, "token": "...", "expiresAt": 0 } }`.
Send the opaque token as `Authorization: Bearer <session token>` to private
routes. Sessions expire after 30 days and are checked against D1 on every
private request. Store tokens only in secure client storage. Password recovery,
email verification, OAuth, Firebase Cloud account/data migration, and Folo main
account migration are not implemented. Existing preview feed rows use Firebase
UIDs and are not linked to newly created FeyFeeds accounts.

Passwords must contain 8–128 characters. Email is normalized to lowercase and
validated before account creation. Registration returns a generic failure for
duplicate addresses. Login uses the same `Invalid email or password` response
for an unknown account and a bad password, and limits a normalized email/IP
pair to 10 attempts per 15-minute window. Do not log request bodies,
Authorization headers, session tokens, cookies, or passwords. Account deletion
revokes every session and permanently removes FeyFeeds-owned account data; it
does not delete legacy Folo or Firebase data.

Password hashing uses Workers Web Crypto PBKDF2-HMAC-SHA-256 (100,000
iterations with a random 16-byte salt); sessions use 256-bit random opaque
tokens and only SHA-256 token digests are stored in D1. Workers Web Crypto
supports PBKDF2, while D1 is the account/session persistence binding. No
password reset or verification email endpoints are exposed until a real email
delivery and verification flow exists.

The verifier rejects malformed hashes and iteration counts above the Worker
runtime's supported 100,000-iteration limit before deriving a key. Unknown
accounts still perform a dummy PBKDF2 verification using the same iteration
count as real accounts. Unexpected Worker errors are logged with only the
request path and method; raw error objects and request data are not serialized.

## Account profile and lifecycle

- `GET /v1/account/profile` and `PUT /v1/account/profile` read/update the basic profile (`{ "name": "..." }`, max 80 characters).
- `GET /v1/account/preferences` and `PUT /v1/account/preferences` read/update the language preference (`en`, `ja`, or `zh-CN`).
- `DELETE /v1/account` deletes the account and FeyFeeds sessions, subscriptions, cached entries, entry states, AI summaries, and usage records in a D1 batch.

Every route requires the FeyFeeds bearer session. Account deletion revokes all
sessions and permanently removes FeyFeeds account data; it does not delete
legacy Folo or Firebase data.

### Local/deployment account setup

No auth provider secrets are required. Apply all D1 migrations before local
development or deployment:

```sh
pnpm --filter @feyfeeds/api exec wrangler d1 migrations apply feyfeeds --local
pnpm --filter @feyfeeds/api exec wrangler d1 migrations apply feyfeeds --remote
pnpm --filter @feyfeeds/api dev
pnpm --filter @feyfeeds/api exec wrangler deploy
```

The `DB` binding and database name are configured in `apps/api/wrangler.jsonc`.
Set `ALLOWED_ORIGINS` there only for browser clients; native mobile requests
send bearer tokens and do not need cookie/CORS auth. Apply
`0005_account_profile_preferences.sql` and `0006_login_limits.sql` locally and remotely before
deploying this account API revision.

## Data API

- `GET /health` — public Worker health check.
- `GET /v1/me` — authenticated FeyFeeds identity.
- `GET /v1/feeds` — list the signed-in user's followed feed URLs.
- `POST /v1/feeds` — follow an HTTP(S) feed URL or configured `rsshub://` route (`{ "url": "...", "title": "..." }`).
- `POST /v1/feeds/discover` — authenticated `{ "url": "https://site.example" }`; inspect a public website and return up to 10 RSS/Atom/JSON Feed autodiscovery links. Responses are bounded to 512 KB, 8 seconds and three manually validated redirects. This inspects advertised links only: it is not keyword search, a catalog, trending, or full feed metadata extraction.
- `POST /v1/feeds/import` — import up to 500 feeds from OPML XML.
- `POST /v1/feeds/:feedId/refresh` — fetch and parse up to 100 RSS 2.0, Atom, or JSON Feed 1.0/1.1 articles; limited to 20 attempts per account per hour and one attempt per feed per 15 minutes.
- `DELETE /v1/feeds/:feedId` — unfollow one of the signed-in user's feeds.
- `GET /v1/timeline?limit=30&cursor=...` — list cached articles with pagination.
- `GET /v1/entry-states?filter=read|bookmarked&limit=100` — list read/bookmark states for entries whose feed belongs to the signed-in user. `limit` is between 1 and 100; the optional filter selects states with that flag enabled.
- `PUT /v1/entry-states/:entryId` — update read/bookmark state only when the entry and its feed belong to the signed-in user. Missing and other users' entries both return `{ "error": "Entry not found" }` with status 404.
- `GET /v1/library/search?q=...&limit=20&offset=0` — private search across owned feed names/URLs and cached article titles/URLs. `q` is 1–100 characters; limit is 1–50 and offset is capped at 10,000. This is not global catalog discovery and does not search article body text.
- `GET|POST /v1/library/folders`, `PUT|DELETE /v1/library/folders/:id`, `PUT /v1/library/folders/reorder` — owned folders, ordered by position. Deleting a folder removes its memberships; feeds remain.
- `GET|POST /v1/library/folders/:id/feeds`, `DELETE /v1/library/folders/:id/feeds/:feedId`, `PUT /v1/library/folders/:id/feeds/:feedId/move`, `PUT /v1/library/folders/:id/feeds/reorder` — add/remove/move/reorder owned feed membership. A feed may belong to multiple folders; deleting a feed cascades memberships.
- `GET|POST /v1/library/lists`, `GET|PUT|DELETE /v1/library/lists/:id`, `PUT /v1/library/lists/reorder` — private-by-default feed lists with name, description, visibility and order.
- `POST|DELETE /v1/library/lists/:id/feeds`, `PUT /v1/library/lists/:id/feeds/:feedId/move`, `PUT /v1/library/lists/:id/feeds/reorder`, `GET /v1/library/lists/:id` — add/remove/move/reorder a feed and read ordered list detail. Memberships only reference feeds owned by the same user and cascade on feed/list deletion.
- `POST|DELETE /v1/library/lists/:id/share` — create a read-only random link or revoke all active links and make the list private. The raw token is returned once at creation; only SHA-256 is stored.
- `GET /v1/public/lists/:token` — unauthenticated, rate-limited JSON view of an active link-visible list, with only the list name/description and selected feed title/URL. It never returns owner identity or article content.

All private routes require a valid, non-expired FeyFeeds session. Feed and entry
records are scoped to the authenticated FeyFeeds user ID. Entry-state reads join
states to entries and their feeds under that user ID, and writes use a single
ownership-scoped insert/upsert. `ALLOWED_ORIGINS` can
be configured as a comma-separated origin allowlist; leave unset for native
mobile clients and local testing.

Migration `0008_user_collections.sql` is idempotent and adds owned `feed_folders`,
`feed_folder_members`, `user_lists`, `user_list_feeds`, `list_share_tokens`, and
`public_share_limits`, plus indexes and composite ownership foreign keys. Folder
and list deletion cascades their memberships; feed deletion cascades folder/list
memberships and cached entries. A migration cleanup and delete trigger remove
`entry_states` when an entry is deleted so feed removal does not leave orphan
read/bookmark state.
The existing `entry_states.is_bookmarked` remains the only bookmark model.
No local SQLite/Folo collection data is migrated: old IDs and list/category
semantics cannot be proven to map safely, so source data is retained.
Public share requests are limited to 60 per token per minute. Tokens are never
written to logs; revoke immediately deactivates every token for that list.
The public endpoint is JSON only: there is no SSR page, canonical URL, or social
metadata yet. The FeyFeeds Cloud mobile screen exposes feed search, folder/list
creation, feed membership adds, and share/revoke through the read-only JSON URL.
Rename/delete, membership removal/reordering, cached collection data, and
offline organization queues are API-only at this stage.

The parser supports RSS 2.0, Atom, and JSON Feed 1.0/1.1. It normalizes source
IDs, alternate links, HTML/text content, summaries, authors, categories,
publication dates and enclosure/media URLs. At most 100 entries, 32 categories
per entry, 16 attachments per entry, and bounded field lengths are stored.
Malformed XML/JSON, invalid UTF-8, unsupported content types, failed origins,
and disallowed redirects return safe feed errors; refresh records an error and
attempt time and the scheduler retries after 15 minutes. Servers with a missing
or generic content type are parsed by body sniffing; explicitly non-feed media
types are rejected. Article HTML is sanitized with a tag/attribute whitelist
before storage and again when timeline rows are returned, covering older
unsanitized rows. Scripts, styles, forms, event handlers, and non-public links
or image sources are removed. Clients should still render feed HTML in a
sandboxed/isolated reader and never execute scripts.

## Offline sync contract and retry behavior

The FeyFeeds sync contract is user-scoped and incremental. The server exposes
private data using the authenticated user ID, and the client stores nothing in a
shared global namespace. The mobile app keeps a per-user outbox with FIFO order,
stable mutation IDs, and idempotent replay semantics for add/delete/read/bookmark
operations. A retry does not create duplicate server effects: duplicate follow
operations are accepted when the URL already belongs to the same user, and delete
operations are treated as success when the resource is already missing.

The sync cursor is a server-issued `nextCursor` token from `GET /v1/timeline`.
It is opaque and must be treated as untrusted input; invalid or expired cursors
return a clear 400/401-style error and the client keeps the last good cached
state until a fresh cursor is fetched. Cursor pagination is the only supported
incremental sync mechanism for timeline data; clients must not re-download the
entire timeline on every load.

For offline behavior, the local app keeps the most recently cached feed and
timeline data available, shows a visible offline status when the outbox is
pending, and replays queued mutations whenever the app becomes active or the
network recovers. Invalid or permanent errors like validation failures or 401/403
responses do not trigger infinite retry loops; the outbox remains queued until
it is corrected or the user manually retries. Account switches clear the active
account's session context and visible cache before loading the other account, and
logout/account deletion preserve or remove the associated namespaced cache and
queueds according to the deletion policy.

To enable RSSHub, deploy an instance you operate using the [official RSSHub deployment guide](https://docs.rsshub.app/guide/instances) and configure its HTTPS base URL as `RSSHUB_BASE_URL`. Set it as a non-secret Worker variable in the Cloudflare dashboard or in a deployment-specific, uncommitted Wrangler environment configuration. For local development, put `RSSHUB_BASE_URL=https://your-owned-instance.example` in the ignored `apps/api/.dev.vars`. No instance is configured in this repository, and no public or Folo instance is used as fallback. The API resolves `rsshub://<route>` only against that configured base, persists the absolute URL as the feed identity, and never forwards the FeyFeeds session to RSSHub. The resolved URL then goes through the same URL validation, redirect, timeout, response-size, and parser policy as other feeds. A missing/invalid configuration returns a clear configuration error. RSSHub provides route-based feeds for specialized sources, but
route availability depends on the configured instance and is not a guarantee
of parity with every Folo source or extraction behavior.
Website autodiscovery is capped at a 512 KB response, three redirects, and an
8 second timeout. It checks only a site's advertised feed links; it does not
provide keyword search, trending, or a global feed catalog. Article-page
readability extraction and non-feed source APIs are not implemented.

Feed URLs and each redirect are checked for HTTP(S), credentials, disallowed
ports, local names, metadata names, IP literals, and non-public/reserved IPv4
ranges. Redirects are manual and limited to three; each request has a 12 second
timeout and response streaming is capped at 1.5 MB. The Worker does not expose
DNS resolution or a way to pin the outbound connection to a validated IP. DNS
rebinding therefore remains a residual SSRF risk; URL validation alone does
not prove that the connection reaches a public address. Cloudflare's outbound
network controls are an additional platform boundary, not a per-feed IP pin.
No user credentials are sent to feed origins.

Migration `0007_feed_entry_metadata.sql` adds nullable-compatible JSON metadata
columns with empty-array defaults; existing entry IDs, GUID uniqueness, and
read/bookmark state remain intact. Apply it locally and remotely before deploy.

## Account profile and deletion

- `GET /v1/account/profile` returns the active FeyFeeds user's `id`, `email`, `name`, and `createdAt`.
- `PUT /v1/account/profile` accepts a non-empty `{ "name": "..." }` payload. `name` may be null or a string up to 80 characters; unknown fields are rejected.
- `GET /v1/account/preferences` returns `{ "language": "en" | "ja" | "zh-CN", "updatedAt": number | null }`.
- `PUT /v1/account/preferences` accepts only `{ "language": "en" | "ja" | "zh-CN" }`.
- `DELETE /v1/account` permanently deletes the authenticated FeyFeeds account. It deletes all sessions, entry states, AI summaries and usage counters, feeds (which cascade to cached entries), then the user/profile/preferences in a D1 batch. The endpoint does not access Folo or Firebase data.

Migration `0005_account_profile_preferences.sql` creates the per-user preferences table idempotently. The profile uses the existing `users.name` field. Mobile clears its FeyFeeds token, cached account/feed/timeline/summary/import data, and that account's queued mutations after successful deletion. Folo-owned primary account/data remain separate. Folo-backed profile and account screens outside FeyFeeds Cloud remain a migration blocker; this API does not claim to replace those flows. D1 deletion does not cover external backups or analytics systems.

## Development

```sh
pnpm --filter @feyfeeds/api exec wrangler d1 migrations apply feyfeeds --local
pnpm --filter @feyfeeds/api dev
pnpm --filter @feyfeeds/api test
pnpm --filter @feyfeeds/api typecheck
```

Mobile Home and Subscriptions use this API with a separately stored FeyFeeds
session token in Expo SecureStore. Session restore is checked on screen entry
and when the app returns to the foreground. A missing, expired, or revoked
session returns the Cloud screen to signed-out state; network failures can show
the current user's saved data only when a token is still present. Logout always
clears the local token, visible data, and last-user marker even if the Worker
cannot be reached; remote revocation completes when the request succeeds.
Offline caches and mutation queues are keyed by FeyFeeds user ID, and the Cloud
screen clears visible feed/timeline state before applying another account.
Logout retains the signed-out account's namespaced cache and pending outbox for
later sign-in; account deletion removes those local records after server deletion.
Other mobile features and the app-wide login still use the Folo API during the
gradual migration. The FeyFeeds token must not be substituted with a Folo or
Firebase token. Existing Folo/SQLite article IDs cannot be safely mapped to the new
`rss_<sha256(feed id + GUID)>` IDs; retain old local read/bookmark history until
an authenticated account-link and explicit mapping/import contract exists.
