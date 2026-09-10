# VIGAN LLM Provider Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give VIGAN's two LLM call sites (`VIGAN Agent Core`, the email-importance classifier) a clean failure message instead of crashing/hanging when the LLM provider fails. Originally scoped as 3-provider automatic failover (Bedrock/Anthropic/OpenRouter) — both Bedrock and OpenRouter were deferred after hitting real blockers during implementation (see `docs/superpowers/specs/2026-09-09-vigan-multi-provider-llm-design.md`, amended 2026-09-10). Current scope: single-provider Anthropic, with retry-then-clean-error-message behavior.

**Architecture:** Each LLM call site is an AI Agent (or Basic LLM Chain) node with Retry On Fail = 1 and On Error = Continue Using Error Output, wired to a terminal Set node that produces a clear failure message in the same output shape as the success path.

**Tech Stack:** n8n editor UI (AI Agent, Basic LLM Chain, Set/"Edit Fields", Anthropic Chat Model, Call n8n Workflow Tool, Simple Memory nodes), Anthropic API.

## Global Constraints

- Single provider (Anthropic) for both call sites in this pass — Bedrock and OpenRouter are deferred, not built. (spec amendment 2026-09-10)
- Each provider node retries once (Max Tries = 2 total attempts) before producing the failure message. (spec: "Current scope")
- The system prompt (Agent Core) and the classification prompt (email classifier, once built) each live once, in a single Set node (`Load Config`) per workflow, referenced by expression — not pasted inline into the AI Agent/LLM Chain node. (spec: "Architecture")
- Expressions needing `sessionId`/`message` must reference the trigger node **by name** (`{{$('When Executed by Another Workflow').item.json.message}}`), not assume pass-through from `Load Config` — n8n's Set node only keeps the fields it explicitly sets. (spec: "Implementation notes")
- The `read_project` Tool node requires an explicit Workflow Input Schema (5 fields on the target trigger, mapped via `$fromAI()`) — the target trigger cannot be left on default "Accept All Data" passthrough. (spec: "Implementation notes")
- `vigan/cli.js` always exits 0 (fixed during this pass — see commit `4b5ad5435b`) since n8n's Execute Command node doesn't reliably pass stdout through on a non-zero exit.
- Every workflow invoked as a sub-workflow (`VIGAN Tool - Project Reader`, `VIGAN Agent Core`) must be **Published** in the n8n editor, not left inactive — contrary to the original Phase 1 plan's assumption. n8n 2.x also requires `NODES_EXCLUDE=[]` (User-scope env var) plus a full terminal-app restart before the Execute Command node is even available to build with.
- Phase 1 remains strictly read-only — nothing in this plan adds write/execute capability. (spec parent doc: `docs/superpowers/specs/2026-09-08-vigan-design.md`)

**Depends on:** `VIGAN Tool - Project Reader` (original plan Task 6) must exist and be Published before Task 2 below.

---

### Task 1: Create the Anthropic (and OpenRouter, for later) credentials — ✅ done

- [x] `Anthropic - VIGAN` (Anthropic API credential) — created and in active use.
- [x] `OpenRouter - VIGAN` (OpenAI API credential, Base URL `https://openrouter.ai/api/v1`) — created but not currently wired into any workflow (OpenRouter deferred). Note for later: prefer n8n's native `OpenRouter` credential type + `OpenRouter Chat Model` node over this generic one if/when OpenRouter is revisited.
- [ ] Update `docs/vigan/setup.md`'s credentials section to note OpenRouter is created-but-unused and Bedrock is deferred (currently still describes the originally-planned 2-provider setup).

---

### Task 2: `VIGAN Tool - Project Reader` — ✅ done

Built per the original Phase 1 plan's Task 6, with two corrections learned during implementation:

- [x] Trigger, `Build CLI Command`, `Run CLI` (Execute Command), `Parse CLI Output` nodes built and wired.
- [x] **Correction:** the trigger's Input Source was changed from "Accept All Data" to explicit fields (`action`, `projectName`, `subpath`, `pattern`, `limit` — all String except `limit` as Number), because `Call n8n Workflow Tool` derives its Workflow Input Schema from the target trigger's defined fields, and without them the AI Agent's tool calls arrived with `action: undefined`.
- [x] **Correction:** `vigan/cli.js`'s `fail()` no longer sets `process.exitCode = 1` (always exits 0) — required for `Run CLI`'s Execute Command node to pass stdout through on error cases; `vigan/__tests__/cli.test.js` updated to match (commit `4b5ad5435b`).
- [x] Workflow **Published** (not left inactive — n8n 2.x requires this for `Call n8n Workflow Tool`/`Execute Workflow` invocations to work).

---

