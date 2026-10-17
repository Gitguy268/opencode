import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"

export function SidebarGoal(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  // Set by the server's /goal command; cleared when the goal completes. Children inherit
  // metadata but not the goal itself, so only root sessions show it.
  const goal = createMemo(() => {
    const session = props.context.data.session.get(props.sessionID)
    const value = session?.parentID ? undefined : session?.metadata?.goal
    return typeof value === "string" ? value : undefined
  })

  return (
    <Show when={goal()}>
      {(value) => (
        <box>
          <text fg={theme.text.base}>
            <b>Goal</b>
          </text>
          <text fg={theme.text.muted}>{value()}</text>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.goal",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarGoal context={context} sessionID={props.sessionID} />,
    })
  },
})
