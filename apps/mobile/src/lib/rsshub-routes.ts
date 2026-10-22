import type { RSSHubRouteDeclaration } from "@follow/models/rsshub"

export const RSSHUB_CATALOG: Record<string, RSSHubRouteDeclaration> = {
  bilibili: {
    name: "Bilibili",
    url: "bilibili.com",
    routes: {
      "/user/video/:uid": {
        name: "User Videos",
        path: "/user/video/:uid",
        example: "/bilibili/user/video/2267573",
        parameters: { uid: "User UID" },
        categories: ["social-media", "multimedia"],
        maintainers: ["DIYgod"],
        location: "bilibili.com",
        description: "Bilibili user published videos",
      },
      "/user/dynamic/:uid": {
        name: "User Dynamic",
        path: "/user/dynamic/:uid",
        example: "/bilibili/user/dynamic/2267573",
        parameters: { uid: "User UID" },
        categories: ["social-media"],
        maintainers: ["DIYgod"],
        location: "bilibili.com",
        description: "Bilibili user dynamics/posts",
      },
    },
  },
  twitter: {
    name: "Twitter / X",
    url: "x.com",
    routes: {
      "/user/:id": {
        name: "User Timeline",
        path: "/user/:id",
        example: "/twitter/user/DIYgod",
        parameters: { id: "Twitter handle / username without @" },
        categories: ["social-media"],
        maintainers: ["DIYgod"],
        location: "x.com",
        description: "Tweets from a specific user",
      },
    },
  },
  youtube: {
    name: "YouTube",
    url: "youtube.com",
    routes: {
      "/channel/:id": {
        name: "Channel Videos",
        path: "/channel/:id",
        example: "/youtube/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw",
        parameters: { id: "YouTube Channel ID (starts with UC)" },
        categories: ["social-media", "multimedia"],
        maintainers: ["DIYgod"],
        location: "youtube.com",
        description: "Videos uploaded by a YouTube channel",
      },
      "/user/:username": {
        name: "User Channel (@handle)",
        path: "/user/:username",
        example: "/youtube/user/@PewDiePie",
        parameters: { username: "YouTube @handle or custom name" },
        categories: ["social-media", "multimedia"],
        maintainers: ["DIYgod"],
        location: "youtube.com",
        description: "Videos uploaded by a YouTube user",
      },
    },
  },
  github: {
    name: "GitHub",
    url: "github.com",
    routes: {
      "/repos/:user/:repo": {
        name: "Repository Releases & Commits",
        path: "/repos/:user/:repo",
        example: "/github/repos/DIYgod/RSSHub",
        parameters: { user: "GitHub Username/Org", repo: "Repository Name" },
        categories: ["programming"],
        maintainers: ["DIYgod"],
        location: "github.com",
        description: "New releases and commits from a GitHub repository",
      },
      "/trending/:since": {
        name: "Trending Repositories",
        path: "/trending/:since",
        example: "/github/trending/daily",
        parameters: { since: "daily | weekly | monthly" },
        categories: ["programming"],
        maintainers: ["DIYgod"],
        location: "github.com",
        description: "GitHub Trending repositories by time frame",
      },
    },
  },
  telegram: {
    name: "Telegram",
    url: "telegram.org",
    routes: {
      "/channel/:username": {
        name: "Public Channel Posts",
        path: "/channel/:username",
        example: "/telegram/channel/durov",
        parameters: { username: "Public channel username without @" },
        categories: ["social-media"],
        maintainers: ["DIYgod"],
        location: "t.me",
        description: "Posts from a public Telegram channel",
      },
    },
  },
  reddit: {
    name: "Reddit",
    url: "reddit.com",
    routes: {
      "/r/:subreddit": {
        name: "Subreddit Posts",
        path: "/r/:subreddit",
        example: "/reddit/r/technology",
        parameters: { subreddit: "Subreddit name without r/" },
        categories: ["social-media", "bbs"],
        maintainers: ["DIYgod"],
        location: "reddit.com",
        description: "Hot posts in a subreddit",
      },
      "/user/:username": {
        name: "User Submitted Posts",
        path: "/user/:username",
        example: "/reddit/user/spez",
        parameters: { username: "Reddit username" },
        categories: ["social-media", "bbs"],
        maintainers: ["DIYgod"],
        location: "reddit.com",
        description: "Posts submitted by a Reddit user",
      },
    },
  },
  steam: {
    name: "Steam",
    url: "steampowered.com",
    routes: {
      "/discount": {
        name: "Game Discounts",
        path: "/discount",
        example: "/steam/discount",
        parameters: {},
        categories: ["game", "shopping"],
        maintainers: ["DIYgod"],
        location: "store.steampowered.com",
        description: "Current discounts and sales on Steam",
      },
    },
  },
  epicgames: {
    name: "Epic Games",
    url: "epicgames.com",
    routes: {
      "/free": {
        name: "Free Weekly Games",
        path: "/free",
        example: "/epicgames/free",
        parameters: {},
        categories: ["game"],
        maintainers: ["DIYgod"],
        location: "store.epicgames.com",
        description: "Free games given away weekly on Epic Games Store",
      },
    },
  },
  bangumi: {
    name: "Bangumi",
    url: "bgm.tv",
    routes: {
      "/calendar/today": {
        name: "Today's Anime Broadcast",
        path: "/calendar/today",
        example: "/bangumi/calendar/today",
        parameters: {},
        categories: ["anime"],
        maintainers: ["DIYgod"],
        location: "bgm.tv",
        description: "Anime episodes broadcasted today",
      },
    },
  },
  pixiv: {
    name: "Pixiv",
    url: "pixiv.net",
    routes: {
      "/user/:id": {
        name: "Artist Illustrations",
        path: "/user/:id",
        example: "/pixiv/user/11",
        parameters: { id: "Pixiv User / Artist ID" },
        categories: ["picture", "anime"],
        maintainers: ["DIYgod"],
        location: "pixiv.net",
        description: "New illustrations and manga from a Pixiv artist",
      },
    },
  },
  v2ex: {
    name: "V2EX",
    url: "v2ex.com",
    routes: {
      "/topics/:tab": {
        name: "Topics by Tab",
        path: "/topics/:tab",
        example: "/v2ex/topics/hot",
        parameters: { tab: "hot | all | tech | creative | deals | jobs" },
        categories: ["programming", "bbs"],
        maintainers: ["DIYgod"],
        location: "v2ex.com",
        description: "V2EX topics in a specific tab",
      },
    },
  },
  hackernews: {
    name: "Hacker News",
    url: "news.ycombinator.com",
    routes: {
      "/news": {
        name: "Top Stories",
        path: "/news",
        example: "/hackernews/news",
        parameters: {},
        categories: ["programming", "new-media"],
        maintainers: ["DIYgod"],
        location: "news.ycombinator.com",
        description: "Hacker News top stories",
      },
    },
  },
  weibo: {
    name: "Weibo",
    url: "weibo.com",
    routes: {
      "/user/:uid": {
        name: "User Posts",
        path: "/user/:uid",
        example: "/weibo/user/1195230310",
        parameters: { uid: "Weibo user UID" },
        categories: ["social-media"],
        maintainers: ["DIYgod"],
        location: "weibo.com",
        description: "Posts from a Weibo user",
      },
    },
  },
}

