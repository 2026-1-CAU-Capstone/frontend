/**
 * Backend-backed Solo library admin tool.
 *
 * Three blocks:
 *   1. List of solos already in the backend (with delete buttons).
 *   2. Migration controls:
 *      a. "Migrate legacy localStorage solos" — uploads jazzify_user_solos
 *         entries (from the pre-backend SoloGenerator) to the API.
 *      b. "Bulk import dataset" buttons (parker / miles / bartley) — parse the
 *         frontend/data/*.{xml,musicxml,json} files via the existing XML
 *         parser and POST each as a curated Solo.
 *   3. Status / log area showing per-batch outcomes.
 *
 * Everything is best-effort — failures don't abort the batch and surface in
 * the log so the user can retry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { loadXmlMelody } from '../../lib/note/xmlMelodyParser';
import {
  createSolo,
  deleteSolo,
  type SoloDraft,
  type SoloResponse,
} from '../../api/solos';
import {
  loadAllSolos,
  invalidateSolosCache,
  removeSoloFromCache,
  pushSoloToCache,
  migrateLegacySolos,
  readLegacyLocalSolos,
  isLegacyMigrationDone,
  markLegacyMigrationDone,
} from '../../data/soloData';
import type { NoteSheetData } from '../../data/sampleMelody';

/* ─── dataset globs (mirror OmnibookViewer) ──────────────────────────────── */

