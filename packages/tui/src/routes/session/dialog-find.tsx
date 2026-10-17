import { onMount } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { useData } from "../../context/data"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { Locale } from "../../util/locale"

const context = 40

/** One match per message, newest first: the user's text or the assistant's visible text, never tool output. */
export function findMatches(messages: readonly SessionMessageInfo[], query: string) {
  const needle = query.trim().replace(/\s+/g, " ").toLowerCase()
  if (!needle) return []
  return messages
    .flatMap((message) => {
      // Whitespace is collapsed so a query still matches across line breaks.
      const text = (
        message.type === "user"
          ? message.text
          : message.type === "assistant"
            ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
            : ""
      ).replace(/\s+/g, " ")
      const index = text.toLowerCase().indexOf(needle)
      if (index === -1) return []
      const start = Math.max(0, index - context)
      const end = Math.min(text.length, index + needle.length + context)
      const snippet = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
      return [{ message, snippet }]
    })
    .reverse()
}

export function DialogFind(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const data = useData()
  const dialog = useDialog()

  onMount(() => {
    dialog.setSize("large")
  })

  const search = (query: string): DialogSelectOption<string>[] =>
    findMatches(data.session.message.list(props.sessionID), query).map(({ message, snippet }) => ({
      title: snippet,
      value: message.id,
      footer: `${message.type === "user" ? "You" : "Assistant"} · ${Locale.time(message.time.created)}`,
      onSelect: (dialog) => {
        props.onMove(message.id)
        dialog.clear()
      },
    }))

  return (
    <DialogSelect
      onMove={(option) => props.onMove(option.value)}
      title="Find in session"
      searchInTitle
      titlePlaceholder="Search messages"
      options={[]}
      search={search}
    />
  )
}
