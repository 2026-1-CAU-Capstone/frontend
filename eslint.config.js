import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      /* `_`-prefixed = intentionally unused (declared-API params, destructure
       * holes). Without these patterns the 11 deliberate `_foo` markers in the
       * codebase count as errors and bury real unused-var findings. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  /* ── 스튜디오 경계 ────────────────────────────────────────────────────
   * `src/studio/**` 는 **내부 제작 도구**다(솔로·릭 DB 구축, YouTube onset,
   * OMR·RAG 관리). 실서비스 번들에 한 글자도 들어가면 안 된다.
   *
   * 경계를 말로만 두면 새 라우트·새 import 에서 조용히 새어 나간다 — 실제로
   * `/preview/chord` 가 그렇게 어드민 화면을 비로그인에게 열어놨다. 그래서
   * 빌드가 막게 한다.
   *
   * 방향은 한쪽만 금지한다: studio → 공유 코드는 정상이고(오히려 그래야 하고),
   * 공유·실서비스 → studio 가 금지다. */
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/studio/**',
      /* 임시 예외 — App.tsx 가 아직 스튜디오 페이지 7개를 lazy import 한다.
       * 진입점을 둘로 쪼개면(app / studio) 이 예외는 삭제한다. */
      'src/App.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/studio/**', './studio/*', '../studio/*'],
          message: '실서비스 코드는 src/studio/** 를 import 할 수 없다 — 스튜디오는 별도 번들·별도 배포다.',
        }],
      }],
    },
  },
])
