import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import { DRAFT_OUTCOMES, DRAFT_STATUSES } from '@livepulse/shared'
import type { DraftCitation, DraftOutcome, DraftStatus } from '@livepulse/shared'

export class AiAnswerDraft extends Model<
  InferAttributes<AiAnswerDraft>,
  InferCreationAttributes<AiAnswerDraft>
> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare questionId: string
  declare jobId: CreationOptional<string | null>
  declare status: DraftStatus
  declare outcome: CreationOptional<DraftOutcome | null>
  declare draftText: CreationOptional<string | null>
  declare approvedText: CreationOptional<string | null>
  declare language: CreationOptional<string | null>
  declare confidence: CreationOptional<number | null>
  declare citations: CreationOptional<DraftCitation[]>
  declare draftAttempts: CreationOptional<number>
  declare reviewedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initAiAnswerDraft = (sequelize: Sequelize): void => {
  AiAnswerDraft.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      questionId: { type: DataTypes.UUID, allowNull: false, unique: true },
      jobId: { type: DataTypes.UUID, allowNull: true },
      status: { type: DataTypes.ENUM(...DRAFT_STATUSES), allowNull: false },
      outcome: { type: DataTypes.ENUM(...DRAFT_OUTCOMES), allowNull: true },
      draftText: { type: DataTypes.STRING(500), allowNull: true },
      approvedText: { type: DataTypes.STRING(500), allowNull: true },
      language: { type: DataTypes.STRING(16), allowNull: true },
      confidence: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        // pg returns numeric as a string; expose it as a number.
        get(): number | null {
          const raw: unknown = this.getDataValue('confidence')
          return raw === null || raw === undefined ? null : Number(raw)
        },
      },
      citations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      draftAttempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'ai_answer_drafts',
      modelName: 'AiAnswerDraft',
      underscored: true,
      timestamps: true,
    },
  )
}
