import { expect, test } from "bun:test"
import { formatContextUsage } from "../src/routes/session/context-usage"

test("summarizes context by group with the largest items first", () => {
  const tools = Array.from({ length: 7 }, (_, index) => ({
    kind: "tools" as const,
    name: `tool${index}`,
    tokens: index + 1,
  }))
  const text = formatContextUsage(
    {
      limit: 1000,
      sections: [
        { kind: "system", name: "System prompt", tokens: 300 },
        { kind: "instructions", name: "core/skill-guidance", tokens: 150 },
        { kind: "instructions", name: "api/goal", tokens: 20 },
        ...tools,
        { kind: "messages", name: "Messages (4)", tokens: 2 },
      ],
    },
    0.5,
  )
  expect(text).toBe(
    [
      "About 500 tokens of 1,000 (50%), estimated before plugin hooks.",
      "",
      "System prompt: 300",
      "Instructions (2): 170",
      "  core/skill-guidance: 150",
      "  api/goal: 20",
      "Tools (7): 28",
      "  tool6: 7",
      "  tool5: 6",
      "  tool4: 5",
      "  tool3: 4",
      "  tool2: 3",
      "  …and 2 more",
      "Messages (4): 2",
      "",
      "Spent $0.50 in this session, including subagents.",
    ].join("\n"),
  )
})
