'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        "CREATE TYPE knowledge_document_status AS ENUM ('PROCESSING', 'READY', 'FAILED')",
        { transaction },
      )

      await queryInterface.createTable(
        'knowledge_documents',
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
          // The job may be pruned later; the document outlives it.
          ai_job_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'ai_jobs', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          file_name: { type: Sequelize.STRING(200), allowNull: false },
          mime_type: { type: Sequelize.STRING(64), allowNull: false },
          size_bytes: { type: Sequelize.INTEGER, allowNull: false },
          content_hash: { type: Sequelize.CHAR(64), allowNull: false },
          // Raw upload, cleared once processing finishes.
          content: { type: Sequelize.BLOB, allowNull: true },
          // Raw type name: the enum is created explicitly above, not by createTable.
          status: { type: 'knowledge_document_status', allowNull: false },
          failure_reason: { type: Sequelize.STRING(40), allowNull: true },
          page_count: { type: Sequelize.INTEGER, allowNull: true },
          passage_count: { type: Sequelize.INTEGER, allowNull: true },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('clock_timestamp()'),
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('clock_timestamp()'),
          },
        },
        { transaction },
      )

      // Final guard against the same file uploaded twice in one session (maps to 409).
      await queryInterface.addConstraint('knowledge_documents', {
        type: 'unique',
        name: 'uq_knowledge_documents_session_hash',
        fields: ['session_id', 'content_hash'],
        transaction,
      })

      const checks = [
        ['knowledge_documents_size_range', ['size_bytes'], 'size_bytes BETWEEN 1 AND 10485760'],
        ['knowledge_documents_mime_known', ['mime_type'], "mime_type IN ('application/pdf','text/plain')"],
        [
          'knowledge_documents_failed_has_reason',
          ['status', 'failure_reason'],
          "status <> 'FAILED' OR failure_reason IS NOT NULL",
        ],
      ]
      for (const [name, fields, sql] of checks) {
        await queryInterface.addConstraint('knowledge_documents', {
          type: 'check',
          name,
          fields,
          where: Sequelize.literal(sql),
          transaction,
        })
      }

      await queryInterface.addIndex('knowledge_documents', ['session_id', 'created_at'], {
        name: 'knowledge_documents_session_created_idx',
        transaction,
      })
    })
  },

  // WARNING: destructive. down deletes ALL uploaded documents; undo the passages migration first.
  // Run it on the test database only unless the developer approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('knowledge_documents', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS knowledge_document_status', { transaction })
    })
  },
}
