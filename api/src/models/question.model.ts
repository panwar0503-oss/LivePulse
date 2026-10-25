import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class Question extends Model<InferAttributes<Question>, InferCreationAttributes<Question>> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare participantId: string
  declare text: string
  declare textKey: string
  declare hidden: CreationOptional<boolean>
  declare pinned: CreationOptional<boolean>
  declare answerText: string | null
  declare answeredAt: Date | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initQuestion = (sequelize: Sequelize): void => {
  Question.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      participantId: { type: DataTypes.UUID, allowNull: false },
      text: { type: DataTypes.STRING(200), allowNull: false },
      textKey: { type: DataTypes.STRING(400), allowNull: false },
      hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      answerText: { type: DataTypes.STRING(500), allowNull: true },
      answeredAt: { type: DataTypes.DATE, allowNull: true },
      // Database clock at insert, so it is comparable with closed_at, which is also set by the database.
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'questions', modelName: 'Question', underscored: true, timestamps: true },
  )
}
