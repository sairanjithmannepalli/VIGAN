# VIGAN — Personal Multi-Agent Assistant (Phase 1: Read-Only)

**Date:** 2026-09-08
**Status:** Approved for planning (Phase 1 scope)
**Owner:** Sai Ranjith Prasad (sairanjith.mannepalli@innovapptive.com)

## Purpose

VIGAN is a personal agent that runs on the user's local machine and lets them:

- Chat interactively (locally, and via Slack) to ask questions about projects stored on the D-drive.
- Receive proactive Slack messages from VIGAN (e.g. important-email alerts).
- Get cross-project summaries (status, recent changes) across all registered D-drive projects.

VIGAN is a single agent/persona — there is no separate "Ganesh" agent; that name was an earlier working name for the same assistant, now renamed to VIGAN throughout (chat and Slack).

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

### 3. Two entry points, one brain

- **Local chat**: n8n's built-in Chat Trigger, serving a local webchat UI, backed by the AI Agent sub-workflow.
- **Slack**: a Slack Trigger (DM / mention) feeding the *same* AI Agent sub-workflow.
- Both share one system prompt defining the VIGAN persona and the same read-only project tool.
- Conversation memory is scoped per source-thread (chat session ID vs. Slack thread), so context does not bleed between the two entry points, using n8n's built-in memory node (e.g. buffer window per session key).

### 4. Slack integration

- A Slack app/bot identity for VIGAN.
- Every inbound Slack event is checked against a single allow-listed Slack user ID (Sai Ranjith Prasad) before VIGAN responds. Messages from anyone else are ignored.
- All outbound/proactive Slack messages (e.g. email alerts, summaries) target that same one recipient only — never a channel, never any other user.

### 5. Email checking (Gmail, read-only)

- A Schedule Trigger polls Gmail on an interval (e.g. every 10–15 minutes) whenever n8n is running.
- Fetches recent/unread mail (read-only — no send/delete/label mutation).
- An AI step classifies importance/urgency.
- If something looks important, VIGAN sends a Slack summary to the one allow-listed recipient; otherwise it stays silent (no notification noise for routine mail).

### 6. Cross-project summaries

On demand (via chat/Slack question) or on a schedule (e.g. daily), VIGAN uses the read-only project tool across some or all registry entries (e.g. `git status` / `git log`) and has the AI Agent synthesize a summary (e.g. "which projects have uncommitted changes", "what changed this week").

## Error handling

- Tool failures (file not found, bad project name, Gmail API error) return a clear error to the AI Agent, which relays a plain-language explanation to the user rather than failing silently.
- Unknown project name → suggest the closest registry match instead of a hard failure.
- Any attempt (by the model or a user request) to write, execute, or mutate is refused by the tool layer itself, not just discouraged by the prompt — the tool must not implement those operations at all in Phase 1.

## Testing / validation plan

- Manually exercise local chat: ask about each registered project (existing one, misspelled one, unregistered path) and confirm correct resolution / refusal behavior.
- Manually exercise Slack: confirm messages from the allow-listed user get responses, and messages from a different Slack user (or a test account) are silently ignored.
- Confirm the read-only tool refuses write/execute attempts (e.g. ask it to "create a file" or "run npm install") and it explains that Phase 1 is read-only rather than attempting the action.
- Confirm the email workflow only fires while the local n8n process is running (turn n8n off, confirm no alerts arrive during that window).
- Confirm cross-project summary output against at least 2–3 projects with known git state (e.g. one with uncommitted changes, one clean).

## Phase 2 (explicitly out of scope for this spec — parked for later design)

- Write/edit files in projects.
- Run scripts, builds, tests.
- Git-mutating operations (commit, push, reset, etc.), likely via delegating to the Claude Code CLI in headless mode (`claude -p "<task>" --cwd "<project path>"`) scoped to one project directory at a time.
- A confirmation-gate flow: read/summarize/answer freely with no confirmation, but require an explicit Slack/chat confirmation before any destructive or mutating action.
- Possibly expanding Slack beyond the single allow-listed recipient.

This phase will get its own brainstorming/design pass once Phase 1 is built and trusted in daily use.
