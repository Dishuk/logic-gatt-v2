/**
 * Lint rules for the desktop app.
 *
 * Formatting is Prettier's job — `eslint-config-prettier` goes last so no rule here
 * argues with it. What is left is correctness: unused code, unsafe types, and the
 * React hook rules, which matter in a codebase that leans on refs and effects to keep
 * the runtime in step with the editor.
 */

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      'artifacts/**',
      'vendor/**',
      // Vendored Python bridge, not our source.
      'src/bun/modules/plugins/usb-ble/python/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // An unused name is either a leftover or a bug. Leading-underscore opts out,
      // which the codebase already uses for deliberately-ignored parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Warn rather than error: the transport and native-module boundaries genuinely
      // hand us `any`, and each one should be narrowed deliberately, not silenced in a
      // sweep. Visible in the report without failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',

      // The next two are errors in react-hooks' recommended set, downgraded here on
      // purpose. Both flag patterns this app uses deliberately and pervasively, and
      // both would need the runtime/editor wiring reworked rather than tidied:
      //
      //   refs — `ref.current = value` during render, the seam that lets the runtime
      //     read the latest scenarios/functions/variables from async callbacks. Safe as
      //     long as no concurrent feature can discard a render (this app uses none),
      //     but it is a latent hazard worth migrating to effect-time writes.
      //   set-state-in-effect — `setLoading(true)` before a fetch, and similar. Costs a
      //     render, is not incorrect.
      //
      // Left visible so neither is forgotten; raise to 'error' once they are cleared.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  {
    files: ['**/__tests__/**/*.{ts,tsx}'],
    rules: {
      // Test doubles stand in for browser types the suite cannot construct in full.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['src/mainview/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  prettier
)
