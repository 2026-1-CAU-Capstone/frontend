import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// NOTE: We intentionally do NOT eagerly warm up the player assets here at app
// boot. `warmupPlayerAssets()` downloads the full SplendidGrandPiano sample
// bank (hundreds of .ogg) + bass soundfont + drum samples — fine on a page
// that plays audio, but at boot it floods the network on EVERY page (incl.
// 내 코드 차트 / 내 악보 차트 / chat) that never touches audio, slowing them
// down. Audio pages warm up on their own: ChordPage and NoteSheet call
// `player.preload(...)` in a mount effect, so the bank loads exactly when the
// user is on a page that can play — and stays cached for the rest of the
// session.
