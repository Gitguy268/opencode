export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt, optional } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  subagent_parallel: PositiveInt.pipe(optional).annotate({
    description:
      "Maximum subagents one session runs at the same time; further subagent calls wait for a free slot. Unlimited by default.",
  }),
  claude_hooks: Schema.Union([Schema.Literal(false), Schema.Literals(["user", "all"])])
    .pipe(optional)
    .annotate({
      description:
        'Run Claude Code hooks (PreToolUse, PostToolUse, UserPromptSubmit, Stop) from ~/.claude/settings.json ("user", the default), also from project .claude/settings.json and settings.local.json ("all"), or not at all (false).',
    }),
  sandbox: Schema.Boolean.pipe(optional).annotate({
    description:
      "macOS only: run shell tool commands under sandbox-exec so they can write only to the project, the working directory, temp directories and package caches. Network access is unchanged. Defaults to false.",
  }),
  auto_mode: Schema.Boolean.pipe(optional).annotate({
    description:
      "Let a model review permission prompts for routine tool actions and approve safe ones. Uncertain or risky requests still ask. Defaults to false.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Deprecated: use top-level policies. Ordered policies controlling access to configured resources",
  }),
}) {}
