'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // createTable creates the enum type enum_ai_jobs_status for the status column.
      await queryInterface.createTable(
        'ai_jobs',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          session_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'sessions', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          type: { type: Sequelize.STRING(40), allowNull: false },
          status: {
            type: Sequelize.ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'),
            allowNull: false,
            defaultValue: 'PENDING',
          },
          attempts: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },
          max_attempts: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 3 },
          run_after: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
          input: { type: Sequelize.JSONB, allowNull: false },
          output: { type: Sequelize.JSONB, allowNull: true },
          error_code: { type: Sequelize.STRING(40), allowNull: true },
          model: { type: Sequelize.STRING(100), allowNull: true },
          prompt_version: { type: Sequelize.STRING(40), allowNull: true },
          input_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          output_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          reserved_tokens: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          latency_ms: { type: Sequelize.INTEGER, allowNull: true },
          dedupe_key: { type: Sequelize.STRING(200), allowNull: true },
          started_at: { type: Sequelize.DATE, allowNull: true },
          finished_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      const checks = [
        [
          'ai_jobs_type_known',
          ['type'],
          "type IN ('PING','INGEST_DOCUMENT','SUGGEST_POLLS','QNA_COPILOT','LIVE_INSIGHTS','SESSION_REPORT')",
        ],
        ['ai_jobs_max_attempts_range', ['max_attempts'], 'max_attempts BETWEEN 1 AND 10'],
        ['ai_jobs_attempts_range', ['attempts', 'max_attempts'], 'attempts BETWEEN 0 AND max_attempts'],
        [
          'ai_jobs_finished_matches_status',
          ['status', 'finished_at'],
          "(status IN ('SUCCEEDED','FAILED','SKIPPED')) = (finished_at IS NOT NULL)",
        ],
        ['ai_jobs_failed_has_code', ['status', 'error_code'], "status <> 'FAILED' OR error_code IS NOT NULL"],
        [
          'ai_jobs_tokens_nonneg',
          ['input_tokens', 'output_tokens', 'reserved_tokens'],
          'input_tokens >= 0 AND output_tokens >= 0 AND reserved_tokens >= 0',
        ],
      ]
      for (const [name, fields, sql] of checks) {
        await queryInterface.addConstraint('ai_jobs', {
          type: 'check',
          name,
          fields,
          where: Sequelize.literal(sql),
          transaction,
        })
      }

      // At most one active (PENDING/RUNNING) job per dedupe key in a session; the database is the
      // final guard against double-enqueue races.
      await queryInterface.sequelize.query(
        "CREATE UNIQUE INDEX ai_jobs_active_dedupe_key ON ai_jobs (session_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('PENDING','RUNNING')",
        { transaction },
      )

      // Worker claim scan: oldest due PENDING jobs.
      await queryInterface.sequelize.query(
        "CREATE INDEX ai_jobs_claim_idx ON ai_jobs (run_after, created_at) WHERE status = 'PENDING'",
        { transaction },
      )

      // Stale-job sweep: RUNNING jobs whose worker died.
      await queryInterface.sequelize.query(
        "CREATE INDEX ai_jobs_stale_idx ON ai_jobs (started_at) WHERE status = 'RUNNING'",
        { transaction },
      )

      await queryInterface.addIndex('ai_jobs', ['session_id', 'created_at'], {
        name: 'ai_jobs_session_created_idx',
        transaction,
      })
    })
  },

  // WARNING: destructive. down deletes ALL AI job history (inputs, outputs, token usage). Run it on
  // the test database only unless the developer approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ai_jobs', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_ai_jobs_status', { transaction })
    })
  },
}
