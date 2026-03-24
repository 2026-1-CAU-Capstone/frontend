import type { LeadSheetData } from './leadSheetTypes';

export const allOfMe: LeadSheetData = {
  title: 'All of Me',
  style: 'Medium Swing',
  composer: 'Marks / Simons',
  timeSignature: '4/4',
  key: 'C',
  systems: [
    { sectionLabel: 'A', bars: [
        { chords: [{ root: 'C', quality: 'Δ7', analysis: { rootPc: 0, degree: 'I', functions: [{ function: 'T', confidence: 1.0 }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'C', quality: 'Δ7', analysis: { rootPc: 0, degree: 'I', functions: [{ function: 'T', confidence: 1.0 }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'E', quality: '7', isDiatonic: false, analysis: { rootPc: 4, degree: 'III', functions: [{ function: 'D', confidence: 0.6 }], secondaryDominant: { targetDegree: 'vi' }, modeSegment: 'ionian', ambiguityScore: 0.31 } }] },
        { chords: [{ root: 'E', quality: '7', isDiatonic: false, analysis: { rootPc: 4, degree: 'III', functions: [{ function: 'D', confidence: 0.9 }], secondaryDominant: { targetDegree: 'vi' }, modeSegment: 'ionian', ambiguityScore: 0.14 } }] },
      ] },
    { bars: [
        { chords: [{ root: 'A', quality: '7', isDiatonic: false, analysis: { rootPc: 9, degree: 'VI', functions: [{ function: 'D', confidence: 0.6 }], secondaryDominant: { targetDegree: 'ii' }, modeSegment: 'dorian', ambiguityScore: 0.31 } }] },
        { chords: [{ root: 'A', quality: '7', isDiatonic: false, analysis: { rootPc: 9, degree: 'VI', functions: [{ function: 'D', confidence: 0.9 }], groupMemberships: [{ groupId: 1, groupType: 'ii-V-I', role: 'V', variant: 'minor' }], secondaryDominant: { targetDegree: 'ii' }, modeSegment: 'dorian', ambiguityScore: 0.22 } }] },
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], groupMemberships: [{ groupId: 1, groupType: 'ii-V-I', role: 'I', variant: 'minor' }], modeSegment: 'dorian' } }] },
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], modeSegment: 'dorian' } }] },
      ] },
    { sectionLabel: "A'", bars: [
        { chords: [{ root: 'E', quality: '7', isDiatonic: false, analysis: { rootPc: 4, degree: 'III', functions: [{ function: 'D', confidence: 0.6 }], secondaryDominant: { targetDegree: 'vi' }, modeSegment: 'dorian', ambiguityScore: 0.31 } }] },
        { chords: [{ root: 'E', quality: '7', isDiatonic: false, analysis: { rootPc: 4, degree: 'III', functions: [{ function: 'D', confidence: 0.9 }], groupMemberships: [{ groupId: 2, groupType: 'ii-V-I', role: 'V', variant: 'minor' }], secondaryDominant: { targetDegree: 'vi' }, modeSegment: 'dorian', ambiguityScore: 0.22 } }] },
        { chords: [{ root: 'A', quality: '-7', analysis: { rootPc: 9, degree: 'vi', functions: [{ function: 'T', confidence: 0.7 }, { function: 'SD', confidence: 0.3 }], groupMemberships: [{ groupId: 2, groupType: 'ii-V-I', role: 'I', variant: 'minor' }], modeSegment: 'aeolian', ambiguityScore: 0.117 } }] },
        { chords: [{ root: 'A', quality: '-7', analysis: { rootPc: 9, degree: 'vi', functions: [{ function: 'T', confidence: 0.7 }, { function: 'SD', confidence: 0.3 }], groupMemberships: [{ groupId: 3, groupType: 'ii-V-I', role: 'ii', variant: 'incomplete' }], modeSegment: 'dorian', ambiguityScore: 0.117 } }] },
      ] },
    { bars: [
        { chords: [{ root: 'D', quality: '7', isDiatonic: false, analysis: { rootPc: 2, degree: 'II', functions: [{ function: 'D', confidence: 0.6 }], groupMemberships: [{ groupId: 3, groupType: 'ii-V-I', role: 'V', variant: 'incomplete' }], secondaryDominant: { targetDegree: 'V' }, modeSegment: 'dorian', ambiguityScore: 0.37 } }] },
        { chords: [{ root: 'D', quality: '7', isDiatonic: false, analysis: { rootPc: 2, degree: 'II', functions: [{ function: 'D', confidence: 0.6 }], secondaryDominant: { targetDegree: 'V' }, modeSegment: 'dorian', ambiguityScore: 0.31 } }] },
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], groupMemberships: [{ groupId: 4, groupType: 'ii-V-I', role: 'ii', variant: 'standard' }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'G', quality: '7', analysis: { rootPc: 7, degree: 'V', functions: [{ function: 'D', confidence: 1.0 }], groupMemberships: [{ groupId: 4, groupType: 'ii-V-I', role: 'V', variant: 'standard' }], modeSegment: 'ionian' } }] },
      ] },
    { sectionLabel: 'A', bars: [
        { chords: [{ root: 'C', quality: 'Δ7', analysis: { rootPc: 0, degree: 'I', functions: [{ function: 'T', confidence: 1.0 }], groupMemberships: [{ groupId: 4, groupType: 'ii-V-I', role: 'I', variant: 'standard' }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'C', quality: 'Δ7', analysis: { rootPc: 0, degree: 'I', functions: [{ function: 'T', confidence: 1.0 }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'E', quality: '7', isDiatonic: false, analysis: { rootPc: 4, degree: 'III', functions: [{ function: 'D', confidence: 0.6 }], secondaryDominant: { targetDegree: 'vi' }, modeSegment: 'ionian', ambiguityScore: 0.31 } }] },
        { chords: [{ root: 'E', quality: '7', isDiatonic: false, analysis: { rootPc: 4, degree: 'III', functions: [{ function: 'D', confidence: 0.9 }], secondaryDominant: { targetDegree: 'vi' }, modeSegment: 'ionian', ambiguityScore: 0.14 } }] },
      ] },
    { bars: [
        { chords: [{ root: 'A', quality: '7', isDiatonic: false, analysis: { rootPc: 9, degree: 'VI', functions: [{ function: 'D', confidence: 0.6 }], secondaryDominant: { targetDegree: 'ii' }, modeSegment: 'dorian', ambiguityScore: 0.31 } }] },
        { chords: [{ root: 'A', quality: '7', isDiatonic: false, analysis: { rootPc: 9, degree: 'VI', functions: [{ function: 'D', confidence: 0.9 }], groupMemberships: [{ groupId: 5, groupType: 'ii-V-I', role: 'V', variant: 'minor' }], secondaryDominant: { targetDegree: 'ii' }, modeSegment: 'dorian', ambiguityScore: 0.22 } }] },
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], groupMemberships: [{ groupId: 5, groupType: 'ii-V-I', role: 'I', variant: 'minor' }], modeSegment: 'dorian' } }] },
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], modeSegment: 'dorian' } }] },
      ] },
    { sectionLabel: 'B', bars: [
        { chords: [{ root: 'F', quality: '6', analysis: { rootPc: 5, degree: 'IV', functions: [{ function: 'SD', confidence: 1.0 }], modeSegment: 'dorian' } }] },
        { chords: [{ root: 'F', quality: '-6', isDiatonic: false, analysis: { rootPc: 5, degree: 'iv', modeSegment: 'ionian', ambiguityScore: 0.53 } }] },
        { chords: [{ root: 'C', quality: 'Δ7', analysis: { rootPc: 0, degree: 'I', functions: [{ function: 'T', confidence: 1.0 }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'A', quality: '7', isDiatonic: false, analysis: { rootPc: 9, degree: 'VI', functions: [{ function: 'D', confidence: 0.9 }], groupMemberships: [{ groupId: 6, groupType: 'ii-V-I', role: 'V', variant: 'minor' }], secondaryDominant: { targetDegree: 'ii' }, modeSegment: 'dorian', ambiguityScore: 0.22 } }] },
      ] },
    { bars: [
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], groupMemberships: [{ groupId: 6, groupType: 'ii-V-I', role: 'I', variant: 'minor' }], modeSegment: 'dorian' } }] },
        { chords: [{ root: 'G', quality: '7', analysis: { rootPc: 7, degree: 'V', functions: [{ function: 'D', confidence: 1.0 }], groupMemberships: [{ groupId: 7, groupType: 'ii-V-I', role: 'V', variant: 'standard' }], modeSegment: 'dorian' } }] },
        { chords: [{ root: 'C', quality: '6', analysis: { rootPc: 0, degree: 'I', functions: [{ function: 'T', confidence: 1.0 }], groupMemberships: [{ groupId: 7, groupType: 'ii-V-I', role: 'I', variant: 'standard' }], modeSegment: 'ionian' } }] },
        { chords: [{ root: 'D', quality: '-7', analysis: { rootPc: 2, degree: 'ii', functions: [{ function: 'SD', confidence: 1.0 }], groupMemberships: [{ groupId: 8, groupType: 'ii-V-I', role: 'ii', variant: 'incomplete' }], modeSegment: 'ionian' } }, { root: 'G', quality: '7', analysis: { rootPc: 7, degree: 'V', functions: [{ function: 'D', confidence: 1.0 }], groupMemberships: [{ groupId: 8, groupType: 'ii-V-I', role: 'V', variant: 'incomplete' }], modeSegment: 'ionian' } }] },
      ] },
  ],
};
