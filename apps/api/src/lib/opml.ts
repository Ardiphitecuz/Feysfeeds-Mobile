import { XMLParser, XMLValidator } from "fast-xml-parser"

export type OpmlFeed = {
  url: string
  title: string | null
}

const MAX_OPML_LENGTH = 1_000_000
const MAX_OPML_FEEDS = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const parseOpmlFeeds = (xml: string): OpmlFeed[] => {
  if (
    xml.length === 0 ||
    xml.length > MAX_OPML_LENGTH ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  ) {
    throw new Error("Invalid OPML document")
  }

  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
  }).parse(xml)

  const opml = isRecord(parsed) ? parsed.opml : undefined
  const body = isRecord(opml) ? opml.body : undefined
  if (!isRecord(body)) {
    throw new Error("Invalid OPML document")
  }

  const feeds: OpmlFeed[] = []
  const pending: unknown[] = [body]

  while (pending.length > 0) {
    const current = pending.pop()
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    if (!isRecord(current)) {
      continue
    }

    const url = current.xmlUrl
    if (typeof url === "string") {
      const title = current.title ?? current.text
      feeds.push({
        url: url.trim(),
        title: typeof title === "string" ? title.trim() || null : null,
      })
      if (feeds.length > MAX_OPML_FEEDS) {
        throw new Error(`OPML files may contain at most ${MAX_OPML_FEEDS} feeds`)
      }
    }

    if (current.outline !== undefined) {
      pending.push(current.outline)
    }
  }

  return feeds
}
