import { FeedFetchError, fetchAndParseFeed, hashFeedEntryId } from "./rss"

export type FeedRefreshResult = { fetched: number; fetchedAt: number }

export const refreshFeed = async (
  db: D1Database,
  feed: { id: string; userId: string; url: string },
): Promise<FeedRefreshResult> => {
  let entries
  try {
    entries = await fetchAndParseFeed(feed.url)
  } catch (error) {
    const message = error instanceof FeedFetchError ? error.message : "Could not retrieve the feed"
    await db
      .prepare("UPDATE feeds SET last_error = ?, last_attempt_at = ? WHERE id = ? AND user_id = ?")
      .bind(message.slice(0, 512), Date.now(), feed.id, feed.userId)
      .run()
    throw error instanceof FeedFetchError ? error : new FeedFetchError(message)
  }

  const fetchedAt = Date.now()
  const statements = await Promise.all(
    entries.map(async (entry) =>
      db
        .prepare(
          `INSERT INTO feed_entries
      (id, user_id, feed_id, guid, title, url, content, summary, author, published_at, inserted_at, categories_json, attachments_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (feed_id, guid) DO UPDATE SET
        title = excluded.title, url = excluded.url, content = excluded.content,
        summary = excluded.summary, author = excluded.author, published_at = excluded.published_at,
        categories_json = excluded.categories_json, attachments_json = excluded.attachments_json`,
        )
        .bind(
          await hashFeedEntryId(feed.id, entry.guid),
          feed.userId,
          feed.id,
          entry.guid,
          entry.title,
          entry.url,
          entry.content,
          entry.summary,
          entry.author,
          entry.publishedAt,
          fetchedAt,
          JSON.stringify(entry.categories),
          JSON.stringify(entry.attachments),
        ),
    ),
  )
  for (let offset = 0; offset < statements.length; offset += 40) {
    await db.batch(statements.slice(offset, offset + 40))
  }
  await db
    .prepare(
      "UPDATE feeds SET last_fetched_at = ?, last_attempt_at = ?, last_error = NULL WHERE id = ? AND user_id = ?",
    )
    .bind(fetchedAt, fetchedAt, feed.id, feed.userId)
    .run()
  return { fetched: entries.length, fetchedAt }
}
