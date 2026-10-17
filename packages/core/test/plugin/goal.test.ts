import { describe, expect } from "bun:test"
import { Effect, Queue, Schema, Stream } from "effect"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Agent } from "@opencode/core/agent"
import { Event } from "@opencode/schema/event"
import { Model } from "@opencode/core/model"
import { GoalPlugin } from "@opencode/core/plugin/goal"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/schema/tool"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_goal_test")

const succeeded = (): SessionEvent.Execution.Succeeded => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
  type: "session.execution.succeeded",
  data: { sessionID },
})

const request = (): SessionContext => ({
  sessionID,
  agent: Agent.ID.make("build"),
  model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
  system: [],
  messages: [],
  // Only the key matters to the plugin.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  tools: { [GoalPlugin.tool]: {} as never, read: {} as never },
  options: {},
})

/** Runs the goal plugin against stubbed domains and an in-memory instruction store. */
const run = Effect.fnUntraced(function* () {
  const stored = new Map<string, Schema.Json>()
  const prompts = new Array<string>()
  const metadata: { current: Record<string, Schema.Json> } = { current: { theme: "kept" } }
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded>()
  const captured: {
    command?: CommandDefinition
    tool?: Tool.Info
    context?: (input: SessionContext) => Effect.Effect<void>
  } = {}
  const entries = InstructionEntry.Service.of({
    list: () => Effect.sync(() => Array.from(stored, ([key, value]) => ({ key, value }))),
    put: (input) => Effect.sync(() => void stored.set(input.key, input.value)),
    remove: (input) => Effect.sync(() => void stored.delete(input.key)),
    load: () => Effect.die("unused load"),
  })
  yield* GoalPlugin.Plugin.effect(
    host({
      command: {
        list: () => Effect.die("unused command.list"),
        reload: () => Effect.die("unused command.reload"),
        transform: (callback) => {
          callback({ add: (definition) => (captured.command = definition) })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      tool: {
        list: () => Effect.die("unused tool.list"),
        reload: () => Effect.die("unused tool.reload"),
        hook: () => Effect.die("unused tool.hook"),
        transform: (callback) => {
          // The plugin only calls add.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          callback({ add: (tool: Tool.Info) => (captured.tool = tool) } as never)
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        hook: (name, callback) => {
          if (name === "context") captured.context = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
        // The plugin reads only metadata from the session.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        get: () => Effect.sync(() => ({ metadata: metadata.current }) as never),
        update: (input) => Effect.sync(() => void (metadata.current = input.metadata ?? {})),
        prompt: (input) => {
          prompts.push(input.text)
          return Effect.die("prompt result unused")
        },
      },
    }),
  ).pipe(Effect.provideService(InstructionEntry.Service, entries))
  const { command, tool, context } = captured
  if (!command || !tool || !context) return yield* Effect.die("goal plugin did not register everything")
  const settle = (count: number) =>
    Effect.promise(async () => {
      for (const _ of Array.from({ length: 1000 })) {
        if (prompts.length >= count) return
        await Bun.sleep(1)
      }
    })
  return { stored, metadata, prompts, events, command, tool, context, settle }
})

const invoke = (command: CommandDefinition, text: string) =>
  command.execute({ sessionID, prompt: { text }, delivery: "steer" }).pipe(Effect.catchDefect(() => Effect.void))

describe("goal plugin", () => {
  it.effect("stores the goal, starts work, and hides the completion tool without a goal", () =>
    Effect.gen(function* () {
      const goal = yield* run()
      const idle = request()
      yield* goal.context(idle)
      expect(Object.keys(idle.tools)).toEqual(["read"])

      yield* invoke(goal.command, "  ship the release  ")
      expect(goal.stored.get(GoalPlugin.key)).toBe("ship the release")
      expect(goal.metadata.current).toEqual({ theme: "kept", goal: "ship the release" })
      expect(goal.prompts[0]).toContain("The session goal is now: ship the release")
      const active = request()
      yield* goal.context(active)
      expect(Object.keys(active.tools)).toEqual([GoalPlugin.tool, "read"])
    }),
  )

  it.effect("continues when idle until the goal is completed, and stops at the cap", () =>
    Effect.gen(function* () {
      const goal = yield* run()
      yield* invoke(goal.command, "ship it")
      yield* Queue.offer(goal.events, succeeded())
      yield* goal.settle(2)
      expect(goal.prompts[1]).toContain("Continue working toward the session goal")

      const result = yield* goal.tool
        .execute(
          { summary: "released v1, tests green" },
          {
            sessionID,
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.make("msg_goal"),
            id: Tool.CallID.make("call_goal"),
            progress: () => Effect.void,
          },
        )
        .pipe(Effect.orDie)
      expect(result.content).toBe("Goal marked complete: released v1, tests green")
      expect(goal.stored.has(GoalPlugin.key)).toBe(false)
      expect(goal.metadata.current).toEqual({ theme: "kept" })
      yield* Queue.offer(goal.events, succeeded())
      yield* Effect.promise(() => Bun.sleep(20))
      expect(goal.prompts).toHaveLength(2)

      yield* invoke(goal.command, "again")
      for (const _ of Array.from({ length: GoalPlugin.maxContinuations + 3 }))
        yield* Queue.offer(goal.events, succeeded())
      yield* goal.settle(3 + GoalPlugin.maxContinuations)
      yield* Effect.promise(() => Bun.sleep(20))
      expect(goal.prompts).toHaveLength(3 + GoalPlugin.maxContinuations)

      yield* invoke(goal.command, "clear")
      expect(goal.stored.has(GoalPlugin.key)).toBe(false)
    }),
  )
})
