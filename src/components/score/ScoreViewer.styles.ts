import styled from 'styled-components';

export const ViewerContainer = styled.div`
  flex: 1;
  overflow: auto;
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  justify-content: center;
  padding: 24px;
`;

export const ScorePage = styled.div`
  position: relative;
  width: 100%;
  max-width: 800px;
  aspect-ratio: 0.77;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-radius: 4px;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  overflow: hidden;
`;

export const ScoreBackground = styled.div`
  width: 100%;
  height: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  display: flex;
  flex-direction: column;
  padding: 32px;
`;

export const ScoreTitle = styled.h2`
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 4px;
`;

export const ScoreSubtitle = styled.p`
  text-align: center;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 24px;
`;

export const StaffLine = styled.div`
  position: relative;
  width: 100%;
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
  margin: 36px 0;
`;

export const StaffGroup = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;
