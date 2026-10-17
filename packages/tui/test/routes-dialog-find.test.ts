import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { findMatches } from "../src/routes/session/dialog-find"

const user = (id: string, text: string, created: number) =>
  ({ id, type: "user", text, time: { created } }) as unknown as SessionMessageInfo
const assistant = (id: string, parts: { type: string; text?: string }[], created: number) =>
  ({ id, type: "assistant", content: parts, time: { created } }) as unknown as SessionMessageInfo

const messages = [
  user("msg_1", "Please fix the Login bug", 1),
  assistant(
    "msg_2",
    [
      { type: "text", text: "Found the login\nbug in auth.ts" },
      { type: "tool", text: "login" },
    ],
    2,
  ),
  assistant("msg_3", [{ type: "reasoning", text: "login reasoning stays hidden" }], 3),
  user("msg_4", `${"x".repeat(100)} needle ${"y".repeat(100)}`, 4),
]

test("finds user and assistant text, newest first, case-insensitive", () => {
  expect(findMatches(messages, "LOGIN").map((match) => match.message.id)).toEqual(["msg_2", "msg_1"])
  expect(findMatches(messages, "login   bug").map((match) => match.snippet)).toEqual([
    "Found the login bug in auth.ts",
    "Please fix the Login bug",
  ])
  expect(findMatches(messages, "   ")).toEqual([])
})

test("trims long text to a snippet around the match", () => {
  const snippet = findMatches(messages, "needle")[0]?.snippet ?? ""
  expect(snippet).toBe(`…${"x".repeat(39)} needle ${"y".repeat(39)}…`)
})
