import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ChordPage from './pages/ChordPage';
import NotePage from './pages/NotePage';
import LicksPage from './pages/LicksPage';
import LickInputPage from './pages/LickInputPage';
import MyLicksPage from './pages/MyLicksPage';
import Lick12KeyPage from './pages/Lick12KeyPage';
import LeadSheetGeneratorPage from './pages/LeadSheetGeneratorPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chord" element={<ChordPage />} />
        <Route path="/note" element={<NotePage />} />
        <Route path="/note/leadsheetgenerator" element={<LeadSheetGeneratorPage />} />
        <Route path="/licks" element={<LicksPage />} />
        <Route path="/lick-input" element={<LickInputPage />} />
        <Route path="/my-licks" element={<MyLicksPage />} />
        <Route path="/lick-practice/:id" element={<Lick12KeyPage />} />
      </Routes>
    </BrowserRouter>
  );
}
