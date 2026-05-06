import styled from 'styled-components';

export const CardContainer = styled.div`
  padding: 12px;
  margin: 8px 0;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
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
  min-width: 0;
`;

export const ChordChip = styled.span<{ $func: 'T' | 'SD' | 'D' }>`
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  max-width: 100%;
  min-width: 0;
  gap: 4px;
  padding: 4px 8px;
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
  overflow: hidden;
`;

export const Arrow = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

export const ChordStep = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
`;

export const MoreChip = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  font-weight: 600;
`;

export const CardBody = styled.p`
  font-size: 13px;
  line-height: 1.6;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0;
`;
