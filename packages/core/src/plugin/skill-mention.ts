export * as SkillMentionPlugin from "./skill-mention.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Skill } from "../skill.js"
import type { PluginInternal } from "./internal.js"

// `$name` after whitespace or at the start; a trailing sentence `.`/`:` is not part of the name.
const token = /(?<=^|\s)\$([\w][\w:.-]*?)(?=[.:]?(?:\s|$))/g

export const Plugin = define({
  id: "opencode.prompt.skill-mention",
  effect: Effect.fn("SkillMentionPlugin")(function* (ctx) {
    const skillService = yield* Skill.Service
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const matches = Array.from(event.prompt.text.matchAll(token))
        if (matches.length === 0) return
        const skills = yield* skillService.list()
        const attached = new Set(event.prompt.skills?.map((skill) => skill.id))
        // Only known skills count, so shell-style text like `$HOME` stays plain text.
        const found = matches.flatMap((match) => {
          const skill = skills.find((item) => item.id === match[1] || item.name === match[1])
          if (!skill || attached.has(skill.id)) return []
          attached.add(skill.id)
          return [{ id: skill.id, mention: { start: match.index, end: match.index + match[0].length, text: match[0] } }]
        })
        if (found.length === 0) return
        event.prompt.skills = [...(event.prompt.skills ?? []), ...found]
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
