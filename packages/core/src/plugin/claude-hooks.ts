export * as ClaudeHooksPlugin from "./claude-hooks.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Tool } from "@opencode/schema/tool"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Duration, Effect, Option, Predicate, Result, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import path from "path"
import { Config } from "../config.js"
import { Location } from "../location.js"
import type { PluginInternal } from "./internal.js"

/** opencode tool names as Claude Code hooks know them; unmapped tools keep their own name. */
export const toolNames: Record<string, string> = {
  shell: "Bash",
  edit: "Edit",
  patch: "Edit",
  write: "Write",
  read: "Read",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  subagent: "Task",
  question: "AskUserQuestion",
  skill: "Skill",
}

// Unattended continuations a Stop hook may force in a row before the session is allowed to stop.
export const maxStopContinuations = 20

const Command = Schema.Struct({
  type: Schema.Literal("command"),
  command: Schema.String,
  timeout: Schema.Number.pipe(Schema.optional),
})
type Command = typeof Command.Type

const Settings = Schema.fromJsonString(
  Schema.Struct({
    hooks: Schema.Record(
      Schema.String,
      Schema.Array(
        Schema.Struct({
          matcher: Schema.String.pipe(Schema.optional),
          hooks: Schema.Array(Schema.Unknown),
        }),
      ),
    ).pipe(Schema.optional),
  }),
)

const Output = Schema.fromJsonString(
  Schema.Struct({
    decision: Schema.String.pipe(Schema.optional),
    reason: Schema.String.pipe(Schema.optional),
    hookSpecificOutput: Schema.Struct({
      permissionDecision: Schema.String.pipe(Schema.optional),
      permissionDecisionReason: Schema.String.pipe(Schema.optional),
      additionalContext: Schema.String.pipe(Schema.optional),
    }).pipe(Schema.optional),
  }),
)

const isCommand = Schema.is(Command)
const decodeSettings = Schema.decodeUnknownOption(Settings)
const decodeOutput = Schema.decodeUnknownOption(Output)

const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

/** Adds Claude's snake_case names (`file_path`, `old_string`) next to opencode's own input keys. */
export const claudeInput = (input: unknown) => {
  if (!Predicate.isObject(input)) return input
  const entries = Object.entries(input)
  return {
    ...Object.fromEntries(entries.map(([key, value]) => [snake(key), value])),
    ...input,
    ...("path" in input ? { file_path: input.path } : {}),
  }
}

/** Claude matchers are tool-name regexes; empty or `*` matches every tool. */
export const matches = (matcher: string | undefined, tool: string) => {
  if (matcher === undefined || matcher === "" || matcher === "*") return true
  const pattern = Result.try(() => new RegExp(`^(?:${matcher})$`))
  return Result.isSuccess(pattern) && pattern.success.test(tool)
}

/** What a finished hook asks for: block with a reason, add context, or nothing. */
export const verdict = (result: { readonly exitCode: number; readonly stdout: string; readonly stderr: string }) => {
  if (result.exitCode === 2) return { block: result.stderr.trim() || "Blocked by a Claude Code hook" }
  if (result.exitCode !== 0) return {}
  const output = decodeOutput(result.stdout.trim())
  if (output._tag === "None") return { context: result.stdout.trim() || undefined }
  const specific = output.value.hookSpecificOutput
  if (output.value.decision === "block" || specific?.permissionDecision === "deny")
    return {
      block: output.value.reason ?? specific?.permissionDecisionReason ?? "Blocked by a Claude Code hook",
    }
  return { context: specific?.additionalContext }
}

const append = (content: Tool.Result["content"], note: string): Tool.Result["content"] =>
  typeof content === "string" || content === undefined
    ? [content, note].filter(Boolean).join("\n\n")
    : [...content, { type: "text", text: note }]

