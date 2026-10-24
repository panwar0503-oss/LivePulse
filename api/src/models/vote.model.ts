import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class Vote extends Model<InferAttributes<Vote>, InferCreationAttributes<Vote>> {
  declare id: CreationOptional<string>
  declare pollId: string
  declare optionId: string
  declare participantId: string
  declare createdAt: CreationOptional<Date>
}

export const initVote = (sequelize: Sequelize): void => {
  Vote.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      pollId: { type: DataTypes.UUID, allowNull: false },
      optionId: { type: DataTypes.UUID, allowNull: false },
      participantId: { type: DataTypes.UUID, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'votes',
      modelName: 'Vote',
      underscored: true,
      timestamps: true,
      // A vote is immutable: the table has no updated_at column.
      updatedAt: false,
    },
  )
}
