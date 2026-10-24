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

- `id` UUID PK · `session_id` FK → sessions (`ON DELETE CASCADE`) · `question` `varchar(200)`
- `status` enum `enum_polls_status`: `DRAFT | ACTIVE | CLOSED`, default `DRAFT` · `show_results` boolean, default `true`
- `closed_at` timestamptz nullable · `created_at` · `updated_at`
- `source_suggestion_id` nullable FK → ai_poll_suggestions (Phase 11, not in the Phase 5 migration)
- CHECK `polls_closed_at_matches_status`: `(status = 'CLOSED') = (closed_at IS NOT NULL)`
- CHECK `polls_question_not_blank`: `length(btrim(question)) > 0`
- Index `polls_session_created_idx` on `(session_id, created_at)`
- **Partial unique index `polls_one_active_per_session` on `(session_id) WHERE status = 'ACTIVE'`**: at most one open poll per session
- `closed_at` is written in the same update that sets `CLOSED`; no database trigger sets it. `closePoll` sets it from the
  app clock after taking the row lock. `endSession` sets it in SQL with `clock_timestamp()`.

### poll_options (Phase 5)

- `id` UUID PK · `poll_id` FK → polls (`ON DELETE CASCADE`) · `label` `varchar(80)` · `position` smallint · timestamps
- CHECK `poll_options_position_range`: `position BETWEEN 0 AND 5` · CHECK `poll_options_label_not_blank`: `length(btrim(label)) > 0`
- Unique `poll_options_poll_position_key` on `(poll_id, position)` · unique `poll_options_poll_label_key` on `(poll_id, label)`
- Unique `poll_options_id_poll_key` on `(id, poll_id)`: target of the composite FK from votes
- The API refuses duplicate labels case-insensitively (trimmed); the unique index is case-sensitive.

### votes (Phase 5)

- `id` UUID PK · `poll_id` · `option_id` · `participant_id` · `created_at` (no `updated_at`: votes are final)
- **Unique `votes_poll_participant_key` on `(poll_id, participant_id)`**: one vote per participant per poll
- Composite FK `votes_option_poll_fkey` `(option_id, poll_id)` → `poll_options(id, poll_id)`, `ON DELETE CASCADE`: the DB
  guarantees the option belongs to the poll (raw SQL, since queryInterface cannot declare it)
- FK `poll_id` → polls and FK `participant_id` → participants, both `ON DELETE CASCADE`
- Index `votes_poll_option_idx` on `(poll_id, option_id)`

### word_prompts (Phase 6)

- `id` UUID PK · `session_id` FK → sessions (`ON DELETE CASCADE`) · `question` `varchar(200)` · timestamps
- `status` enum `enum_word_prompts_status`: `DRAFT | ACTIVE | CLOSED` (default `DRAFT`) · `show_cloud` boolean (default `true`)
- `closed_at` nullable. CHECK `word_prompts_closed_at_matches_status`: `(status = 'CLOSED') = (closed_at IS NOT NULL)`
- CHECK `word_prompts_question_not_blank`: `length(btrim(question)) > 0`
- **Partial unique index `word_prompts_one_active_per_session` on `(session_id) WHERE status = 'ACTIVE'`**: at most one open prompt per session
- Index `word_prompts_session_created_idx` on `(session_id, created_at)`

### word_responses (Phase 6)

- `id` UUID PK · `prompt_id` FK → word_prompts (`word_responses_prompt_id_fkey`, `ON DELETE CASCADE`) · `participant_id` FK → participants (`word_responses_participant_id_fkey`, `ON DELETE CASCADE`)
- `normalized_word` `varchar(120)` · `display_word` `varchar(30)` · `created_at` (no `updated_at`: answers are final)
- No `session_id` column: the session is read from the prompt row
- **Unique `word_responses_prompt_participant_key` on `(prompt_id, participant_id)`**: one answer per participant per prompt
- Index `word_responses_prompt_word_idx` on `(prompt_id, normalized_word)`
- CHECK `word_responses_normalized_not_blank` and `word_responses_display_not_blank`: `length(btrim(...)) > 0`

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
