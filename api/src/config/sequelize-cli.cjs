const { existsSync } = require('node:fs')
const { join } = require('node:path')

// Same local .env behaviour as the server; real environment variables take precedence.
const repoEnvFile = join(__dirname, '..', '..', '..', '.env')
if (existsSync(repoEnvFile)) {
  process.loadEnvFile(repoEnvFile)
}

const url = process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL is not set')
}

const config = { url, dialect: 'postgres' }

module.exports = { development: config, test: config, production: config }