### Task 3: `VIGAN Agent Core` — Anthropic branch with clean failure message — ✅ done

**Depends on:** Task 1, Task 2.

**Interfaces:**
- Consumes: `Anthropic - VIGAN` credential, `VIGAN Tool - Project Reader` workflow.
- Produces: `VIGAN Agent Core` workflow, callable via Execute Workflow with input `{sessionId, message}`, producing `{reply}` on either `Format Reply` (success) or `Agent Unavailable` (Anthropic failed after 1 retry) — both produce the same `reply` field shape, so `VIGAN - Chat`/`VIGAN - Slack` (original plan Tasks 8–9, not yet built) don't need to know which path fired.

- [x] **Step 1:** Trigger node (`When Executed by Another Workflow`), Input Source left at default (unlike the Tool Reader workflow — no explicit fields needed here since this trigger is only ever called by Chat/Slack with a fixed `{sessionId, message}` shape, not by an AI-decided tool call).
- [x] **Step 2:** `Load Config` Set node — one field, `systemPrompt`, holding the VIGAN system prompt text (unchanged from the original Task 7 Step 2).
- [x] **Step 3:** `Agent - Anthropic` AI Agent node:
  - Prompt (User Message): dropdown set to "Define below" → `{{$('When Executed by Another Workflow').item.json.message}}`
  - System Message (added via the node's "Add Option"): `{{$('Load Config').item.json.systemPrompt}}`
- [x] **Step 4:** Anthropic Chat Model sub-node — credential `Anthropic - VIGAN`, model Claude Sonnet 5.
- [x] **Step 5:** Simple Memory sub-node — Session ID dropdown set to "Define below" → Key: `{{$('When Executed by Another Workflow').item.json.sessionId}}`, Context Window Length 20.
- [x] **Step 6:** `read_project` Call n8n Workflow Tool sub-node — Name `read_project`, Description explaining the 7 actions (unchanged text from original Task 7 Step 5, plus an added note: "you must always include all five fields... pass empty string/0 if not applicable" — added after discovering the required-fields issue described in Task 2's corrections above applies to tool-call arguments generally, not just this specific workflow), Source: Database, Workflow: `VIGAN Tool - Project Reader`, Workflow Inputs mapped via `$fromAI()` for all 5 fields.
- [x] **Step 7:** `Agent - Anthropic` node Settings: Retry On Fail = On, Max Tries = 2, On Error = Continue Using Error Output.
- [x] **Step 8:** `Format Reply` Set node — field `reply` = `{{$json.output}}`. Connected from `Agent - Anthropic`'s success output.
- [x] **Step 9:** `Agent Unavailable` Set node — field `reply` = `VIGAN's AI backend is unavailable right now: {{$json.error?.message || $json.error || 'unknown error'}}`. Connected from `Agent - Anthropic`'s error output.
- [x] **Step 10:** Manually verified: normal operation returns a correct reply listing all registry projects; a forced Anthropic auth failure (temporarily invalid API key) correctly produces the `Agent Unavailable` message instead of a crash; restoring the valid key returns to normal operation.
- [x] **Step 11:** Workflow **Published**.

---

### Task 4: `VIGAN - Email Watcher` — classifier with clean failure handling (not yet built)

**Depends on:** Task 1 (Anthropic credential), a Gmail OAuth2 credential scoped to `gmail.readonly` and the Slack bot credential (original plan Task 11 Steps 5 and 7 — not yet built).

**Interfaces:**
- Consumes: `Anthropic - VIGAN` credential; Gmail and Slack credentials.
- Produces: `VIGAN - Email Watcher` workflow, matching the original plan's Task 10 externally (Schedule Trigger → Gmail → classify → alert), with the classify step using the single-provider-with-retry pattern rather than a multi-provider chain.

- [ ] **Step 1: Create the workflow and trigger**

Create a new workflow named `VIGAN - Email Watcher`. Add a **Schedule Trigger** node, Interval: every 15 minutes.

- [ ] **Step 2: Fetch recent unread mail (read-only)**

Add a **Gmail** node `Get Recent Mail`:
- **Credential**: `Gmail - VIGAN Read Only`
- **Operation**: Get Many (Messages)
- **Filters/Query**: `is:unread newer_than:1d`
- Leave "Mark as Read" (or equivalent) **off**.

- [ ] **Step 3: Add the `Load Classification Prompt` node**

Add a **Set** node named `Load Classification Prompt` after `Get Recent Mail`, with one string field:

- `classificationPrompt` =

```
You are triaging email for urgency. Given the subject and snippet below, respond with strict JSON only, no other text: {"important": true or false, "reason": "<one short sentence>"}.

Subject: {{$json.subject}}
Snippet: {{$json.snippet}}
From: {{$json.from}}
```

- [ ] **Step 4: Add the classify node**

Add a **Basic LLM Chain** node named `Classify - Anthropic`, with Prompt: `{{$('Load Classification Prompt').item.json.classificationPrompt}}`. Attach an **Anthropic Chat Model** sub-node: credential `Anthropic - VIGAN`, model Claude Sonnet 5.

Open `Classify - Anthropic`'s node Settings: **Retry On Fail**: On, **Max Tries**: `2`, **On Error**: `Continue Using Error Output`.

- [ ] **Step 5: Add `Parse Classification` (fails closed, unchanged from the original plan)**

Add a **Code** node `Parse Classification`, JavaScript, "Run Once for Each Item":

```js
const raw = $input.item.json.text || $input.item.json.output || '';
try {
  const parsed = JSON.parse(raw);
  return { important: Boolean(parsed.important), reason: String(parsed.reason || '') };
} catch {
  return { important: false, reason: 'classification unparsable, defaulting to not important' };
}
```

- [ ] **Step 6: Wire the classify chain**

Connect: `Get Recent Mail` → `Load Classification Prompt` → `Classify - Anthropic` (success) → `Parse Classification`.
Connect: `Classify - Anthropic` (error) → `Parse Classification` (the same node — its input will be an error-shaped item with no `text`/`output` field, which the existing try/catch already handles by defaulting to `{important: false, reason: 'classification unparsable, defaulting to not important'}`).

- [ ] **Step 7: Add the alert branch (unchanged from the original plan)**

Add an **IF** node `Is Important` on `{{$json.important}}` **is true**. On the true branch, add a **Slack** node `Send Alert`:
- **Credential**: `Slack - VIGAN Bot`
- **Channel**: the DM channel with the allow-listed user
- **Text**: `📧 Possibly important email from {{$json.from}}: "{{$json.subject}}" — {{$json.reason}}`

Leave the false branch unconnected.

Connect: `Parse Classification` → `Is Important` → (true) → `Send Alert`.

- [ ] **Step 8: Manually verify normal classification**

Activate/Publish the workflow, or manually execute it, with real unread mail present. Confirm in the execution log that `Classify - Anthropic` handled the classification (no error), and that unimportant mail produces no Slack message while a deliberately urgent-sounding test email does.

- [ ] **Step 9: Manually verify fail-closed behavior**

Temporarily invalidate the `Anthropic - VIGAN` credential and manually execute the workflow again; confirm `Parse Classification` produced `{important: false, reason: 'classification unparsable, defaulting to not important'}` for every email and no Slack alert was sent, rather than the workflow crashing. Restore the valid credential afterward.

- [ ] **Step 10: Publish**

Publish `VIGAN - Email Watcher`.

---

### Task 5: End-to-end validation and final commit

**Depends on:** Tasks 1–4 complete.

- [ ] **Step 1: Re-confirm Agent Core error handling end to end**

Repeat Task 3 Step 10 once more (normal → forced failure → restored), confirming the behavior is stable.

- [ ] **Step 2: Re-confirm Email Watcher fail-closed behavior end to end**

Repeat Task 4 Step 9 once more.

- [ ] **Step 3: Confirm existing chat/Slack behavior is unaffected**

Once `VIGAN - Chat`/`VIGAN - Slack` (original plan Tasks 8–9) exist: ask "what's the status of Product360" and confirm a normal reply — this confirms both only depend on `VIGAN Agent Core`'s `{reply}` output field, unaffected by which internal path produced it.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(vigan): complete single-provider LLM resilience verification"
```

---

## Deferred: adding Bedrock later

See `docs/superpowers/specs/2026-09-09-vigan-multi-provider-llm-design.md`'s "Deferred: adding Bedrock later" section. Summary: create the `Bedrock - VIGAN` AWS credential (with a solved credential-refresh story), enable Bedrock model access for Claude Sonnet, add an `Agent - Bedrock` AI Agent node using the native **AWS Bedrock Chat Model** node, chain it off `Agent - Anthropic`'s error output (ahead of `Agent Unavailable`), reusing the shared Memory/Tool sub-nodes and `Load Config` expression.

## Deferred: adding OpenRouter later

See `docs/superpowers/specs/2026-09-09-vigan-multi-provider-llm-design.md`'s "Deferred: adding OpenRouter later" section. Summary: blocked on either n8n shipping optional-parameter support for `$fromAI()`, or a different integration approach (e.g. a single JSON-encoded argument instead of 5 separate required fields) that avoids the required-fields schema limitation. Prefer n8n's native `OpenRouter` credential type + `OpenRouter Chat Model` node over the generic OpenAI API + Base URL override approach originally planned, if revisited.
