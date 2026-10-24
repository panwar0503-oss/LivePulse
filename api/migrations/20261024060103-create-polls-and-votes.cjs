'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        "CREATE TYPE enum_polls_status AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED')",
        { transaction },
      )

      await queryInterface.createTable(
        'polls',
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
          status: { type: 'enum_polls_status', allowNull: false, defaultValue: 'DRAFT' },
          show_results: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          closed_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('polls', {
        type: 'check',
        name: 'polls_closed_at_matches_status',
        fields: ['status', 'closed_at'],
        where: Sequelize.literal("(status = 'CLOSED') = (closed_at IS NOT NULL)"),
        transaction,
      })

      await queryInterface.addConstraint('polls', {
        type: 'check',
        name: 'polls_question_not_blank',
        fields: ['question'],
        where: Sequelize.literal('length(btrim(question)) > 0'),
        transaction,
      })

      await queryInterface.addIndex('polls', ['session_id', 'created_at'], {
        name: 'polls_session_created_idx',
        transaction,
      })

      // At most one open poll per session; the database is the final guard against races.
      await queryInterface.sequelize.query(
        "CREATE UNIQUE INDEX polls_one_active_per_session ON polls (session_id) WHERE status = 'ACTIVE'",
        { transaction },
      )

      await queryInterface.createTable(
        'poll_options',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          poll_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'polls', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          label: { type: Sequelize.STRING(80), allowNull: false },
          position: { type: Sequelize.SMALLINT, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('poll_options', {
        type: 'unique',
        name: 'poll_options_poll_position_key',
        fields: ['poll_id', 'position'],
        transaction,
      })

      await queryInterface.addConstraint('poll_options', {
        type: 'unique',
        name: 'poll_options_poll_label_key',
        fields: ['poll_id', 'label'],
        transaction,
      })

      // Target of the composite FK from votes: guarantees a vote's option belongs to its poll.
      await queryInterface.addConstraint('poll_options', {
        type: 'unique',
        name: 'poll_options_id_poll_key',
        fields: ['id', 'poll_id'],
        transaction,
      })

      await queryInterface.addConstraint('poll_options', {
        type: 'check',
        name: 'poll_options_position_range',
        fields: ['position'],
        where: Sequelize.literal('position BETWEEN 0 AND 5'),
        transaction,
      })

      await queryInterface.addConstraint('poll_options', {
        type: 'check',
        name: 'poll_options_label_not_blank',
        fields: ['label'],
        where: Sequelize.literal('length(btrim(label)) > 0'),
        transaction,
      })

      await queryInterface.createTable(
        'votes',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          poll_id: { type: Sequelize.UUID, allowNull: false },
          option_id: { type: Sequelize.UUID, allowNull: false },
          participant_id: { type: Sequelize.UUID, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('votes', {
        type: 'foreign key',
        name: 'votes_poll_id_fkey',
        fields: ['poll_id'],
        references: { table: 'polls', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      })

      await queryInterface.addConstraint('votes', {
        type: 'foreign key',
        name: 'votes_participant_id_fkey',
        fields: ['participant_id'],
        references: { table: 'participants', field: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction,
      })

      // Raw SQL: queryInterface cannot declare a composite foreign key.
      await queryInterface.sequelize.query(
        'ALTER TABLE votes ADD CONSTRAINT votes_option_poll_fkey FOREIGN KEY (option_id, poll_id) ' +
          'REFERENCES poll_options (id, poll_id) ON DELETE CASCADE ON UPDATE CASCADE',
        { transaction },
      )

      await queryInterface.addConstraint('votes', {
        type: 'unique',
        name: 'votes_poll_participant_key',
        fields: ['poll_id', 'participant_id'],
        transaction,
      })

      await queryInterface.addIndex('votes', ['poll_id', 'option_id'], {
        name: 'votes_poll_option_idx',
        transaction,
      })
    })
  },

  // WARNING: down deletes ALL poll and vote data. Never run it on a database with real data
  // without the developer's approval, and never use db:migrate:undo:all.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('votes', { transaction })
      await queryInterface.dropTable('poll_options', { transaction })
      await queryInterface.dropTable('polls', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_polls_status', {
        transaction,
      })
    })
  },
}
