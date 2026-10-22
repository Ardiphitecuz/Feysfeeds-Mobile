import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"

import { join, relative } from "pathe"

const flowRoots = ["e2e/flows/shared", "e2e/flows/android", "e2e/flows/ios"]
const yamlFiles = flowRoots.flatMap((root) =>
  readdirSync(root)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => join(root, file)),
)

for (const file of yamlFiles) {
  const result = spawnSync("maestro", ["check-syntax", file], {
    stdio: "inherit",
    shell: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
  console.log(`Checked ${relative(process.cwd(), file)}`)
}
