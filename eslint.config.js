// Flat config shared by all packages. Keep rules few and enforced, not advisory.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const nativePopups = ['alert', 'confirm', 'prompt'];
const popupMessage =
  'Use ConfirmDialog or a toast (apps/web/src/components/ui), not a browser popup.';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The browser's own popups do not belong in the web app: ask with `ConfirmDialog`, report
    // with a toast (apps/web/src/components/ui).
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...nativePopups.map((name) => ({ name, message: popupMessage })),
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          nativePopups.map((property) => ({ object, property, message: popupMessage })),
        ),
      ],
    },
  },
);
