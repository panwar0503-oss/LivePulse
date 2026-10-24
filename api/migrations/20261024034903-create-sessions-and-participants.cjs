'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("CREATE TYPE enum_sessions_status AS ENUM ('ACTIVE', 'ENDED')", {
        transaction,
      })

      await queryInterface.createTable(
        'sessions',
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          room_code: { type: Sequelize.CHAR(6), allowNull: false, unique: true },
          title: { type: Sequelize.STRING(80), allowNull: false },
          description: { type: Sequelize.STRING(500), allowNull: true },
          presenter_key_hash: { type: Sequelize.CHAR(64), allowNull: false, unique: true },
          // Raw type name: the enum is created explicitly above, not by createTable.
          status: { type: 'enum_sessions_status', allowNull: false, defaultValue: 'ACTIVE' },
          ended_at: { type: Sequelize.DATE, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addConstraint('sessions', {
        type: 'check',
        name: 'sessions_ended_at_matches_status',
        fields: ['status', 'ended_at'],
        where: Sequelize.literal("(status = 'ENDED') = (ended_at IS NOT NULL)"),
        transaction,
      })

      await queryInterface.addConstraint('sessions', {
        type: 'check',
        name: 'sessions_room_code_format',
        fields: ['room_code'],
        where: Sequelize.literal("room_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'"),
        transaction,
      })

      await queryInterface.createTable(
        'participants',
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
          display_name: { type: Sequelize.STRING(30), allowNull: false },
          token_hash: { type: Sequelize.CHAR(64), allowNull: false, unique: true },
          last_seen_at: { type: Sequelize.DATE, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      )

      await queryInterface.addIndex('participants', ['session_id'], {
        name: 'participants_session_id_idx',
        transaction,
      })
    })
  },

  // WARNING: down destroys ALL session and participant data. Do not run it on a database
  // with real data without explicit approval.
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('participants', { transaction })
      await queryInterface.dropTable('sessions', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_sessions_status', {
        transaction,
      })
    })
  },
}
