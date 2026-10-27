'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Raw SQL: a named enum type and a vector column. Existing questions stay VISIBLE via the default.
      await queryInterface.sequelize.query(
        "CREATE TYPE qna_review_state AS ENUM ('VISIBLE', 'CHECKING', 'HELD', 'REJECTED', 'MERGED')",
        { transaction },
      )
      await queryInterface.sequelize.query(
        `ALTER TABLE questions
          ADD COLUMN review_state qna_review_state NOT NULL DEFAULT 'VISIBLE',
          ADD COLUMN moderation_label varchar(16) NULL,
          ADD COLUMN duplicate_of_id uuid NULL
            REFERENCES questions(id) ON DELETE SET NULL ON UPDATE CASCADE,
          ADD COLUMN embedding vector(384) NULL,
          ADD COLUMN ai_step varchar(24) NULL,
          ADD COLUMN cluster_id uuid NULL
            REFERENCES question_clusters(id) ON DELETE SET NULL ON UPDATE CASCADE,
          ADD COLUMN answer_source varchar(16) NULL,
          ADD COLUMN answer_citations jsonb NULL,
          ADD CONSTRAINT questions_moderation_label_known
            CHECK (moderation_label IS NULL OR moderation_label IN ('OK', 'TOXIC', 'SPAM', 'OFF_TOPIC', 'PII')),
          ADD CONSTRAINT questions_not_duplicate_of_self
            CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
          ADD CONSTRAINT questions_pinned_is_visible
            CHECK (NOT (pinned AND review_state <> 'VISIBLE'))`,
        { transaction },
      )

      await queryInterface.addIndex('questions', ['session_id', 'review_state'], {
        name: 'questions_session_review_state_idx',
        transaction,
      })
    })
  },

  // WARNING: destructive. down loses every moderation label, duplicate link, embedding, cluster link
  // and AI answer source. Test database only unless the developer approves; never use
  // db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('questions', 'questions_session_review_state_idx', {
        transaction,
      })
      await queryInterface.sequelize.query(
        `ALTER TABLE questions
          DROP CONSTRAINT questions_pinned_is_visible,
          DROP CONSTRAINT questions_not_duplicate_of_self,
          DROP CONSTRAINT questions_moderation_label_known,
          DROP COLUMN answer_citations,
          DROP COLUMN answer_source,
          DROP COLUMN cluster_id,
          DROP COLUMN ai_step,
          DROP COLUMN embedding,
          DROP COLUMN duplicate_of_id,
          DROP COLUMN moderation_label,
          DROP COLUMN review_state`,
        { transaction },
      )
      await queryInterface.sequelize.query('DROP TYPE qna_review_state', { transaction })
    })
  },
}
