'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'sessions',
        'ai_enabled',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction },
      )
      await queryInterface.addColumn(
        'sessions',
        'ai_token_budget',
        { type: Sequelize.INTEGER, allowNull: false, defaultValue: 200000 },
        { transaction },
      )
      await queryInterface.addColumn(
        'sessions',
        'ai_tokens_used',
        { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        { transaction },
      )

      await queryInterface.addConstraint('sessions', {
        type: 'check',
        name: 'sessions_ai_token_budget_positive',
        fields: ['ai_token_budget'],
        where: Sequelize.literal('ai_token_budget > 0'),
        transaction,
      })

      await queryInterface.addConstraint('sessions', {
        type: 'check',
        name: 'sessions_ai_tokens_used_nonneg',
        fields: ['ai_tokens_used'],
        where: Sequelize.literal('ai_tokens_used >= 0'),
        transaction,
      })
    })
  },

  // WARNING: destructive. down loses every session's AI flag, token budget and token usage.
  // Run it on the test database only unless the developer approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeConstraint('sessions', 'sessions_ai_tokens_used_nonneg', { transaction })
      await queryInterface.removeConstraint('sessions', 'sessions_ai_token_budget_positive', {
        transaction,
      })
      await queryInterface.removeColumn('sessions', 'ai_tokens_used', { transaction })
      await queryInterface.removeColumn('sessions', 'ai_token_budget', { transaction })
      await queryInterface.removeColumn('sessions', 'ai_enabled', { transaction })
    })
  },
}
