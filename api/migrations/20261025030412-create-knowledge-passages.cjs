'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Raw SQL: vector and generated tsvector columns have no Sequelize type. The vector extension
      // already exists (enable-pgvector migration).
      await queryInterface.sequelize.query(
        `CREATE TABLE knowledge_passages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
          session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          ordinal integer NOT NULL,
          page_number integer NULL,
          section_number integer NULL,
          content text NOT NULL,
          embedding vector(384) NOT NULL,
          tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT knowledge_passages_one_location CHECK ((page_number IS NULL) <> (section_number IS NULL)),
          CONSTRAINT knowledge_passages_content_length CHECK (char_length(content) BETWEEN 1 AND 4000),
          CONSTRAINT knowledge_passages_ordinal_positive CHECK (ordinal >= 1)
        )`,
        { transaction },
      )

      await queryInterface.addIndex('knowledge_passages', ['session_id'], {
        name: 'knowledge_passages_session_idx',
        transaction,
      })
      await queryInterface.addIndex('knowledge_passages', ['document_id', 'ordinal'], {
        name: 'knowledge_passages_document_ordinal_uq',
        unique: true,
        transaction,
      })
      await queryInterface.addIndex('knowledge_passages', ['tsv'], {
        name: 'knowledge_passages_tsv_gin',
        using: 'GIN',
        transaction,
      })
    })
  },

  // WARNING: destructive. down deletes ALL passages and embeddings. Test database only unless the
  // developer approves; never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('knowledge_passages', { transaction })
    })
  },
}
