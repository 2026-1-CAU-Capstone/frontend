import styled from 'styled-components';
import { ProgressionArrow } from './ProgressionArrow';

export const MessageRow = styled.div<{ $role: 'user' | 'assistant' }>`
  display: flex;
  justify-content: ${({ $role }) => ($role === 'user' ? 'flex-end' : 'flex-start')};
  padding: ${({ $role }) => ($role === 'assistant' ? '10px 0' : '4px 0')};
  ${({ $role }) => $role === 'assistant' && 'width: 100%;'}
`;

export const Bubble = styled.div<{ $role: 'user' | 'assistant' }>`
  position: relative;

  ${({ $role, theme }) =>
    $role === 'user'
      ? `
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 16px;
    background: ${theme.colors.highlightIiVI};
    border: none;
  `
      : `
    width: 100%;
    padding: 0;
    border-radius: 0;
    background: transparent;
    border: none;
  `}

  font-size: 14px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textPrimary};

  &:hover > button {
    opacity: 1;
  }
`;

export const CopyButton = styled.button`
  position: absolute;
  top: 0;
  right: 0;
  opacity: 0;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  transition: opacity 0.15s, background 0.15s;
  line-height: 1;

  &:hover {
    background: ${({ theme }) => theme.colors.border};
  }
`;

export const AssistantHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
`;

export const AssistantIcon = styled.div`
  width: 22px;
  height: 22px;
  border-radius: 5px;
  overflow: hidden;
  flex-shrink: 0;
  display: block;
`;

export const AssistantName = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

export const UserSelectedContext = styled.div`
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.45);
`;

export const UserSelectedLabel = styled.div`
  margin-bottom: 5px;
  color: rgba(0, 0, 0, 0.58);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.2;
`;

export const UserSelectedChordRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

export const UserSelectedChordStep = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

export const UserSelectedChord = styled.span`
  display: inline-flex;
  align-items: center;
  font-family: 'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1;
  color: #000;

  span {
    font-family: 'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif !important;
    font-size: inherit !important;
    letter-spacing: 0 !important;
  }
`;

export const UserSelectedArrow = styled(ProgressionArrow)`
  flex: 0 0 auto;
  width: 17px;
  height: 9px;
  color: rgba(0, 0, 0, 0.44);
  transform: translateY(1px);
`;

export const UserQuestionText = styled.div`
  white-space: pre-wrap;
`;

export const MarkdownBody = styled.div`
  font-size: 15px; /* Increased from 13.5px */
  line-height: 1.65;
  color: ${({ theme }) => theme.colors.textPrimary};

  > *:first-child { margin-top: 0; }
  > *:last-child { margin-bottom: 0; }

  h3, h4 {
    margin: 14px 0 6px;
    font-size: 16px;
    font-weight: 700;
  }

  h3 { font-size: 17px; }

  p { margin: 6px 0; }

  strong { font-weight: 700; }

  ul, ol {
    margin: 6px 0;
    padding-left: 18px;
  }

  li { margin: 4px 0; }

  li > ul, li > ol { margin: 2px 0; }

  code {
    background: ${({ theme }) => theme.colors.bgSecondary};
    border: 1px solid ${({ theme }) => theme.colors.border};
    padding: 1px 5px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 14px; /* Increased from 12.5px */
  }

  pre {
    background: ${({ theme }) => theme.colors.bgSecondary};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 8px 0;

    &:has(.glick-container) {
      background: none;
      border: none;
      padding: 0;
      overflow: visible;
    }

    code {
      background: none;
      border: none;
      padding: 0;
    }
  }

  hr {
    border: none;
    border-top: 1px solid ${({ theme }) => theme.colors.border};
    margin: 12px 0;
  }

  blockquote {
    border-left: 3px solid ${({ theme }) => theme.colors.border};
    margin: 8px 0;
    padding: 4px 12px;
    color: ${({ theme }) => theme.colors.textSecondary};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }

  th, td {
    border: 1px solid ${({ theme }) => theme.colors.border};
    padding: 8px;
    text-align: left;
  }

  th {
    background-color: ${({ theme }) => theme.colors.bgSecondary};
    font-weight: 600;
  }

  tr:nth-child(even) {
    background-color: ${({ theme }) => theme.colors.bgSecondary};
  }
`;
