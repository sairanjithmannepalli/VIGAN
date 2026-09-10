# VIGAN Phase 1 — Setup

1. `npm install -g n8n` (standalone install; do not use the source checkout in `n8n/n8n`)
2. Set env vars (User scope): `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `VIGAN_SLACK_ALLOWED_USER_ID=<your Slack member ID>`
3. Put a shortcut to `vigan/start-n8n.bat` in `shell:startup` so n8n starts at login
4. Slack app "VIGAN": bot scopes `chat:write, im:history, im:read, users:read`, subscribe to `message.im`, credential name `Slack - VIGAN Bot`
5. LLM provider credentials (failover order: Anthropic → OpenRouter; Bedrock deferred, see docs/superpowers/specs/2026-09-09-vigan-multi-provider-llm-design.md):
   - `Anthropic - VIGAN` (Anthropic API credential)
   - `OpenRouter - VIGAN` (OpenAI API credential with Base URL overridden to `https://openrouter.ai/api/v1`)
6. Gmail credential (readonly scope only): `Gmail - VIGAN Read Only`
7. Build workflows in order: `VIGAN Tool - Project Reader` → `VIGAN Agent Core` → `VIGAN - Chat` → `VIGAN - Slack` → `VIGAN - Email Watcher`
8. Run `cd vigan && npm test` any time the CLI changes, before rebuilding the tool workflow
