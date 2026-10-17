import { describe, expect } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { Effect, Exit, Queue, Stream } from "effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { ClaudeHooksPlugin } from "@opencode/core/plugin/claude-hooks"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Document, Info } from "@opencode/schema/config"
import { Event } from "@opencode/schema/event"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "./host"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const sessionID = Session.ID.make("ses_claude_hooks")

const settings = (hooks: Record<string, unknown>) => JSON.stringify({ hooks })
const command = (script: string) => ({ type: "command", command: script })

/** Writes hook settings into a temp home and project, then runs the plugin against stubbed domains. */
const run = Effect.fnUntraced(function* (input: {
  readonly user?: Record<string, unknown>
  readonly project?: Record<string, unknown>
  readonly scope?: false | "user" | "all"
  readonly parentID?: string
}) {
  const tmp = yield* Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  )
  const home = path.join(tmp.path, "home")
  const userRoot = path.join(home, ".claude")
  const projectRoot = path.join(tmp.path, "project", ".claude")
  yield* Effect.promise(async () => {
    await mkdir(userRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    if (input.user) await Bun.write(path.join(userRoot, "settings.json"), settings(input.user))
    if (input.project) await Bun.write(path.join(projectRoot, "settings.json"), settings(input.project))
  })
  const captured: {
    before?: (event: ToolHooks["execute.before"]) => Effect.Effect<void, Tool.Error>
    after?: (event: ToolHooks["execute.after"]) => Effect.Effect<void>
    prompt?: (event: SessionHooks["prompt"]) => Effect.Effect<void>
  } = {}
  const prompts = new Array<string>()
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded>()
  yield* ClaudeHooksPlugin.Plugin.effect(
    host({
      tool: {
        list: () => Effect.die("unused tool.list"),
        reload: () => Effect.die("unused tool.reload"),
        transform: () => Effect.die("unused tool.transform"),
        hook: (name, callback) => {
          // Hook names and callbacks are correlated, but TypeScript does not narrow this registration API.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "execute.before") captured.before = callback as never
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "execute.after") captured.after = callback as never
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        // Only parentID is read.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        get: () => Effect.succeed({ parentID: input.parentID } as never),
        hook: (name, callback) => {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "prompt") captured.prompt = callback as never
          return Effect.succeed({ dispose: Effect.void })
        },
        prompt: (prompt) => {
          prompts.push(prompt.text)
          return (
            captured.prompt?.({
              sessionID,
              messageID: SessionMessage.ID.make("msg_stop"),
              prompt: { text: prompt.text },
              delivery: "steer",
            }) ?? Effect.void
          ).pipe(Effect.andThen(Effect.die("prompt result unused")))
        },
      },
    }),
  ).pipe(
    Effect.provide(
      Config.testLayer(
        input.scope === undefined
          ? []
          : [
              new Document({
                type: "document",
                info: new Info({ experimental: new ConfigExperimental.Info({ claude_hooks: input.scope }) }),
              }),
            ],
        { claude: [AbsolutePath.make(userRoot), AbsolutePath.make(projectRoot)], agents: [] },
      ),
    ),
    Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home })),
  )
  const { before, after, prompt } = captured
  if (!before || !after || !prompt) return yield* Effect.die("claude hooks plugin did not register its hooks")
  return { before, after, prompt, prompts, events, tmp }
})

const call = (tool: string, input: unknown): ToolHooks["execute.before"] => ({
  tool,
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_hook"),
  id: Tool.CallID.make("call_hook"),
  input,
})

const succeeded = (): SessionEvent.Execution.Succeeded => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.execution.succeeded",
  data: { sessionID },
})

