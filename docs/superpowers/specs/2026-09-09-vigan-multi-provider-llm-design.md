# VIGAN — Multi-Provider LLM Failover (Bedrock / Anthropic / OpenRouter)

**Date:** 2026-09-09
**Status:** Approved for planning
**Owner:** Sai Ranjith Prasad (sairanjith.mannepalli@innovapptive.com)
**Extends:** `docs/superpowers/specs/2026-09-08-vigan-design.md` (Phase 1 read-only VIGAN) — specifically Task 7 (`VIGAN Agent Core`) and Task 10 (`VIGAN - Email Watcher`'s `Classify Importance` step) of `docs/superpowers/plans/2026-09-08-vigan-phase1.md`.

## Purpose

The original Phase 1 design hardcodes a single LLM credential (`Anthropic - VIGAN`) for both the main chat/Slack agent and the email-importance classifier. This addendum replaces that single-provider dependency with automatic failover across three providers, driven by:

- **Cost / rate limits** — spread usage, avoid getting stuck when one provider throttles.
- **Model variety** — different underlying models per provider rather than the same model through three transports.
- **Existing credentials/credits** — use API access already available across AWS, Anthropic, and OpenRouter.
- **Redundancy/failover** — VIGAN keeps answering even if one or two providers are down.

## Provider priority and models

Automatic failover tries providers in this order, stopping at the first success:

1. **Bedrock** — Claude Sonnet (via AWS Bedrock's model catalog) — primary.
2. **Anthropic direct** — Claude Sonnet 5 — first fallback.
3. **OpenRouter** — Muse Spark 1.3 — last-resort fallback, deliberately a non-Claude model so a Claude-family-wide outage doesn't take down all three providers at once. (OpenRouter model IDs are typically `vendor/model-name` — confirm the exact catalog slug for this model in the OpenRouter dashboard when configuring the OpenAI Chat Model node in Task 11/7, since the marketing name and API slug can differ.)

If a provider errors (auth failure, rate limit, timeout, outage), VIGAN retries that same provider once, then — if it still fails — automatically moves to the next provider in the list, with no user-visible interruption beyond added latency. Only if all three fail does VIGAN surface an error to the user (chat/Slack) or, for the email classifier, fail closed (skip the alert rather than crash or false-alert).

## Credentials (extends plan Task 11 steps 6–7)

| Credential name | n8n credential type | What you provide | Notes |
|---|---|---|---|
| `Bedrock - VIGAN` | AWS | Access Key ID, Secret Access Key, region | Requires a one-time AWS Bedrock console step: enable model access for the Claude Sonnet model in that region (Bedrock gates model access per-account/per-region). |
| `Anthropic - VIGAN` | Anthropic API | API key | Unchanged from the original Phase 1 plan. |
| `OpenRouter - VIGAN` | OpenAI API (generic) | API key, Base URL = `https://openrouter.ai/api/v1` | OpenRouter has no dedicated n8n node; its API is OpenAI-schema-compatible, so the generic OpenAI Chat Model node is reused with the Base URL overridden. |

## Architecture: `VIGAN Agent Core` (replaces plan Task 7, Steps 2–4)

n8n's AI Agent node accepts only one connected chat-model input at a time, so failover across providers is built as a **sequential error-output chain** of three AI Agent nodes, not one node with three models:

```
Execute Workflow Trigger (sessionId, message)
        │
        ▼
   Load Config (Set node: systemPrompt — single source of truth)
        │
        ▼
AI Agent [Bedrock: Claude Sonnet]        ──success──▶ Format Reply
        │ error (after 1 retry)
        ▼
AI Agent [Anthropic: Claude Sonnet 5]    ──success──▶ Format Reply
        │ error (after 1 retry)
        ▼
AI Agent [OpenRouter: Muse Spark 1.3]    ──success──▶ Format Reply
        │ error (after 1 retry)
        ▼
   Format Reply (final message: "VIGAN's AI backends are all unavailable right now: <last error>")
```

Implementation details:

- Each AI Agent node: **Retry On Fail = 1**, then **On Error = Continue Using Error Output**, whose error output connects to the next provider's AI Agent node (or, for the third/OpenRouter node, to the final `Format Reply` carrying the all-providers-failed message).
- All three AI Agent nodes share the **same Memory node** (Window Buffer Memory, session-keyed on `{{$json.sessionId}}`, context window 20 — unchanged from the original Task 7) and the **same `read_project` Call n8n Workflow Tool node** (pointing at `VIGAN Tool - Project Reader`, Task 6, unchanged). A single Memory or Tool sub-node's output can fan out to multiple AI Agent nodes, so these are not tripled.
- The **system prompt** (unchanged text from the original Task 7 Step 2) lives once in the `Load Config` Set node and is referenced by expression — `{{$('Load Config').item.json.systemPrompt}}` — in all three AI Agent nodes' System Message field, so the persona/constraints text cannot drift out of sync between providers.
- **Known limitation:** if a provider fails *after* it has already made a tool call mid-turn, the next provider re-runs the whole agent turn from scratch. This is harmless since `read_project` is read-only — it costs one redundant tool call, not a correctness issue.

## Architecture: email classifier (replaces plan Task 10, Step 3)

`Classify Importance` becomes three chained **Basic LLM Chain** nodes in the same priority order (Bedrock → Anthropic → OpenRouter), wired with the same Retry-On-Fail-1-then-error-output pattern. The classification prompt text (unchanged from the original Task 10 Step 3) is likewise sourced once from a `Load Config` node and referenced by expression in all three nodes, so it can't drift between providers.

All three success paths, and the final all-providers-failed path, feed into the existing `Parse Classification` Code node (Task 10 Step 4), which already fails closed (`important: false` on anything unparsable). Consequence: if all three providers are down during a scheduled run, the email is silently skipped — no alert, no crash — consistent with Phase 1's existing "fail closed, never spam a false alert" behavior.

## Validation additions (extends plan Task 12)

- Force a Bedrock auth failure (e.g. temporarily invalid AWS key) and confirm chat/Slack still gets a reply, now served by Anthropic.
- Additionally force Anthropic to fail (e.g. invalid API key) and confirm OpenRouter serves the reply.
- Force all three providers to fail and confirm the user sees the clear "VIGAN's AI backends are all unavailable" message rather than a silent hang or a raw n8n error.
- Confirm the email classifier silently skips (no alert, no crash) when all three providers are down during a scheduled run.

## Out of scope

- Automatic detection of *which* error types are worth retrying vs. not (e.g. a malformed-tool-call error will fail identically on every provider) — Phase 1 treats any error as failover-worthy, accepting the small cost of a doomed retry against providers 2 and 3 in that case.
- Persisting/synchronizing conversation memory access patterns beyond what n8n's Window Buffer Memory already provides across the three AI Agent nodes sharing one Memory sub-node.
- Any provider beyond these three, or user-facing runtime provider selection (e.g. "always use OpenRouter" as a chat command) — priority order is fixed at build time in this phase.
