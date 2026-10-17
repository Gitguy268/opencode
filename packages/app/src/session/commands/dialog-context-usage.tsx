import type { SessionContextUsageOutput } from "@opencode/client/promise"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

const kinds = ["system", "instructions", "tools", "messages"] as const

export default function DialogContextUsage(props: { usage: SessionContextUsageOutput; cost: number }) {
  const language = useLanguage()
  const number = new Intl.NumberFormat(language.intl())
  const money = new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" })

  const total = props.usage.sections.reduce((sum, section) => sum + section.tokens, 0)
  const limit = props.usage.limit

  const groups = kinds.flatMap((kind) => {
    const sections = props.usage.sections
      .filter((section) => section.kind === kind)
      .toSorted((a, b) => b.tokens - a.tokens)

    return sections.length === 0
      ? []
      : [{ kind, sections, tokens: sections.reduce((sum, section) => sum + section.tokens, 0) }]
  })

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("session.context.title")}
          description={
            limit
              ? language.t("session.context.total", {
                  total: number.format(total),
                  limit: number.format(limit),
                  percent: Math.round((total / limit) * 100),
                })
              : language.t("session.context.totalUnknown", { total: number.format(total) })
          }
        />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-2 pb-5 ps-6 pe-6 text-[13px] leading-5">
          <For each={groups}>
            {(group) => (
              <details>
                <summary class="flex cursor-pointer justify-between gap-4 text-v2-text-text-base">
                  <span>{language.t(`session.context.${group.kind}`, { count: group.sections.length })}</span>
                  <span class="tabular-nums">{number.format(group.tokens)}</span>
                </summary>
                <ul class="mt-1 flex flex-col ps-4 text-v2-text-text-muted">
                  <For each={group.sections}>
                    {(section) => (
                      <li class="flex justify-between gap-4">
                        <span class="truncate">{section.name}</span>
                        <span class="tabular-nums">{number.format(section.tokens)}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            )}
          </For>
          <p class="text-v2-text-text-muted">
            {language.t("session.context.spent", { cost: money.format(props.cost) })}
          </p>
        </div>
      </DialogBody>
    </Dialog>
  )
}
