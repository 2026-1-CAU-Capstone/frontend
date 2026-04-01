import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const LogoIcon = styled.img`
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
  cursor: pointer;
`;

export function Logo() {
  const navigate = useNavigate();
  return (
    <LogoIcon src="/jazzifylogo.png" alt="Jazzify" onClick={() => navigate('/')} />
  );
}
