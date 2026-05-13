/**
 * Degree — port of JJazzLab's Degree.java enum.
 *
 * A "Degree" is a specific scale degree like THIRD, NINTH_FLAT, FIFTH_SHARP.
 * Each degree has a "Natural" (which scale tone: 1/3/5/7/9/11/13) and an
 * accidental offset (-1/0/+1). The resulting relative pitch (0..11) is the
 * combination.
 *
 * Source: model/Harmony/src/main/java/org/jjazz/harmony/api/Degree.java
 */

/** The seven "natural" scale degrees. intValue is the human label (1, 3, 5, 7, 9, 11, 13).
 * pitch is the relative pitch (0..11) of that natural degree above the root. */
export const Natural = {
  ROOT:     { name: 'ROOT'    as const, intValue: 1,  pitch: 0  },
  NINTH:    { name: 'NINTH'   as const, intValue: 9,  pitch: 2  },
  THIRD:    { name: 'THIRD'   as const, intValue: 3,  pitch: 4  },
  ELEVENTH: { name: 'ELEVENTH'as const, intValue: 11, pitch: 5  },
  FIFTH:    { name: 'FIFTH'   as const, intValue: 5,  pitch: 7  },
  SIXTH:    { name: 'SIXTH'   as const, intValue: 13, pitch: 9  },
  SEVENTH:  { name: 'SEVENTH' as const, intValue: 7,  pitch: 11 },
} as const;

export type NaturalKey = keyof typeof Natural;

/** Look up Natural by intValue (1, 9, 3, 11, 5, 13, 7). */
export function naturalFromIntValue(v: number): NaturalKey | null {
  for (const k of Object.keys(Natural) as NaturalKey[]) {
    if (Natural[k].intValue === v) return k;
  }
  return null;
}

/** The 15 enumerated Degree values. */
export type DegreeName =
  | 'ROOT'
  | 'NINTH_FLAT' | 'NINTH' | 'NINTH_SHARP'
  | 'THIRD_FLAT' | 'THIRD'
  | 'FOURTH_OR_ELEVENTH' | 'ELEVENTH_SHARP'
  | 'FIFTH_FLAT' | 'FIFTH' | 'FIFTH_SHARP'
  | 'THIRTEENTH_FLAT' | 'SIXTH_OR_THIRTEENTH'
  | 'SEVENTH_FLAT' | 'SEVENTH';

export interface Degree {
  name: DegreeName;
  natural: NaturalKey;
  /** -1, 0, or +1 */
  accidental: number;
  /** Resulting relative pitch (0..11) above root. */
  pitch: number;
}

export const Degrees: Record<DegreeName, Degree> = {
  ROOT:                { name: 'ROOT',                natural: 'ROOT',     accidental: 0,  pitch: 0  },
  NINTH_FLAT:          { name: 'NINTH_FLAT',          natural: 'NINTH',    accidental: -1, pitch: 1  },
  NINTH:               { name: 'NINTH',               natural: 'NINTH',    accidental: 0,  pitch: 2  },
  NINTH_SHARP:         { name: 'NINTH_SHARP',         natural: 'NINTH',    accidental: 1,  pitch: 3  },
  THIRD_FLAT:          { name: 'THIRD_FLAT',          natural: 'THIRD',    accidental: -1, pitch: 3  },
  THIRD:               { name: 'THIRD',               natural: 'THIRD',    accidental: 0,  pitch: 4  },
  FOURTH_OR_ELEVENTH:  { name: 'FOURTH_OR_ELEVENTH',  natural: 'ELEVENTH', accidental: 0,  pitch: 5  },
  ELEVENTH_SHARP:      { name: 'ELEVENTH_SHARP',      natural: 'ELEVENTH', accidental: 1,  pitch: 6  },
  FIFTH_FLAT:          { name: 'FIFTH_FLAT',          natural: 'FIFTH',    accidental: -1, pitch: 6  },
  FIFTH:               { name: 'FIFTH',               natural: 'FIFTH',    accidental: 0,  pitch: 7  },
  FIFTH_SHARP:         { name: 'FIFTH_SHARP',         natural: 'FIFTH',    accidental: 1,  pitch: 8  },
  THIRTEENTH_FLAT:     { name: 'THIRTEENTH_FLAT',     natural: 'SIXTH',    accidental: -1, pitch: 8  },
  SIXTH_OR_THIRTEENTH: { name: 'SIXTH_OR_THIRTEENTH', natural: 'SIXTH',    accidental: 0,  pitch: 9  },
  SEVENTH_FLAT:        { name: 'SEVENTH_FLAT',        natural: 'SEVENTH',  accidental: -1, pitch: 10 },
  SEVENTH:             { name: 'SEVENTH',             natural: 'SEVENTH',  accidental: 0,  pitch: 11 },
};

/** "Db" / "3" / "b9" / "#11" — short label as in JJazzLab Degree.toStringShort(). */
export function degreeToShortString(d: Degree): string {
  const n = Natural[d.natural].intValue;
  if (d.accidental === -1) return `b${n}`;
  if (d.accidental === +1) return `#${n}`;
  return String(n);
}

/** Get a Degree by (natural, alt). alt ∈ {-1, 0, +1}. Returns null if no match. */
export function getDegreeByNaturalAlt(natural: NaturalKey, alt: number): Degree | null {
  for (const key of Object.keys(Degrees) as DegreeName[]) {
    const d = Degrees[key];
    if (d.natural === natural && d.accidental === alt) return d;
  }
  return null;
}
