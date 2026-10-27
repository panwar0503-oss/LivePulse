import { DataTypes, Model, literal } from 'sequelize'
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize'

export class QuestionCluster extends Model<
  InferAttributes<QuestionCluster>,
  InferCreationAttributes<QuestionCluster>
> {
  declare id: CreationOptional<string>
  declare sessionId: string
  // pgvector text form, e.g. '[0.1,0.2,...]' (build it with toPgVector): running mean of members.
  declare centroid: string
  declare size: number
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export const initQuestionCluster = (sequelize: Sequelize): void => {
  QuestionCluster.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false },
      // Sequelize has no vector type; the value is sent untyped and Postgres casts it to vector(384).
      centroid: { type: DataTypes.TEXT, allowNull: false },
      size: { type: DataTypes.INTEGER, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    {
      sequelize,
      tableName: 'question_clusters',
      modelName: 'QuestionCluster',
      underscored: true,
      timestamps: true,
    },
  )
}
