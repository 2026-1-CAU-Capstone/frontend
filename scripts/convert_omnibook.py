#!/usr/bin/env python3
"""
Convert all Omnibook MusicXML files to:
  1) MIDI files  (notes)
  2) JSON chord annotations  (chords + key + time signature + tempo)

Usage:
  cd frontend
  scripts/.venv/bin/python3 scripts/convert_omnibook.py

Output goes to data/omnibook/midi/ and data/omnibook/chords/
"""

import json
import os
import sys
from pathlib import Path

# ── music21 ──────────────────────────────────────────────────────────────

import music21
from music21 import converter, key as m21key

# Disable music21's interactive prompts (e.g., MuseScore path)
music21.environment.UserSettings()['warnings'] = 0

# ── paths ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
XML_DIR = ROOT / 'data' / 'omnibook' / 'Omnibook xml'
MIDI_DIR = ROOT / 'data' / 'omnibook' / 'midi'
CHORD_DIR = ROOT / 'data' / 'omnibook' / 'chords'

# ── harmony kind mapping ────────────────────────────────────────────────

ALTER_MAP = {-1: 'b', 1: '#'}

KIND_MAP = {
    'major':            'maj7',
    'minor':            'm',
    'dominant':         '7',
    'diminished':       'dim',
    'augmented':        'aug',
    'half-diminished':  'm7b5',
    'minor-seventh':    'm7',
    'major-seventh':    'maj7',
    'dominant-seventh': '7',
    'major-minor':      'mMaj7',
    'minor-sixth':      'm6',
    'major-sixth':      '6',
    'suspended-fourth': 'sus4',
    'suspended-second': 'sus2',
    'dominant-ninth':   '9',
    'major-ninth':      'maj9',
    'minor-ninth':      'm9',
    'dominant-11th':    '11',
    'major-11th':       'maj11',
    'minor-11th':       'm11',
    'dominant-13th':    '13',
    'major-13th':       'maj13',
    'minor-13th':       'm13',
    'augmented-seventh': 'aug7',
    'diminished-seventh': 'dim7',
}


