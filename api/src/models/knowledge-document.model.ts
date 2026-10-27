import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'
import { KNOWLEDGE_DOCUMENT_STATUSES, KNOWLEDGE_FAILURE_REASONS } from '@livepulse/shared'
import type { KnowledgeDocumentStatus, KnowledgeFailureReason } from '@livepulse/shared'

export class KnowledgeDocument extends Model<
  InferAttributes<KnowledgeDocument>,
  InferCreationAttributes<KnowledgeDocument>
> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare aiJobId: CreationOptional<string | null>
  declare fileName: string
  declare mimeType: 'application/pdf' | 'text/plain'
  declare sizeBytes: number
  declare contentHash: string
  // Never returned to clients; cleared once processing finishes.
  declare content: CreationOptional<Buffer | null>
  declare status: KnowledgeDocumentStatus
  declare failureReason: CreationOptional<KnowledgeFailureReason | null>
  declare pageCount: CreationOptional<number | null>
  declare passageCount: CreationOptional<number | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initKnowledgeDocument = (sequelize: Sequelize): void => {
  KnowledgeDocument.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      aiJobId: { type: DataTypes.UUID, allowNull: true },
      fileName: { type: DataTypes.STRING(200), allowNull: false },
      mimeType: { type: DataTypes.STRING(64), allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
      contentHash: { type: DataTypes.CHAR(64), allowNull: false },
      content: { type: DataTypes.BLOB, allowNull: true },
      status: { type: DataTypes.ENUM(...KNOWLEDGE_DOCUMENT_STATUSES), allowNull: false },
      failureReason: {
        type: DataTypes.STRING(40),
        allowNull: true,
        validate: { isIn: [[...KNOWLEDGE_FAILURE_REASONS]] },
      },
      pageCount: { type: DataTypes.INTEGER, allowNull: true },
      passageCount: { type: DataTypes.INTEGER, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
    },
    {
      sequelize,
      tableName: 'knowledge_documents',
      modelName: 'KnowledgeDocument',
      underscored: true,
      timestamps: true,
    },
  )
}