export const Plugin = define({
  id: "opencode.claude-hooks",
  effect: Effect.fn("ClaudeHooksPlugin")(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const home = path.join(global.home, ".claude")

    // Read on every event so edits apply at once; the files are small.
    const commands = Effect.fn("ClaudeHooksPlugin.commands")(function* (event: string, tool?: string) {
      const scope = Config.latest(yield* config.entries(), "experimental")?.claude_hooks ?? "user"
      if (scope === false || !config.compatibility) return []
      const roots = (yield* config.compatibility()).claude
      // A cloned repository's .claude/settings.json is code from someone else, so it needs an explicit opt-in.
      const files = roots.flatMap((root) =>
        root === home
          ? [path.join(root, "settings.json")]
          : scope === "all"
            ? [path.join(root, "settings.json"), path.join(root, "settings.local.json")]
            : [],
      )
      const found = yield* Effect.forEach(files, (file) =>
        fs.readFileStringSafe(file).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.map((text) =>
            Option.match(text === undefined ? Option.none() : decodeSettings(text), {
              onNone: () => [],
              onSome: (settings) => settings.hooks?.[event] ?? [],
            }),
          ),
        ),
      )
      return found
        .flat()
        .filter((group) => tool === undefined || matches(group.matcher, tool))
        .flatMap((group) => group.hooks.filter(isCommand))
    })

    const run = (command: Command, input: Record<string, unknown>) =>
      processes
        .run(
          ChildProcess.make("/bin/sh", ["-c", command.command], {
            cwd: location.directory,
            env: { CLAUDE_PROJECT_DIR: location.project.directory },
            extendEnv: true,
          }),
          {
            stdin: JSON.stringify({ cwd: location.directory, transcript_path: "", ...input }),
            timeout: Duration.seconds(command.timeout ?? 60),
            maxOutputBytes: 64 * 1024,
            maxErrorBytes: 64 * 1024,
          },
        )
        .pipe(
          Effect.map((result) =>
            verdict({ exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }),
          ),
          // shortcut: runs through /bin/sh, so Windows needs Git Bash or WSL on PATH; upgrade to the shell selector.
          Effect.catch((error) =>
            Effect.logWarning("Claude Code hook failed", { command: command.command, error: error.message }).pipe(
              Effect.as({}),
            ),
          ),
        )

    const runAll = (event: string, input: Record<string, unknown>, tool?: string) =>
      commands(event, tool).pipe(
        Effect.flatMap((found) =>
          Effect.forEach(found, (command) => run(command, { hook_event_name: event, ...input })),
        ),
        Effect.map((results) => ({
          block: results.flatMap((result) => ("block" in result && result.block ? [result.block] : [])).join("\n"),
          context: results
            .flatMap((result) => ("context" in result && result.context ? [result.context] : []))
            .join("\n"),
        })),
      )

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const tool = toolNames[event.tool] ?? event.tool
        const result = yield* runAll(
          "PreToolUse",
          { session_id: event.sessionID, tool_name: tool, tool_input: claudeInput(event.input) },
          tool,
        )
        if (result.block) return yield* new Tool.Error({ message: `PreToolUse hook blocked ${tool}: ${result.block}` })
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed") return
        const tool = toolNames[event.tool] ?? event.tool
        const result = yield* runAll(
          "PostToolUse",
          {
            session_id: event.sessionID,
            tool_name: tool,
            tool_input: claudeInput(event.input),
            tool_response: event.result.output ?? event.result.content,
          },
          tool,
        )
        const note = [result.block, result.context].filter(Boolean).join("\n")
        if (note) event.result = { ...event.result, content: append(event.result.content, `PostToolUse hook: ${note}`) }
      }),
    )

    // shortcut: a UserPromptSubmit block cannot stop the prompt (the hook has no failure channel), so it is added as context.
    const stops = new Map<string, number>()
    const continuing = new Set<string>()
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        // Stop hook feedback is not a user prompt, and it ends no run of continuations.
        if (continuing.delete(event.sessionID)) return
        stops.delete(event.sessionID)
        const result = yield* runAll("UserPromptSubmit", { session_id: event.sessionID, prompt: event.prompt.text })
        const note = [result.block, result.context].filter(Boolean).join("\n")
        if (note)
          event.prompt.text = `${event.prompt.text}\n\n<user-prompt-submit-hook>\n${note}\n</user-prompt-submit-hook>`
      }),
    )

    yield* ctx.event.subscribe().pipe(
      Stream.filter((event): event is SessionEvent.Execution.Succeeded => event.type === "session.execution.succeeded"),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          const count = stops.get(sessionID) ?? 0
          const result = yield* runAll("Stop", { session_id: sessionID, stop_hook_active: count > 0 })
          if (!result.block || count >= maxStopContinuations) return
          stops.set(sessionID, count + 1)
          continuing.add(sessionID)
          yield* ctx.session.prompt({ sessionID, text: `Stop hook feedback:\n${result.block}` })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Claude Code Stop hook failed", { sessionID: event.data.sessionID, cause }),
          ),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
