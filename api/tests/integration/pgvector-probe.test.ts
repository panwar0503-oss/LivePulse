import { Sequelize, type Transaction } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { toPgVector } from '../../src/ai/vector.js'
import { assertTestDatabaseUrl } from '../helpers/test-db.js'

class Rollback extends Error {}

describe('pgvector', () => {
  let sequelize: Sequelize

  beforeAll(() => {
    sequelize = new Sequelize(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.NODE_ENV), {
      dialect: 'postgres',
      logging: false,
    })
  })

  afterAll(async () => {
    await sequelize.close()
  })

  // Runs inside a transaction that is always rolled back, so nothing persists.
  const inRolledBackTransaction = async <T>(run: (t: Transaction) => Promise<T>): Promise<T | undefined> => {
    let result: T | undefined
    try {
      await sequelize.transaction(async (t) => {
        result = await run(t)
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    }
    return result
  }

  it('pgvector stores vectors and returns the nearest rows by distance', async () => {
    const [a, b, c] = await createFakeEmbeddings(3).embed(['alpha', 'beta', 'gamma'])
    if (!a || !b || !c) throw new Error('fake embeddings returned too few vectors')

    const rows = await inRolledBackTransaction(async (transaction) => {
      await sequelize.query('CREATE TEMP TABLE probe (id int, embedding vector(3))', { transaction })
      for (const [id, v] of [
        [1, a],
        [2, b],
        [3, c],
      ] as const) {
        await sequelize.query('INSERT INTO probe (id, embedding) VALUES (:id, :embedding::vector)', {
          replacements: { id, embedding: toPgVector(v, 3) },
          transaction,
        })
      }
      const [found] = await sequelize.query(
        'SELECT id FROM probe ORDER BY embedding <=> :q::vector LIMIT 1',
        {
          replacements: { q: toPgVector(b, 3) },
          transaction,
        },
      )
      return found
    })

    expect(rows).toEqual([{ id: 2 }])
  })

  it('pgvector rejects a vector of the wrong dimension', async () => {
    await expect(
      inRolledBackTransaction(async (transaction) => {
        await sequelize.query('CREATE TEMP TABLE probe (embedding vector(3))', { transaction })
        await sequelize.query('INSERT INTO probe (embedding) VALUES (:e::vector)', {
          replacements: { e: '[1,2]' },
          transaction,
        })
      }),
    ).rejects.toThrow(/dimensions/i)
  })
})
