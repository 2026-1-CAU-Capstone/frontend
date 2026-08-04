import { ThemeProvider } from 'styled-components';
import { theme } from './styles/theme';
import { darkTheme } from './styles/darkTheme';
import { GlobalStyle } from './styles/global';
import { useIsDark } from './lib/themePrefs';
import App from './App';

/* 테마 선택은 여기 한 곳 — 설정(모양)이나 OS 설정이 바뀌면 즉시 반영된다.
 * 다크 색은 styles/darkTheme.ts 가 소유한다(구조는 라이트와 동일). */
export function Root() {
  const dark = useIsDark();
  return (
    <ThemeProvider theme={dark ? darkTheme : theme}>
      <GlobalStyle />
      <App />
    </ThemeProvider>
  );
}
