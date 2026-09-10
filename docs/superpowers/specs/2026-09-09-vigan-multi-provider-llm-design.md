# VIGAN — LLM Provider Resilience (Bedrock / Anthropic / OpenRouter)

**Date:** 2026-09-09 (amended 2026-09-10)
**Status:** Approved for planning
**Owner:** Sai Ranjith Prasad (sairanjith.mannepalli@innovapptive.com)
**Extends:** `docs/superpowers/specs/2026-09-08-vigan-design.md` (Phase 1 read-only VIGAN) — specifically Task 7 (`VIGAN Agent Core`) and Task 10 (`VIGAN - Email Watcher`'s `Classify Importance` step) of `docs/superpowers/plans/2026-09-08-vigan-phase1.md`.

## Purpose

The original Phase 1 design hardcodes a single LLM credential (`Anthropic - VIGAN`) for both the main chat/Slack agent and the email-importance classifier. This addendum originally set out to replace that with automatic failover across three providers (cost/rate-limit spreading, model variety, using already-available credentials, redundancy). In practice, both additional providers hit real blockers during implementation — see the two amendments below — so **the final scope of this pass is: `VIGAN Agent Core` stays single-provider (Anthropic), but gains a clean failure message instead of crashing/hanging when Anthropic itself fails.** Both Bedrock and OpenRouter are documented as deferred future work rather than abandoned outright.

## Amendment history

> **Amendment (2026-09-09): Bedrock deferred.** Bedrock access turned out to require company-issued temporary/rotating AWS SSO credentials (session tokens that expire every 1–12 hours), which makes it impractical as a reliably-available provider for now. See "Deferred: adding Bedrock later" below.

> **Amendment (2026-09-10): OpenRouter deferred too.** While implementing the Anthropic → OpenRouter chain, the OpenRouter branch (model: Muse Spark 1.3) failed tool calls with `Received tool input did not match expected schema` — it correctly omitted fields that don't apply to the chosen action (e.g. `projectName`/`subpath`/`pattern`/`limit` when calling `list-projects`), but n8n's `Call n8n Workflow Tool` node currently has **no way to mark a Workflow Input field as optional** — every field defined on the sub-workflow's trigger is treated as required in the schema handed to the model, regardless of `$fromAI()` default values (a confirmed, currently-unresolved n8n platform limitation, not a VIGAN configuration bug). Claude/Anthropic happened to always populate every field anyway, masking this gap — Muse Spark 1.3 did not. Rather than keep fighting a platform limitation, OpenRouter is deferred alongside Bedrock. See "Deferred: adding OpenRouter later" below.

## Current scope: single-provider Anthropic with a clean failure message

`VIGAN Agent Core`'s AI Agent node (`Agent - Anthropic`, Claude Sonnet 5) keeps its **Retry On Fail = 1** setting and **On Error = Continue Using Error Output**, wired to a terminal `Agent Unavailable` node, so a persistent Anthropic failure (auth error, rate limit, outage) produces:

```
VIGAN's AI backend is unavailable right now: <error message>
```

instead of a silent hang or a raw n8n error surfaced to the chat/Slack user. This is strictly better than the original Phase 1 plan's Task 7 (which had no error handling at all), at effectively no added complexity, even though it isn't true multi-provider failover.

The email classifier (Task 10, not yet built as of this amendment) follows the same pattern once built: single Anthropic `Basic LLM Chain` node, Retry On Fail = 1, error output feeding into the existing `Parse Classification` node — which already fails closed (`important: false`) on anything it can't parse, including an error-shaped item with no `text`/`output` field. No multi-provider chain needed there either.

## Deferred: adding Bedrock later

Once a workable Bedrock credential story exists (either a company process for keeping a temporary-credential n8n credential refreshed, or a switch to a long-lived IAM user if your company allows it), Bedrock — Claude Sonnet (via AWS Bedrock's model catalog) — can be inserted as a second branch, chained off `Agent - Anthropic`'s error output (in place of the current direct-to-`Agent Unavailable` wiring). It would reuse the same shared Memory/Tool sub-nodes and `Load Config` expression as the Anthropic branch. Since Bedrock traffic goes through n8n's native **AWS Bedrock Chat Model** node (not the `Call n8n Workflow Tool` schema mechanism used for OpenRouter), it is not expected to hit the same required-field limitation described below — but this should be verified in practice once it's actually built, not assumed.

## Deferred: adding OpenRouter later

OpenRouter can be revisited once either (a) n8n ships proper optional-parameter support for `$fromAI()`/Workflow Inputs (tracked as a known community feature request, unresolved as of this writing), or (b) a different integration approach sidesteps the schema issue — e.g. a single `$fromAI()` argument carrying a JSON-encoded object (avoiding per-field required-ness entirely) that `Build CLI Command` parses, or restricting the OpenRouter branch to a model with strong, well-tested function-calling adherence to always-populate-every-field behavior (would need to be verified empirically per model, not assumed from a provider's marketing claims). Whichever approach is chosen, this is a small, self-contained follow-up — it does not require touching the Anthropic branch, `Load Config`, or the shared Memory/Tool sub-nodes.

## Credentials

| Credential name | n8n credential type | What you provide | Notes |
|---|---|---|---|
| `Anthropic - VIGAN` | Anthropic API | API key | Unchanged from the original Phase 1 plan. Currently the only provider in active use. |
| `OpenRouter - VIGAN` | OpenAI API (generic) | API key, Base URL = `https://openrouter.ai/api/v1` | Created during this pass but not currently wired into any workflow — deferred, see above. Note: n8n 2.x also offers a **native "OpenRouter" credential type** (distinct from the generic OpenAI API + Base URL override approach originally assumed here) — if/when OpenRouter is revisited, prefer the native `OpenRouter Chat Model` node + native `OpenRouter` credential type over this generic one. |
| `Bedrock - VIGAN` (deferred) | AWS | Access Key ID, Secret Access Key, Session Token, region | Not created in this pass — see "Deferred: adding Bedrock later" above. |

## Architecture: `VIGAN Agent Core` (replaces plan Task 7, Steps 2–4)

```
Execute Workflow Trigger (sessionId, message)
        │
        ▼
   Load Config (Set node: systemPrompt — single source of truth)
        │
        ▼
AI Agent - Anthropic [Claude Sonnet 5]    ──success──▶ Format Reply
        │ error (after 1 retry)
        ▼
   Agent Unavailable ("VIGAN's AI backend is unavailable right now: <error>")
```

Implementation details:

- `Agent - Anthropic`: **Retry On Fail = 1**, **On Error = Continue Using Error Output**, whose error output connects to `Agent Unavailable` (a Set node producing the same `reply` field shape as `Format Reply`, so downstream consumers — `VIGAN - Chat`, `VIGAN - Slack` — don't need to know which path fired).
- The **system prompt** (unchanged text from the original Task 7 Step 2) lives once in the `Load Config` Set node and is referenced by expression — `{{$('Load Config').item.json.systemPrompt}}` — in the AI Agent's System Message field, rather than being pasted inline, so a future second provider branch can reuse it without drift.
- Prompt/Memory-Key expressions reference the trigger node **by name** (`{{$('When Executed by Another Workflow').item.json.message}}`, etc.) rather than relying on pass-through from `Load Config`, because n8n's "Edit Fields" (Set) node only keeps the fields it explicitly sets by default — it does not pass through the trigger's original `sessionId`/`message` fields alongside the new `systemPrompt` field.
- The Memory sub-node (Simple Memory — the current n8n display name for what's referred to elsewhere as Window Buffer Memory) uses `{{$('When Executed by Another Workflow').item.json.sessionId}}` as its Key, with Context Window Length 20.
- The `read_project` Tool sub-node (`Call n8n Workflow Tool`, pointing at `VIGAN Tool - Project Reader`) is built with an explicit Workflow Input Schema (5 fields: `action`, `projectName`, `subpath`, `pattern`, `limit`, all defined on the target workflow's trigger and mapped via `$fromAI()`), rather than left on the trigger's default "Accept All Data" passthrough — the schema is required for the AI Agent's tool-call arguments to actually reach `Build CLI Command` correctly (see "Implementation notes" below).

## Implementation notes (discovered while building, not originally in scope but load-bearing)

- **`vigan/cli.js` was changed to always exit 0.** It originally set `process.exitCode = 1` on error (returning a `{error: ...}` JSON body either way) — standard Unix convention. n8n's Execute Command node (used by `VIGAN Tool - Project Reader`'s `Run CLI` step) treats any non-zero exit as a hard node failure and does not reliably pass stdout through in that case, which broke the tool's error-reporting contract when embedded in n8n. Since errors are already communicated via the JSON body, the exit code was redundant. `vigan/__tests__/cli.test.js` was updated accordingly (see commit `4b5ad5435b`).
- **n8n 2.x disables the Execute Command node by default** (a real security control — arbitrary shell execution). It requires setting the environment variable `NODES_EXCLUDE=[]` (User scope) and a full restart of the terminal application (not just re-running the command in an already-open terminal/tab, which does not pick up new environment variables) before the node appears in the node panel.
- **n8n 2.x requires sub-workflows to be Published (not just saved)** before they can be invoked via `Call n8n Workflow Tool` or `Execute Workflow` — contrary to the original Phase 1 plan's assumption ("leave inactive, only invoked as a sub-workflow"). Every workflow invoked this way (`VIGAN Tool - Project Reader`, `VIGAN Agent Core` once Chat/Slack call it) must be Published.
- **n8n 2.x replaced the workflow Active/Inactive toggle with a "Publish" button** in the editor's top-right area.
- Several AI Agent node parameters (Prompt/User Message, Memory's Session ID/Key) present as a **mode-selector dropdown** ("Connected Chat Trigger Node" vs. "Define below") separate from the actual value field — switching the dropdown itself into expression mode does not satisfy the "parameter is required" validation; you must select "Define below" as a literal dropdown choice first, which reveals a separate field to enter the expression into.

## Validation additions (extends plan Task 12)

- Force an Anthropic auth failure (e.g. temporarily invalid API key) and confirm chat gets the clean `Agent Unavailable` message rather than a silent hang or raw n8n error. (Confirmed working during this pass.)
- Confirm normal operation (valid credential) still returns a correct reply after the error-path wiring was added. (Confirmed working during this pass.)
- Once the email classifier (Task 10) is built: confirm it silently skips (no alert, no crash) when Anthropic is down during a scheduled run, consistent with `Parse Classification`'s existing fail-closed behavior.

## Out of scope

- True multi-provider automatic failover — deferred in full per the amendments above. What's built now is single-provider-with-clean-failure-message, not failover.
- Automatic detection of *which* error types are worth retrying vs. not — treated as out of scope regardless of provider count.
- Persisting/synchronizing conversation memory across multiple providers — moot while single-provider.
- User-facing runtime provider selection (e.g. "always use OpenRouter" as a chat command).
