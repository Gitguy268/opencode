import { expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { SkillMentionPlugin } from "@opencode/core/plugin/skill-mention"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Skill } from "@opencode/core/skill"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const prompt = (text: string, skills?: { id: Skill.ID }[]): SessionHooks["prompt"] => ({
  sessionID: Session.ID.make("ses_skill_mention"),
  messageID: SessionMessage.ID.make("msg_skill_mention"),
  prompt: { text, ...(skills ? { skills } : {}) },
  delivery: "steer",
})

it.effect("attaches known $skill mentions and leaves other $ text alone", () =>
  Effect.gen(function* () {
    const skills = yield* Skill.Service
    const hooks = yield* PluginHooks.Service
    yield* skills.transform((editor) => {
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("review"),
          name: Skill.Name.make("Code Review"),
          path: AbsolutePath.make(path.resolve("/skills/review/SKILL.md")),
          content: "Review the diff",
        }),
      )
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("ponytail:audit"),
          name: Skill.Name.make("audit"),
          path: AbsolutePath.make(path.resolve("/skills/audit/SKILL.md")),
          content: "Audit the repo",
        }),
      )
    })
    yield* SkillMentionPlugin.Plugin.effect(yield* PluginHost.make(yield* Plugin.Service))

    const event = prompt("$review this, then run $ponytail:audit. Keep $HOME and $5 as they are, and $review once")
    yield* hooks.trigger("session", "prompt", event)
    expect(event.prompt.skills).toEqual([
      { id: Skill.ID.make("review"), mention: { start: 0, end: 7, text: "$review" } },
      { id: Skill.ID.make("ponytail:audit"), mention: { start: 23, end: 38, text: "$ponytail:audit" } },
    ])
    expect(event.prompt.text).toBe(
      "$review this, then run $ponytail:audit. Keep $HOME and $5 as they are, and $review once",
    )

    const attached = prompt("use $review", [{ id: Skill.ID.make("review") }])
    yield* hooks.trigger("session", "prompt", attached)
    expect(attached.prompt.skills).toEqual([{ id: Skill.ID.make("review") }])

    const plain = prompt("echo $HOME")
    yield* hooks.trigger("session", "prompt", plain)
    expect(plain.prompt.skills).toBeUndefined()
  }),
)