def extract_key_from_xml(xml_path: str) -> str:
    """Parse key signature directly from XML (faster than music21 analysis)."""
    import xml.etree.ElementTree as ET
    tree = ET.parse(xml_path)
    root = tree.getroot()
    key_el = root.find('.//key')
    if key_el is None:
        return 'C'
    fifths = int(key_el.findtext('fifths', '0'))
    mode = key_el.findtext('mode', 'major')

    # sharps: C(0) G(1) D(2) A(3) E(4) B(5) F#(6) C#(7)
    # flats:  F(1) Bb(2) Eb(3) Ab(4) Db(5) Gb(6) Cb(7)
    major_sharp = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
    major_flat  = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
    minor_sharp = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']
    minor_flat  = ['A', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab']

    if mode == 'minor':
        keys = minor_sharp if fifths >= 0 else minor_flat
        return keys[abs(fifths) % len(keys)] + 'm'
    else:
        keys = major_sharp if fifths >= 0 else major_flat
        return keys[abs(fifths) % len(keys)]


def extract_chords_from_xml(xml_path: str) -> list[dict]:
    """Parse <harmony> elements directly from MusicXML."""
    import xml.etree.ElementTree as ET
    tree = ET.parse(xml_path)
    root = tree.getroot()

    chords = []
    divisions = 1  # persists across measures

    for measure in root.iter('measure'):
        measure_num = int(measure.get('number', '0'))
        beat_pos = 0.0  # reset per measure

        for el in measure:
            if el.tag == 'attributes':
                div_el = el.find('divisions')
                if div_el is not None:
                    divisions = int(div_el.text)

            elif el.tag == 'harmony':
                root_step = el.findtext('root/root-step', '')
                root_alter = el.findtext('root/root-alter')
                kind_el = el.find('kind')
                kind_text = kind_el.get('text', '') if kind_el is not None else ''
                kind_type = kind_el.text if kind_el is not None else ''

                # Build chord symbol
                root_name = root_step
                if root_alter:
                    root_name += ALTER_MAP.get(int(root_alter), '')

                # Use the text attribute if available (e.g., "7", "m7", "maj7")
                # Otherwise fall back to kind mapping
                if kind_text:
                    symbol = root_name + kind_text
                else:
                    suffix = KIND_MAP.get(kind_type, '')
                    symbol = root_name + suffix

                # Check for bass note
                bass_step = el.findtext('bass/bass-step')
                if bass_step:
                    bass_alter = el.findtext('bass/bass-alter')
                    bass_name = bass_step
                    if bass_alter:
                        bass_name += ALTER_MAP.get(int(bass_alter), '')
                    symbol += '/' + bass_name

                # Calculate beat (1-based)
                beat = 1.0 + beat_pos / divisions

                chords.append({
                    'measure': measure_num,
                    'beat': round(beat, 2),
                    'symbol': symbol,
                })

            elif el.tag == 'note':
                dur_el = el.find('duration')
                if dur_el is not None:
                    beat_pos += int(dur_el.text)

                # Forward/backup also adjust position
            elif el.tag == 'forward':
                dur_el = el.find('duration')
                if dur_el is not None:
                    beat_pos += int(dur_el.text)
            elif el.tag == 'backup':
                dur_el = el.find('duration')
                if dur_el is not None:
                    beat_pos -= int(dur_el.text)

    return chords


def extract_time_sig(xml_path: str) -> str:
    """Extract time signature from XML."""
    import xml.etree.ElementTree as ET
    tree = ET.parse(xml_path)
    root = tree.getroot()
    time_el = root.find('.//time')
    if time_el is None:
        return '4/4'
    beats = time_el.findtext('beats', '4')
    beat_type = time_el.findtext('beat-type', '4')
    return f'{beats}/{beat_type}'


def extract_tempo(xml_path: str) -> int | None:
    """Extract tempo from XML <sound tempo="..."/>."""
    import xml.etree.ElementTree as ET
    tree = ET.parse(xml_path)
    root = tree.getroot()
    for sound in root.iter('sound'):
        t = sound.get('tempo')
        if t:
            return int(float(t))
    return None


def convert_one(xml_path: Path) -> dict:
    """Convert a single XML → MIDI + chord JSON. Returns summary dict."""
    name = xml_path.stem  # e.g., "Bloomdido"
    midi_out = MIDI_DIR / f'{name}.mid'
    chord_out = CHORD_DIR / f'{name}.json'

    # 1) XML → MIDI via music21 (accurate conversion)
    score = converter.parse(str(xml_path))
    score.write('midi', fp=str(midi_out))

    # 2) Extract chord annotations directly from XML (faster, more reliable)
    key_sig = extract_key_from_xml(str(xml_path))
    time_sig = extract_time_sig(str(xml_path))
    tempo = extract_tempo(str(xml_path))
    chords = extract_chords_from_xml(str(xml_path))

    annotation = {
        'title': name.replace('_', ' '),
        'composer': 'Charlie Parker',
        'key': key_sig,
        'timeSignature': time_sig,
        'tempo': tempo,
        'chords': chords,
    }

    with open(chord_out, 'w', encoding='utf-8') as f:
        json.dump(annotation, f, indent=2, ensure_ascii=False)

    return {
        'name': name,
        'key': key_sig,
        'time': time_sig,
        'tempo': tempo,
        'chords': len(chords),
    }


def main():
    if not XML_DIR.exists():
        print(f'ERROR: XML directory not found: {XML_DIR}')
        sys.exit(1)

    MIDI_DIR.mkdir(parents=True, exist_ok=True)
    CHORD_DIR.mkdir(parents=True, exist_ok=True)

    xml_files = sorted(XML_DIR.glob('*.xml'))
    print(f'Found {len(xml_files)} XML files\n')

    results = []
    for i, xml_path in enumerate(xml_files, 1):
        try:
            info = convert_one(xml_path)
            results.append(info)
            print(f'  [{i:2d}/{len(xml_files)}] ✓ {info["name"]:<30s}  '
                  f'key={info["key"]:<4s}  time={info["time"]}  '
                  f'tempo={info["tempo"] or "?":<4}  chords={info["chords"]}')
        except Exception as e:
            print(f'  [{i:2d}/{len(xml_files)}] ✗ {xml_path.stem}: {e}')

    print(f'\nDone: {len(results)}/{len(xml_files)} converted')
    print(f'  MIDI  → {MIDI_DIR}')
    print(f'  Chords → {CHORD_DIR}')


if __name__ == '__main__':
    main()
