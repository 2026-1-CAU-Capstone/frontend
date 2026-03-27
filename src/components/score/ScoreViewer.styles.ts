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
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-radius: 4px;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  overflow: hidden;
  align-self: flex-start;
`;

export const ScoreImage = styled.img`
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
  -webkit-user-drag: none;
`;

export const OverlayLayer = styled.div`
  position: absolute;
  inset: 0;
`;

export const PlaceholderPage = styled.div`
  width: 100%;
  aspect-ratio: 0.77;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  gap: 8px;
`;

export const PlaceholderIcon = styled.div`
  font-size: 48px;
  opacity: 0.3;
`;
