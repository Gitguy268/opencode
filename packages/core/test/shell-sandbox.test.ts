import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { ShellSandbox } from "@opencode/core/shell/sandbox"
import { tmpdir } from "./fixture/tmpdir"

describe("ShellSandbox", () => {
  test("writes resolved, quoted paths into the profile", () => {
    const text = ShellSandbox.profile(['/work/my "quoted" dir'], "/home/me")
    expect(text).toContain("(deny file-write*)")
    expect(text).toContain('(subpath "/work/my \\"quoted\\" dir")')
    expect(text).toContain('(subpath "/private/tmp")')
    expect(text).toContain('(subpath "/home/me/.bun")')
    expect(ShellSandbox.wrap("/bin/sh", ["-c", "ls"], ["/work"]).args.slice(2)).toEqual(["/bin/sh", "-c", "ls"])
  })

  test.skipIf(process.platform !== "darwin")("lets commands write to the project but not outside it", async () => {
    await using root = await tmpdir()
    // Temp roots are writable by design, so the denied write targets the home directory.
    const outside = path.join(process.env.HOME ?? "/", `.opencode-sandbox-test-${process.pid}`)
    const project = path.join(root.path, "project")
    const command = `mkdir -p ${project} && echo in > ${project}/in.txt && (echo out > ${outside} || true)`
    const wrapped = ShellSandbox.wrap("/bin/sh", ["-c", command], [project])
    const result = Bun.spawnSync([wrapped.file, ...wrapped.args])
    expect(result.exitCode).toBe(0)
    expect(await Bun.file(path.join(project, "in.txt")).text()).toBe("in\n")
    expect(existsSync(outside)).toBe(false)
  })
})
