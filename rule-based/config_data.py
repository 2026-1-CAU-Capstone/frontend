"""Python config fallback for environments without PyYAML."""

FUNCTION_MAP = {
    "major_key": {
        "I": [{"function": "T", "confidence": 1.0}],
        "ii": [{"function": "SD", "confidence": 1.0}],
        "iii": [
            {"function": "T", "confidence": 0.6, "note": "Tonic substitute (shares 2 tones with I)"},
            {"function": "D_mediant", "confidence": 0.3, "note": "Dominant mediant in some contexts"},
        ],
        "IV": [{"function": "SD", "confidence": 1.0}],
        "V": [{"function": "D", "confidence": 1.0}],
        "vi": [
            {"function": "T", "confidence": 0.7, "note": "Tonic substitute (relative minor)"},
            {"function": "SD", "confidence": 0.3, "note": "Subdominant function in some progressions"},
        ],
        "vii": [{"function": "D", "confidence": 0.9, "note": "Leading tone chord, dominant function"}],
        "viio": [{"function": "D", "confidence": 0.9, "note": "Leading tone chord, dominant function"}],
    },
    "chromatic_degrees": {
        "bII": [
            {"function": "SD", "confidence": 0.6, "note": "Neapolitan / Phrygian"},
            {"function": "D_substitute", "confidence": 0.4, "note": "Tritone sub of V when dom7"},
        ],
        "bii": [{"function": "SD", "confidence": 0.6, "note": "Neapolitan area (minor quality)"}],
        "II": [
            {"function": "D", "confidence": 0.7, "note": "Secondary dominant area (V/V)"},
            {"function": "SD", "confidence": 0.3, "note": "Lydian II"},
        ],
        "III": [
            {"function": "D", "confidence": 0.5, "note": "Secondary dominant area (V/vi) when dom7"},
            {"function": "T", "confidence": 0.4, "note": "Major mediant, tonic substitute"},
        ],
        "bIII": [
            {"function": "T", "confidence": 0.5, "note": "Modal interchange from minor"},
            {"function": "SD", "confidence": 0.3},
        ],
        "biii": [{"function": "T", "confidence": 0.4, "note": "Modal interchange from minor (minor quality)"}],
        "#iv": [{"function": "D", "confidence": 0.7, "note": "Passing chromatic to V"}],
        "#IVo": [{"function": "D", "confidence": 0.8, "note": "Passing diminished with dominant function"}],
        "#IV": [{"function": "D", "confidence": 0.5, "note": "Lydian II or passing"}],
        "bV": [{"function": "D_substitute", "confidence": 0.7, "note": "Tritone sub area"}],
        "VI": [
            {"function": "D", "confidence": 0.7, "note": "Secondary dominant area (V/ii) when dom7"},
            {"function": "SD", "confidence": 0.3},
        ],
        "bVI": [
            {"function": "SD", "confidence": 0.7, "note": "Modal interchange from minor"},
            {"function": "T", "confidence": 0.3, "note": "Deceptive resolution target"},
        ],
        "VII": [
            {"function": "D", "confidence": 0.7, "note": "Secondary dominant area (V/iii) when dom7"},
            {"function": "T", "confidence": 0.2, "note": "Leading tone area"},
        ],
        "bVII": [
            {"function": "SD", "confidence": 0.6, "note": "Modal interchange (mixolydian/aeolian)"},
            {"function": "D", "confidence": 0.3, "note": "Backdoor dominant approach"},
        ],
        "bvii": [{"function": "SD", "confidence": 0.5, "note": "Modal interchange (minor quality)"}],
        "i": [{"function": "T", "confidence": 0.8, "note": "Parallel minor tonic (modal interchange)"}],
        "v": [
            {"function": "D", "confidence": 0.4, "note": "Minor v, weaker dominant"},
            {"function": "T", "confidence": 0.3},
        ],
    },
    "minor_key": {
        "i": [{"function": "T", "confidence": 1.0}],
        "ii": [{"function": "SD", "confidence": 1.0}],
        "iio": [{"function": "SD", "confidence": 1.0}],
        "bIII": [
            {"function": "T", "confidence": 0.6, "note": "Relative major"},
            {"function": "SD", "confidence": 0.3},
        ],
        "III": [{"function": "T", "confidence": 0.5, "note": "Major III (major quality)"}],
        "iv": [{"function": "SD", "confidence": 1.0}],
        "v": [
            {"function": "D", "confidence": 0.6, "note": "Minor dominant (weaker)"},
            {"function": "T", "confidence": 0.2},
        ],
        "V": [{"function": "D", "confidence": 1.0, "note": "Harmonic minor dominant"}],
        "bVI": [
            {"function": "SD", "confidence": 0.8},
            {"function": "T", "confidence": 0.2},
        ],
        "VI": [{"function": "SD", "confidence": 0.7, "note": "Raised 6th degree"}],
        "bVII": [
            {"function": "SD", "confidence": 0.5},
            {"function": "D", "confidence": 0.4, "note": "Subtonic dominant"},
        ],
        "VII": [{"function": "D", "confidence": 0.8, "note": "Leading tone (harmonic minor)"}],
        "viio": [{"function": "D", "confidence": 0.9, "note": "Leading tone diminished"}],
        "bII": [{"function": "SD", "confidence": 0.6, "note": "Neapolitan"}],
        "bii": [{"function": "SD", "confidence": 0.5}],
        "II": [{"function": "D", "confidence": 0.6, "note": "Secondary dominant area"}],
    },
}


