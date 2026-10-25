'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS vector', { transaction })
    })
  },

  // No CASCADE on purpose: this down FAILS if any vector column still exists, so it can never
  // silently drop embeddings. Undo the migrations that add vector columns first.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS vector', { transaction })
    })
  },
}
