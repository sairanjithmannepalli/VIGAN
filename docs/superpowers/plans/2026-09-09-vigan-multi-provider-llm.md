# VIGAN Multi-Provider LLM Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace VIGAN's single hardcoded Anthropic credential with automatic failover across three providers (Bedrock → Anthropic → OpenRouter) in both the `VIGAN Agent Core` chat/Slack brain and the email-importance classifier.

**Architecture:** Each LLM call site becomes a sequential error-output chain of provider-specific nodes (AI Agent nodes for Agent Core, Basic LLM Chain nodes for the classifier), each configured to retry once then hand off to the next provider on failure, sharing one system-prompt/prompt-text source, one Memory node, and one Tool node so nothing drifts out of sync between providers.

**Tech Stack:** n8n editor UI (AI Agent, Basic LLM Chain, Set, AWS Bedrock Chat Model, Anthropic Chat Model, OpenAI Chat Model nodes), AWS Bedrock, Anthropic API, OpenRouter (OpenAI-compatible API).

## Global Constraints

- Provider failover order is fixed: Bedrock → Anthropic → OpenRouter. (spec: "Provider priority and models")
- Each provider node retries once (Max Tries = 2 total attempts) before failing over to the next provider. (spec: "Provider priority and models")
- The system prompt (Agent Core) and the classification prompt (email classifier) each live once, in a single Set node per workflow, referenced by expression from every provider branch — never pasted three times. (spec: "Architecture" sections)
- The Memory node (Window Buffer Memory) and the `read_project` Tool node in Agent Core are each a single shared sub-node whose output fans out to all three AI Agent nodes — never duplicated per provider. (spec: "Architecture: VIGAN Agent Core")
- OpenRouter is wired through the generic "OpenAI Chat Model" node with its credential's Base URL overridden to `https://openrouter.ai/api/v1` — there is no dedicated OpenRouter node in n8n. (spec: "Credentials")
- If all three providers fail, the email classifier's existing `Parse Classification` node already fails closed (`important: false`) — no changes needed to that node. (spec: "Architecture: email classifier")
- This plan builds entirely inside the n8n editor UI (plus one credential in the AWS console); there are no workflow source files for this in the repo, matching the original Phase 1 plan's own note. (spec parent doc, plan: `docs/superpowers/plans/2026-09-08-vigan-phase1.md`)
- Phase 1 remains strictly read-only — nothing in this plan adds write/execute capability. (spec parent doc: `docs/superpowers/specs/2026-09-08-vigan-design.md`)

**Depends on:** `VIGAN Tool - Project Reader` (original plan Task 6) must exist before Task 2 below, since the AI Agent nodes built here attach to it as their tool.

---

### Task 1: Create the three LLM provider credentials

**Files:**
- Modify: `docs/vigan/setup.md`

**Interfaces:**
- Consumes: nothing
- Produces: three n8n credentials — `Bedrock - VIGAN` (AWS), `Anthropic - VIGAN` (Anthropic API), `OpenRouter - VIGAN` (OpenAI API, Base URL overridden) — consumed by name in Tasks 2–5.

- [ ] **Step 1: Create the `Bedrock - VIGAN` credential**

In the n8n editor: Credentials → New → search "AWS" → fill in Access Key ID, Secret Access Key, and Region (the AWS region where you will enable Bedrock model access in Step 2). Save as `Bedrock - VIGAN`.

- [ ] **Step 2: Enable Bedrock model access for Claude Sonnet**

In the AWS Console, go to Bedrock → Model access, in the same region as the credential above, and request/enable access for the Claude Sonnet model. Wait until the console shows "Access granted" before doing Task 2 — the AI Agent node's Bedrock model dropdown in Task 2 only lists models your account has been granted access to.

- [ ] **Step 3: Create the `Anthropic - VIGAN` credential**

