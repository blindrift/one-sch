import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      // 'server-only' 는 Next 번들러 밖에서는 항상 throw 하므로 테스트에서는 빈 모듈로 바꾼다.
      'server-only': r('./tests/stubs/empty.ts'),
    },
  },
  test: {
    environment: 'node',
    // next.config 의 experimental.authInterrupts 를 켜면 Next 빌드가 주입하는 값(forbidden() 사용 조건)
    env: { __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS: 'true' },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
