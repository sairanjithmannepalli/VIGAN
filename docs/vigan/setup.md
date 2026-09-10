# VIGAN Phase 1 — Setup

1. `npm install -g n8n` (standalone install; do not use the source checkout in `n8n/n8n`)
2. Set env vars (User scope): `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `VIGAN_SLACK_ALLOWED_USER_ID=<your Slack member ID>`
3. Put a shortcut to `vigan/start-n8n.bat` in `shell:startup` so n8n starts at login
4. Slack app "VIGAN": bot scopes `chat:write, im:history, im:read, users:read`, subscribe to `message.im`, credential name `Slack - VIGAN Bot`
5. LLM provider credential — single-provider Anthropic in active use; Bedrock and OpenRouter both deferred after hitting real blockers during implementation, see `docs/superpowers/specs/2026-09-09-vigan-multi-provider-llm-design.md`:
   - `Anthropic - VIGAN` (Anthropic API credential) — the only provider actually wired into any workflow right now.
   - `OpenRouter - VIGAN` (OpenAI API credential with Base URL overridden to `https://openrouter.ai/api/v1`) — created but unused; deferred due to an n8n platform limitation (tool-call arguments can't be marked optional, so non-Claude models that correctly omit inapplicable fields fail schema validation).
   - Bedrock — not created; deferred due to company-issued AWS credentials being temporary/session-token-based.
6. Gmail credential (readonly scope only): `Gmail - VIGAN Read Only`
7. Build workflows in order: `VIGAN Tool - Project Reader` → `VIGAN Agent Core` → `VIGAN - Chat` → `VIGAN - Slack` → `VIGAN - Email Watcher`
   - Every workflow invoked as a sub-workflow (`VIGAN Tool - Project Reader`, `VIGAN Agent Core`) must be **Published** (n8n 2.x replaced the old Active/Inactive toggle with a Publish button, and requires it for `Call n8n Workflow Tool`/`Execute Workflow` invocations to work) — leaving it merely saved-but-unpublished will fail with "Workflow is not active and cannot be executed."
   - n8n 2.x disables the Execute Command node by default; enabling it requires setting `NODES_EXCLUDE=[]` (User-scope env var) and fully restarting the terminal application (a new tab/window in an already-running terminal app does not pick up new environment variables).
8. Run `cd vigan && npm test` any time the CLI changes, before rebuilding the tool workflow
