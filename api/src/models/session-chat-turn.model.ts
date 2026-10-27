import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import { CHAT_TURN_STATUSES } from '@livepulse/shared'
import type { ChatSource } from '@livepulse/shared'

export type ChatTurnStatus = (typeof CHAT_TURN_STATUSES)[number]

export class SessionChatTurn extends Model<
  InferAttributes<SessionChatTurn>,
  InferCreationAttributes<SessionChatTurn>
> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare clientMessageId: string
  declare question: string
  declare answer: CreationOptional<string | null>
  declare status: ChatTurnStatus
  declare errorCode: CreationOptional<string | null>
  declare sources: CreationOptional<ChatSource[]>
  declare aiJobId: CreationOptional<string | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initSessionChatTurn = (sequelize: Sequelize): void => {
  SessionChatTurn.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      clientMessageId: { type: DataTypes.UUID, allowNull: false },
      question: { type: DataTypes.STRING(500), allowNull: false },
      answer: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM(...CHAT_TURN_STATUSES), allowNull: false },
      errorCode: { type: DataTypes.STRING(40), allowNull: true },
      sources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      aiJobId: { type: DataTypes.UUID, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'session_chat_turns',
      modelName: 'SessionChatTurn',
      underscored: true,
      timestamps: true,
    },
  )
}
