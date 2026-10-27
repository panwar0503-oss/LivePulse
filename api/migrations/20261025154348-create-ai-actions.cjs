'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Raw SQL so the enum types get the explicit names the plan uses.
      await queryInterface.sequelize.query(
        "CREATE TYPE ai_action_type AS ENUM ('CREATE_POLL', 'START_POLL', 'CLOSE_POLL', 'PUBLISH_ANSWER')",
        { transaction },
      )
      await queryInterface.sequelize.query(
        "CREATE TYPE ai_action_status AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED')",
        { transaction },
      )
      await queryInterface.sequelize.query(
        `CREATE TABLE ai_actions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          type ai_action_type NOT NULL,
          status ai_action_status NOT NULL DEFAULT 'PROPOSED',
          payload jsonb NOT NULL,
          result_id uuid NULL,
          error_code varchar(64) NULL,
          error_message varchar(300) NULL,
          decided_at timestamptz NULL,
          finished_at timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT ai_actions_payload_object CHECK (jsonb_typeof(payload) = 'object'),
          CONSTRAINT ai_actions_payload_size CHECK (octet_length(payload::text) <= 4096),
          CONSTRAINT ai_actions_failed_has_error_code CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
        )`,
        { transaction },
      )
      await queryInterface.sequelize.query(
        'CREATE INDEX ai_actions_session_created_idx ON ai_actions (session_id, created_at DESC)',
        { transaction },
      )
      // Open-proposal count per session.
      await queryInterface.sequelize.query(
        "CREATE INDEX ai_actions_session_proposed_idx ON ai_actions (session_id) WHERE status = 'PROPOSED'",
        { transaction },
      )
      // Finds APPROVED rows left behind by a crash mid-execution.
      await queryInterface.sequelize.query(
        "CREATE INDEX ai_actions_approved_updated_idx ON ai_actions (updated_at) WHERE status = 'APPROVED'",
        { transaction },
      )
    })
  },

  // WARNING: destructive. down deletes ALL proposals. Test database only unless the developer
  // approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ai_actions', { transaction })
      await queryInterface.sequelize.query('DROP TYPE ai_action_status', { transaction })
      await queryInterface.sequelize.query('DROP TYPE ai_action_type', { transaction })
    })
  },
}
