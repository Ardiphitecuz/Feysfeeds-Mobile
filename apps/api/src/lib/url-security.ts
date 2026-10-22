export const isPublicHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) {
    return false
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !url.hostname ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.port !== "" && url.port !== "80" && url.port !== "443")
  ) {
    return false
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata" ||
    hostname.endsWith(".metadata") ||
    hostname === "instance-data.ec2.internal"
  ) {
    return false
  }

  // Workers fetch cannot pin a DNS answer, so reject all IP literals and rely on
  // the platform's outbound network policy for DNS-resolved destinations.
  if (hostname.includes(":") || /^\d+$/.test(hostname) || /^\d+(?:\.\d+){0,3}$/.test(hostname)) {
    return false
  }

  const ipv4 = hostname.split(".")
  if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part))) {
    const octets = ipv4.map(Number)
    const first = Number(octets[0])
    const second = Number(octets[1])
    if (
      ipv4.some((part) => Number(part) > 255) ||
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19 || second === 51)) ||
      (first === 203 && second === 0) ||
      first >= 224
    ) {
      return false
    }
  }

  return true
}
