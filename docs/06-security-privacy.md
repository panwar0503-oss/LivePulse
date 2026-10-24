# 06 — Security and Privacy

## 1. Threats

**Core:** guessing room codes · forged presenter actions · joining another session's room · duplicate/concurrent
votes and upvotes · forged participant IDs or counts · spam and oversized text · XSS through audience text ·
token leakage (logs, URLs, errors) · CORS misconfiguration · SQL injection · socket/event floods (reactions) ·
false success when a write fails.

**AI-specific:**
- **Prompt injection** via questions, word responses, or uploaded documents ("ignore previous instructions…").
- **Data exfiltration** across sessions through retrieval (chunks from session A answering session B).
- **Hallucinated answers** presented as facts.
- **Unsafe/abusive content** generated or amplified.
- **Cost abuse**: flooding questions to burn tokens.
- **Malicious uploads**: huge/zip-bomb PDFs, unsupported types.
- **MCP misuse**: a local tool acting beyond the presenter's session.
- **Secret leakage**: API key in logs, client bundles, or error messages.

## 2. Controls — core
1. Room codes from a CSPRNG; unique constraint + bounded retry.
2. Presenter key and participant tokens: high-entropy, server-generated, stored as hashes, compared in constant
   time, scoped to one session, never in URLs or logs.
3. Zod validation on every REST and socket payload; body size limits.
4. Parameterised Sequelize queries only (including vector queries).
5. DB unique constraints for votes, upvotes, word responses; option-belongs-to-poll composite FK.
6. Rate limits per IP and per participant: join, vote, word, question, upvote, reaction, AI endpoints.
7. Helmet; strict CORS allowlist (`WEB_ORIGIN`); same allowlist for Socket.IO.
8. React text nodes only; no `dangerouslySetInnerHTML` (AI output included; render Markdown, if ever, with a
   sanitising renderer that disallows HTML).
9. Generic public errors; detailed internal logs with request IDs; never log tokens, keys, or full payloads.
10. Result visibility, room membership, and lifecycle checks enforced on the server.

## 3. Controls — AI
1. **Untrusted-input fencing:** audience text and document chunks are wrapped in labelled delimiters; the system
   prompt says content inside is data, not instructions.
2. **No authority for the model in audience-triggered flows:** the Q&A graph and insights chains have no
   state-changing tools. They return data; services decide what to persist.
3. **Schema-validated outputs:** Zod parse every response; reject extra fields; cap lengths; invalid → retry once →
   FAILED.
4. **Human approval:** answers, polls, and released questions require a presenter action.
5. **Grounding:** answers must cite retrieved chunks; self-check node rejects ungrounded drafts; below similarity
   threshold → "not in the material".
6. **Session isolation in retrieval:** every vector query filters by `session_id`; tests prove no cross-session
   leakage.
7. **Budgets and rate limits:** per-session token budget, per-participant question rate limit, job dedupe,
   global kill switch `AI_ENABLED`.
8. **Uploads:** allowlisted MIME types checked by content sniffing, size limit (e.g. 10 MB), page limit, text-length
   limit, extraction timeout; files are not stored after text extraction (prototype).
9. **Moderation:** classify questions before display when moderation is on; held content visible only to presenter.
10. **Secrets:** `ANTHROPIC_API_KEY` from env only, validated at startup when `AI_PROVIDER=anthropic`, never
    logged, never shipped to `web/` (no `NEXT_PUBLIC_` prefix).
11. **MCP:** stdio transport only (local); presenter key from env; tools call the REST API with that key so the
    same authorization applies; no direct DB access and no generic "run SQL" or file-system tools.
12. **Data minimisation:** don't send display names or tokens to the LLM; send only the text needed.

## 4. Privacy
- Personal data: display names and free text the audience types. No email, phone, location.
- When `AI_PROVIDER=anthropic`, audience text and uploaded material are sent to Anthropic for processing. The
  presenter must enable AI per session and sees this notice; participants see "AI-assisted session" on join.
- README states the prototype is for demo use, has no formal security audit, and should not use sensitive data.

## 5. Limitations to disclose
Anonymous tokens ≠ identity verification · room code ≠ authorization · presenter key is a bearer secret (no
accounts) · Redis Pub/Sub not durable · in-memory reaction aggregation and rate limits are per instance unless
moved to Redis · LLM output can still be wrong even when grounded — that is why the presenter approves · no
capacity claims without load tests.
