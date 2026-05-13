import { useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ChordPage from './pages/ChordPage';
import NotePage from './pages/NotePage';
import LicksPage from './pages/LicksPage';
import LickInputPage from './pages/LickInputPage';
import MyLicksPage from './pages/MyLicksPage';
import Lick12KeyPage from './pages/Lick12KeyPage';
import SoloGeneratorPage from './pages/SoloGeneratorPage';
import InputPage from './pages/InputPage';
import AdminPage from './pages/AdminPage';
import StyPocPage from './pages/StyPocPage';
import StyDemoPage from './pages/StyDemoPage';
import { IntroScreen } from './components/common/IntroScreen';

export default function App() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <>
      {showIntro && <IntroScreen onDone={() => setShowIntro(false)} />}
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/chord" element={<ChordPage />} />
          <Route path="/note" element={<NotePage />} />
          <Route path="/note/sologenerator" element={<SoloGeneratorPage />} />
          <Route path="/licks" element={<LicksPage />} />
          <Route path="/input" element={<InputPage />} />
          <Route path="/lick-input" element={<LickInputPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/my-licks" element={<MyLicksPage />} />
          <Route path="/lick-practice/:id" element={<Lick12KeyPage />} />
          <Route path="/sty-poc" element={<StyPocPage />} />
          <Route path="/sty-demo" element={<StyDemoPage />} />
        </Routes>
      </HashRouter>
    </>
  );
}
