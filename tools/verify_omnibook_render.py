"""Simulate the JS renderer beam logic with our parser fixes and compare to
XML expected beam groups across all Omnibook XML files.

Parser sets:
  - noBeam=True if note is beamable-type AND has no <beam number=1>
  - beamBreak=True if <beam number=1> text == 'end'
  - tuplet=N from time-modification

Renderer beam logic (post-fix):
  walk notes:
    if noBeam → flush group, skip
    if rest or non-beamable → flush group
    handle postTupletMerged + tuplet transitions
    push to group, on beamBreak flush
"""
import xml.etree.ElementTree as ET
from pathlib import Path
import math
import sys
import zipfile

# Optional CLI arg = directory of .xml / .musicxml / .mxl files to verify.
# Defaults to the Parker Omnibook XML corpus.
DEFAULT_DIR = Path('data/omnibook/Omnibook xml')
omnidir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR

TYPE_BEATS = {'whole': 4, 'half': 2, 'quarter': 1, 'eighth': 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125}
BEAMABLE_TYPES = {'eighth', '16th', '32nd', '64th', '128th'}
TYPE_TO_DUR = {'eighth': '8', '16th': '16', '32nd': '32', '64th': '64', '128th': '128'}


def parse_measure(measure_el, doc_has_beams=True):
    notes = []
    group_id = 0
    cur_group = None
    beam_open = False
    for n in measure_el.iter('note'):
        if n.find('chord') is not None:
            continue
        voice = n.findtext('voice', '1')
        if voice != '1':
            continue
        if n.find('grace') is not None:
            continue
        is_rest = n.find('rest') is not None
        ntype = n.findtext('type', 'quarter')
        dotted = n.find('dot') is not None
        tm = n.find('time-modification')
        tuplet = None
        if tm is not None:
            actual = int(tm.findtext('actual-notes', '0'))
            normal = int(tm.findtext('normal-notes', '0'))
            if actual > normal and actual > 1:
                tuplet = actual
        primary = None
        for be in n.findall('beam'):
            if be.get('number', '1') == '1':
                primary = (be.text or '').strip()
                break
        noBeam = False
        beamBreak = False
        rest_in_beam = False
        if is_rest:
            if doc_has_beams and beam_open and ntype in BEAMABLE_TYPES:
                rest_in_beam = True
        elif ntype in BEAMABLE_TYPES and doc_has_beams:
            if primary is None:
                noBeam = True
                beam_open = False
            elif primary == 'begin':
                beam_open = True
            elif primary == 'end':
                beamBreak = True
                beam_open = False
        xml_group = None
        if primary == 'begin':
            cur_group = group_id
            group_id += 1
            xml_group = cur_group
        elif primary == 'continue' and cur_group is not None:
            xml_group = cur_group
        elif primary == 'end' and cur_group is not None:
            xml_group = cur_group
            cur_group = None
        elif is_rest and rest_in_beam and cur_group is not None:
            xml_group = cur_group
        notes.append({
            'type': ntype, 'dotted': dotted, 'tuplet': tuplet,
            'is_rest': is_rest, 'noBeam': noBeam, 'beamBreak': beamBreak,
            'restInBeam': rest_in_beam,
            'xml_group': xml_group,
        })
    return notes


def simulate_renderer(notes):
    """Mirror of the JS renderer's explicit-beam-mode logic (active when any
    note has noBeam or beamBreak — i.e. parsed from MusicXML)."""
    explicit_mode = any(n['noBeam'] or n['beamBreak'] for n in notes)
    beams = []
    group = []
    if explicit_mode:
        for i, n in enumerate(notes):
            ntype = n['type']
            dur = TYPE_TO_DUR.get(ntype, 'q')
            isBeamable = dur in ('8', '16', '32', '64', '128')
            isRest = n['is_rest']
            if isRest and n.get('restInBeam') and group:
                group.append(i)
                continue
            if isRest or not isBeamable or n['noBeam']:
                if len(group) >= 2:
                    beams.append(group)
                group = []
                continue
            group.append(i)
            if n['beamBreak']:
                if len(group) >= 2:
                    beams.append(group)
                group = []
        if len(group) >= 2:
            beams.append(group)
        return beams

    # Heuristic mode (no explicit beam info from parser).
    gb = 0.0
    inTupletN = 0
    postTupletMerged = False
    for i, n in enumerate(notes):
        tupletN = n['tuplet'] or 0
        isTuplet = tupletN >= 3
        ntype = n['type']
        dur = TYPE_TO_DUR.get(ntype, 'q')
        isBeamable = dur in ('8', '16', '32', '64', '128')
        noteBeats = TYPE_BEATS.get(ntype, 1)
        if n['dotted']:
            noteBeats *= 1.5
        isRest = n['is_rest']

        if postTupletMerged and len(group) > 0:
            if len(group) >= 2:
                beams.append(group)
            group = []
            gb = 0
            postTupletMerged = False

        if tupletN != inTupletN and len(group) > 0:
            prevIs16Triplet = inTupletN == 3 and any(notes[j]['type'] == '16th' for j in group)
            if prevIs16Triplet and isBeamable and not isRest and not isTuplet:
                postTupletMerged = True
            else:
                if len(group) >= 2:
                    beams.append(group)
                group = []
                if not isTuplet:
                    gb = 0
        inTupletN = tupletN

        if isBeamable and not isRest:
            if not isTuplet and not postTupletMerged:
                new_gb = gb + noteBeats
                has16 = dur in ('16', '32') or any(notes[j]['type'] in ('16th', '32nd') for j in group)
                boundary = 1 if has16 else 2
                if gb > 0 and math.floor((gb - 0.001) / boundary) != math.floor((new_gb - 0.001) / boundary) and len(group) > 0:
                    if len(group) >= 2:
                        beams.append(group)
                    group = []
                    gb = 0
            group.append(i)
            if not isTuplet:
                gb += noteBeats
            if isTuplet and len(group) == tupletN:
                beams.append(group)
                group = []
                gb = 0
                postTupletMerged = False
                continue
            if n['beamBreak']:
                if len(group) >= 2:
                    beams.append(group)
                group = []
                gb = 0
                postTupletMerged = False
        else:
            if len(group) >= 2:
                beams.append(group)
            group = []
            gb = 0
            postTupletMerged = False

    if len(group) >= 2:
        beams.append(group)
    return beams


