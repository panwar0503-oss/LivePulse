import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export type WordPromptStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED'

export class WordPrompt extends Model<InferAttributes<WordPrompt>, InferCreationAttributes<WordPrompt>> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare question: string
  declare status: CreationOptional<WordPromptStatus>
  declare showCloud: CreationOptional<boolean>
  declare closedAt: Date | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initWordPrompt = (sequelize: Sequelize): void => {
  WordPrompt.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      question: { type: DataTypes.STRING(200), allowNull: false },
      status: {
        type: DataTypes.ENUM('DRAFT', 'ACTIVE', 'CLOSED'),
        allowNull: false,
        defaultValue: 'DRAFT',
      },
      showCloud: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      closedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'word_prompts', modelName: 'WordPrompt', underscored: true, timestamps: true },
  )
}
