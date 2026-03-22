import styled from 'styled-components';

export const CardContainer = styled.div`
  padding: 12px;
  margin: 8px 0;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

export const CardTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 8px;
`;

export const ChordChipRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  flex-wrap: wrap;
`;

export const ChordChip = styled.span<{ $func: 'T' | 'SD' | 'D' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.fonts.chord};
  background: ${({ $func, theme }) =>
    $func === 'T'
      ? theme.colors.highlightIiVI
      : $func === 'D'
        ? theme.colors.highlightSecDom
        : theme.colors.highlightModal};
  color: ${({ $func, theme }) =>
    $func === 'T'
      ? theme.colors.tonic
      : $func === 'D'
        ? theme.colors.dominant
        : theme.colors.subdominant};
`;

export const Arrow = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

export const CardBody = styled.p`
  font-size: 13px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.textPrimary};
`;
