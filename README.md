<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### About this fork

This is a personal fork of [anomalyco/opencode](https://github.com/anomalyco/opencode), on branch `lean-features`. It is not built by the OpenCode team and is not affiliated with them. It adds the following to the TUI and the desktop and web app:

| Feature | How to use it | Upstream request |
| --- | --- | --- |
| Session goals | `/goal <text>` sets a goal and starts work. The agent keeps going after each successful run until it calls `goal_complete`, you run `/goal clear`, or 20 unattended turns pass. If it is blocked it pauses, keeping the goal, and your next message resumes it. The goal shows in the TUI sidebar and the app header. | [#27167](https://github.com/anomalyco/opencode/issues/27167) |
| Context breakdown | `/context` estimates the tokens used by the system prompt, each instruction source, each tool and the messages, and shows the session cost including subagents. | [#6152](https://github.com/anomalyco/opencode/issues/6152) |
| Transcript search (TUI) | `/find` (or `/search`) searches user and assistant text and jumps to the message. The app already had Cmd+F. | [#4714](https://github.com/anomalyco/opencode/issues/4714) |
| Inline skills | Type `$skill-id` or `$skill-name` in a prompt to load that skill. Text that matches no skill, like `$HOME`, is left alone. | [#15617](https://github.com/anomalyco/opencode/issues/15617) |
| Claude Code hooks | `PreToolUse`, `PostToolUse`, `UserPromptSubmit` and `Stop` hooks from `~/.claude/settings.json` run. Project hooks need `"experimental": { "claude_hooks": "all" }`. | [#12472](https://github.com/anomalyco/opencode/issues/12472) |
| Auto mode | `"experimental": { "auto_mode": true }` lets the default model approve routine permission prompts. Anything risky or unclear still asks. | [#37564](https://github.com/anomalyco/opencode/issues/37564) |
| Subagent cap | `"experimental": { "subagent_parallel": 2 }` limits how many subagents one session runs at once. | [#27110](https://github.com/anomalyco/opencode/issues/27110) |
| Shell sandbox (macOS) | `"experimental": { "sandbox": true }` lets shell commands write only to the project, temp folders and package caches. | [#2242](https://github.com/anomalyco/opencode/issues/2242) |
| SearXNG search | Set `SEARXNG_URL` (for example `http://127.0.0.1:8888`), then choose `"websearch": { "provider": "searxng" }`. | — |

Inline skills, hooks, auto mode, the sandbox, the subagent cap and SearXNG are also documented in `services/www/src/docs/content` (`skills.mdx`, `plugins.mdx`, `permissions.mdx`, `tools.mdx`, `websearch.mdx`). `/goal`, `/context` and `/find` are documented only here.

<details>
<summary>Limits and things not done</summary>

- Session goals and auto mode were tested with stubbed models only, not against a live model.
- A `UserPromptSubmit` hook cannot block a prompt. Its block reason is added to the prompt as context instead.
- The sandbox covers the shell tool only. Terminals, MCP servers, formatters and file edits are not sandboxed, network access is unchanged, and it does nothing on Linux or Windows.
- `/context` counts tools before plugin hooks, so `goal_complete` appears in the list even though requests without a goal leave it out.
- There is no `$` autocomplete in the prompt yet.
- Clickable links in the TUI were already upstream, so nothing was added for them.

</details>

<details>
<summary>Startup and memory</summary>

Measured on an M-series Mac with `bun script/bench-startup.ts <binary>`, which runs the server with throwaway data folders. TUI numbers come from launching the TUI with `--standalone` in a terminal emulator. Each figure is the median of 3 runs, comparing this fork against the upstream commit it is based on (`8c173a8f3`).

| | Upstream | This fork |
| --- | --- | --- |
| Server boot to ready | 182 ms | 189 ms |
| Server memory, idle | 120 MB | 139 MB |
| Server memory, 3 projects open | 299 MB | 329 MB |
| TUI time to prompt | 1.64 s | 1.73 s |
| TUI and its server, memory | 433 MB | 413 MB |

Run-to-run differences are around ±40 MB, so the two builds perform the same. The fork adds features without measurable cost, but it does not make opencode faster. About two thirds of the memory belongs to the server process (about 260–310 MB). Idle projects are already unloaded after 60 minutes upstream. Running the TUI and server in one process would save roughly one Bun runtime, but it would break the built-in terminal, and the desktop app needs the separate server, so that was not done. Flags such as `OPENCODE_DISABLE_MODELS_FETCH` changed memory by less than the noise.

</details>

<details>
<summary>Building and testing this fork</summary>

```bash
bun install                                   # bun 1.4.x
cd packages/cli && bun run script/build.ts --single --skip-install
./dist/cli-darwin-arm64/bin/opencode          # or: bun dev (from packages/cli)
```

Run tests per package, never from the repository root, for example `cd packages/core && bun test`. Run `bun run check` at the root for lint and typecheck.

</details>

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g @opencode/cli@latest      # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
