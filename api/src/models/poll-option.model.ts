import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class PollOption extends Model<InferAttributes<PollOption>, InferCreationAttributes<PollOption>> {
  declare id: CreationOptional<string>
  declare pollId: string
  declare label: string
  declare position: number
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initPollOption = (sequelize: Sequelize): void => {
  PollOption.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      pollId: { type: DataTypes.UUID, allowNull: false },
      label: { type: DataTypes.STRING(80), allowNull: false },
      position: { type: DataTypes.SMALLINT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'poll_options', modelName: 'PollOption', underscored: true, timestamps: true },
  )
}
