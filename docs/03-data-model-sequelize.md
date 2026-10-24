# 03 — Data Model and Sequelize

Conventions: tables and columns `snake_case` (Sequelize `underscored: true`), models PascalCase, UUID primary keys,
`created_at`/`updated_at` unless noted. Each table is introduced by the phase that needs it (see `08`).

## 1. Core entities

### sessions (Phase 3)

- `id` UUID PK · `room_code` `char(6)` unique, CHECK format (31-character alphabet, no look-alikes)
- `title` `varchar(80)` · `description` `varchar(500)` nullable
- `presenter_key_hash` `char(64)` unique (SHA-256 hex; the raw key is never stored)
- `status` `ACTIVE | ENDED` · `ended_at` nullable, CHECK: set exactly when `status` is `ENDED`
- `ai_enabled` and `ai_tokens_used` are added in Phase 9, not in the Phase 3 migration

### participants (Phase 3)

- `id` UUID PK · `session_id` FK `ON DELETE CASCADE` · `display_name` `varchar(30)`
- `token_hash` `char(64)` unique (SHA-256 hex) · `last_seen_at` · index on `session_id`

### polls (Phase 5)

- `id` · `session_id` FK · `question` · `status` `DRAFT | ACTIVE | CLOSED` · `show_results` boolean
- `closed_at` nullable · `source_suggestion_id` nullable FK → ai_poll_suggestions (Phase 11)
- Partial unique index: one `ACTIVE` poll per session

### poll_options (Phase 5)

- `id` · `poll_id` FK · `label` · `position` · unique `(poll_id, position)` · unique `(id, poll_id)` for composite FK

### votes (Phase 5)

- `id` · `poll_id` · `option_id` · `participant_id` · `created_at`
- **Unique `(poll_id, participant_id)`** · index `(poll_id, option_id)`
- Composite FK `(option_id, poll_id)` → `poll_options(id, poll_id)` so the DB guarantees the option belongs to the poll

### word_prompts (Phase 6)

- `id` · `session_id` · `prompt` · `status` `OPEN | CLOSED`

### word_responses (Phase 6)

- `id` · `prompt_id` FK · `session_id` · `participant_id` · `normalized_word` · `display_word`
- Unique `(prompt_id, participant_id)` · index `(prompt_id, normalized_word)`
- `embedding vector(384)` nullable (Phase 13, for semantic themes)

### questions (Phase 7)

- `id` · `session_id` · `participant_id` · `text`
- `status` `VISIBLE | PENDING_REVIEW | HIDDEN | ANSWERED | REJECTED` · `pinned` boolean
- `upvote_count` integer (denormalised, updated in the same transaction as the upvote insert)
- `answer_text` nullable · `answered_at` nullable
- Phase 12 adds: `moderation_label` nullable · `duplicate_of_id` nullable self-FK · `embedding vector(384)` nullable
- Index `(session_id, status, upvote_count DESC, created_at)`

### question_upvotes (Phase 7)

- `question_id` · `participant_id` · unique `(question_id, participant_id)`

### reaction_counts (Phase 8)

- `session_id` · `emoji` · `bucket_start` (minute) · `count`
- Unique `(session_id, emoji, bucket_start)`; written with `INSERT … ON CONFLICT DO UPDATE SET count = count + n`
  from the server-side aggregator (not one row per tap)

## 2. AI entities

### pgvector setup (Phase 9)

- Migration: `CREATE EXTENSION IF NOT EXISTS vector` (down: drop only if no vector columns remain — document it).
- Vector columns and HNSW indexes are created with raw SQL inside generated migrations, e.g.
  `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`.
- Sequelize has no native vector type. Options (decide in Phase 9 plan): (a) the `pgvector` npm package's Sequelize
  type registration (new dependency) or (b) exclude the column from model attributes and read/write it with
  parameterised `sequelize.query` + replacements. Never interpolate vectors or text into SQL strings.
- `EMBEDDING_DIM = 384` lives in `shared/`; changing it requires a migration and re-embedding.

