#!/usr/bin/env python3
"""Build a static index of note-song -> jazz1460 (chord-analysis) matches.

Scans the four external collections used by the /note page (PDMX, omnibook,
jazzstandards, wjazzd) and emits a TS data module mapping each matched note
song id to the jazz1460 song index that holds its chord progression.

The /note page uses this index to clone matching songs into the "manual"
group, applying chord-progression data from chord analysis on top of the
melody parsed from the original MXL/XML/MIDI source.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JAZZ_PATH = os.path.join(ROOT, 'public', 'jazz1460.json')
PDMX_DIR = os.path.join(ROOT, 'data', 'PDMX', 'scores')
OMNIBOOK_DIR = os.path.join(ROOT, 'data', 'omnibook', 'Omnibook xml')
JAZZSTD_DIR = os.path.join(ROOT, 'data', 'jazzstandards')
WJAZZD_DIR = os.path.join(ROOT, 'data', 'wjazzd')

OUT_PATH = os.path.join(ROOT, 'src', 'data', 'chordMatchIndex.ts')


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r'\s*\(\d+\)\s*$', '', s)
    s = re.sub(r"[^\w\s]", ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def split_camel(s: str) -> str:
    s = re.sub(r"([a-z'])([A-Z])", r'\1 \2', s)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r'\1 \2', s)
    return s


def parse_pdmx(fn: str) -> str:
    name = fn[:-4] if fn.lower().endswith('.mxl') else fn
    return re.sub(r'\s*\(\d+\)$', '', name)


def parse_omnibook(fn: str) -> str:
    name = re.sub(r'\.xml$', '', fn, flags=re.I)
    return name.replace('_', ' ')


def parse_jazzstd(fn: str) -> str:
    name = re.sub(r'\.mid$', '', fn, flags=re.I)
    name = name.replace('_', ' ')
    name = re.sub(r'\s*\d+$', '', name)
    name = re.sub(r'\s*(GM|XG)$', '', name, flags=re.I)
    name = re.sub(r'\s*\(Doug McKenzie\)', '', name, flags=re.I)
    name = re.sub(r'\s*(solo|trio|duet|piano|duo)\s*', ' ', name, flags=re.I)
    name = split_camel(name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def parse_wjazzd(fn: str):
    base = re.sub(r'\.mid$', '', fn, flags=re.I)
    base = re.sub(r'_FINAL$', '', base)
    parts = base.split('_')
    artist = split_camel(parts[0]) if parts else ''
    title = ' '.join(
        split_camel(re.sub(r'-(\d)', r' \1', p)) for p in parts[1:]
    )
    return artist, title


def main():
    with open(JAZZ_PATH, encoding='utf-8') as f:
        jazz = json.load(f)

    jazz_map: dict[str, list[tuple[int, str]]] = {}
    for i, song in enumerate(jazz):
        jazz_map.setdefault(norm(song['title']), []).append((i, song['title']))

    matches: list[dict] = []

    # PDMX
    if os.path.isdir(PDMX_DIR):
        for fn in sorted(os.listdir(PDMX_DIR)):
            if not fn.lower().endswith('.mxl'):
                continue
            title = parse_pdmx(fn)
            n = norm(title)
            if n in jazz_map:
                j_idx, j_title = jazz_map[n][0]
                matches.append({
                    'collection': 'pdmx',
                    'noteId': f'pdmx:{fn}',
                    'title': title,
                    'jazzIndex': j_idx,
                    'jazzTitle': j_title,
                })

    # omnibook
    if os.path.isdir(OMNIBOOK_DIR):
        for fn in sorted(os.listdir(OMNIBOOK_DIR)):
            if not fn.lower().endswith('.xml'):
                continue
            title = parse_omnibook(fn)
            n = norm(title)
            if n in jazz_map:
                j_idx, j_title = jazz_map[n][0]
                matches.append({
                    'collection': 'omnibook',
                    'noteId': f'omnibook:{fn}',
                    'title': title,
                    'jazzIndex': j_idx,
                    'jazzTitle': j_title,
                })

    # jazzstandards
    if os.path.isdir(JAZZSTD_DIR):
        for fn in sorted(os.listdir(JAZZSTD_DIR)):
            if not fn.lower().endswith('.mid'):
                continue
            title = parse_jazzstd(fn)
            n = norm(title)
            if n in jazz_map:
                j_idx, j_title = jazz_map[n][0]
                matches.append({
                    'collection': 'jazzstandard',
                    'noteId': f'jazzstandard:{fn}',
                    'title': title,
                    'jazzIndex': j_idx,
                    'jazzTitle': j_title,
                })

    # wjazzd
    if os.path.isdir(WJAZZD_DIR):
        for fn in sorted(os.listdir(WJAZZD_DIR)):
            if not fn.lower().endswith('.mid'):
                continue
            artist, title = parse_wjazzd(fn)
            n = norm(title)
            if n in jazz_map:
                j_idx, j_title = jazz_map[n][0]
                matches.append({
                    'collection': 'wjazzd',
                    'noteId': f'wjazzd:{fn}',
                    'title': title,
                    'composer': artist,
                    'jazzIndex': j_idx,
                    'jazzTitle': j_title,
                })

    # Write TS
    lines: list[str] = []
    lines.append('/* AUTO-GENERATED by scripts/build_chord_match_index.py - DO NOT EDIT MANUALLY */')
    lines.append('')
    lines.append('export interface ChordMatchEntry {')
    lines.append("  collection: 'pdmx' | 'omnibook' | 'jazzstandard' | 'wjazzd';")
    lines.append('  noteId: string;')
    lines.append('  title: string;')
    lines.append('  composer?: string;')
    lines.append('  jazzIndex: number;')
    lines.append('  jazzTitle: string;')
    lines.append('}')
    lines.append('')
    lines.append('export const chordMatchIndex: ChordMatchEntry[] = [')
    for m in matches:
        parts = [
            f"collection: '{m['collection']}'",
            f"noteId: {json.dumps(m['noteId'])}",
            f"title: {json.dumps(m['title'])}",
        ]
        if 'composer' in m:
            parts.append(f"composer: {json.dumps(m['composer'])}")
        parts.append(f"jazzIndex: {m['jazzIndex']}")
        parts.append(f"jazzTitle: {json.dumps(m['jazzTitle'])}")
        lines.append('  { ' + ', '.join(parts) + ' },')
    lines.append('];')
    lines.append('')

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    by_coll = {}
    for m in matches:
        by_coll[m['collection']] = by_coll.get(m['collection'], 0) + 1

    print(f"Wrote {len(matches)} match entries to {OUT_PATH}")
    for c, n in sorted(by_coll.items()):
        print(f"  {c}: {n}")


if __name__ == '__main__':
    sys.exit(main())
