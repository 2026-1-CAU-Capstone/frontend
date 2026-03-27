# Jazzify chord2text Rule Engine -- Version 0.1.0

## Supported Features

### Layer 1: Individual Chord Analysis
- [x] Diatonic/Non-diatonic classification (major scale basis)
- [x] Scale degree calculation
- [x] T/SD/D function labeling (with ambiguity scores)
- [x] Chord normalization (tension stripping)

### Layer 2: Contextual Pattern Detection
- [x] ii-V-I detection (standard, minor, tritone sub, backdoor, incomplete, sus delay)
- [x] Tritone substitution detection (with ambiguity score)
- [x] Secondary dominant detection (with origin position)
- [x] Diminished chord classification (passing, auxiliary, dominant function)
- [x] Chromatic approach detection
- [x] Deceptive resolution detection
- [x] Pedal point detection

### Layer 3: Structural Analysis
- [x] Modal interchange detection (aeolian, dorian, phrygian, lydian, mixolydian)
- [x] Mode segment detection (sliding window)
- [x] Tonicization vs modulation detection (configurable threshold)
- [x] Section boundary detection

### Unsupported / Future Development
- [ ] Augmented 6th chord (Italian, French, German)
- [ ] Upper structure triad detection
- [ ] Coltrane changes / Giant Steps pattern
- [ ] Rhythm changes pattern detection
- [ ] Blues form detection
- [ ] Automatic key detection (Krumhansl-Schmuckler)

## Supported Input Formats
- [x] Plain text chord progression
- [x] iReal Pro export (basic)
- [x] Chord-annotated MIDI (text event)
- [ ] Raw MIDI chord estimation (future)
- [ ] Audio chord estimation (future)

## Substitution Rules (substitution_rules.yaml)
- tritone_sub: bII7 replaces V7. Root is tritone (6 semitones) from original V.
- backdoor: bVII7 resolves to I. iv-bVII7-I pattern.
- tonic_substitutes: IM7 can be replaced by iiim7
- tonic_substitutes: IM7 can be replaced by vim7
- subdominant_substitutes: IVM7 can be replaced by iim7
- subdominant_substitutes: IVM7 can be replaced by vim7 (ambiguous T/SD)
- dominant_substitutes: V7 can be replaced by viidim or viim7b5
- dominant_substitutes: V7 can be replaced by bII7 (tritone sub)
- dominant_substitutes: V can sometimes be replaced by iii in weak resolution
- chromatic_approach: Non-diatonic chord approaching target by half step (above or below)

