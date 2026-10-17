export * as GoalPlugin from "./goal.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Schema, Stream } from "effect"
import { InstructionEntry } from "../session/instruction-entry.js"
import type { PluginInternal } from "./internal.js"

export const key = InstructionEntry.Key.make("goal")
export const tool = "goal_complete"
// Unattended turns per goal before the agent stops and waits for the user.
export const maxContinuations = 20

const start = (goal: string) =>
  `The session goal is now: ${goal}\n\nWork toward it. When the goal is fully done and verified, call the ${tool} tool. If you are blocked or need a decision from the user, say so and stop.`

const resume = `Continue working toward the session goal. When it is fully done and verified, call the ${tool} tool. If you are blocked or need a decision from the user, say so and stop.`

export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn("GoalPlugin")(function* (ctx) {
    const entries = yield* InstructionEntry.Service
    const continuations = new Map<string, number>()
    const goal = (sessionID: Parameters<typeof entries.list>[0]) =>
      entries.list(sessionID).pipe(Effect.map((items) => items.find((item) => item.key === key)?.value))
    // Mirrored into session metadata so every client can show it from the session it already syncs.
    const display = (sessionID: Parameters<typeof entries.list>[0], value?: string) =>
      ctx.session.get({ sessionID }).pipe(
        Effect.flatMap((session) => {
          const { [key]: _, ...rest } = session.metadata ?? {}
          return ctx.session.update({ sessionID, metadata: value === undefined ? rest : { ...rest, [key]: value } })
        }),
        Effect.catchCause((cause) => Effect.logWarning("failed to show session goal", { sessionID, cause })),
      )
    const clear = (sessionID: Parameters<typeof entries.list>[0]) =>
      Effect.sync(() => continuations.delete(sessionID)).pipe(
        Effect.andThen(entries.remove({ sessionID, key })),
        Effect.andThen(display(sessionID)),
      )

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "goal",
        description: "set a goal the agent keeps working toward; /goal clear stops it",
        execute: (input) =>
          Effect.gen(function* () {
            const text = input.prompt.text.trim()
            if (text === "" || text === "clear" || text === "stop") return yield* clear(input.sessionID)
            continuations.set(input.sessionID, 0)
            yield* entries.put({ sessionID: input.sessionID, key, value: text })
            yield* display(input.sessionID, text)
            yield* ctx.session.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: start(text),
              delivery: input.delivery,
            })
          }).pipe(Effect.asVoid),
      })
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: tool,
          options: { codemode: false },
          description: "Mark the session goal as complete. Only call this after the goal is fully done and verified.",
          input: Schema.Struct({
            summary: Schema.String.annotate({ description: "What was done and how it was verified" }),
          }),
          output: Schema.Struct({}),
          execute: (input, context) =>
            clear(context.sessionID).pipe(Effect.as({ output: {}, content: `Goal marked complete: ${input.summary}` })),
        }),
      )
      .pipe(Effect.orDie)

    // Sessions without a goal never see the tool, so it costs no context.
    yield* ctx.session.hook("context", (event) =>
      goal(event.sessionID).pipe(
        Effect.map((value) => {
          if (value === undefined) delete event.tools[tool]
        }),
      ),
    )

    yield* ctx.event.subscribe().pipe(
      Stream.filter((event): event is SessionEvent.Execution.Succeeded => event.type === "session.execution.succeeded"),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          if ((yield* goal(sessionID)) === undefined) return
          const count = continuations.get(sessionID) ?? 0
          if (count >= maxContinuations) return
          continuations.set(sessionID, count + 1)
          yield* ctx.session.prompt({ sessionID, text: resume })
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to continue session goal", { sessionID: event.data.sessionID, cause }),
          ),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
