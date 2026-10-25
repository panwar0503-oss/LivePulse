import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import type { SessionStatus } from '@livepulse/shared'

export class Session extends Model<InferAttributes<Session>, InferCreationAttributes<Session>> {
  declare id: CreationOptional<string>
  declare roomCode: string
  declare title: string
  declare description: string | null
  declare presenterKeyHash: string
  declare status: CreationOptional<SessionStatus>
  declare endedAt: Date | null
  declare qnaOpen: CreationOptional<boolean>
  declare aiEnabled: CreationOptional<boolean>
  declare aiTokenBudget: CreationOptional<number>
  declare aiTokensUsed: CreationOptional<number>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initSession = (sequelize: Sequelize): void => {
  Session.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      roomCode: { type: DataTypes.CHAR(6), allowNull: false, unique: true },
      title: { type: DataTypes.STRING(80), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: true },
      presenterKeyHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      status: { type: DataTypes.ENUM('ACTIVE', 'ENDED'), allowNull: false, defaultValue: 'ACTIVE' },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      qnaOpen: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      aiEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      aiTokenBudget: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 200000 },
      aiTokensUsed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'sessions', modelName: 'Session', underscored: true, timestamps: true },
  )
}
