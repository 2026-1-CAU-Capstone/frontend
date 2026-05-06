import styled from 'styled-components';

export const MessageRow = styled.div<{ $role: 'user' | 'assistant' }>`
  display: flex;
  justify-content: ${({ $role }) => ($role === 'user' ? 'flex-end' : 'flex-start')};
  padding: 4px 0;
`;

export const Bubble = styled.div<{ $role: 'user' | 'assistant' }>`
  position: relative;
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.5;
  background: ${({ $role, theme }) =>
    $role === 'user' ? theme.colors.highlightIiVI : theme.colors.bgSecondary};
  color: #000;
  border: ${({ $role, theme }) =>
    $role === 'assistant' ? `1px solid ${theme.colors.border}` : 'none'};

  &:hover > button {
    opacity: 1;
  }
`;

export const CopyButton = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
  background: rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 14px;
  color: #555;
  transition: opacity 0.15s, background 0.15s;
  line-height: 1;

  &:hover {
    background: rgba(0, 0, 0, 0.12);
  }
`;

export const AssistantHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
`;

export const AssistantIcon = styled.div`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.gold}, ${({ theme }) => theme.colors.goldDark});
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
`;

export const AssistantName = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #333;
`;

export const MarkdownBody = styled.div`
  font-size: 13.5px;
  line-height: 1.65;
  color: #000;

  > *:first-child { margin-top: 0; }
  > *:last-child { margin-bottom: 0; }

  h3, h4 {
    margin: 14px 0 6px;
    font-size: 14px;
    font-weight: 700;
    color: #000;
  }

  h3 { font-size: 15px; }

  p {
    margin: 6px 0;
    color: #000;
  }

  strong {
    font-weight: 700;
    color: #000;
  }

  ul, ol {
    margin: 6px 0;
    padding-left: 18px;
  }

  li {
    margin: 4px 0;
    color: #000;
  }

  li > ul, li > ol {
    margin: 2px 0;
  }

  code {
    background: rgba(0, 0, 0, 0.06);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12.5px;
    color: #000;
  }

  pre {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 8px 0;

    code {
      background: none;
      padding: 0;
    }
  }

  hr {
    border: none;
    border-top: 1px solid rgba(0, 0, 0, 0.15);
    margin: 12px 0;
  }

  blockquote {
    border-left: 3px solid #000;
    margin: 8px 0;
    padding: 4px 12px;
    color: #333;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }

  th, td {
    border: 1px solid rgba(0, 0, 0, 0.15);
    padding: 8px;
    text-align: left;
  }

  th {
    background-color: rgba(0, 0, 0, 0.04);
    font-weight: 600;
    color: #000;
  }

  tr:nth-child(even) {
    background-color: rgba(0, 0, 0, 0.02);
  }
`;
