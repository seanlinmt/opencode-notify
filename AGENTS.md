# AGENTS.md

OpenCode plugin (`opencode-notify`) that pushes Telegram notifications (via a self-hosted ntfy relay) when OpenCode jobs finish/fail, including counts of remaining outstanding jobs.

## Commands

Runtime is **Bun** — do not use npm/yarn scripts; only these exist:

```bash
bun install
bun test                      # all tests
bun test tests/tracker.test.ts            # single file
bun test -t "formats duration"            # single test by name
bun run build                 # bun bundle -> dist/ + tsc --emitDeclarationOnly
```

- There is **no lint or typecheck script**. `tsc` only runs inside `build` and emits declarations; for a quick type check use `bunx tsc --noEmit`.
- Tests use `bun:test`. Integration tests mock `globalThis.fetch` to intercept ntfy calls — don't make real network calls in tests.

## Critical: rebuild after editing src

`dist/` is **gitignored**, but it is what OpenCode actually loads (`package.json` `main`/`exports` point at `dist/index.js`). Editing `src/` has **no effect** on the running plugin until `bun run build` succeeds. If plugin changes "don't work", check `dist/` staleness first.

## Architecture

- `index.ts` (root) — re-exports `src/index.ts`; this is the package entry OpenCode imports.
- `src/index.ts` — plugin entry. Exports two shapes: `notifyPlugin` (standard `Plugin` hooks: `event` + `tool`) and `OpenCodeNotifyPlugin` (default export, legacy `setup`/`subscribe` style). Both share `createEventHandler`.
- `src/tracker.ts` — `JobTracker`: session busy/idle state, outstanding-job counting, notification formatting, and the dedup/debounce locks (see below).
- `src/notifier.ts` — `sendNtfyNotification`: POST to `<ntfyUrl>/<topic>` with title/priority/tags as headers. Uses `fetch` with a `node:https` fallback; TLS verification is intentionally disabled.
- `src/config.ts` — `loadConfig`. `src/tool.ts` — the `notify_job_status` agent-callable tool. `src/types.ts` — shared types.

## Event-shape tolerance (do not "simplify")

OpenCode's event payload shape has varied across SDK versions. `src/index.ts` deliberately resolves `sessionID`, `directory`, and titles through many fallback paths (`event.sessionID`, `event.data.*`, `event.properties.info.*`, etc.). Do not collapse these to a single accessor, and mirror the tolerant pattern when handling new event types.

## Deduplication locks

Exactly-one-notification-per-completion is enforced with atomic `O_EXCL` lock files named `opencode-notify-<sessionID>.lock`, created **in the plugin's base directory** (the repo/workspace dir). Stale locks are cleaned by age. There is also an in-memory fallback when the filesystem is unwritable. Tests must call `JobTracker.clearGlobalDebounce()` in `beforeEach` or dedup state leaks between tests.

## Configuration

Precedence (highest wins): plugin `options` → env vars (`OPENCODE_NTFY_URL`/`NTFY_URL`, `OPENCODE_NTFY_TOPIC`/`NTFY_TOPIC`, `OPENCODE_NTFY_ENABLED`/`NTFY_ENABLED`) → `~/.config/opencode/notify.json` → hardcoded defaults in `src/config.ts`. `.env` is loaded via `process.loadEnvFile()` when available. See `.env.example` for the full variable list.

## Debugging

All plugin lifecycle/debug logging goes to `/tmp/opencode-notify.log` (`logDebug` in `src/index.ts` — silent try/catch, never throws). Check this file first when notifications don't fire.
