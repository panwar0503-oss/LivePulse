'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'questions',
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
          participant_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'participants', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          text: { type: Sequelize.STRING(200), allowNull: false },
          text_key: { type: Sequelize.STRING(400), allowNull: false },
          hidden: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          pinned: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          answer_text: { type: Sequelize.STRING(500), allowNull: true },
          answered_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('questions', {
        type: 'check',
        name: 'questions_text_not_blank',
        fields: ['text'],
        where: Sequelize.literal('length(btrim(text)) > 0'),
        transaction,
      })

      await queryInterface.addConstraint('questions', {
        type: 'check',
        name: 'questions_answer_not_blank',
        fields: ['answer_text'],
        where: Sequelize.literal('answer_text IS NULL OR length(btrim(answer_text)) > 0'),
        transaction,
      })

      await queryInterface.addConstraint('questions', {
        type: 'check',
        name: 'questions_not_pinned_and_hidden',
        fields: ['pinned', 'hidden'],
        where: Sequelize.literal('NOT (pinned AND hidden)'),
        transaction,
      })

      // At most one pinned question per session; the database is the final guard against races.
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX questions_one_pinned_per_session ON questions (session_id) WHERE pinned',
        { transaction },
      )

      // Duplicate guard: one participant cannot ask the same normalized question twice.
      await queryInterface.addConstraint('questions', {
        type: 'unique',
        name: 'questions_participant_text_key',
        fields: ['participant_id', 'text_key'],
        transaction,
      })

      await queryInterface.addIndex('questions', ['session_id', 'created_at'], {
        name: 'questions_session_created_idx',
        transaction,
      })

      await queryInterface.createTable(
        'question_upvotes',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          question_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'questions', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          participant_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'participants', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          created_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('question_upvotes', {
        type: 'unique',
        name: 'question_upvotes_question_participant_key',
        fields: ['question_id', 'participant_id'],
        transaction,
      })
    })
  },

  // WARNING: down deletes ALL Q&A questions and upvotes. Never run it on a database with real
  // data without the developer's approval, and never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('question_upvotes', { transaction })
      await queryInterface.dropTable('questions', { transaction })
    })
  },
}
