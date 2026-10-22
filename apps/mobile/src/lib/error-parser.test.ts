import { FollowAPIError } from "@follow-app/client-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getFetchErrorMessage, toastFetchError } from "./error-parser"

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}))

vi.mock("i18next", () => ({
  t: (key: string) => {
    if (key === "errors:2012") {
      return "RSSHub feed subscription limit exceeded"
    }
    if (key === "errors:3") {
      return "Unprocessable content"
    }
    return key.replace(/^errors:/u, "")
  },
}))

vi.mock("./toast", () => ({
  toast: {
    error: mocks.toastError,
  },
}))

describe("toastFetchError", () => {
  beforeEach(() => {
    mocks.toastError.mockClear()
  })

  it("shows payment-required responses as ordinary errors without an upgrade prompt", () => {
    const error = new FollowAPIError(
      [
        "RSSHub feed subscription limit exceeded",
        "Request: POST /subscriptions (original: /subscriptions)",
        'Args: { "headers": { "cookie": "session=secret" } }',
      ].join("\n"),
      402,
      "2012",
    )

    toastFetchError(error)

    expect(mocks.toastError).toHaveBeenCalledWith("RSSHub feed subscription limit exceeded")
  })

  it("does not expose request context when an API error code has no translation", () => {
    const error = new FollowAPIError(
      [
        "Unable to follow this feed",
        "Request: POST /subscriptions (original: /subscriptions)",
        'Args: { "headers": { "cookie": "session=secret" } }',
      ].join("\n"),
      400,
      "29999",
    )

    toastFetchError(error)

    expect(mocks.toastError).toHaveBeenCalledOnce()
    expect(mocks.toastError).toHaveBeenCalledWith("Unable to follow this feed")
  })
})

describe("toastFetchError for a rejected request body", () => {
  beforeEach(() => {
    mocks.toastError.mockClear()
  })

  it("names the field the server rejected under the translated code", () => {
    toastFetchError(
      new FollowAPIError(
        "`rules.0.result.webhooks.0`: Invalid URL\nRequest: PUT /actions (original: /actions)\nArgs: {}",
        422,
        "3",
      ),
    )

    expect(mocks.toastError).toHaveBeenCalledWith("Unprocessable content", {
      description: "`rules.0.result.webhooks.0`: Invalid URL",
    })
  })

  it("names the field under a title", () => {
    toastFetchError(new FollowAPIError("`rules.0.condition`: Invalid input", 422, "3"), {
      title: "Failed to save",
    })

    expect(mocks.toastError).toHaveBeenCalledWith("Failed to save", {
      description: "`rules.0.condition`: Invalid input",
    })
  })
})

describe("getFetchErrorMessage", () => {
  it("describes a request that never reached the server instead of the native reason", () => {
    const error = new Error(
      "fetch failed: java.net.ConnectException: Failed to connect to localhost/127.0.0.1:3000",
    )

    expect(getFetchErrorMessage(error)).toBe("common:app.api_unreachable")
  })

  it("keeps the message of a cancelled request", () => {
    const error = new Error("fetch failed: The operation was aborted.")

    expect(getFetchErrorMessage(error)).toBe("fetch failed: The operation was aborted.")
  })
})

describe("toastFetchError for unreachable servers", () => {
  it("shows the connection message instead of the native reason", () => {
    mocks.toastError.mockClear()
    toastFetchError(
      new Error("fetch failed: java.net.UnknownHostException: Unable to resolve host"),
    )

    expect(mocks.toastError).toHaveBeenCalledWith("common:app.api_unreachable")
  })
})

describe("getFetchErrorMessage for API errors", () => {
  it("keeps the API message for a code without a translation", () => {
    const error = new FollowAPIError("Something specific went wrong", 400, "9999")
    expect(getFetchErrorMessage(error)).toBe("Something specific went wrong")
  })

  it("keeps the SDK message for a non-numeric code", () => {
    const error = new FollowAPIError("Authentication required", 401, "AUTH_REQUIRED")
    expect(getFetchErrorMessage(error)).toBe("Authentication required")
  })

  it("translates a known API error code", () => {
    const error = new FollowAPIError("limit", 402, "2012")
    expect(getFetchErrorMessage(error)).toBe("RSSHub feed subscription limit exceeded")
  })
})
