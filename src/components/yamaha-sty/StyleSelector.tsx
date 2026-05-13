import { useState, useEffect, useRef } from 'react';
import {
  saveStyleFile, loadStyleFile, listStyleFiles, deleteStyleFile,
} from '../../lib/yamaha-sty';

/**
 * UI for picking which Yamaha .sty / .sst file the .sty engine should use.
 *
 * - Built-in: 'psBase' (LGPL bundled, served from /styles/psBase.sst).
 * - User uploads land in IndexedDB and become selectable here.
 *
 * Selection is reported via `onSelect({name, source, buffer?})`:
 *   - { source: 'builtin', name, url } — caller fetches the URL
 *   - { source: 'uploaded', name, buffer } — caller uses the buffer directly
 *
 * Keeps its own list state and reloads from IndexedDB when uploads change.
 */

export interface StyleSelectorChoice {
  source: 'builtin' | 'uploaded';
  name: string;
  /** Only for 'builtin'. */
  url?: string;
  /** Only for 'uploaded'. */
  buffer?: ArrayBuffer;
}

export const BUILTIN_STYLE: StyleSelectorChoice = {
  source: 'builtin',
  name: 'psBase (bundled)',
  url: '/styles/psBase.sst',
};

interface Props {
  currentName: string;
  onSelect: (choice: StyleSelectorChoice) => void;
}

export function StyleSelector({ currentName, onSelect }: Props) {
  const [uploads, setUploads] = useState<{ name: string; uploadedAt: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setUploads(await listStyleFiles());
  }

  async function handleFile(file: File) {
    setBusy(`uploading ${file.name}…`);
    const buf = await file.arrayBuffer();
    await saveStyleFile(file.name, buf);
    await refresh();
    setBusy(null);
    onSelect({ source: 'uploaded', name: file.name, buffer: buf });
    setOpen(false);
  }

  async function pickUpload(name: string) {
    setBusy(`loading ${name}…`);
    const buf = await loadStyleFile(name);
    setBusy(null);
    if (!buf) return;
    onSelect({ source: 'uploaded', name, buffer: buf });
    setOpen(false);
  }

  async function remove(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    await deleteStyleFile(name);
    await refresh();
    // If we just deleted the currently active upload, fall back to builtin.
    if (currentName === name) onSelect(BUILTIN_STYLE);
  }

  return (
    <div style={wrap}>
      <button onClick={() => setOpen((o) => !o)} style={btn}>
        Style: {currentName} ▾
      </button>

      {open && (
        <div style={panel}>
          <div style={panelHeader}>
            <span>{busy ?? 'Choose a style'}</span>
            <button onClick={() => setOpen(false)} style={closeBtn}>×</button>
          </div>

          <div style={itemRow}>
            <button onClick={() => { onSelect(BUILTIN_STYLE); setOpen(false); }} style={itemBtn(currentName === BUILTIN_STYLE.name)}>
              psBase (bundled)
            </button>
          </div>

          {uploads.length > 0 && (
            <div style={{ borderTop: '1px solid #333', marginTop: 4, paddingTop: 4 }}>
              {uploads.map((u) => (
                <div style={itemRow} key={u.name}>
                  <button onClick={() => pickUpload(u.name)} style={itemBtn(currentName === u.name)}>
                    {u.name}
                  </button>
                  <button onClick={() => remove(u.name)} style={delBtn}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid #333', marginTop: 4, paddingTop: 4 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sty,.sst,.prs,.bcs"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />
            <button onClick={() => fileInputRef.current?.click()} style={uploadBtn}>
              + Upload .sty / .sst / .prs / .bcs
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  top: 8,
  right: 200,
  zIndex: 1000,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
};

const btn: React.CSSProperties = {
  padding: '6px 12px',
  background: 'rgba(20, 20, 20, 0.85)',
  border: '1px solid #333',
  borderRadius: 999,
  color: '#eee',
  cursor: 'pointer',
  fontSize: 12,
};

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 36,
  right: 0,
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  padding: 8,
  minWidth: 240,
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
};

const panelHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  color: '#888',
  fontSize: 11,
  padding: '0 4px 4px',
  borderBottom: '1px solid #333',
  marginBottom: 4,
};

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
  fontSize: 16,
  padding: 0,
};

const itemRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const itemBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '6px 8px',
  background: active ? '#3a7' : 'transparent',
  color: active ? '#fff' : '#ddd',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 12,
});

const delBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  background: 'transparent',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#888',
  cursor: 'pointer',
  fontSize: 14,
};

const uploadBtn: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: 'transparent',
  border: '1px dashed #555',
  color: '#aaa',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};
