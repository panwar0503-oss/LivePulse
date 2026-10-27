import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class KnowledgePassage extends Model<
  InferAttributes<KnowledgePassage>,
  InferCreationAttributes<KnowledgePassage>
> {
  declare id: CreationOptional<string>
  declare documentId: string
  declare sessionId: string
  declare ordinal: number
  declare pageNumber: number | null
  declare sectionNumber: number | null
  declare content: string
  // pgvector text form, e.g. '[0.1,0.2,...]' (build it with toPgVector). Read it back the same way.
  declare embedding: string
  declare createdAt: CreationOptional<Date>
}

// The generated tsv column is deliberately not mapped: the database computes it and rejects writes.
export const initKnowledgePassage = (sequelize: Sequelize): void => {
  KnowledgePassage.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      documentId: { type: DataTypes.UUID, allowNull: false },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      ordinal: { type: DataTypes.INTEGER, allowNull: false },
      pageNumber: { type: DataTypes.INTEGER, allowNull: true },
      sectionNumber: { type: DataTypes.INTEGER, allowNull: true },
      content: { type: DataTypes.TEXT, allowNull: false },
      // Sequelize has no vector type; the value is sent untyped and Postgres casts it to vector(384).
      embedding: { type: DataTypes.TEXT, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
    },
    {
      sequelize,
      tableName: 'knowledge_passages',
      modelName: 'KnowledgePassage',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    },
  )
}
