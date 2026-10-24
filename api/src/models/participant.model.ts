import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class Participant extends Model<InferAttributes<Participant>, InferCreationAttributes<Participant>> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare displayName: string
  declare tokenHash: string
  declare lastSeenAt: Date
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initParticipant = (sequelize: Sequelize): void => {
  Participant.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      displayName: { type: DataTypes.STRING(30), allowNull: false },
      tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'participants', modelName: 'Participant', underscored: true, timestamps: true },
  )
}
