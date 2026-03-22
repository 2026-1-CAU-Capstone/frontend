import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ${({ theme }) => theme.fonts.ui};
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.bgPrimary};
    overflow: hidden;
  }
  #root {
    width: 100vw;
    height: 100vh;
  }
`;
