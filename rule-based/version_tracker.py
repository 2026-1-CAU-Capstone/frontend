"""Version Tracker: Auto-generates VERSION.md documenting engine capabilities."""

import os

VERSION_TEMPLATE = """# Jazzify chord2text Rule Engine -- Version {version}

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
{sub_rules}
"""


def generate_version_md(version: str = "0.1.0") -> str:
    """Generate VERSION.md content."""
    import yaml
    config_dir = os.path.join(os.path.dirname(__file__), 'config')
    sub_rules_path = os.path.join(config_dir, 'substitution_rules.yaml')

    sub_rules_text = ""
    if os.path.exists(sub_rules_path):
        with open(sub_rules_path, 'r') as f:
            rules = yaml.safe_load(f)
        for rule_name, rule_data in rules.items():
            if isinstance(rule_data, dict) and 'description' in rule_data:
                sub_rules_text += f"- {rule_name}: {rule_data['description']}\n"
            elif isinstance(rule_data, list):
                for item in rule_data:
                    if isinstance(item, dict) and 'note' in item:
                        sub_rules_text += f"- {rule_name}: {item['note']}\n"

    if not sub_rules_text:
        sub_rules_text = "- tritone substitution: V7 -> bII7\n- tonic substitutes: I -> iii, I -> vi\n- dominant substitutes: V7 -> vii deg\n"

    return VERSION_TEMPLATE.format(version=version, sub_rules=sub_rules_text)


def write_version_md(output_dir: str = None, version: str = "0.1.0"):
    """Write VERSION.md to the project directory."""
    if output_dir is None:
        output_dir = os.path.dirname(__file__)
    content = generate_version_md(version)
    path = os.path.join(output_dir, 'VERSION.md')
    with open(path, 'w') as f:
        f.write(content)
    return path


if __name__ == '__main__':
    path = write_version_md()
    print(f"Generated: {path}")
