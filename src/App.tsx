import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ChordPage from './pages/ChordPage';
import NotePage from './pages/NotePage';
import LicksPage from './pages/LicksPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chord" element={<ChordPage />} />
        <Route path="/note" element={<NotePage />} />
        <Route path="/licks" element={<LicksPage />} />
      </Routes>
    </BrowserRouter>
  );
}
