import { DataTypes, Model, literal } from 'sequelize'
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
      // Database clock at insert, so it is comparable with closed_at, which is also set by the database.
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
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