In the n8n editor: Credentials → New → "Anthropic API" → paste your Anthropic API key. Save as `Anthropic - VIGAN`. (Skip this step if it already exists from the original Phase 1 plan's Task 11 Step 6.)

- [ ] **Step 4: Create the `OpenRouter - VIGAN` credential**

In the n8n editor: Credentials → New → search "OpenAI" → select "OpenAI API" → paste your OpenRouter API key into the API Key field → open the credential's additional/advanced options and set **Base URL** to `https://openrouter.ai/api/v1`. Save as `OpenRouter - VIGAN`.

- [ ] **Step 5: Update the setup doc**

Edit `docs/vigan/setup.md`, replacing the existing line:

```
5. Anthropic credential: `Anthropic - VIGAN`
```

with:

```
5. LLM provider credentials (failover order: Bedrock → Anthropic → OpenRouter):
   - `Bedrock - VIGAN` (AWS credential; requires Bedrock model access enabled for Claude Sonnet in the AWS Console)
   - `Anthropic - VIGAN` (Anthropic API credential)
   - `OpenRouter - VIGAN` (OpenAI API credential with Base URL overridden to `https://openrouter.ai/api/v1`)
```

- [ ] **Step 6: Commit**

```bash
git add docs/vigan/setup.md
git commit -m "docs(vigan): add multi-provider LLM credential setup steps"
```

---

### Task 2: `VIGAN Agent Core` — workflow skeleton and the Bedrock (primary) branch

**Depends on:** Task 1 (credentials), and `VIGAN Tool - Project Reader` (original plan Task 6) already existing.

**Files:** none (n8n editor UI only)

**Interfaces:**
- Consumes: `Bedrock - VIGAN` credential (Task 1), `VIGAN Tool - Project Reader` workflow (original plan Task 6)
- Produces: `VIGAN Agent Core` workflow, callable via Execute Workflow with input `{sessionId, message}`, producing `{reply}` on its `Format Reply` node — this is what original plan Tasks 8 and 9 (`VIGAN - Chat`, `VIGAN - Slack`) already expect, unchanged.

- [ ] **Step 1: Create the workflow and trigger**

Create a new workflow named `VIGAN Agent Core`. Add an **Execute Workflow Trigger** node with input fields `sessionId` and `message`.

- [ ] **Step 2: Add the `Load Config` node**

Add a **Set** node named `Load Config` after the trigger, with one string field:

- `systemPrompt` =

```
You are VIGAN, a personal read-only assistant for Sai Ranjith Prasad. You can answer questions about the projects listed in the project registry by using the `read_project` tool. You must never claim to write files, run scripts, execute builds/tests, or make any git-mutating change — this is a Phase 1 read-only assistant. If asked to do any of those things, explain clearly that write/execute capability is planned for a future phase and is not available yet. When a project name given by the user does not match any known project, tell them the closest match you found (the tool will tell you) or list the known project names. Keep answers concise and specific, quoting relevant file paths, git status lines, or commit messages you retrieved via the tool rather than guessing.
```

- [ ] **Step 3: Add the Bedrock AI Agent node**

Add an **AI Agent** node named `Agent - Bedrock`. Set:
- **Prompt / Text**: `{{$json.message}}`
- **System Message**: `{{$('Load Config').item.json.systemPrompt}}`

- [ ] **Step 4: Add the Bedrock chat model**

Add an **AWS Bedrock Chat Model** sub-node (search the node panel for "Bedrock") attached to `Agent - Bedrock`'s Model input. Credential: `Bedrock - VIGAN`. Model: select the Claude Sonnet entry from the dropdown (populated from your AWS account's enabled Bedrock models per Task 1 Step 2).

- [ ] **Step 5: Add the shared Memory sub-node**

Add a **Window Buffer Memory** sub-node attached to `Agent - Bedrock`'s Memory input. Session Key: `{{$json.sessionId}}`. Context Window Length: `20`.

- [ ] **Step 6: Add the shared Tool sub-node**

Add a **Call n8n Workflow Tool** sub-node attached to `Agent - Bedrock`'s Tool input. Configure:
- **Name**: `read_project`
- **Description**:

```
Read-only access to a fixed set of local projects. Actions: list-projects (no args), list-dir (projectName, subpath), read-file (projectName, subpath), search (projectName, subpath, pattern — regex, searches file contents line by line), git-status (projectName), git-log (projectName, limit), git-diff (projectName). Always call list-projects first if you are unsure of the exact project name. This tool cannot write, execute, or modify anything.
```

- **Workflow**: `VIGAN Tool - Project Reader`
- **Input schema**: a JSON schema with fields `action` (string, required), `projectName` (string), `subpath` (string), `pattern` (string), `limit` (number).

- [ ] **Step 7: Set retry-then-failover behavior on `Agent - Bedrock`**

Open `Agent - Bedrock`'s node Settings (three-dot menu → Settings). Set **Retry On Fail**: On, **Max Tries**: `2`. Set **On Error**: `Continue Using Error Output`.

- [ ] **Step 8: Add `Format Reply` and wire the success path**

Add a **Set** node named `Format Reply` with one field: `reply` = `{{$json.output}}` (the AI Agent node's default output field is `output`; if your n8n version names it differently, check the node's output panel after Step 9's test run and adjust this expression to match).

Connect: Execute Workflow Trigger → Load Config → Agent - Bedrock (success/main output) → Format Reply.

- [ ] **Step 9: Manually verify the Bedrock branch**

Test the workflow with pinned input `{"sessionId": "test-1", "message": "list the projects you know about"}` and confirm `Format Reply` outputs `{"reply": "..."}` naming all registry projects.

- [ ] **Step 10: Save**

Save as `VIGAN Agent Core`. Leave it inactive (only invoked as a sub-workflow, per the original plan's Task 7 Step 8).

---

### Task 3: `VIGAN Agent Core` — Anthropic fallback branch

**Depends on:** Task 2.

**Interfaces:**
- Consumes: `Anthropic - VIGAN` credential (Task 1), the `Load Config`, Memory, and Tool sub-nodes from Task 2.
- Produces: `Agent - Bedrock`'s error output now routes into a second provider attempt instead of dead-ending.

- [ ] **Step 1: Add the Anthropic AI Agent node**

Add an **AI Agent** node named `Agent - Anthropic`. Set:
- **Prompt / Text**: `{{$json.message}}`
- **System Message**: `{{$('Load Config').item.json.systemPrompt}}`

- [ ] **Step 2: Add the Anthropic chat model**

Add an **Anthropic Chat Model** sub-node attached to `Agent - Anthropic`'s Model input. Credential: `Anthropic - VIGAN`. Model: the current Claude Sonnet 5 entry in your credential's model list.

- [ ] **Step 3: Reuse the shared Memory and Tool sub-nodes**

Connect the *same* Window Buffer Memory sub-node from Task 2 Step 5 to `Agent - Anthropic`'s Memory input, and the *same* Call n8n Workflow Tool sub-node from Task 2 Step 6 to `Agent - Anthropic`'s Tool input (n8n lets one sub-node's output fan out to multiple main nodes — do not create new Memory/Tool sub-nodes here).

- [ ] **Step 4: Set retry-then-failover behavior on `Agent - Anthropic`**

Open `Agent - Anthropic`'s node Settings. Set **Retry On Fail**: On, **Max Tries**: `2`. Set **On Error**: `Continue Using Error Output`.

- [ ] **Step 5: Wire the failover chain**

Connect: `Agent - Bedrock` (error output) → `Agent - Anthropic` → (success/main output) → `Format Reply`.

- [ ] **Step 6: Manually verify failover from Bedrock to Anthropic**

In the `Bedrock - VIGAN` credential, temporarily change the Access Key ID to an invalid value (e.g. append `-broken`) and save. Test the workflow with pinned input `{"sessionId": "test-2", "message": "list the projects you know about"}` and confirm `Format Reply` still outputs a correct `{"reply": "..."}` — check the execution's node-by-node view to confirm `Agent - Bedrock` errored and `Agent - Anthropic` produced the reply. Then restore the valid Access Key ID on `Bedrock - VIGAN`.

- [ ] **Step 7: Save**

Save the workflow.

---

### Task 4: `VIGAN Agent Core` — OpenRouter fallback branch and the all-providers-failed message

**Depends on:** Task 3.

**Interfaces:**
- Consumes: `OpenRouter - VIGAN` credential (Task 1), the shared Memory/Tool sub-nodes from Task 2.
- Produces: a complete `VIGAN Agent Core` workflow matching the spec's full fallback chain, with a terminal `reply` even when all three providers fail.

- [ ] **Step 1: Add the OpenRouter AI Agent node**

Add an **AI Agent** node named `Agent - OpenRouter`. Set:
- **Prompt / Text**: `{{$json.message}}`
- **System Message**: `{{$('Load Config').item.json.systemPrompt}}`

- [ ] **Step 2: Add the OpenRouter chat model**

Add an **OpenAI Chat Model** sub-node attached to `Agent - OpenRouter`'s Model input. Credential: `OpenRouter - VIGAN` (already has its Base URL overridden to OpenRouter, from Task 1 Step 4). Model: enter/select the exact OpenRouter catalog slug for Muse Spark 1.3 (OpenRouter model IDs are typically `vendor/model-name` — check https://openrouter.ai/models for the exact slug before typing it in).

- [ ] **Step 3: Reuse the shared Memory and Tool sub-nodes**

Connect the same Window Buffer Memory sub-node (Task 2 Step 5) and the same Call n8n Workflow Tool sub-node (Task 2 Step 6) to `Agent - OpenRouter`'s Memory and Tool inputs, same as Task 3 Step 3.

- [ ] **Step 4: Set retry-then-failover behavior on `Agent - OpenRouter`**

Open `Agent - OpenRouter`'s node Settings. Set **Retry On Fail**: On, **Max Tries**: `2`. Set **On Error**: `Continue Using Error Output`.

- [ ] **Step 5: Add the all-providers-failed terminal node**

Add a **Set** node named `All Providers Failed` with one field:

- `reply` = `VIGAN's AI backends are all unavailable right now: {{$json.error?.message || $json.error || 'unknown error'}}`

- [ ] **Step 6: Wire the rest of the chain**

Connect: `Agent - Anthropic` (error output) → `Agent - OpenRouter` → (success/main output) → `Format Reply`.
Connect: `Agent - OpenRouter` (error output) → `All Providers Failed`.

- [ ] **Step 7: Manually verify failover to OpenRouter**

With `Bedrock - VIGAN` still valid, temporarily invalidate the `Anthropic - VIGAN` credential's API key (e.g. append a character) and save. Also temporarily invalidate `Bedrock - VIGAN` (as in Task 3 Step 6). Test the workflow with pinned input `{"sessionId": "test-3", "message": "list the projects you know about"}` and confirm `Format Reply` outputs a correct `{"reply": "..."}` served by OpenRouter — check the execution view to confirm both `Agent - Bedrock` and `Agent - Anthropic` errored first. Restore both credentials afterward.

- [ ] **Step 8: Manually verify the total-failure path**

With all three credentials temporarily invalidated (Bedrock, Anthropic, and OpenRouter), test the workflow with the same pinned input and confirm `All Providers Failed` outputs `{"reply": "VIGAN's AI backends are all unavailable right now: ..."}` instead of the workflow crashing or hanging. Restore all three credentials to valid values afterward.

- [ ] **Step 9: Save**

Save the workflow. `VIGAN Agent Core` is now complete and matches the design's full fallback chain.

---

### Task 5: `VIGAN - Email Watcher` — three-provider classifier chain

**Depends on:** Task 1 (credentials). Independent of Tasks 2–4 (this builds the separate `VIGAN - Email Watcher` workflow from the original plan's Task 10, with the classifier step revised per this design).

**Interfaces:**
- Consumes: `Bedrock - VIGAN`, `Anthropic - VIGAN`, `OpenRouter - VIGAN` credentials (Task 1); a Gmail OAuth2 credential scoped to `gmail.readonly` and the Slack bot credential (original plan Task 11 Steps 5 and 7).
- Produces: `VIGAN - Email Watcher` workflow, unchanged externally from the original plan (Schedule Trigger → Gmail → classify → alert), with the classify step now failing over across three providers.

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

- [ ] **Step 4: Add the Bedrock classify node**

Add a **Basic LLM Chain** node named `Classify - Bedrock`, with Prompt: `{{$('Load Classification Prompt').item.json.classificationPrompt}}`. Attach an **AWS Bedrock Chat Model** sub-node as its model: credential `Bedrock - VIGAN`, model the Claude Sonnet entry (same as Task 2 Step 4).

Open `Classify - Bedrock`'s node Settings: **Retry On Fail**: On, **Max Tries**: `2`, **On Error**: `Continue Using Error Output`.

- [ ] **Step 5: Add the Anthropic classify node**

Add a **Basic LLM Chain** node named `Classify - Anthropic`, with Prompt: `{{$('Load Classification Prompt').item.json.classificationPrompt}}`. Attach an **Anthropic Chat Model** sub-node: credential `Anthropic - VIGAN`, model Claude Sonnet 5 (same as Task 3 Step 2).

Open `Classify - Anthropic`'s node Settings: **Retry On Fail**: On, **Max Tries**: `2`, **On Error**: `Continue Using Error Output`.

- [ ] **Step 6: Add the OpenRouter classify node**

Add a **Basic LLM Chain** node named `Classify - OpenRouter`, with Prompt: `{{$('Load Classification Prompt').item.json.classificationPrompt}}`. Attach an **OpenAI Chat Model** sub-node: credential `OpenRouter - VIGAN`, model the Muse Spark 1.3 slug (same as Task 4 Step 2).

Open `Classify - OpenRouter`'s node Settings: **Retry On Fail**: On, **Max Tries**: `2`, **On Error**: `Continue Using Error Output`.

- [ ] **Step 7: Add `Parse Classification` (fails closed, unchanged from the original plan)**

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

- [ ] **Step 8: Wire the classify chain**

Connect: `Get Recent Mail` → `Load Classification Prompt` → `Classify - Bedrock` (success) → `Parse Classification`.
Connect: `Classify - Bedrock` (error) → `Classify - Anthropic` (success) → `Parse Classification`.
Connect: `Classify - Anthropic` (error) → `Classify - OpenRouter` (success) → `Parse Classification`.
Connect: `Classify - OpenRouter` (error) → `Parse Classification` (the same node — its input will be an error-shaped item with no `text`/`output` field, which the existing try/catch already handles by defaulting to `{important: false, reason: 'classification unparsable, defaulting to not important'}`).

- [ ] **Step 9: Add the alert branch (unchanged from the original plan)**

Add an **IF** node `Is Important` on `{{$json.important}}` **is true**. On the true branch, add a **Slack** node `Send Alert`:
- **Credential**: `Slack - VIGAN Bot`
- **Channel**: the DM channel with the allow-listed user
- **Text**: `📧 Possibly important email from {{$json.from}}: "{{$json.subject}}" — {{$json.reason}}`

Leave the false branch unconnected.

Connect: `Parse Classification` → `Is Important` → (true) → `Send Alert`.

- [ ] **Step 10: Manually verify normal classification**

Activate the workflow (or manually execute it) with real unread mail present. Confirm in the execution log that `Classify - Bedrock` handled the classification (no error), and that unimportant mail produces no Slack message while a deliberately urgent-sounding test email does.

- [ ] **Step 11: Manually verify classifier failover and fail-closed behavior**

Temporarily invalidate the `Bedrock - VIGAN` credential and manually execute the workflow again; confirm `Classify - Anthropic` handled it instead (check the execution's node view) and the alert behavior is unchanged. Then temporarily invalidate all three credentials (Bedrock, Anthropic, OpenRouter) and manually execute once more; confirm `Parse Classification` produced `{important: false, reason: 'classification unparsable, defaulting to not important'}` for every email and no Slack alert was sent, rather than the workflow crashing. Restore all three credentials to valid values afterward.

- [ ] **Step 12: Save**

Save as `VIGAN - Email Watcher`.

---

### Task 6: End-to-end validation and final commit

**Depends on:** Tasks 1–5 complete.

- [ ] **Step 1: Re-confirm Agent Core failover end to end**

Repeat Task 2 Step 9, Task 3 Step 6, Task 4 Steps 7–8 once more in sequence without pausing between them (Bedrock working → Bedrock broken/Anthropic serves → Bedrock+Anthropic broken/OpenRouter serves → all three broken/`All Providers Failed` message), restoring credentials at the end. This confirms the full chain works as one continuous scenario, not just in isolated per-task checks.

- [ ] **Step 2: Re-confirm Email Watcher failover end to end**

Repeat Task 5 Step 11 once more, confirming Bedrock → Anthropic → OpenRouter → fail-closed in sequence, restoring credentials at the end.

- [ ] **Step 3: Confirm existing chat/Slack behavior is unaffected**

In the `VIGAN - Chat` webchat (original plan Task 8) or via Slack DM (original plan Task 9), ask "what's the status of Product360" and confirm a normal reply — this confirms `VIGAN - Chat` and `VIGAN - Slack` needed no changes, since both still only depend on `VIGAN Agent Core`'s `{reply}` output field, unchanged by this plan.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(vigan): complete multi-provider LLM failover verification"
```
