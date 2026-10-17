export * as SessionContextUsage from "./context-usage.js"

import { Effect, Result } from "effect"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Instructions } from "../instructions/index.js"
import { Plugin } from "../plugin/service.js"
import { Token } from "../util/token.js"
import { estimateMessage } from "./compaction.js"
import { SessionContext } from "./context.js"
import { SessionHistory } from "./history.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionProviderContext } from "./provider-context.js"
import type { SessionSchema } from "./schema.js"

export interface Section {
  readonly kind: "system" | "instructions" | "tools" | "messages"
  readonly name: string
  readonly tokens: number
}

export interface Usage {
  readonly limit?: number
  readonly sections: ReadonlyArray<Section>
}

/**
 * Estimates what the next request would send, by section. Read-only: no model call, no plugin hooks,
 * and no instruction observation, so it never adds to the transcript.
 */
export const usage = Effect.fn("SessionContextUsage.usage")(function* (input: { session: SessionSchema.Info }) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const context = yield* SessionContext.Service
    const selection = yield* context.select(input.session.id)
    const model = yield* context.resolveModel(selection.session)
    const history = yield* SessionHistory.preview(
      database.db,
      selection.session.id,
      selection.instructions,
      SessionProviderContext.provenance(model) ?? "local",
    )
    const transcript = SessionModelRequest.baseTranscript({
      agent: selection.agent.info,
      model,
      tools: selection.tools,
      initial: "",
      messages: history.messages,
    })
    const observed = yield* Instructions.read(selection.instructions)
    const instructions = selection.instructions.flatMap((source): Section[] => {
      const value = observed.find((entry) => entry.key === source.key)?.value
      if (value === undefined) return []
      // Unavailable or removed values do not render, and contribute nothing.
      const text = Result.try(() => Instructions.renderInitial([source], { [source.key]: value }))
      return Result.isSuccess(text) && text.success
        ? [{ kind: "instructions", name: source.key, tokens: Token.estimate(text.success) }]
        : []
    })
    const tools = selection.tools.definitions.map(
      (tool): Section => ({
        kind: "tools",
        name: tool.name,
        tokens: Token.estimate(tool.name + tool.description + JSON.stringify(tool.inputSchema)),
      }),
    )
    return {
      limit: model.limit.context,
      sections: [
        {
          kind: "system",
          name: "System prompt",
          tokens: transcript.system.reduce((sum, part) => sum + Token.estimate(part.text), 0),
        },
        ...instructions,
        ...tools,
        {
          kind: "messages",
          name: `Messages (${history.messages.length})`,
          tokens: transcript.messages.reduce((sum, message) => sum + estimateMessage(message), 0),
        },
      ],
    } satisfies Usage
  }).pipe(instances.provide(input.session))
})
