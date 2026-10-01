import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      // Node globals, plus browser globals used inside puppeteer page callbacks.
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Generation must be reproducible: all randomness goes through the seeded generator.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG, not Math.random().' },
      ],
    },
  },
);
