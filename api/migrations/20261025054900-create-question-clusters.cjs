'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Raw SQL: vector has no Sequelize type. The vector extension already exists (enable-pgvector).
      await queryInterface.sequelize.query(
        `CREATE TABLE question_clusters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          centroid vector(384) NOT NULL,
          size integer NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT question_clusters_size_positive CHECK (size >= 1)
        )`,
        { transaction },
      )

      await queryInterface.addIndex('question_clusters', ['session_id'], {
        name: 'question_clusters_session_idx',
        transaction,
      })
    })
  },

  // WARNING: destructive. down deletes ALL question clusters. Test database only unless the
  // developer approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('question_clusters', { transaction })
    })
  },
}
