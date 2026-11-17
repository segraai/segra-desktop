# Segra CLI

Run Segra in your terminal. Interactive chat for paired sessions, or fully headless for CI/CD and scripting. The CLI shares its agent core with Segra Desktop, so plan/act modes, MCP servers, checkpoints, rules, skills, provider settings, and your Segra sign-in are the same in both.

## Install

The CLI ships inside [Segra Desktop](https://segra.ai). To use it from a terminal:

1. Open Segra Desktop and go to **Settings → About → Command-line tool**.
2. Click **Install**. This adds a `segra` command:
   - **macOS / Linux:** a link at `~/.local/bin/segra`. No admin password is needed. If `~/.local/bin` isn't on your `PATH`, the page shows the line to add to your shell startup file.
   - **Windows:** a `segra` command added to your user `PATH`. Open a new terminal afterwards.
3. Run `segra`.

The command always runs the CLI bundled with the app, so it updates when Segra Desktop updates. If an update moves the app, the same page offers **Reinstall**. The Linux AppImage doesn't support this; use the `.deb` or `.rpm` build.

To run the CLI from a checkout of this repository instead, see [DEVELOPMENT.md](./DEVELOPMENT.md) (`bun run cli` from the repository root).

## Quick start

Run interactively:

```sh
segra
```

Run a single prompt:

```sh
segra "Audit this package and propose fixes"
```

Pipe input:

```sh
cat file.txt | segra "Summarize this"
```

See `segra --help` for the full flag reference.

## Sign in

Sign in with your Segra account to use Segra's private, TEE-attested models:

```sh
segra auth --provider segra
```

This prints a code and opens the Segra web sign-in page in your browser. Confirm the code there and the CLI saves the key. It works without an interactive terminal, so you can run it over SSH and approve from any browser. Running `segra` for the first time also offers **Sign in with Segra** as the first option.

If you already signed in with Segra Desktop, the CLI uses that sign-in; the two share settings in `~/.cline`.

## Use any provider

You can also sign in to Cline, use your ChatGPT subscription through `openai-codex`, or bring an API key from Anthropic, OpenAI, Google Gemini, OpenRouter, AWS Bedrock, GCP Vertex, Cerebras, Groq, and any OpenAI-compatible endpoint.

```sh
segra auth                              # interactive sign-in
segra auth --provider segra             # Segra browser sign-in
segra auth cline                        # Cline OAuth sign-in
segra auth --provider anthropic --apikey sk-... --modelid claude-sonnet-4-6
```

`segra auth` without a provider opens the interactive sign-in screen (Sign in with Segra, Cline, or ChatGPT, or use your own API key).

OAuth-supported providers (`segra`, `cline`, `openai-codex`, `oca`) do not launch a browser on normal startup. Sign in explicitly first with `segra auth <provider>`. For non-interactive runs, if an OAuth provider is selected and no saved credentials are available, `segra` fails fast with an authentication message instead of launching a hidden browser flow.

## Modes

Segra CLI runs in a few different shapes depending on what you need:

- Interactive TUI: `segra` or `segra -i` opens a full terminal UI with plan/act toggle, slash commands, file mentions, and live tool approvals
- One-shot: `segra "your prompt"` runs a single turn and exits
- JSON: `segra --json "..."` streams NDJSON events for piping into other tools
- Yolo: `segra --yolo "..."` skips approval prompts and exits when the turn finishes
- Zen: `segra --zen "..."` fires the task to the background hub daemon and exits immediately (see below)

## Headless mode for CI/CD

Run Segra with zero interaction for scripting and automation. Pipe input, get JSON output, chain commands, integrate into CI/CD pipelines.

```sh
# One-shot prompt, auto-approve all tools
segra --yolo "Run tests and fix any failures"

# Pipe a diff in for review
git diff origin/main | segra "Review these changes for issues"

# NDJSON output for downstream tooling
segra --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## Features

- Streaming TUI built on [OpenTUI](https://github.com/sst/opentui) with markdown rendering, syntax-highlighted diffs, scrollable chat, and mouse support
- Plan/Act mode toggle for switching between planning and execution
- Native MCP support for connecting custom tools
- Checkpoints with `/undo` to rewind workspace state
- Sub-agent spawning and agent teams for parallel work
- Browser sign-in for Segra, plus OAuth login for Cline, ChatGPT Subscription (`openai-codex`), and OCA
- Configurable thinking budgets per run
- Cron and event-driven schedules for recurring agent work
- Chat connectors for Telegram, Google Chat, and WhatsApp

## Usage

```sh
# Start Segra CLI without a prompt to enter interactive mode
segra

# Single prompt (one-shot) - includes tools, spawn, and teams
segra "Audit this package and propose fixes"

# Interactive mode with a starting prompt
segra -i "Let's work on this together. First, analyze the current state."

# With a custom system prompt
segra -i -s "You are a pirate" "Tell me about the sea"

# Require approval before each tool call
segra --auto-approve false "Inspect and modify this repository"

# Explicit yolo: enables submit_and_exit and disables spawn/team tools by default
segra --yolo --retries 5 "Refactor this package"

# Override consecutive internal mistake (retry) limit (default: 3)
segra --retries 5 "Fix failing tests"

# Team workflow with persistent name
segra --team-name my-team "Plan, implement, and verify release checklist"
segra --team-name my-team "Continue yesterday's team workflow"

# Show verbose run stats (elapsed time, tokens, estimated cost when available)
segra -v "Explain quantum computing"

# Use a specific provider, model, and access token for a single prompt
segra -P openrouter -m google/gemini-3-pro -k sk-... "Set up a storybook"

# Use a different model with the last used provider
segra -m anthropic/claude-opus-4-6 "Explain string theory"

# Stream structured NDJSON output
segra --json "Summarize this repository"

# Quick provider setup
segra auth --provider anthropic --apikey sk-... --modelid claude-sonnet-4-6
segra auth --provider openai-native --apikey sk-... --modelid gpt-5 --baseurl https://api.example.com/v1
```

### MCP servers

Manage MCP servers with the interactive wizard:

```sh
segra mcp
segra config mcp
```

Open the add-server wizard with the name, transport, and command or URL already filled in with `segra mcp install` (`segra mcp add` also works). Stdio servers use everything after `--` as the command and arguments:

```sh
segra mcp install fs -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

Remote HTTP and SSE servers take a name, transport, and URL. The wizard still asks for auth details before saving:

```sh
segra mcp install ctx7 --transport http https://mcp.context7.com/mcp
segra mcp install events --transport sse https://example.com/sse
```

Because this command opens the wizard, it requires a TTY.

### Connectors

Bridge a chat surface into RPC-backed Segra sessions. Each conversation thread maps to a session with full context. Supported platforms: Telegram, Slack, Google Chat, WhatsApp, and Linear.

```sh
# Telegram (polling mode)
segra connect telegram -k 123456:ABCDEF...

# Slack (webhook mode)
segra connect slack --bot-token $SLACK_BOT_TOKEN --signing-secret $SLACK_SIGNING_SECRET --base-url https://your-domain.com

# Slack (socket mode)
segra connect slack --bot-token $SLACK_BOT_TOKEN --app-token $SLACK_APP_TOKEN

# Google Chat (webhook mode)
segra connect gchat --base-url https://your-domain.com

# WhatsApp (webhook mode)
segra connect whatsapp --base-url https://your-domain.com

# Linear (webhook mode)
segra connect linear --api-key $LINEAR_API_KEY --base-url https://your-domain.com

# Stop connector bridges and delete their sessions
segra connect --stop
segra connect --stop telegram
```

In chat surfaces, connector slash commands include `/help`, `/start`, `/new`, `/clear`, `/whereami`, `/tools`, `/yolo`, `/cwd <path>`, `/schedule`, `/abort`, and `/exit`. Run `segra connect <adapter> --help` to see the full flag list for any adapter.

### Schedules

Schedule agents on cron-like intervals or external events.

If `--provider` and `--model` are omitted, schedules use the last configured
provider and model. If only `--provider` is given, the schedule uses that
provider's saved model.

```sh
segra schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --timeout 3600 \
  --tags automation,review

segra schedule list
segra schedule get <schedule-id>
segra schedule trigger <schedule-id>
segra schedule history <schedule-id> --limit 20
segra schedule export <schedule-id> > daily-review.yaml
segra schedule import ./daily-review.yaml
```

Schedules can route results back to chat surfaces with `--delivery-adapter`, `--delivery-bot`, and `--delivery-thread`.

## Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | Override the system prompt |
| `-P, --provider <id>` | Provider id (default: `cline`) |
| `-m, --model <id>` | Model id (default: `anthropic/claude-sonnet-4.6`) |
| `-k, --key <api-key>` | API key for this run, also saved as the provider's key |
| `-p, --plan` | Run in plan mode (default is act mode) |
| `-i, --tui` | Interactive TUI multi-turn mode |
| `-t, --timeout <seconds>` | Optional run timeout in seconds |
| `-c, --cwd <path>` | Working directory for tools |
| `--config <path>` | Configuration directory (used for CLI home resolution) |
| `--hooks-dir <path>` | Additional hooks directory hint for runtime hook injection |
| `--acp` | ACP (Agent Client Protocol) mode |
| `--thinking [none\|low\|medium\|high\|xhigh]` | Model thinking level when supported. Defaults to `medium` when the flag is provided without a level. Without the flag, the CLI uses the level you last chose with `/model`, or the provider default. |
| `--compaction <agentic\|basic\|off>` | Context compaction mode. Defaults to `agentic`; use `basic` for local truncation or `off` to disable. |
| `--retries <count>` | Maximum consecutive mistakes (retries) before halting (default: `3`) |
| `--json` | Output NDJSON instead of styled text |
| `--data-dir <path>` | Use isolated local state at `<path>` instead of `~/.cline/data` (enables sandbox mode automatically) |
| `--auto-approve [true\|false]` | Set tool auto-approval for all tools |
| `--kanban` | Run the external `kanban` app |
| `-y, --yolo` | Skip tool approval prompts, enable `submit_and_exit`, and disable spawn/team tools by default |
| `-z, --zen` | Dispatch the task to the background hub and exit the CLI immediately |
| `--team-name <name>` | Override the runtime team state name |
| `-h, --help` | Show help and exit |
| `-v, --verbose` | Show verbose runtime diagnostics |
| `-V, --version` | Show version and exit |

`--json` is non-interactive and requires either a prompt argument or piped stdin. `--key` takes precedence over environment variables.

## Top-level commands

- `segra config` - Open the interactive config view
- `segra history|h [options]` - List session history or manage saved sessions
- `segra version` - Show CLI version
- `segra update [options]` - Check for CLI and kanban updates
- `segra auth <provider>` - Authenticate or seed provider credentials
- `segra connect <adapter>` - Run a chat connector bridge (`telegram`, `gchat`, `whatsapp`)
- `segra connect --stop [adapter]` - Stop connector bridge processes and their sessions
- `segra schedule <command>` - Create and manage scheduled runs
- `segra doctor` - Inspect local CLI health and stale processes
- `segra doctor fix` - Kill stale local RPC listeners and old CLI processes
- `segra doctor log` - Open the CLI runtime log file (`CLINE_LOG_PATH` when set)
- `segra hook` - Handle a hook payload from stdin
- `segra hub` - Manage the local hub daemon
- `segra kanban` - Run the external `kanban` app, installing it first when needed

Compiled CLI binaries embed the plugin bootstrap, SDK modules, and dashboard
assets. They can start the Hub, load SDK plugins, and serve the dashboard without
a separate Node/Bun installation or adjacent runtime files. Resources are read directly from the binary’s read-only Bun filesystem; no
runtime cache is extracted. `--plugin-sandbox` is an internal subprocess dispatch
flag, not a user command.

## Hub dashboard

Run `segra hub` to list hub subcommands. To start the browser dashboard:

```sh
segra hub dashboard
```

The dashboard opens in your default browser and stays running until you press Ctrl+C. Use `--no-open` to print the URL without opening a browser, or `--port` to change the dashboard's HTTP/WebSocket port (default: `8787`):

```sh
segra hub dashboard --port 9090 --no-open
segra hub dashboard --help
```

Dashboard options also include `--cwd`, `--config`, `--data-dir`, `--host`, `--public-url`, and `--room-secret`. For LAN or tunnel access, see the [Hub configuration and security guidance](../cline-hub/README.md). The old `segra dashboard` invocation remains a hidden compatibility alias; use `segra hub dashboard` in new scripts.

## Zen mode

`--zen` (alias `-z`) runs a task in the background hub daemon and exits the CLI immediately. It is intended for long-running tasks you want to fire off and walk away from.

```sh
segra --zen "Refactor the authentication module and add unit tests"
```

Behavior:

- The CLI starts (or reuses) the local hub daemon, submits the task, then exits. It does not stream output or stay attached to the session.
- Because there is no human in the loop once the CLI exits, zen sessions run with full tool auto-approval (same semantics as `--yolo`). `spawn`/`team` tools are disabled by default for safety, consistent with yolo-mode defaults.
- There is no live UI for the task. Use `segra history` later to find the session and inspect the result.
- `--zen` is incompatible with `--data-dir` (the implicit sandbox requires a local backend that exits with the CLI) and with `--tui` (there is no terminal UI to render into).

## Tool approval

Tool calls are auto-approved by default. Use `--auto-approve false` to require review before tool execution.

```sh
segra --auto-approve false "Inspect and modify this repository"
```

When approval is required, the CLI prompts in TTY mode:

```text
Approve tool "<tool_name>" with input <preview>? [y/N]
```

- Enter `y` or `yes` to approve.
- Enter anything else (or press Enter) to reject.
- If stdin/stdout is not a TTY, required-approval calls are denied in terminal mode.

Desktop-integrated approval mode is also supported via env wiring (`CLINE_TOOL_APPROVAL_MODE=desktop` and `CLINE_TOOL_APPROVAL_DIR=<path>`). In desktop mode, CLI writes a request JSON file and waits for a matching decision JSON file.

## Environment variables

- `ANTHROPIC_API_KEY` - API key for Anthropic
- `SEGRA_API_KEY` - Segra API key (when using `-P segra`; normally `segra auth --provider segra` saves one for you)
- `SEGRA_BASE_URL` - Segra server URL (default `https://web.segra.ai/api/app/v1`; set it for a local or staging Segra server)
- `CLINE_API_KEY` - API key for Cline (when using `-P cline`)
- `OPENAI_API_KEY` - API key for OpenAI (when using `-P openai`)
- `OPENROUTER_API_KEY` - API key for OpenRouter (when using `-P openrouter`)
- `AI_GATEWAY_API_KEY` - API key for Vercel AI Gateway (when using `-P vercel-ai-gateway`)
- `V0_API_KEY` - API key for v0 (when using `-P v0`)
- `CLINE_DATA_DIR` - Base data directory for sessions/settings/teams/hooks
- `CLINE_SANDBOX` - Set to `1` to force sandbox mode
- `CLINE_SANDBOX_DATA_DIR` - Override sandbox state directory
- `CLINE_TEAM_DATA_DIR` - Override team persistence directory
- `CLINE_BUILD_ENV` - Runtime build mode for SDK-owned subprocess launches
- `CLINE_DEBUG_HOST` - Host for development inspector listeners (default `127.0.0.1`)
- `CLINE_DEBUG_PORT_BASE` - Base inspector port for development child processes
- `CLINE_TOOL_APPROVAL_MODE` - Approval mode (`desktop` uses file IPC; unset uses terminal prompt)
- `CLINE_TOOL_APPROVAL_DIR` - Directory for desktop approval request/decision files
- `CLINE_LOG_ENABLED` - Set to `0`/`false` to disable runtime file logging
- `CLINE_LOG_LEVEL` - Runtime log level (`trace|debug|info|warn|error|fatal|silent`, default `info`)
- `CLINE_LOG_PATH` - Runtime log file path (default `<CLINE_DATA_DIR>/logs/cline.log`)
- `CLINE_LOG_NAME` - Logger name embedded in runtime log records

`--key` takes precedence over environment variables.

## Certificate trust

The CLI trusts your operating system's certificate store, so it works behind corporate TLS-inspecting proxies and with self-signed or internal endpoints without any setup. The binary bundled with Segra Desktop is built with this enabled.

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local development setup, monorepo structure, and TUI architecture. See [DISTRIBUTION.md](./DISTRIBUTION.md) for how the CLI is packaged and distributed.

## License

Segra CLI is based on [Cline](https://github.com/cline/cline), licensed under [Apache 2.0 © Cline Bot Inc.](https://github.com/cline/cline/blob/main/LICENSE)
