import styled from 'styled-components';

/* 스튜디오 워드마크(public/jazzify-studio.png).
 *
 * 로고 안에 이미 "Studio" 가 들어 있어서 별도 STUDIO 배지는 쓰지 않는다.
 * 검정 단색 PNG 라 실서비스 워드마크와 같은 방식으로 다크에서 반전시킨다
 * (BrandLogoImage 참조 — 밝은 버전 에셋을 따로 두는 대신 filter 로 뒤집는다). */
export const StudioLogo = styled.img.attrs({
  src: `${import.meta.env.BASE_URL}jazzify-studio.png`,
  alt: 'Jazzify Studio',
  draggable: false,
})<{ $h: number; $clickable?: boolean }>`
  display: block;
  height: ${({ $h }) => $h}px;
  width: auto;
  user-select: none;
  -webkit-user-drag: none;
  ${({ theme }) => theme.mode === 'dark' && 'filter: invert(1);'}
  ${({ $clickable }) => ($clickable ? 'cursor: pointer;' : '')}
`;
