'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Raw SQL so the enum type gets the explicit name the plan uses.
      await queryInterface.sequelize.query(
        "CREATE TYPE session_chat_turn_status AS ENUM ('STREAMING', 'COMPLETE', 'INCOMPLETE')",
        { transaction },
      )
      // (session_id, client_message_id) UNIQUE absorbs a double send of the same message.
      await queryInterface.sequelize.query(
        `CREATE TABLE session_chat_turns (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          client_message_id uuid NOT NULL,
          question varchar(500) NOT NULL,
          answer text NULL,
          status session_chat_turn_status NOT NULL,
          error_code varchar(40) NULL,
          sources jsonb NOT NULL DEFAULT '[]'::jsonb,
          ai_job_id uuid NULL REFERENCES ai_jobs(id) ON DELETE SET NULL ON UPDATE CASCADE,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT session_chat_turns_client_message_key UNIQUE (session_id, client_message_id),
          CONSTRAINT session_chat_turns_answer_length CHECK (char_length(answer) <= 8000)
        )`,
        { transaction },
      )
      await queryInterface.addIndex('session_chat_turns', ['session_id', 'created_at'], {
        name: 'session_chat_turns_session_created_idx',
        transaction,
      })
    })
  },

  // WARNING: destructive. down deletes ALL chat history. Test database only unless the developer
  // approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('session_chat_turns', { transaction })
      await queryInterface.sequelize.query('DROP TYPE session_chat_turn_status', { transaction })
    })
  },
}
