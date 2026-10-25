import { DataTypes, Model } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import { AI_JOB_STATUSES, AI_TASK_TYPES } from '@livepulse/shared'
import type { AiTaskType } from '@livepulse/shared'

export type AiJobStatus = (typeof AI_JOB_STATUSES)[number]
type JsonObject = Record<string, unknown>

export class AiJob extends Model<InferAttributes<AiJob>, InferCreationAttributes<AiJob>> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare type: AiTaskType
  declare status: CreationOptional<AiJobStatus>
  declare attempts: CreationOptional<number>
  declare maxAttempts: CreationOptional<number>
  declare runAfter: CreationOptional<Date>
  declare input: JsonObject
  declare output: CreationOptional<JsonObject | null>
  declare errorCode: CreationOptional<string | null>
  declare model: CreationOptional<string | null>
  declare promptVersion: CreationOptional<string | null>
  declare inputTokens: CreationOptional<number>
  declare outputTokens: CreationOptional<number>
  declare reservedTokens: CreationOptional<number>
  declare latencyMs: CreationOptional<number | null>
  declare dedupeKey: CreationOptional<string | null>
  declare startedAt: CreationOptional<Date | null>
  declare finishedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initAiJob = (sequelize: Sequelize): void => {
  AiJob.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING(40), allowNull: false, validate: { isIn: [[...AI_TASK_TYPES]] } },
      status: {
        type: DataTypes.ENUM(...AI_JOB_STATUSES),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      attempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
      maxAttempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 3 },
      runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      input: { type: DataTypes.JSONB, allowNull: false },
      output: { type: DataTypes.JSONB, allowNull: true },
      errorCode: { type: DataTypes.STRING(40), allowNull: true },
      model: { type: DataTypes.STRING(100), allowNull: true },
      promptVersion: { type: DataTypes.STRING(40), allowNull: true },
      inputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      outputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      reservedTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      latencyMs: { type: DataTypes.INTEGER, allowNull: true },
      dedupeKey: { type: DataTypes.STRING(200), allowNull: true },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'ai_jobs', modelName: 'AiJob', underscored: true, timestamps: true },
  )
}
