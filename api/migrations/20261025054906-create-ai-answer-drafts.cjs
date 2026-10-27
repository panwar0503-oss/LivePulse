'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Raw SQL so the enum types get the explicit names the plan uses.
      await queryInterface.sequelize.query(
        "CREATE TYPE ai_answer_draft_status AS ENUM ('DRAFTING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')",
        { transaction },
      )
      await queryInterface.sequelize.query(
        "CREATE TYPE ai_answer_draft_outcome AS ENUM ('GROUNDED', 'NOT_COVERED')",
        { transaction },
      )
      // question_id UNIQUE: one draft per question, the database guard against a second draft
      // after a restart or a duplicate job.
      await queryInterface.sequelize.query(
        `CREATE TABLE ai_answer_drafts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          job_id uuid NULL REFERENCES ai_jobs(id) ON DELETE SET NULL ON UPDATE CASCADE,
          status ai_answer_draft_status NOT NULL,
          outcome ai_answer_draft_outcome NULL,
          draft_text varchar(500) NULL,
          approved_text varchar(500) NULL,
          language varchar(16) NULL,
          confidence numeric(3,2) NULL,
          citations jsonb NOT NULL DEFAULT '[]'::jsonb,
          draft_attempts smallint NOT NULL DEFAULT 0,
          reviewed_at timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT ai_answer_drafts_question_key UNIQUE (question_id),
          CONSTRAINT ai_answer_drafts_confidence_range CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
          CONSTRAINT ai_answer_drafts_attempts_range CHECK (draft_attempts BETWEEN 0 AND 2),
          CONSTRAINT ai_answer_drafts_approved_has_text CHECK ((approved_text IS NOT NULL) = (status = 'APPROVED'))
        )`,
        { transaction },
      )

      await queryInterface.addIndex('ai_answer_drafts', ['session_id', 'status'], {
        name: 'ai_answer_drafts_session_status_idx',
        transaction,
      })
    })
  },

  // WARNING: destructive. down deletes ALL answer drafts and approvals. Test database only unless the
  // developer approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ai_answer_drafts', { transaction })
      await queryInterface.sequelize.query('DROP TYPE ai_answer_draft_outcome', { transaction })
      await queryInterface.sequelize.query('DROP TYPE ai_answer_draft_status', { transaction })
    })
  },
}
