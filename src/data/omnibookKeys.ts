/**
 * Manual per-tune key overrides for the Charlie Parker / Miles Davis Omnibook
 * viewers. Edit this map when the automatic chord-progression-based key
 * inference (src/lib/note/keyInference.ts) produces the wrong answer for a
 * specific tune.
 *
 * Keys here are filename-derived IDs (filename without extension, matches the
 * OmnibookViewer `entry.id` minus the `.xml` / `.musicxml` suffix). Values
 * are key strings in the same format the rest of the app uses:
 *   major:  "C", "Bb", "F#", "Ab" ...
 *   minor:  "Cm", "F#m", "Bbm" ...
 *
 * Override precedence: this map wins over the inferred key. If a tune isn't
 * listed here, the inferred key is used. If inference also fails, the parser's
 * original key (almost always "C") is left in place.
 */

import type { OmnibookSource } from '../components/admin/OmnibookViewer';

export const OMNIBOOK_KEY_OVERRIDES: Record<OmnibookSource, Record<string, string>> = {
  parker: {
    // Example overrides — add tunes here when inference is wrong:
    // 'Anthropology.xml': 'Bb',
    // 'KoKo.xml':         'Bb',
    // 'Donna_Lee.xml':    'Ab',
  },
  miles: {
    // 'So_What.musicxml': 'Dm',
  },
};
