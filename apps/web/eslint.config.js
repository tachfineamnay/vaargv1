const tseslint = require('typescript-eslint');
const nextPlugin = require('@next/eslint-plugin-next');
const prettier = require('eslint-plugin-prettier');

module.exports = tseslint.config(
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['node_modules/', 'dist/', '.next/', '*.config.*', 'next-env.d.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      '@next/next': nextPlugin,
      prettier: prettier,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'react/no-unescaped-entities': 'off',
      'prettier/prettier': 'error',
    },
  }
);
