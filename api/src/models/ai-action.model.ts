import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import { AI_ACTION_STATUSES, AI_ACTION_TYPES } from '@livepulse/shared'
import type { AiActionStatus, AiActionType } from '@livepulse/shared'

export class AiAction extends Model<InferAttributes<AiAction>, InferCreationAttributes<AiAction>> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare type: AiActionType
  declare status: CreationOptional<AiActionStatus>
  declare payload: Record<string, unknown>
  declare resultId: CreationOptional<string | null>
  declare errorCode: CreationOptional<string | null>
  declare errorMessage: CreationOptional<string | null>
  declare decidedAt: CreationOptional<Date | null>
  declare finishedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initAiAction = (sequelize: Sequelize): void => {
  AiAction.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM(...AI_ACTION_TYPES), allowNull: false },
      status: { type: DataTypes.ENUM(...AI_ACTION_STATUSES), allowNull: false, defaultValue: 'PROPOSED' },
      payload: { type: DataTypes.JSONB, allowNull: false },
      resultId: { type: DataTypes.UUID, allowNull: true },
      errorCode: { type: DataTypes.STRING(64), allowNull: true },
      errorMessage: { type: DataTypes.STRING(300), allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      finishedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'ai_actions',
      modelName: 'AiAction',
      underscored: true,
      timestamps: true,
    },
  )
}
