# OpenCode Push Notification Plugin (`opencode-notify`)

An OpenCode plugin that sends push notifications to Telegram when an OpenCode job finishes or fails, and reports the number of outstanding jobs remaining.

It routes push events through your self-hosted **ntfy** instance, which is relayed directly to Telegram via a dedicated bridge container.

---

## Architecture

```
┌─────────────────────────────────┐
│        OpenCode (Client)        │
│  - opencode-notify plugin       │
│  - Tracks session lifecycles    │
│  - Calculates outstanding jobs  │
└────────────────┬────────────────┘
                 │ HTTP POST /opencode-jobs
                 ▼
┌─────────────────────────────────┐
│     Remote Host (Docker)        │
│  - ntfy container               │
│  - Topic: opencode-jobs         │
└────────────────┬────────────────┘
                 │ SSE / JSON stream
                 ▼
┌─────────────────────────────────┐
│     Remote Host (Docker)        │
│  - ntfy-telegram-bridge         │
│  - Telegram Bot API             │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│        Telegram App             │
│  - Push notifications           │
│  - Job duration & status        │
│  - Outstanding jobs remaining   │
└─────────────────────────────────┘
```

---

## Components Deployed

### 1. `ntfy-telegram-bridge`
- **Location:** `/opt/ntfy-telegram-bridge/`
- **Container:** `ntfy-telegram-bridge` (`python:3-alpine`, `restart: unless-stopped`, `network_mode: host`)
- **Service file:** `/opt/ntfy-telegram-bridge/compose.yaml`
- **Bridge script:** `/opt/ntfy-telegram-bridge/bridge.py`
- **Telegram Bot:** Configured bot token via `@BotFather`
- **Target Chat ID:** Configured for your Telegram chat ID
- **Function:** Streams messages published to ntfy's `opencode-jobs` topic and forwards them with formatted HTML to Telegram.

### 2. OpenCode Plugin (`opencode-notify`)
- **Location:** `/path/to/opencode-notify`
- **Registration:** Configured in `~/.config/opencode/opencode.json` under `"plugins"`:
  ```json
  "plugins": [
    "/path/to/opencode-notify"
  ]
  ```
- **Configuration File:** `~/.config/opencode/notify.json`
  ```json
  {
    "ntfyUrl": "https://ntfy.example.com",
    "topic": "opencode-jobs",
    "enabled": true,
    "notifyOnSuccess": true,
    "notifyOnError": true
  }
  ```
- **Environment Variables / `.env`:**
  A [.env.example](file:///Users/sean/projects/opencode-notify/.env.example) template is provided. Variables can be placed in [.env](file:///Users/sean/projects/opencode-notify/.env) (ignored by git):
  ```ini
  OPENCODE_NTFY_URL=https://ntfy.example.com
  OPENCODE_NTFY_TOPIC=opencode-jobs
  OPENCODE_NTFY_ENABLED=true
  NTFY_URL=https://127.0.0.1:18080
  NTFY_TOPIC=opencode-jobs
  NTFY_SSL_VERIFY=false
  TELEGRAM_BOT_TOKEN=...
  TELEGRAM_CHAT_ID=...
  ```

---

## Features

1. **Automatic Lifecycle Tracking:**
   - Hooks into OpenCode's event stream (`session.execution.started`, `session.execution.succeeded`, `session.step.started`, `session.idle`, `session.error`).
   - Tracks when sessions become busy and when they complete.
   - Calculates execution duration.

2. **Outstanding Jobs Calculation:**
   - On completion of a job, scans active sessions to count how many other jobs are currently still running.
   - If other jobs are running, lists them with their elapsed times.
   - If no other jobs are running, reports `Outstanding Jobs Remaining: 0 (All jobs complete 🎉)`.

3. **OS-Level Atomic Deduplication:**
   - OpenCode runs plugins across multiple workspace instances simultaneously.
   - The plugin uses atomic filesystem lock acquisition (`O_EXCL`) to ensure exactly **one** push notification is dispatched per job completion.

4. **Built-in Tool (`notify_job_status`):**
   - In addition to automated background hooks, the plugin exposes an OpenCode tool callable by agents:
     ```typescript
     tools.notify_job_status({
       message: "Finished generating database schema",
       title: "Database Update",
       status: "completed" // or "failed", "in_progress", "info"
     })
     ```

---

## Verification & Commands

### Test the bridge manually:
```bash
curl -k -d $'Job: Test Run\nStatus: Completed ✅\nDuration: 12s\n\nOutstanding Jobs Remaining: 0 (All jobs complete 🎉)' \
  -H "Title: OpenCode Job Finished: Manual Test" \
  -H "Tags: white_check_mark,opencode" \
  https://<NTFY_ENDPOINT>/opencode-jobs
```

### Inspect the bridge service:
```bash
docker logs -n 20 ntfy-telegram-bridge
```

### Restart OpenCode background service:
```bash
opencode service restart
```

---

## License

[MIT](LICENSE)

