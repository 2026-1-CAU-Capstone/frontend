"""Batch processor for running the rule engine on a corpus of songs.

Usage:
    # From a JSON corpus file (list of {title, key, chords} objects):
    python batch.py --corpus songs.json --output results/

    # Generates:
    #   results/<title>.json          — per-song analysis
    #   results/_corpus_stats.json    — aggregate statistics
    #   results/_high_confidence.json — chords with ambiguity_score ≤ 0.1
    #   results/_ambiguous.json       — chords with ambiguity_score > 0.3

Input JSON format:
    [
      {"title": "Autumn Leaves", "key": "C", "chords": "Dm7 | G7 | Cmaj7 | ..."},
      {"title": "Blue Bossa",    "key": "Cm", "chords": "Cm7 | Cm7 | Fm7 | ..."},
      ...
    ]
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from main import analyze
from aggregator import to_json


def process_corpus(corpus: list[dict], output_dir: str,
                   verbose: bool = True) -> dict:
    """Process a list of songs and write per-song + aggregate results.

    Args:
        corpus: List of dicts with keys: title, key, chords
                (optionally: time_signature)
        output_dir: Directory to write output files
        verbose: Print progress

    Returns:
        Corpus-level statistics dict.
    """
    os.makedirs(output_dir, exist_ok=True)

    all_high_conf = []   # ambiguity_score ≤ 0.1
    all_ambiguous = []   # ambiguity_score > 0.3
    all_medium = []      # 0.1 < score ≤ 0.3

    song_stats = []
    total_chords = 0
    total_high = 0
    total_ambiguous = 0
    errors = []

    t0 = time.time()

    for i, entry in enumerate(corpus):
        title = entry.get('title', f'Song_{i+1}')
        key = entry.get('key', 'C')
        chords_text = entry.get('chords', '')
        time_sig = entry.get('time_signature', '4/4')

        if not chords_text.strip():
            errors.append({'title': title, 'error': 'empty chords'})
            continue

        try:
            result = analyze(chords_text, key=key, title=title,
                             time_signature=time_sig)
        except Exception as e:
            errors.append({'title': title, 'error': str(e)})
            if verbose:
                print(f"  ERROR: {title}: {e}")
            continue

        if 'error' in result:
            errors.append({'title': title, 'error': result['error']})
            continue

        # Write per-song JSON
        safe_title = "".join(c if c.isalnum() or c in ' _-' else '_'
                             for c in title).strip()
        song_path = os.path.join(output_dir, f"{safe_title}.json")
        with open(song_path, 'w') as f:
            f.write(to_json(result))

        # Collect stats
        stats = result.get('ambiguity_stats', {})
        n = stats.get('total_chords', 0)
        hc = stats.get('high_confidence_count', 0)
        amb = stats.get('ambiguous_count', 0)

        total_chords += n
        total_high += hc
        total_ambiguous += amb

        song_stats.append({
            'title': title,
            'key': key,
            'num_chords': n,
            'high_confidence_count': hc,
            'high_confidence_pct': stats.get('high_confidence_pct', 0),
            'ambiguous_count': amb,
            'ambiguous_pct': stats.get('ambiguous_pct', 0),
            'mean_score': stats.get('mean_score', 0),
            'max_score': stats.get('max_score', 0),
        })

        # Categorize individual chords
        for chord_dict in result.get('chords', []):
            a = chord_dict.get('analysis', {})
            score = a.get('ambiguity_score', 0.0)
            chord_entry = {
                'song': title,
                'bar': chord_dict['bar'],
                'beat': chord_dict['beat'],
                'symbol': chord_dict['symbol'],
                'degree': a.get('degree'),
                'is_diatonic': a.get('is_diatonic'),
                'functions': a.get('functions', []),
                'ambiguity_score': score,
                'group_memberships': a.get('group_memberships', []),
                'secondary_dominant': a.get('secondary_dominant'),
                'modal_interchange': a.get('modal_interchange'),
                'tonicization': a.get('tonicization'),
            }
            if score <= 0.1:
                all_high_conf.append(chord_entry)
            elif score > 0.3:
                all_ambiguous.append(chord_entry)
            else:
                all_medium.append(chord_entry)

        if verbose and (i + 1) % 50 == 0:
            print(f"  Processed {i+1}/{len(corpus)} songs...")

    elapsed = time.time() - t0

    # ── Corpus-level stats ──
    corpus_stats = {
        'total_songs': len(corpus),
        'successful_songs': len(song_stats),
        'errors': len(errors),
        'total_chords': total_chords,
        'high_confidence_count': total_high,
        'high_confidence_pct': round(total_high / total_chords * 100, 1) if total_chords else 0,
        'medium_count': len(all_medium),
        'medium_pct': round(len(all_medium) / total_chords * 100, 1) if total_chords else 0,
        'ambiguous_count': total_ambiguous,
        'ambiguous_pct': round(total_ambiguous / total_chords * 100, 1) if total_chords else 0,
        'processing_time_seconds': round(elapsed, 2),
        'per_song_stats': song_stats,
        'error_list': errors,
    }

    # Write aggregate files
    with open(os.path.join(output_dir, '_corpus_stats.json'), 'w') as f:
        json.dump(corpus_stats, f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, '_high_confidence.json'), 'w') as f:
        json.dump(all_high_conf, f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, '_ambiguous.json'), 'w') as f:
        json.dump(all_ambiguous, f, indent=2, ensure_ascii=False)

    with open(os.path.join(output_dir, '_medium.json'), 'w') as f:
        json.dump(all_medium, f, indent=2, ensure_ascii=False)

    if verbose:
        print(f"\nDone! {len(song_stats)}/{len(corpus)} songs processed in {elapsed:.1f}s")
        print(f"  Total chords: {total_chords}")
        print(f"  High confidence (≤0.1): {total_high} ({corpus_stats['high_confidence_pct']}%)")
        print(f"  Medium (0.1-0.3):       {len(all_medium)} ({corpus_stats['medium_pct']}%)")
        print(f"  Ambiguous (>0.3):       {total_ambiguous} ({corpus_stats['ambiguous_pct']}%)")
        if errors:
            print(f"  Errors: {len(errors)}")

    return corpus_stats


def main():
    parser = argparse.ArgumentParser(
        description='Batch process a corpus of songs through the rule engine'
    )
    parser.add_argument('--corpus', '-c', type=str, required=True,
                        help='Input JSON corpus file')
    parser.add_argument('--output', '-o', type=str, default='results/',
                        help='Output directory (default: results/)')
    parser.add_argument('--quiet', '-q', action='store_true',
                        help='Suppress progress output')

    args = parser.parse_args()

    with open(args.corpus, 'r') as f:
        corpus = json.load(f)

    if not isinstance(corpus, list):
        print("Error: corpus file must contain a JSON array of song objects")
        sys.exit(1)

    process_corpus(corpus, args.output, verbose=not args.quiet)


if __name__ == '__main__':
    main()