export const getRssHubCategoryRoutes = (
  category?: string,
): Record<string, RSSHubRouteDeclaration> => {
  if (!category || category === "all" || category === "popular") {
    return RSSHUB_CATALOG
  }

  const result: Record<string, RSSHubRouteDeclaration> = {}
  for (const [key, item] of Object.entries(RSSHUB_CATALOG)) {
    const matchedRoutes: Record<string, (typeof item.routes)[string]> = {}
    for (const [routeKey, routeData] of Object.entries(item.routes)) {
      if (routeData.categories.includes(category)) {
        matchedRoutes[routeKey] = routeData
      }
    }
    if (Object.keys(matchedRoutes).length > 0) {
      result[key] = {
        ...item,
        routes: matchedRoutes,
      }
    }
  }
  return result
}

export const searchRssHubRoutes = (
  query: string,
): Array<{
  feed: {
    id: string
    title: string
    url: string
    siteUrl: string
    description: string
    image: string | null
    ownerUserId: null
    type: "feed"
  }
}> => {
  const lower = query.trim().toLowerCase()
  if (!lower || lower.length < 2) return []

  const results: Array<{
    feed: {
      id: string
      title: string
      url: string
      siteUrl: string
      description: string
      image: string | null
      ownerUserId: null
      type: "feed"
    }
  }> = []

  const isGenericSearch = lower === "rsshub" || lower.includes("rsshub")

  for (const [key, item] of Object.entries(RSSHUB_CATALOG)) {
    const keyMatch = isGenericSearch || key.includes(lower) || item.name.toLowerCase().includes(lower) || item.url.toLowerCase().includes(lower)

    for (const [routePath, route] of Object.entries(item.routes)) {
      const routeMatch =
        keyMatch ||
        route.name.toLowerCase().includes(lower) ||
        route.description.toLowerCase().includes(lower) ||
        routePath.toLowerCase().includes(lower) ||
        route.categories.some((c) => c.toLowerCase().includes(lower))

      if (routeMatch) {
        const exampleRoute = route.example || `/${key}${routePath}`
        const rsshubUrl = `rsshub://${exampleRoute.replace(/^\/+/, "")}`
        results.push({
          feed: {
            id: rsshubUrl,
            title: `[RSSHub] ${item.name}: ${route.name}`,
            url: rsshubUrl,
            siteUrl: `https://${item.url}`,
            description: route.description,
            image: `https://www.google.com/s2/favicons?domain=${item.url}&sz=128`,
            ownerUserId: null,
            type: "feed",
          },
        })
      }
    }
  }

  return results
}
