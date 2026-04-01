import { createGlobalStyle } from 'styled-components';
import { mq } from './theme';

export const GlobalStyle = createGlobalStyle`
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ${({ theme }) => theme.fonts.ui};
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.bgPrimary};
    overflow: hidden;

    ${mq.mobile} {
      overflow: auto;
    }
  }
  #root {
    width: 100%;
    height: 100vh;
    height: 100dvh;
  }
`;
