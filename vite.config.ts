import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Demo/test config — the library build has its own vite.lib.config.ts
// and writes to dist/; the demo goes here instead.
export default defineConfig({
  build: { outDir: 'demo-dist' },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // demo page, re-export barrel, type-only module — not library code
      exclude: ['src/main.ts', 'src/index.ts', 'src/ast.ts'],
      thresholds: { statements: 92, branches: 92, functions: 92, lines: 92 },
    },
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/browser/**', 'node_modules/**'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.spec.ts'],
          // 실브라우저(Chromium)에서만 검증되는 것들을 담는 계층 —
          // 네이티브 편집 의미론(요소 앵커 캐럿, 선택 삭제, Home/End 줄
          // 개념), 실 키보드 이벤트, execCommand, CSS 적용 (§9)
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
