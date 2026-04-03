import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';

const LogoIcon = styled.img`
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
  cursor: pointer;

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