def xml_groups(notes):
    from collections import defaultdict
    g = defaultdict(list)
    for i, n in enumerate(notes):
        if n['xml_group'] is not None:
            g[n['xml_group']].append(i)
    return list(g.values())


def load_root(p):
    """Open an XML / MusicXML / MXL file and return the parsed root element.

    .mxl is a zip archive; the score XML is the first non-META-INF .xml inside.
    """
    if p.suffix.lower() == '.mxl':
        with zipfile.ZipFile(p) as zf:
            for name in zf.namelist():
                if name.startswith('META-INF') or name == 'container.xml':
                    continue
                if name.endswith('.xml') or name.endswith('.musicxml'):
                    with zf.open(name) as f:
                        return ET.parse(f).getroot()
        raise ValueError(f'No score XML in {p}')
    return ET.parse(p).getroot()


def main():
    total_xml_groups = 0
    matched = 0
    only_render = 0
    only_xml = 0
    examples = []
    files_with_diffs = set()
    parse_failures = []

    # Gather files across the three accepted extensions.
    files = []
    for ext in ('*.xml', '*.musicxml', '*.mxl'):
        files.extend(omnidir.glob(ext))
    files.sort()
    print(f'Scanning {len(files)} files in {omnidir}')

    for p in files:
        try:
            root = load_root(p)
        except (ET.ParseError, ValueError, zipfile.BadZipFile, Exception) as e:
            parse_failures.append((p.name, type(e).__name__, str(e)[:80]))
            continue
        doc_has_beams = root.find('.//beam') is not None
        if not doc_has_beams:
            # Engraver didn't specify beams anywhere in this file — there's no
            # ground truth to compare against; renderer's heuristic owns the
            # output. Skip the diff check for this file.
            continue
        for measure in root.iter('measure'):
            notes = parse_measure(measure, doc_has_beams=doc_has_beams)
            rendered = simulate_renderer(notes)
            expected = xml_groups(notes)

            # tuple them for set comparison (groups may include tuplet-only beams
            # that XML doesn't bracket but renderer beams from tuplet logic).
            rend_set = set(tuple(g) for g in rendered)
            exp_set = set(tuple(g) for g in expected)
            total_xml_groups += len(exp_set)
            matched += len(rend_set & exp_set)
            diff_r = rend_set - exp_set
            diff_e = exp_set - rend_set
            if diff_r or diff_e:
                only_render += len(diff_r)
                only_xml += len(diff_e)
                files_with_diffs.add(p.name)
                if len(examples) < 8:
                    examples.append((p.name, measure.get('number'),
                                     [list(g) for g in diff_e],
                                     [list(g) for g in diff_r],
                                     notes))

    print(f'Total XML beam groups: {total_xml_groups}')
    print(f'Matched: {matched}')
    print(f'Groups in XML but missing from render: {only_xml}')
    print(f'Groups in render but not in XML: {only_render}')
    print(f'Files with any diffs: {len(files_with_diffs)}/{len(files)}')
    if parse_failures:
        print(f'Parse failures: {len(parse_failures)}')
        for f in parse_failures[:10]:
            print(' ', f)
    print()
    for ex in examples:
        print(f'--- {ex[0]} measure {ex[1]} ---')
        print(f'  XML-only beam groups: {ex[2]}')
        print(f'  render-only beam groups: {ex[3]}')
        print('  notes:')
        for i, n in enumerate(ex[4]):
            marks = []
            if n['noBeam']:
                marks.append('noBeam')
            if n['beamBreak']:
                marks.append('beamBreak')
            if n['tuplet']:
                marks.append(f'tup{n["tuplet"]}')
            if n['is_rest']:
                marks.append('REST')
            xg = n['xml_group']
            print(f'    [{i}] {n["type"]}{"d" if n["dotted"] else ""} xmlG={xg} {",".join(marks)}')


if __name__ == '__main__':
    main()
