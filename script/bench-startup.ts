#!/usr/bin/env bun
// Measures server cold boot (until the stdio url line) and resident memory, idle and with several directories loaded.
// Usage: bun script/bench-startup.ts [command...]   default: the dev source (bun run --cwd packages/cli src/index.ts)
import { mkdtempSync, mkdirSync, rmSync } from "fs"
import os from "os"
import path from "path"

const command =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ["bun", "run", "--cwd", path.join(import.meta.dir, "../packages/cli"), "src/index.ts"]
const directories = 3
const runs = 3
const password = "bench"

// Isolated XDG roots: a dev build must never migrate the user's real database.
const root = mkdtempSync(path.join(os.tmpdir(), "opencode-bench-"))
const env = {
  ...process.env,
  OPENCODE_PASSWORD: password,
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_STATE_HOME: path.join(root, "state"),
}

function tree(pid: number): number[] {
  const children = Bun.spawnSync(["pgrep", "-P", String(pid)])
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
    .map(Number)
  return [pid, ...children.flatMap(tree)]
}

function rssMB(pid: number) {
  const kb = tree(pid)
    .map((id) =>
      Number(
        Bun.spawnSync(["ps", "-o", "rss=", "-p", String(id)])
          .stdout.toString()
          .trim() || 0,
      ),
    )
    .reduce((a, b) => a + b, 0)
  return Math.round(kb / 1024)
}

async function readUrl(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const state = { text: "" }
  for await (const chunk of stream) {
    state.text += decoder.decode(chunk)
    const line = state.text.split("\n").find((item) => item.startsWith('{"url"'))
    if (line) return JSON.parse(line).url as string
  }
  throw new Error(`server exited before printing its url:\n${state.text}`)
}

async function run() {
  const started = performance.now()
  const child = Bun.spawn([...command, "serve", "--stdio", "--port", "0"], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  const url = await readUrl(child.stdout)
  const boot = Math.round(performance.now() - started)
  await Bun.sleep(3000)
  const idle = rssMB(child.pid)
  const auth = `Basic ${btoa(`opencode:${password}`)}`
  for (const index of Array.from({ length: directories }, (_, i) => i)) {
    const directory = path.join(root, `project-${index}`)
    mkdirSync(directory, { recursive: true })
    const response = await fetch(`${url}/api/location?location[directory]=${encodeURIComponent(directory)}`, {
      headers: { authorization: auth },
    })
    if (!response.ok) throw new Error(`location ${index}: HTTP ${response.status} ${await response.text()}`)
  }
  await Bun.sleep(3000)
  const loaded = rssMB(child.pid)
  child.stdin.end()
  await child.exited
  return { boot, idle, loaded }
}

const results = []
for (const index of Array.from({ length: runs }, (_, i) => i)) {
  results.push(await run())
  console.error(`run ${index + 1}/${runs}:`, results.at(-1))
}
rmSync(root, { recursive: true, force: true })
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
console.log(
  JSON.stringify({
    command: command.join(" "),
    boot_ms: median(results.map((r) => r.boot)),
    idle_rss_mb: median(results.map((r) => r.idle)),
    [`rss_mb_with_${directories}_dirs`]: median(results.map((r) => r.loaded)),
  }),
)
