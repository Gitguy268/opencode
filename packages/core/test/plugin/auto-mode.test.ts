import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { Config } from "@opencode/core/config"
import { AutoModePlugin } from "@opencode/core/plugin/auto-mode"
import { Session } from "@opencode/core/session"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Document, Info } from "@opencode/schema/config"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_auto_mode")

/** Runs the plugin with a scripted classifier reply and returns the evaluate hook plus the prompts it sent. */
const run = Effect.fnUntraced(function* (reply: Effect.Effect<string, Error>, enabled = true) {
  const prompts = new Array<string>()
  const captured: { evaluate?: (event: PermissionEvaluation) => Effect.Effect<void> } = {}
  yield* AutoModePlugin.Plugin.effect(
    host({
      permission: {
        list: () => Effect.die("unused permission.list"),
        get: () => Effect.die("unused permission.get"),
        reply: () => Effect.die("unused permission.reply"),
        assert: () => Effect.die("unused permission.assert"),
        hook: (name, callback) => {
          if (name === "evaluate") captured.evaluate = callback
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      session: {
        // Only the user's text is read.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        context: () => Effect.succeed([{ type: "user", text: "run the tests" }] as never),
      },
      generate: {
        text: (input) => {
          prompts.push(input.prompt)
          return reply.pipe(Effect.map((text) => ({ text })))
        },
      },
    }),
  ).pipe(
    Effect.provide(
      Config.testLayer([
        new Document({
          type: "document",
          info: new Info({ experimental: new ConfigExperimental.Info({ auto_mode: enabled }) }),
        }),
      ]),
    ),
  )
  if (!captured.evaluate) return yield* Effect.die("auto mode did not register an evaluate hook")
  return { evaluate: captured.evaluate, prompts }
})

const event = (action: string, effect: PermissionEvaluation["effect"] = "ask"): PermissionEvaluation => ({
  sessionID,
  action,
  resources: ["bun test"],
  effect,
})

describe("auto mode", () => {
  it.effect("approves only an exact ALLOW for a reviewed action", () =>
    Effect.gen(function* () {
      const allow = yield* run(Effect.succeed("ALLOW"))
      const approved = event("shell")
      yield* allow.evaluate(approved)
      expect(approved.effect).toBe("allow")
      expect(allow.prompts[0]).toContain("run the tests")
      expect(allow.prompts[0]).toContain("bun test")

      const ask = yield* run(Effect.succeed("ASK: deletes files"))
      const escalated = event("shell")
      yield* ask.evaluate(escalated)
      expect(escalated).toMatchObject({ effect: "ask", message: "Auto mode: deletes files" })

      const vague = yield* run(Effect.succeed("allow, probably"))
      const kept = event("shell")
      yield* vague.evaluate(kept)
      expect(kept.effect).toBe("ask")
      expect(kept.message).toBeUndefined()
    }),
  )

  it.effect("leaves the request alone when disabled, already decided, unreviewed, or the classifier fails", () =>
    Effect.gen(function* () {
      const failing = yield* run(Effect.fail(new Error("provider down")))
      const failed = event("edit")
      yield* failing.evaluate(failed)
      expect(failed.effect).toBe("ask")

      const allow = yield* run(Effect.succeed("ALLOW"))
      const outside = event("external_directory")
      const allowed = event("shell", "allow")
      yield* allow.evaluate(outside)
      yield* allow.evaluate(allowed)
      expect(outside.effect).toBe("ask")
      expect(allowed.effect).toBe("allow")
      expect(allow.prompts).toEqual([])

      const disabled = yield* run(Effect.succeed("ALLOW"), false)
      const off = event("shell")
      yield* disabled.evaluate(off)
      expect(off.effect).toBe("ask")
      expect(disabled.prompts).toEqual([])
    }),
  )
})

describe("auto mode timeout", () => {
  it.effect("keeps asking when the classifier does not answer in time", () =>
    Effect.gen(function* () {
      const hanging = yield* run(Effect.never)
      const pending = event("shell")
      const fiber = yield* hanging.evaluate(pending).pipe(Effect.forkChild)
      yield* TestClock.adjust("9 seconds")
      yield* Fiber.join(fiber)
      expect(pending.effect).toBe("ask")
    }),
  )
})

describe("auto mode reply parsing", () => {
  it.effect("reads the first line only", () =>
    Effect.sync(() => {
      expect(AutoModePlugin.parse(" ALLOW \nbecause tests")).toEqual({ allow: true })
      expect(AutoModePlugin.parse("ASK:   pushes to main")).toEqual({ allow: false, reason: "pushes to main" })
      expect(AutoModePlugin.parse("ASK:")).toEqual({ allow: false, reason: undefined })
      expect(AutoModePlugin.parse("")).toEqual({ allow: false, reason: undefined })
    }),
  )
})
