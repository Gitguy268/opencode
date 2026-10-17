export * as ShellSandbox from "./sandbox.js"

import { realpathSync } from "fs"
import os from "os"
import path from "path"
import { Result } from "effect"

// Caches package managers write outside the project; denying them breaks installs and builds.
const caches = [".bun", ".npm", ".cache", ".yarn", ".cargo", path.join("Library", "Caches")]

// Seatbelt matches resolved paths, so /tmp must be written as /private/tmp.
const real = (target: string) => {
  const resolved = Result.try(() => realpathSync.native(target))
  return Result.isSuccess(resolved) ? resolved.success : target
}

const quote = (target: string) => `"${target.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

/** macOS Seatbelt profile: everything is allowed except writing outside `writable`, temp dirs, caches and /dev. */
export const profile = (writable: ReadonlyArray<string>, home = os.homedir()) => {
  const paths = [
    ...new Set([...writable, os.tmpdir(), "/tmp", ...caches.map((cache) => path.join(home, cache))].map(real)),
  ]
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${paths.map((target) => `(subpath ${quote(target)})`).join(" ")} (subpath "/dev"))`,
  ].join("\n")
}

/** The command that runs `file args` under the profile. shortcut: macOS only and file writes only; network stays open. */
export const wrap = (file: string, args: ReadonlyArray<string>, writable: ReadonlyArray<string>) => ({
  file: "/usr/bin/sandbox-exec",
  args: ["-p", profile(writable), file, ...args],
})
