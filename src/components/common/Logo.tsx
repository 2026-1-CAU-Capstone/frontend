import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';

const LogoIcon = styled.img`
  width: 28px;
  height: 28px;
  border-radius: 7px;
  object-fit: cover;
  cursor: pointer;
  transition: opacity 0.15s;

  &:hover {
    opacity: 0.82;
  }

  ${mq.mobile} {
    width: 24px;
    height: 24px;
    border-radius: 6px;
  }
`;

export function Logo() {
  const navigate = useNavigate();
  return (
    <LogoIcon src="/jazzifylogo.png" alt="Jazzify" onClick={() => navigate('/')} />
  );
}
