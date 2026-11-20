import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'next-env.d.ts',
      'test-results/**',
      'playwright-report/**',
      'data/**',
      'backups/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='$queryRawUnsafe']",
          message: '$queryRawUnsafe 금지: tagged $queryRaw 를 사용하세요.',
        },
        {
          selector: "MemberExpression[property.name='$executeRawUnsafe']",
          message: '$executeRawUnsafe 금지: tagged $executeRaw 를 사용하세요.',
        },
      ],
    },
  },
];

export default config;
