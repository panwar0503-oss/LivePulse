'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'sessions',
        'qna_open',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        { transaction },
      )

      // Backfill: ended sessions never accept questions.
      await queryInterface.sequelize.query("UPDATE sessions SET qna_open = false WHERE status = 'ENDED'", {
        transaction,
      })

      await queryInterface.addConstraint('sessions', {
        type: 'check',
        name: 'sessions_qna_closed_when_ended',
        fields: ['status', 'qna_open'],
        where: Sequelize.literal("status = 'ACTIVE' OR qna_open = false"),
        transaction,
      })
    })
  },

  // The down only loses the Q&A switch state (open/closed per session); no other data is affected.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeConstraint('sessions', 'sessions_qna_closed_when_ended', {
        transaction,
      })
      await queryInterface.removeColumn('sessions', 'qna_open', { transaction })
    })
  },
}