MODAL_INTERCHANGE = {
    "aeolian": {
        "name": "Natural Minor (Aeolian)",
        "available_degrees": [
            {"interval": 0, "quality": "min7", "degree_label": "i"},
            {"interval": 2, "quality": "min7b5", "degree_label": "ii°"},
            {"interval": 3, "quality": "maj7", "degree_label": "bIII"},
            {"interval": 5, "quality": "min7", "degree_label": "iv"},
            {"interval": 7, "quality": "min7", "degree_label": "v"},
            {"interval": 8, "quality": "maj7", "degree_label": "bVI"},
            {"interval": 10, "quality": "dom7", "degree_label": "bVII"},
        ],
        "common_borrows": [
            {"degree_label": "bVII", "note": "Very common in pop/rock and jazz"},
            {"degree_label": "bVI", "note": "Common dramatic chord"},
            {"degree_label": "iv", "note": "Minor subdominant, very common"},
            {"degree_label": "bIII", "note": "Common in rock"},
            {"degree_label": "v", "note": "Less common, modal flavor"},
        ],
    },
    "dorian": {
        "name": "Dorian",
        "available_degrees": [
            {"interval": 0, "quality": "min7", "degree_label": "i"},
            {"interval": 2, "quality": "min7", "degree_label": "ii"},
            {"interval": 3, "quality": "maj7", "degree_label": "bIII"},
            {"interval": 5, "quality": "dom7", "degree_label": "IV7"},
            {"interval": 7, "quality": "min7", "degree_label": "v"},
            {"interval": 9, "quality": "min7b5", "degree_label": "vi°"},
            {"interval": 10, "quality": "maj7", "degree_label": "bVII"},
        ],
        "common_borrows": [
            {"degree_label": "IV7", "note": "Dominant quality IV, bluesy"},
            {"degree_label": "bVII", "note": "Major bVII"},
        ],
    },
    "phrygian": {
        "name": "Phrygian",
        "available_degrees": [
            {"interval": 0, "quality": "min7", "degree_label": "i"},
            {"interval": 1, "quality": "maj7", "degree_label": "bII"},
            {"interval": 3, "quality": "dom7", "degree_label": "bIII7"},
            {"interval": 5, "quality": "min7", "degree_label": "iv"},
            {"interval": 7, "quality": "min7b5", "degree_label": "v°"},
            {"interval": 8, "quality": "maj7", "degree_label": "bVI"},
            {"interval": 10, "quality": "min7", "degree_label": "bvii"},
        ],
        "common_borrows": [{"degree_label": "bII", "note": "Phrygian / Neapolitan chord"}],
    },
    "lydian": {
        "name": "Lydian",
        "available_degrees": [
            {"interval": 0, "quality": "maj7", "degree_label": "I"},
            {"interval": 2, "quality": "dom7", "degree_label": "II7"},
            {"interval": 4, "quality": "min7", "degree_label": "iii"},
            {"interval": 6, "quality": "min7b5", "degree_label": "#iv°"},
            {"interval": 7, "quality": "maj7", "degree_label": "V"},
            {"interval": 9, "quality": "min7", "degree_label": "vi"},
            {"interval": 11, "quality": "min7", "degree_label": "vii"},
        ],
        "common_borrows": [
            {"degree_label": "II7", "note": "Lydian dominant II"},
            {"degree_label": "#iv°", "note": "Sharp four diminished"},
        ],
    },
    "mixolydian": {
        "name": "Mixolydian",
        "available_degrees": [
            {"interval": 0, "quality": "dom7", "degree_label": "I7"},
            {"interval": 2, "quality": "min7", "degree_label": "ii"},
            {"interval": 4, "quality": "min7b5", "degree_label": "iii°"},
            {"interval": 5, "quality": "maj7", "degree_label": "IV"},
            {"interval": 7, "quality": "min7", "degree_label": "v"},
            {"interval": 9, "quality": "min7", "degree_label": "vi"},
            {"interval": 10, "quality": "maj7", "degree_label": "bVII"},
        ],
        "common_borrows": [
            {"degree_label": "bVII", "note": "Major bVII from mixolydian"},
            {"degree_label": "I7", "note": "Dominant I instead of maj7"},
        ],
    },
}