### ai_jobs (Phase 9)

- `id` · `session_id` · `type` `INGEST_DOCUMENT | SUGGEST_POLLS | QNA_COPILOT | LIVE_INSIGHTS | SESSION_REPORT`
- `status` `PENDING | RUNNING | SUCCEEDED | FAILED | SKIPPED` · `attempts` · `input` JSONB · `error_code` nullable
- `model` · `prompt_version` · `input_tokens` · `output_tokens` · `latency_ms`
- `dedupe_key` nullable, partial unique where status in (PENDING, RUNNING) — prevents duplicate queued jobs
- `started_at` · `finished_at` · index `(status, created_at)`

### knowledge_documents (Phase 10)

- `id` · `session_id` · `filename` · `mime_type` · `byte_size` · `status` `PROCESSING | READY | FAILED`
- `chunk_count` · `error_code` nullable

### knowledge_chunks (Phase 10)

- `id` · `document_id` FK (cascade on document delete) · `session_id` · `chunk_index` · `content`
- `page` nullable · `heading` nullable · `token_count` · `embedding vector(384)` NOT NULL
- HNSW index on `embedding`; btree on `session_id` (every query filters by session)

### ai_poll_suggestions (Phase 11)

- `id` · `session_id` · `job_id` · `question` · `options` JSONB (string[2–6]) · `rationale`
- `source_chunk_ids` UUID[] · `status` `SUGGESTED | ACCEPTED | DISMISSED` · `poll_id` nullable

### ai_answer_drafts (Phase 12)

- `id` · `question_id` FK unique · `job_id` · `draft_text` · `citations` JSONB (`[{chunkId, quote, page}]`)
- `grounded` boolean · `confidence` numeric · `status` `PENDING_REVIEW | APPROVED | REJECTED`
- `final_text` nullable (presenter edit) · `reviewed_at`

### ai_insights (Phase 13–14)

- `id` · `session_id` · `kind` `WORD_THEMES | SENTIMENT | ROOM_SUMMARY | SESSION_REPORT` · `payload` JSONB
  (Zod-validated per kind) · `version` integer (increments per kind) · `job_id`
- Index `(session_id, kind, version DESC)`

## 3. Associations (summary)

Session hasMany Participants, Polls, WordPrompts, Questions, ReactionCounts, KnowledgeDocuments, AiJobs,
AiInsights · Poll hasMany PollOptions, Votes · Question hasMany QuestionUpvotes, hasOne AiAnswerDraft ·
KnowledgeDocument hasMany KnowledgeChunks · AiPollSuggestion belongsTo Poll (optional).

## 4. Migration and transaction rules

1. One generated migration per change, with `up` and `down`; run `down` on a test DB before committing.
2. Never `sync({ force | alter })` outside tests. Never edit a migration that has run elsewhere.
3. Uniqueness lives in PostgreSQL; services translate unique violations into domain errors (`409`).
4. Vote insert and poll close serialize on the poll row lock.
5. Enqueue AI jobs in the same transaction as the triggering write; run them after commit.
6. Never hold a transaction open across an LLM call, an embedding batch, or a socket ack.
7. Map models to DTOs; never return `token_hash`, `presenter_key_hash`, or embeddings to clients.

## 5. Vector query shape (pseudocode)

```ts
// Top-k chunks for a session; parameters bound, never interpolated.
const rows = await sequelize.query(
  `SELECT id, content, page, heading, 1 - (embedding <=> :q::vector) AS score
     FROM knowledge_chunks
    WHERE session_id = :sessionId
    ORDER BY embedding <=> :q::vector
    LIMIT :k`,
  { replacements: { q: toPgVector(queryEmbedding), sessionId, k }, type: QueryTypes.SELECT },
)
// Then drop rows below MIN_SIMILARITY.
```

## 6. Data retention

Prototype policy: data kept until a documented manual cleanup script deletes a session (cascade to all child rows
including chunks and AI outputs). No automatic destructive jobs.