describe("Claude Code hooks", () => {
  it.live("blocks a matching PreToolUse call on exit 2 and passes Claude-shaped input", () =>
    Effect.gen(function* () {
      const hooks = yield* run({
        user: {
          PreToolUse: [
            {
              matcher: "Bash|Edit",
              hooks: [
                command(
                  `input=$(cat); case "$input" in *'"rm -rf'*) echo "no rm -rf" >&2; exit 2;; esac; case "$input" in *'"file_path":"src/a.ts"'*) echo '{"decision":"block","reason":"generated file"}';; esac`,
                ),
              ],
            },
          ],
        },
      })
      const blocked = yield* hooks.before(call("shell", { command: "rm -rf build" })).pipe(Effect.exit)
      expect(Exit.isFailure(blocked) && String(blocked.cause)).toContain("PreToolUse hook blocked Bash: no rm -rf")
      const edit = yield* hooks
        .before(call("edit", { path: "src/a.ts", oldString: "a", newString: "b" }))
        .pipe(Effect.exit)
      expect(Exit.isFailure(edit) && String(edit.cause)).toContain("generated file")
      expect(Exit.isSuccess(yield* hooks.before(call("shell", { command: "bun test" })).pipe(Effect.exit))).toBe(true)
      // Read does not match the Bash|Edit matcher.
      expect(Exit.isSuccess(yield* hooks.before(call("read", { path: "src/a.ts" })).pipe(Effect.exit))).toBe(true)
    }),
  )

  it.live("adds PostToolUse feedback and UserPromptSubmit context", () =>
    Effect.gen(function* () {
      const hooks = yield* run({
        user: {
          PostToolUse: [{ hooks: [command(`echo "lint found 2 problems" >&2; exit 2`)] }],
          UserPromptSubmit: [
            { hooks: [command(`echo '{"hookSpecificOutput":{"additionalContext":"branch is main"}}'`)] },
          ],
        },
      })
      const event = {
        ...call("write", { path: "a.ts" }),
        status: "completed" as const,
        result: { content: "Wrote a.ts" },
      }
      yield* hooks.after(event)
      expect(event.result.content).toBe("Wrote a.ts\n\nPostToolUse hook: lint found 2 problems")
      const prompt: SessionHooks["prompt"] = {
        sessionID,
        messageID: SessionMessage.ID.make("msg_prompt"),
        prompt: { text: "ship it" },
        delivery: "steer",
      }
      yield* hooks.prompt(prompt)
      expect(prompt.prompt.text).toBe(
        "ship it\n\n<user-prompt-submit-hook>\nbranch is main\n</user-prompt-submit-hook>",
      )
    }),
  )

  it.live("ignores project hooks unless claude_hooks is all, and nothing runs when it is false", () =>
    Effect.gen(function* () {
      const project = { PreToolUse: [{ hooks: [command(`echo "project says no" >&2; exit 2`)] }] }
      const byDefault = yield* run({ project })
      expect(Exit.isSuccess(yield* byDefault.before(call("shell", { command: "ls" })).pipe(Effect.exit))).toBe(true)

      const all = yield* run({ project, scope: "all" })
      const blocked = yield* all.before(call("shell", { command: "ls" })).pipe(Effect.exit)
      expect(Exit.isFailure(blocked) && String(blocked.cause)).toContain("project says no")

      const off = yield* run({ user: project, scope: false })
      expect(Exit.isSuccess(yield* off.before(call("shell", { command: "ls" })).pipe(Effect.exit))).toBe(true)
    }),
  )

  it.live("continues a session when a Stop hook blocks, and passes stop_hook_active on the next stop", () =>
    Effect.gen(function* () {
      const stop = {
        Stop: [
          {
            hooks: [
              command(
                `case "$(cat)" in *'"stop_hook_active":true'*) exit 0;; esac; echo '{"decision":"block","reason":"tests not run"}'`,
              ),
            ],
          },
        ],
      }
      const hooks = yield* run({ user: stop })
      yield* Queue.offer(hooks.events, succeeded())
      yield* Effect.promise(async () => {
        for (const _ of Array.from({ length: 400 })) {
          if (hooks.prompts.length > 0) return
          await Bun.sleep(5)
        }
      })
      expect(hooks.prompts).toEqual(["Stop hook feedback:\ntests not run"])
      yield* Queue.offer(hooks.events, succeeded())
      yield* Effect.promise(() => Bun.sleep(300))
      expect(hooks.prompts).toHaveLength(1)

      const child = yield* run({ user: stop, parentID: "ses_parent" })
      yield* Queue.offer(child.events, succeeded())
      yield* Effect.promise(() => Bun.sleep(300))
      expect(child.prompts).toEqual([])
    }),
  )
})

describe("Claude Code hook helpers", () => {
  it.effect("maps inputs, matchers and verdicts the way Claude Code does", () =>
    Effect.sync(() => {
      expect(ClaudeHooksPlugin.claudeInput({ path: "a.ts", oldString: "x", replaceAll: true })).toEqual({
        path: "a.ts",
        file_path: "a.ts",
        oldString: "x",
        old_string: "x",
        replaceAll: true,
        replace_all: true,
      })
      expect(ClaudeHooksPlugin.matches(undefined, "Bash")).toBe(true)
      expect(ClaudeHooksPlugin.matches("*", "Bash")).toBe(true)
      expect(ClaudeHooksPlugin.matches("Edit|Write", "Write")).toBe(true)
      expect(ClaudeHooksPlugin.matches("Edit", "MultiEdit")).toBe(false)
      expect(ClaudeHooksPlugin.matches("(", "Bash")).toBe(false)
      expect(ClaudeHooksPlugin.verdict({ exitCode: 1, stdout: "", stderr: "crash" })).toEqual({})
      expect(
        ClaudeHooksPlugin.verdict({
          exitCode: 0,
          stdout: '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"secrets"}}',
          stderr: "",
        }),
      ).toEqual({ block: "secrets" })
      expect(ClaudeHooksPlugin.verdict({ exitCode: 0, stdout: "plain note\n", stderr: "" })).toEqual({
        context: "plain note",
      })
    }),
  )
})
