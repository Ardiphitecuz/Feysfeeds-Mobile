import { describe, expect, it } from "vitest"

import {
  getRssHubCategoryRoutes,
  RSSHUB_CATALOG,
  searchRssHubRoutes,
} from "./rsshub-routes"

describe("rsshub-routes catalog and helpers", () => {
  it("provides valid catalog definitions with routes", () => {
    expect(Object.keys(RSSHUB_CATALOG).length).toBeGreaterThan(5)
    expect(RSSHUB_CATALOG.bilibili).toBeDefined()
    expect(RSSHUB_CATALOG.twitter).toBeDefined()
    expect(RSSHUB_CATALOG.youtube).toBeDefined()
    expect(RSSHUB_CATALOG.github).toBeDefined()

    for (const [key, item] of Object.entries(RSSHUB_CATALOG)) {
      expect(item.name).toBeTruthy()
      expect(item.url).toBeTruthy()
      expect(Object.keys(item.routes).length).toBeGreaterThan(0)
      for (const [routePath, route] of Object.entries(item.routes)) {
        expect(route.name).toBeTruthy()
        expect(route.path).toBe(routePath)
        expect(route.example).toContain(key)
      }
    }
  })

  it("filters routes by category accurately", () => {
    const popularRoutes = getRssHubCategoryRoutes("popular")
    expect(Object.keys(popularRoutes).length).toBeGreaterThan(0)
    expect(popularRoutes.bilibili).toBeDefined()

    const socialRoutes = getRssHubCategoryRoutes("social-media")
    expect(socialRoutes.twitter).toBeDefined()
    expect(socialRoutes.bilibili).toBeDefined()

    const programmingRoutes = getRssHubCategoryRoutes("programming")
    expect(programmingRoutes.github).toBeDefined()
    expect(programmingRoutes.twitter).toBeUndefined()
  })

  it("searches RSSHub routes by keyword", () => {
    const bilibiliMatches = searchRssHubRoutes("bilibili")
    expect(bilibiliMatches.length).toBeGreaterThan(0)
    expect(bilibiliMatches[0]?.feed.url).toMatch(/^rsshub:\/\/bilibili\//)
    expect(bilibiliMatches[0]?.feed.title).toContain("Bilibili")

    const twitterMatches = searchRssHubRoutes("twitter")
    expect(twitterMatches.length).toBeGreaterThan(0)
    expect(twitterMatches[0]?.feed.url).toMatch(/^rsshub:\/\/twitter\//)

    const githubMatches = searchRssHubRoutes("github")
    expect(githubMatches.length).toBeGreaterThan(0)
    expect(githubMatches[0]?.feed.url).toMatch(/^rsshub:\/\/github\//)

    const noMatches = searchRssHubRoutes("xyznonexistentroute123")
    expect(noMatches).toEqual([])
  })
})
