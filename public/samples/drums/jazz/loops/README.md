# Jazz drum loops — drop site

The backing player's mixer ("Brushes" / "Sticks" buttons) reads two fixed
filenames from this folder:

| Kit       | Expected filename               | Source (Freesound)                                                   | License  |
|-----------|---------------------------------|----------------------------------------------------------------------|----------|
| Brushes   | `brushes-145bpm.wav`            | [#107846 vincent sermonne brush-loop](https://freesound.org/people/vincent%20sermonne/sounds/107846/) | CC-BY 4.0 |
| Sticks    | `sticks-120bpm.mp3`             | [#353081 jimrsbjorklund jazz-drum-beat-120-bpm](https://freesound.org/people/jimrsbjorklund/sounds/353081/) | CC0 |

Download from Freesound (free account required), rename to the exact
filename above, and drop the file here. Pick the matching kit from the
backing player's mixer popup. The "Synth Kit" option falls back to the
built-in per-hit sampler and doesn't need any file here.

**Attribution requirement:** when "Brushes" is selected the UI shows
"Drums: Vincent Sermonne — Freesound #107846 (CC-BY 4.0)" automatically,
so the CC-BY obligation is met as long as the kit is visible during use.

---

## Advanced: pointing at a different file

If you want to use your own loop, you can call `setConfig` manually:

```ts
player.setConfig({
  drumMode: "loop",
  drumLoop: {
    url: "/samples/drums/jazz/loops/swing-120bpm.wav",
    recordedBpm: 120,
    gain: 1.0,
    maxRateDeviation: 0.15,   // ±15% playbackRate clamp (default)
  },
});
```

## Free CC0/CC-BY candidates from Freesound

Reviewed via metadata only — audit by ear before committing to one.

### CC0 (no attribution required, simplest)

1. **`353081__jimrsbjorklund__jazz-drum-beat-120-bpm.mp3`** — 3:54, 120 BPM, MP3
   - https://freesound.org/people/jimrsbjorklund/sounds/353081/
   - Title says "jazz drum beat 120 BPM". Length is long enough that you can
     trim out a good clean 4 or 8-bar loop. Unverified whether it's live or
     programmed.

2. **`261100__frankyboomer__jazz-loop.wav`** — 1:02, "50s jazz" vibe, stereo WAV
   - https://freesound.org/people/FrankyBoomer/sounds/261100/
   - Made in Ableton (sequenced from samples, not live drumming). Use as
     fallback if you want the *sound* of vintage jazz drums without caring
     about real-human-played authenticity.

### CC-BY (attribution required — credit drummer in About page)

3. **`107846__vincent-sermonne__brush-loop.wav`** — 0:53, 145 BPM, stereo WAV
   - https://freesound.org/people/vincent%20sermonne/sounds/107846/
   - "Long Jazz brush-loop." Closer to the real-drummer-with-brushes vibe
     than the CC0 options. Requires crediting Vincent Sermonne.

## How to install

1. Pick one of the above, log in to freesound.org (free account), download.
2. Rename to something descriptive — e.g.
   `swing-120bpm.wav`, `brush-145bpm.wav`.
3. Drop it in this folder.
4. Wire up the config (see example at top).
5. Verify the loop seam — if you hear a click/pop where the loop repeats,
   trim the file in Audacity so it starts and ends exactly at a downbeat
   with zero silence.

## Bar-aligned loop math

For the loop to repeat *without drift over many bars*, its length should be
an integer number of bars at the recorded BPM:

```
loop_length_sec = bars * (60 / recordedBpm) * beatsPerBar
```

E.g. 4 bars of 4/4 at 120 BPM → 8.0 s exactly.
