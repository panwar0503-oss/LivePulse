import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/.next/', '**/coverage/', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS config files (sequelize-cli) run under Node, so declare its globals explicitly.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { process: 'readonly', module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    // sequelize-cli loads its config with require(), so CommonJS config files must use it.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
