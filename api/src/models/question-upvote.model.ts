import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class QuestionUpvote extends Model<
  InferAttributes<QuestionUpvote>,
  InferCreationAttributes<QuestionUpvote>
> {
  declare id: CreationOptional<string>
  declare questionId: string
  declare participantId: string
  declare createdAt: CreationOptional<Date>
}

export const initQuestionUpvote = (sequelize: Sequelize): void => {
  QuestionUpvote.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      questionId: { type: DataTypes.UUID, allowNull: false },
      participantId: { type: DataTypes.UUID, allowNull: false },
      // Database clock at insert, so it is comparable with closed_at, which is also set by the database.
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
    },
    {
      sequelize,
      tableName: 'question_upvotes',
      modelName: 'QuestionUpvote',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    },
  )
}
