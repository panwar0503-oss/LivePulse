'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        "CREATE TYPE enum_word_prompts_status AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED')",
        { transaction },
      )

      await queryInterface.createTable(
        'word_prompts',
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
          question: { type: Sequelize.STRING(200), allowNull: false },
          // Raw type name: the enum is created explicitly above, not by createTable.
          status: { type: 'enum_word_prompts_status', allowNull: false, defaultValue: 'DRAFT' },
          show_cloud: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          closed_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('word_prompts', {
        type: 'check',
        name: 'word_prompts_closed_at_matches_status',
        fields: ['status', 'closed_at'],
        where: Sequelize.literal("(status = 'CLOSED') = (closed_at IS NOT NULL)"),
        transaction,
      })

      await queryInterface.addConstraint('word_prompts', {
        type: 'check',
        name: 'word_prompts_question_not_blank',
        fields: ['question'],
        where: Sequelize.literal('length(btrim(question)) > 0'),
        transaction,
      })

      await queryInterface.addIndex('word_prompts', ['session_id', 'created_at'], {
        name: 'word_prompts_session_created_idx',
        transaction,
      })

      // At most one open prompt per session; the database is the final guard against races.
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX word_prompts_one_active_per_session ON word_prompts (session_id) ' +
          "WHERE status = 'ACTIVE'",
        { transaction },
      )

      await queryInterface.createTable(
        'word_responses',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          prompt_id: { type: Sequelize.UUID, allowNull: false },
          participant_id: { type: Sequelize.UUID, allowNull: false },
          normalized_word: { type: Sequelize.STRING(120), allowNull: false },
          display_word: { type: Sequelize.STRING(30), allowNull: false },
          // Answers are final, so there is no updated_at.
          created_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('word_responses', {
        type: 'foreign key',
        name: 'word_responses_prompt_id_fkey',
        fields: ['prompt_id'],
        references: { table: 'word_prompts', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      })

      await queryInterface.addConstraint('word_responses', {
        type: 'foreign key',
        name: 'word_responses_participant_id_fkey',
        fields: ['participant_id'],
        references: { table: 'participants', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      })

      // One word per participant per prompt.
      await queryInterface.addConstraint('word_responses', {
        type: 'unique',
        name: 'word_responses_prompt_participant_key',
        fields: ['prompt_id', 'participant_id'],
        transaction,
      })

      await queryInterface.addIndex('word_responses', ['prompt_id', 'normalized_word'], {
        name: 'word_responses_prompt_word_idx',
        transaction,
      })

      await queryInterface.addConstraint('word_responses', {
        type: 'check',
        name: 'word_responses_normalized_not_blank',
        fields: ['normalized_word'],
        where: Sequelize.literal('length(btrim(normalized_word)) > 0'),
        transaction,
      })

      await queryInterface.addConstraint('word_responses', {
        type: 'check',
        name: 'word_responses_display_not_blank',
        fields: ['display_word'],
        where: Sequelize.literal('length(btrim(display_word)) > 0'),
        transaction,
      })
    })
  },

  // WARNING: down deletes ALL word-cloud data (prompts and responses). Never run it on a database
  // with real data without the developer's approval, and never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('word_responses', { transaction })
      await queryInterface.dropTable('word_prompts', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_word_prompts_status', {
        transaction,
      })
    })
  },
}
