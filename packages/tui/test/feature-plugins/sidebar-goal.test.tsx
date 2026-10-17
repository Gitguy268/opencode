/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarGoal } from "../../src/feature-plugins/sidebar/goal"

function context(metadata?: Record<string, unknown>) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: { text: { base: color, muted: color } },
    data: { session: { get: () => ({ metadata }) } },
  } as unknown as Context
}

test.each([
  ["without a goal", undefined, false],
  ["with a non-text goal", { goal: 3 }, false],
  ["with a goal", { goal: "ship the release" }, true],
])("sidebar goal %s", async (_name, metadata, shown) => {
  const app = await testRender(() => <SidebarGoal context={context(metadata)} sessionID="session" />, {
    width: 42,
    height: 6,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame().includes("Goal")).toBe(shown)
    if (shown) expect(app.captureCharFrame()).toContain("ship the release")
  } finally {
    app.renderer.destroy()
  }
})
