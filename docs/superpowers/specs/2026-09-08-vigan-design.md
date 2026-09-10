# VIGAN — Personal Multi-Agent Assistant (Phase 1: Read-Only)

**Date:** 2026-09-08 (amended 2026-09-10)
**Status:** Approved for planning (Phase 1 scope)
**Owner:** Sai Ranjith Prasad (sairanjith.mannepalli@innovapptive.com)

> **Amendment (2026-09-10): Slack dropped from Phase 1 scope.** n8n's Slack Trigger requires a classic webhook — a public HTTPS URL Slack's servers can reach — rather than Socket Mode, which the user's local n8n instance doesn't have. Two attempts were made to add a tunnel: (1) using the user's company Slack workspace was ruled out over visibility/policy concerns, so a private personal Slack workspace was created instead; (2) ngrok was installed to provide the tunnel, but its executable was blocked from running by the machine's corporate endpoint security policy (this is a domain-joined company machine) even after updating to the latest version — the block presented as "Access is denied" with no Mark-of-the-Web flag and correct file permissions, consistent with an EDR/AppLocker-style block rather than a config issue. A Cloudflare Tunnel (`cloudflared`) alternative was also attempted but its installer required interactive UAC elevation not available in the session. Given two independent tunnel tools were blocked, this is treated as a **blanket policy against tunneling executables on this machine**, not a tool-specific fix — worth confirming with IT before attempting a third alternative. Slack integration (Component 4 below) and the Slack entry point (part of Component 3) are dropped, not merely deferred; all Slack-related n8n credentials/workflows and the `VIGAN_SLACK_ALLOWED_USER_ID` env var were rolled back (twice). VIGAN is chat-only for the foreseeable future. Component 5 (email checking) is **not blocked by this** — Gmail polling is outbound-only (n8n calls Google's API on a schedule; nothing needs to reach back into the machine) — but its alert step needs redesigning to not depend on Slack (e.g. an email-to-self alert) since it currently assumes Slack is available.

## Purpose

VIGAN is a personal agent that runs on the user's local machine and lets them:

- Chat interactively (locally) to ask questions about projects stored on the D-drive. (Slack dropped — see amendment above.)
- Get cross-project summaries (status, recent changes) across all registered D-drive projects.

VIGAN is a single agent/persona — there is no separate "Ganesh" agent; that name was an earlier working name for the same assistant, now renamed to VIGAN throughout.

Phase 1 is strictly **read-only**: VIGAN can read files, read git metadata, and read Gmail. It cannot write files, run scripts/builds/tests, or perform any mutating operation (git commits/pushes, file edits, email send/delete/label). Write/execute capability is explicitly deferred to Phase 2 (see below).

## Platform

Self-hosted **n8n**, run locally (e.g. started at Windows login), using the n8n checkout already present at `D:\Ai Projects\n8n\n8n`. Running locally rather than as a cloud/always-on service is what satisfies "only checks email when the system is awake" — when the machine is off or asleep, the n8n process is not running, so the schedule trigger simply does not fire. No separate wake-detection logic is required.

## Components

### 1. Project Registry

A config file (e.g. `projects.json`) living alongside the VIGAN workflows, listing every D-drive project VIGAN is allowed to look at:

| Project | Path |
|---|---|
| n8n | `D:\Ai Projects\n8n` |
| aiplay_project | `D:\Ai Projects\aiplay_project` |
| De-duplication | `D:\Ai Projects\De-duplication` |
| DevLinguist | `D:\Ai Projects\DevLinguist` |
| GitWorkSpace | `D:\Ai Projects\GitWorkSpace` |
| HACK | `D:\Ai Projects\HACK` |
| Meeting Assist | `D:\Ai Projects\Meeting Assist` |
| Product360 | `D:\Ai Projects\Product360` |
| SPCC | `D:\Ai Projects\SPCC` |
| Vibe Coding Projects | `D:\Ai Projects\Vibe Coding Projects` |
| unified_app | `D:\unified_app` |

The registry is the only source of truth for "which project" a name refers to. When the user names a project ("what's the status of Product360"), the agent resolves the name to a path via this file rather than guessing. Unknown names produce a "closest match" suggestion rather than a hard error. Adding a new project later means adding a row to this file — no workflow changes required.

### 2. Read-only project tool

A single n8n tool (exposed to the AI Agent node) that can, only within registry paths:

- List a directory
- Read a file
- Search/grep file contents
- Run read-only git commands: `git status`, `git log`, `git diff`

It must refuse any path outside the registry's listed roots, and must not expose any write/execute capability (no arbitrary shell execution, no file write, no git mutation commands).

### 3. One entry point, one brain

- **Local chat**: n8n's built-in Chat Trigger, serving a local webchat UI, backed by the AI Agent sub-workflow.
- Uses one system prompt defining the VIGAN persona and the read-only project tool.
- Conversation memory is scoped per chat session ID, using n8n's built-in memory node (buffer window per session key).
- (Originally two entry points including Slack — dropped, see amendment above.)

### 4. Slack integration — dropped (see amendment above)

### 5. Email checking (Gmail, read-only)

- A Schedule Trigger polls Gmail on an interval (e.g. every 10–15 minutes) whenever n8n is running. This is outbound-only (n8n calling Google's API), so it is unaffected by the Slack tunnel blocker above.
- Fetches recent/unread mail (read-only — no send/delete/label mutation).
- An AI step classifies importance/urgency.
- If something looks important, VIGAN sends an alert to the user — originally designed as a Slack message; since Slack is dropped, this needs redesigning (e.g. an email-to-self alert) before this component is built. Otherwise it stays silent (no notification noise for routine mail).

### 6. Cross-project summaries

On demand (via chat/Slack question) or on a schedule (e.g. daily), VIGAN uses the read-only project tool across some or all registry entries (e.g. `git status` / `git log`) and has the AI Agent synthesize a summary (e.g. "which projects have uncommitted changes", "what changed this week").

## Error handling

- Tool failures (file not found, bad project name, Gmail API error) return a clear error to the AI Agent, which relays a plain-language explanation to the user rather than failing silently.
- Unknown project name → suggest the closest registry match instead of a hard failure.
- Any attempt (by the model or a user request) to write, execute, or mutate is refused by the tool layer itself, not just discouraged by the prompt — the tool must not implement those operations at all in Phase 1.

## Testing / validation plan

- Manually exercise local chat: ask about each registered project (existing one, misspelled one, unregistered path) and confirm correct resolution / refusal behavior. **(Done 2026-09-10 — see `VIGAN - Chat` in the phase 1 plan.)**
- ~~Manually exercise Slack~~ — dropped, see amendment above.
- Confirm the read-only tool refuses write/execute attempts (e.g. ask it to "create a file" or "run npm install") and it explains that Phase 1 is read-only rather than attempting the action.
- Confirm the email workflow only fires while the local n8n process is running (turn n8n off, confirm no alerts arrive during that window).
- Confirm cross-project summary output against at least 2–3 projects with known git state (e.g. one with uncommitted changes, one clean).

## Phase 2 (explicitly out of scope for this spec — parked for later design)

- Write/edit files in projects.
- Run scripts, builds, tests.
- Git-mutating operations (commit, push, reset, etc.), likely via delegating to the Claude Code CLI in headless mode (`claude -p "<task>" --cwd "<project path>"`) scoped to one project directory at a time.
- A confirmation-gate flow: read/summarize/answer freely with no confirmation, but require an explicit chat confirmation before any destructive or mutating action.
- Slack integration, if ever revisited, would need IT to allow a tunneling tool on this machine (or a hosted/cloud n8n instance instead of local) — see the 2026-09-10 amendment above.

This phase will get its own brainstorming/design pass once Phase 1 is built and trusted in daily use.
