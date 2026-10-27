import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import { REVIEW_STATES } from '@livepulse/shared'
import type { DraftCitation, ModerationLabel, ReviewState } from '@livepulse/shared'

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
  declare reviewState: CreationOptional<ReviewState>
  declare moderationLabel: CreationOptional<ModerationLabel | null>
  declare duplicateOfId: CreationOptional<string | null>
  // pgvector text form, e.g. '[0.1,0.2,...]' (build it with toPgVector).
  declare embedding: CreationOptional<string | null>
  declare aiStep: CreationOptional<string | null>
  declare clusterId: CreationOptional<string | null>
  declare answerSource: CreationOptional<string | null>
  declare answerCitations: CreationOptional<DraftCitation[] | null>
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
      // The column uses the named Postgres type qna_review_state (created by its migration).
      reviewState: { type: DataTypes.ENUM(...REVIEW_STATES), allowNull: false, defaultValue: 'VISIBLE' },
      moderationLabel: { type: DataTypes.STRING(16), allowNull: true },
      duplicateOfId: { type: DataTypes.UUID, allowNull: true },
      // Sequelize has no vector type; the value is sent untyped and Postgres casts it to vector(384).
      embedding: { type: DataTypes.TEXT, allowNull: true },
      aiStep: { type: DataTypes.STRING(24), allowNull: true },
      clusterId: { type: DataTypes.UUID, allowNull: true },
      answerSource: { type: DataTypes.STRING(16), allowNull: true },
      answerCitations: { type: DataTypes.JSONB, allowNull: true },
      // Database clock at insert, so it is comparable with closed_at, which is also set by the database.
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'questions', modelName: 'Question', underscored: true, timestamps: true },
  )
}
