import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class WordResponse extends Model<
  InferAttributes<WordResponse>,
  InferCreationAttributes<WordResponse>
> {
  declare id: CreationOptional<string>
  declare promptId: string
  declare participantId: string
  declare normalizedWord: string
  declare displayWord: string
  declare createdAt: CreationOptional<Date>
}

export const initWordResponse = (sequelize: Sequelize): void => {
  WordResponse.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      promptId: { type: DataTypes.UUID, allowNull: false },
      participantId: { type: DataTypes.UUID, allowNull: false },
      normalizedWord: { type: DataTypes.STRING(120), allowNull: false },
      displayWord: { type: DataTypes.STRING(30), allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'word_responses',
      modelName: 'WordResponse',
      underscored: true,
      timestamps: true,
      // An answer is final: the table has no updated_at column.
      updatedAt: false,
    },
  )
}