const parkerModules = import.meta.glob('../../../data/omnibook/Omnibook xml/*.xml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

const milesModules = import.meta.glob('../../../data/miles_davis_xml/*.musicxml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

const bartleyJsonModules = import.meta.glob('../../../data/patrick_bartley/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, NoteSheetData>;

interface DatasetEntry {
  fileId: string;
  title: string;
  loadSheet: () => Promise<NoteSheetData>;
}

function buildXmlEntries(
  modules: Record<string, () => Promise<string>>,
  defaultTitle: (fn: string) => string = (fn) =>
    decodeURIComponent(fn).replace(/\.(musicxml|xml)$/i, '').replace(/_/g, ' '),
): DatasetEntry[] {
  return Object.entries(modules).map(([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    return {
      fileId: fn,
      title: defaultTitle(fn),
      loadSheet: async () => {
        const url = await loadUrl();
        return loadXmlMelody(url, defaultTitle(fn));
      },
    };
  });
}

function buildJsonEntries(modules: Record<string, NoteSheetData>): DatasetEntry[] {
  return Object.entries(modules).map(([path, data]) => {
    const fn = path.split('/').pop() ?? '';
    const title = data.title || decodeURIComponent(fn).replace(/\.json$/i, '').replace(/_/g, ' ');
    return {
      fileId: fn,
      title,
      loadSheet: async () => data,
    };
  });
}

interface DatasetConfig {
  id: 'parker' | 'miles' | 'bartley';
  label: string;
  performer: string;
  instrument: SoloDraft['instrument'];
  style?: SoloDraft['style'];
  entries: DatasetEntry[];
}

const DATASETS: DatasetConfig[] = [
  {
    id: 'parker',
    label: 'Charlie Parker Omnibook',
    performer: 'Charlie Parker',
    instrument: 'as',
    style: 'BEBOP',
    entries: buildXmlEntries(parkerModules),
  },
  {
    id: 'miles',
    label: 'Miles Davis MusicXML',
    performer: 'Miles Davis',
    instrument: 'tp',
    style: 'HARDBOP',
    entries: buildXmlEntries(milesModules),
  },
  {
    id: 'bartley',
    label: 'Patrick Bartley JSON',
    performer: 'Patrick Bartley',
    instrument: 'as',
    style: 'BEBOP',
    entries: buildJsonEntries(bartleyJsonModules),
  },
];

/* ─── styled ───────────────────────────────────────────────────────────── */

const Wrap = styled.div`
  padding: 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  font-family: 'DM Sans', sans-serif;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const CardTitle = styled.h2`
  font-size: 1rem;
  margin: 0 0 10px 0;
`;

const SoloTable = styled.div`
  flex: 1;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 7px 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-size: 13px;
  &:last-child { border-bottom: 0; }
`;

const RowTitle = styled.span`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Pill = styled.span`
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  white-space: nowrap;
`;

const DangerBtn = styled.button`
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid #c0392b;
  background: #fdecea;
  color: #a03022;
  border-radius: 5px;
  cursor: pointer;
  &:hover { background: #fad7d2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const ActionBtn = styled.button<{ $bg?: string; $fg?: string }>`
  font-size: 13px;
  padding: 8px 12px;
  border: 1px solid ${({ $bg }) => $bg ?? '#1976d2'};
  background: ${({ $bg }) => $bg ?? '#1976d2'};
  color: ${({ $fg }) => $fg ?? '#fff'};
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
  &:hover { filter: brightness(1.05); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const SmallNote = styled.div`
  font-size: 11.5px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 4px 0 12px 0;
  line-height: 1.4;
`;

const ButtonStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const LogBox = styled.pre`
  flex: 1;
  margin: 0;
  padding: 10px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  border-radius: 6px;
  overflow: auto;
  white-space: pre-wrap;
  min-height: 200px;
`;

const EmptyState = styled.div`
  padding: 24px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

/* ─── component ────────────────────────────────────────────────────────── */

export function SoloLibrary() {
  const [solos, setSolos] = useState<SoloResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'user' | 'curated'>('all');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);  // 'migrate' | 'parker' | ...

  const legacyCount = useMemo(() => readLegacyLocalSolos().length, []);
  const legacyDone = isLegacyMigrationDone();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      invalidateSolosCache();
      const list = await loadAllSolos(true);
      setSolos(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const handleDelete = useCallback(async (s: SoloResponse) => {
    if (!confirm(`Delete "${s.title}" (${s.performer || '—'})?`)) return;
    try {
      await deleteSolo(s.publicId);
      removeSoloFromCache(s.publicId);
      setSolos((prev) => prev.filter((x) => x.publicId !== s.publicId));
      appendLog(`✓ deleted ${s.title}`);
    } catch (e) {
      appendLog(`✗ delete failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [appendLog]);

  const handleMigrateLegacy = useCallback(async () => {
    if (busy) return;
    setBusy('migrate');
    appendLog(`→ migrating ${legacyCount} legacy localStorage solos…`);
    try {
      const { ok, failed, errors } = await migrateLegacySolos();
      appendLog(`✓ legacy migration: ${ok} ok, ${failed} failed`);
      for (const e of errors.slice(0, 5)) appendLog(`  · ${e}`);
      if (errors.length > 5) appendLog(`  · …+${errors.length - 5} more`);
      await refresh();
    } catch (e) {
      appendLog(`✗ legacy migration failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }, [busy, legacyCount, appendLog, refresh]);

  const handleBulkImport = useCallback(async (cfg: DatasetConfig) => {
    if (busy) return;
    setBusy(cfg.id);
    appendLog(`→ importing ${cfg.entries.length} ${cfg.label} entries…`);
    let ok = 0;
    let failed = 0;
    for (const entry of cfg.entries) {
      try {
        const sheet = await entry.loadSheet();
        const draft: SoloDraft = {
          source: 'curated',
          title: sheet.title || entry.title,
          instrument: cfg.instrument,
          performer: sheet.composer || cfg.performer,
          tempo: sheet.tempo,
          key: sheet.key,
          timeSignature: sheet.timeSignature,
          ...(cfg.style ? { style: cfg.style } : {}),
          sheetData: {
            ...sheet,
            composer: sheet.composer || cfg.performer,
          },
        };
        const persisted = await createSolo(draft);
        pushSoloToCache(persisted);
        ok++;
      } catch (e) {
        failed++;
        appendLog(`  ✗ ${entry.title}: ${e instanceof Error ? e.message : e}`);
      }
    }
    appendLog(`✓ ${cfg.label}: ${ok} imported, ${failed} failed`);
    setBusy(null);
    await refresh();
  }, [busy, appendLog, refresh]);

  const filtered = solos.filter((s) => filter === 'all' || s.source === filter);

  return (
    <Wrap>
      <Card>
        <CardTitle>
          백엔드 Solo 라이브러리
          <span style={{ marginLeft: 10, fontWeight: 400, fontSize: 13, color: '#888' }}>
            {filtered.length} / {solos.length}
          </span>
        </CardTitle>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {(['all', 'user', 'curated'] as const).map((f) => (
            <ActionBtn
              key={f}
              $bg={filter === f ? '#1976d2' : '#e5e5e5'}
              $fg={filter === f ? '#fff' : '#333'}
              onClick={() => setFilter(f)}
            >
              {f}
            </ActionBtn>
          ))}
          <ActionBtn $bg="#666" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </ActionBtn>
        </div>
        {error && <SmallNote style={{ color: '#c0392b' }}>{error}</SmallNote>}
        <SoloTable>
          {filtered.length === 0 ? (
            <EmptyState>{loading ? '불러오는 중…' : '저장된 솔로가 없습니다.'}</EmptyState>
          ) : (
            filtered.map((s) => (
              <Row key={s.publicId}>
                <RowTitle title={s.title}>{s.title}</RowTitle>
                <Pill>{s.performer ?? '—'}</Pill>
                <Pill>{s.instrument}</Pill>
                <Pill>{s.source}</Pill>
                <DangerBtn onClick={() => handleDelete(s)}>Delete</DangerBtn>
              </Row>
            ))
          )}
        </SoloTable>
      </Card>

      <Card>
        <CardTitle>Migration / Bulk Import</CardTitle>
        <SmallNote>
          한 번씩만 누르세요 — 같은 곡 중복 업로드 시 백엔드가 400/409 일 수도 있고, 그냥
          duplicate row 가 쌓일 수도 있어요. 결과는 아래 로그에서 확인.
        </SmallNote>

        <ButtonStack style={{ marginBottom: 14 }}>
          <ActionBtn
            $bg="#7b1fa2"
            onClick={handleMigrateLegacy}
            disabled={busy !== null || legacyCount === 0}
            title={legacyCount === 0 ? 'localStorage 에 마이그레이션할 솔로 없음' : ''}
          >
            {busy === 'migrate'
              ? 'Migrating…'
              : `Migrate localStorage solos${legacyDone ? ' (done once)' : ''} (${legacyCount})`}
          </ActionBtn>

          {DATASETS.map((d) => (
            <ActionBtn
              key={d.id}
              $bg="#2e7d32"
              onClick={() => handleBulkImport(d)}
              disabled={busy !== null}
            >
              {busy === d.id
                ? `Importing ${d.label}…`
                : `Bulk import ${d.label} (${d.entries.length})`}
            </ActionBtn>
          ))}

          <ActionBtn
            $bg="#666"
            onClick={() => { markLegacyMigrationDone(); appendLog('marked legacy as done'); }}
            disabled={busy !== null}
          >
            Mark legacy as done (skip)
          </ActionBtn>
        </ButtonStack>

        <CardTitle style={{ marginTop: 4 }}>Log</CardTitle>
        <LogBox>{log.length === 0 ? '(empty)' : log.join('\n')}</LogBox>
      </Card>
    </Wrap>
  );
}
