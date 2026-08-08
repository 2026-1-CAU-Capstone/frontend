import { ThemeProvider } from 'styled-components';
import { theme } from '../styles/theme';
import { darkTheme } from '../styles/darkTheme';
import { GlobalStyle } from '../styles/global';
import { useIsDark } from '../lib/themePrefs';
import StudioApp from './StudioApp';

/* 스튜디오의 테마 선택 지점 — 실서비스의 Root.tsx 와 짝. 테마·전역 스타일은
 * 같은 것을 쓰고(디자인이 같아야 하므로) 그 아래 앱만 다르다.
 *
 * Root.tsx 를 그대로 재사용하지 않는 이유: 그쪽은 App(실서비스)을 직접 렌더해서,
 * 재사용하면 스튜디오 번들에 실서비스 전체가 끌려 들어온다. */
export function StudioRoot() {
  const dark = useIsDark();
  return (
    <ThemeProvider theme={dark ? darkTheme : theme}>
      <GlobalStyle />
      <StudioApp />
    </ThemeProvider>
  );
}
