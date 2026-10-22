import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"

import { join } from "pathe"

const run = (command: string, args: string[], inherit = false) =>
  spawnSync(command, args, {
    encoding: "utf8",
    shell: true,
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  })

const configuredDevice = process.env.MAESTRO_ANDROID_DEVICE_ID
const devices = run("adb", ["devices"])
  .stdout.split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .find(([id, status]) => id && status === "device")?.[0]
const deviceId = configuredDevice ?? devices

if (!deviceId) {
  console.error(
    "No booted Android device found. Set MAESTRO_ANDROID_DEVICE_ID or start an emulator.",
  )
  process.exit(1)
}

for (let attempt = 0; attempt < 90; attempt += 1) {
  const boot = run("adb", ["-s", deviceId, "shell", "getprop", "sys.boot_completed"]).stdout.trim()
  const packages = run("adb", ["-s", deviceId, "shell", "cmd", "package", "list", "packages"])
  if (boot === "1" && packages.status === 0) break
  if (attempt === 89) {
    console.error(`Android device ${deviceId} did not finish booting in time.`)
    process.exit(1)
  }
  run("node", ["-e", "setTimeout(() => {}, 2000)"])
}

run("adb", ["-s", deviceId, "shell", "pm", "clear", "is.follow"])
run("adb", [
  "-s",
  deviceId,
  "shell",
  "monkey",
  "-p",
  "is.follow",
  "-c",
  "android.intent.category.LAUNCHER",
])

const platform = "android"
const debugOutput = process.env.MAESTRO_DEBUG_OUTPUT ?? join("e2e", "artifacts", platform)
mkdirSync(debugOutput, { recursive: true })
const environment = {
  ...process.env,
  E2E_EMAIL: process.env.E2E_EMAIL ?? `folo-e2e-${platform}-${Date.now()}@example.com`,
  E2E_PASSWORD: process.env.E2E_PASSWORD ?? "Password123!",
}

const result = spawnSync(
  "maestro",
  [
    "test",
    "--format",
    "junit",
    "--platform",
    platform,
    "--device",
    deviceId,
    "--debug-output",
    debugOutput,
    "-e",
    `E2E_EMAIL=${environment.E2E_EMAIL}`,
    "-e",
    `E2E_PASSWORD=${environment.E2E_PASSWORD}`,
    "e2e/flows/android/core.yaml",
  ],
  { env: environment, stdio: "inherit", shell: true },
)

process.exit(result.status ?? 1)
