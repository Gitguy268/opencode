export * as AutoModePlugin from "./auto-mode.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect } from "effect"
import { Config } from "../config.js"
import type { PluginInternal } from "./internal.js"

// Actions a classifier may approve. Anything else, such as external_directory, always reaches the user.
const reviewed = new Set(["shell", "edit", "read", "glob", "grep", "webfetch", "websearch"])
const timeout = Duration.seconds(8)
const limit = 2000

const clip = (text: string) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

export const prompt = (input: {
  readonly request?: string
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
}) => `You review permission requests from an AI coding agent working in a software project.

The user's latest request:
<request>
${clip(input.request ?? "(none)")}
</request>

The agent wants to run the "${input.action}" action on:
<resources>
${clip(input.resources.join("\n"))}
</resources>
${input.metadata ? `<details>\n${clip(JSON.stringify(input.metadata))}\n</details>\n` : ""}
Approve only routine, reversible development work that fits the user's request and stays inside the project, such as reading files, searching, running tests, builds, linters or formatters, and editing project files.
Ask the user for anything destructive or hard to undo, anything touching credentials, secrets or files outside the project, network uploads, git push or history rewrites, publishing, installing system software, sudo, or anything the request does not call for. When unsure, ask.

Reply with exactly one line: ALLOW, or ASK: <short reason>.`

/** Only an exact ALLOW approves; anything else keeps the prompt. */
export const parse = (text: string) => {
  const line = text.trim().split("\n")[0]?.trim() ?? ""
  if (line === "ALLOW") return { allow: true as const }
  const reason = line.startsWith("ASK:") ? line.slice(4).trim() : undefined
  return { allow: false as const, reason: reason || undefined }
}

export const Plugin = define({
  id: "opencode.permission.auto-mode",
  effect: Effect.fn("AutoModePlugin")(function* (ctx) {
    const config = yield* Config.Service
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        if (event.effect !== "ask" || !reviewed.has(event.action)) return
        if (!Config.latest(yield* config.entries(), "experimental")?.auto_mode) return
        const messages = yield* ctx.session.context({ sessionID: event.sessionID })
        const request = messages.findLast((message) => message.type === "user")
        const { text } = yield* ctx.generate.text({
          prompt: prompt({
            request: request?.type === "user" ? request.text : undefined,
            action: event.action,
            resources: event.resources,
            metadata: event.metadata,
          }),
        })
        const decision = parse(text)
        if (decision.allow) {
          event.effect = "allow"
          yield* Effect.logInfo("auto mode approved permission", { action: event.action, resources: event.resources })
          return
        }
        if (decision.reason) event.message = `Auto mode: ${decision.reason}`
      }).pipe(
        Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.void }),
        // Any failure leaves the request as ask, so the user decides.
        Effect.catchCause((cause) => Effect.logWarning("auto mode review failed", { action: event.action, cause })),
      ),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
