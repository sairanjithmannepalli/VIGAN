# VIGAN Phase 1 — Setup

1. `npm install -g n8n` (standalone install; do not use the source checkout in `n8n/n8n`)
2. Set env vars (User scope): `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
3. Put a shortcut to `vigan/start-n8n.bat` in `shell:startup` so n8n starts at login
4. Slack integration (`VIGAN - Slack`) — **parked, not built.** n8n's Slack Trigger requires a classic webhook (a public HTTPS URL Slack can reach), not Socket Mode — impractical for a purely local n8n instance without a tunnel (ngrok or similar). The Slack app "VIGAN" was created and then torn down (app itself left installed on the workspace if not manually deleted there; the n8n credential, workflow, and `VIGAN_SLACK_ALLOWED_USER_ID` env var were all removed). Revisit only once a tunneling approach is chosen — see `docs/superpowers/plans/2026-09-08-vigan-phase1.md` Task 9 for the original design (email alert text there also needs the "no emoji" fix noted in Task 9/10 — see memory).
5. LLM provider credential — single-provider Anthropic in active use; Bedrock and OpenRouter both deferred after hitting real blockers during implementation, see `docs/superpowers/specs/2026-09-09-vigan-multi-provider-llm-design.md`:
   - `Anthropic - VIGAN` (Anthropic API credential) — the only provider actually wired into any workflow right now.
   - `OpenRouter - VIGAN` (OpenAI API credential with Base URL overridden to `https://openrouter.ai/api/v1`) — created but unused; deferred due to an n8n platform limitation (tool-call arguments can't be marked optional, so non-Claude models that correctly omit inapplicable fields fail schema validation).
   - Bedrock — not created; deferred due to company-issued AWS credentials being temporary/session-token-based.
6. Gmail credential (readonly scope only): `Gmail - VIGAN Read Only`
7. Build workflows in order: `VIGAN Tool - Project Reader` → `VIGAN Agent Core` → `VIGAN - Chat` (all three built and working). `VIGAN - Slack` is parked (see step 4); `VIGAN - Email Watcher` is also paused since its alert step depends on Slack for delivery — revisit both together once a Slack delivery path (or an alternative notification channel) is chosen.
   - Every workflow invoked as a sub-workflow (`VIGAN Tool - Project Reader`, `VIGAN Agent Core`) must be **Published** (n8n 2.x replaced the old Active/Inactive toggle with a Publish button, and requires it for `Call n8n Workflow Tool`/`Execute Workflow` invocations to work) — leaving it merely saved-but-unpublished will fail with "Workflow is not active and cannot be executed."
   - n8n 2.x disables the Execute Command node by default; enabling it requires setting `NODES_EXCLUDE=[]` (User-scope env var) and fully restarting the terminal application (a new tab/window in an already-running terminal app does not pick up new environment variables).
8. Run `cd vigan && npm test` any time the CLI changes, before rebuilding the tool workflow
