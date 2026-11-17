# segra-claude-mem

Connects Segra to [claude-mem](https://github.com/thedotmack/claude-mem), the memory system many people already run with Claude Code. With it, Segra shares that memory:

- **Records Segra sessions:** prompts, tool calls and an end-of-run summary go to claude-mem, labelled with the source `segra`. They land in the same projects as your Claude Code sessions.
- **Adds past work at the start of each run:** claude-mem's timeline for the current folder is injected into the conversation before the model's first request.
- **Adds claude-mem's search tools:** `search`, `timeline`, `get_observations`, `save_memory` and the rest, through claude-mem's MCP server.

It needs claude-mem installed for Claude Code. Without it the plugin does nothing, and Segra sessions are unaffected.

## Install

1. Install claude-mem for Claude Code and make sure its worker runs (`claude-mem status`).
2. Install the plugin:
   - **In Segra Desktop:** open **Settings → Marketplace**. It's listed under **Segra Recommended** at the top as "claude-mem memory". The plugin ships with the app, so installing needs no download.
   - **From the CLI:** `segra plugin install /path/to/segra-desktop/plugins/segra-claude-mem`

3. Start a new Segra session. The plugin loads in the CLI and in Segra Desktop, which share `~/.cline`.

Reinstalling from the Marketplace after an app update replaces the installed copy with the version bundled in the new app.

To remove it: `segra plugin uninstall segra-claude-mem`.

## How it works

The plugin calls claude-mem's own CLI, `claude-mem hook segra <event>`, which takes claude-mem's generic hook input on stdin:

| Segra hook | claude-mem event | When |
|---|---|---|
| `beforeRun` | `session-init`, then `context` | Each run. The context is returned as `appendContext`. |
| `onEvent` (user message added) | `session-init` | Prompts not visible at run start. Each prompt is recorded once. |
| `afterTool` | `observation` | Each tool call. Not awaited, so the agent isn't slowed down. |
| `afterRun` | `summarize` | End of each run, with the final assistant text. |
| session end (`onDispose`) | `session-end` | When the session closes. |

- **Sub-agents** (team members, spawned agents) are not recorded.
- **Not recorded as prompts:** Segra's `<user_input>` wrapper is removed, and runtime reminders that start with `[SYSTEM]` are skipped.
- **MCP launcher:** claude-mem installs into a versioned folder that changes on every update. `mcp-server.cjs` finds the newest one and starts its MCP server.

### Finding claude-mem

A desktop app launched from the dock gets a minimal `PATH`, so besides `PATH` the plugin checks `~/.local/bin`, `~/.bun/bin`, `/usr/local/bin` and `/opt/homebrew/bin`. Set `CLAUDE_MEM_BIN` to point at a different binary.

## Limits

- **How claude-mem builds memories:** it creates observations and summaries in the background with its own model, which runs on your Claude Code plan. If that isn't working, Segra sessions are recorded as prompts only. Check claude-mem's viewer (the URL in `claude-mem status`) or its logs in `~/.claude-mem/logs`.
- **Promotional text:** claude-mem's start-of-session text can include its own messages (for example a trial offer). The plugin injects that text as it is.
- **Windows:** not tested.

## Tests

```sh
cd plugins/segra-claude-mem && bun test
```

The tests use a fake `claude-mem` that logs each call, so they never touch a real memory database.
