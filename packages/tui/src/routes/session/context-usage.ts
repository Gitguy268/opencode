import type { SessionContextUsageOutput } from "@opencode/client/promise"

const number = new Intl.NumberFormat("en-US")
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const shown = 5

/** Plain-text /context report: total against the window, then each group with its largest items. */
export function formatContextUsage(usage: SessionContextUsageOutput, cost: number) {
  const total = usage.sections.reduce((sum, section) => sum + section.tokens, 0)
  const groups = (["system", "instructions", "tools", "messages"] as const).flatMap((kind) => {
    const sections = usage.sections.filter((section) => section.kind === kind)
    if (sections.length === 0) return []
    const tokens = sections.reduce((sum, section) => sum + section.tokens, 0)
    if (kind === "system" || kind === "messages") return [`${sections[0]!.name}: ${number.format(tokens)}`]
    const title = kind === "tools" ? `Tools (${sections.length})` : `Instructions (${sections.length})`
    const largest = sections.toSorted((a, b) => b.tokens - a.tokens)
    return [
      `${title}: ${number.format(tokens)}`,
      ...largest.slice(0, shown).map((section) => `  ${section.name}: ${number.format(section.tokens)}`),
      ...(largest.length > shown ? [`  …and ${largest.length - shown} more`] : []),
    ]
  })
  const window = usage.limit ? ` of ${number.format(usage.limit)} (${Math.round((total / usage.limit) * 100)}%)` : ""
  return [
    `About ${number.format(total)} tokens${window}, estimated before plugin hooks.`,
    "",
    ...groups,
    "",
    `Spent ${money.format(cost)} in this session, including subagents.`,
  ].join("\n")
}
