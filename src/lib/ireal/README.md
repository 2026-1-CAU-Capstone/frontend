# lib/ireal

`irealLoader.ts`만 실사용 (ChordPage/NotePage가 빌드타임 변환된 JSON을 로드).

iReal URL 직접 파싱 파이프라인(decode/tokenize/parse/types/index/midiChart,
~1,000줄)은 어디서도 import되지 않는 데드코드라 2026-06-11 제거했다.
빌드타임 대체는 `scripts/convert-ireal.cjs`(자체 독립 구현).
필요해지면 git 이력에서 복원할 것.
