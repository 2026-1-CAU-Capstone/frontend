import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioRoot } from './StudioRoot';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudioRoot />
  </StrictMode>,
);
