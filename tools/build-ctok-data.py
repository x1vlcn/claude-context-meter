"""
Build browser-ready ctok data artifacts from the upstream ctok vocabulary files.

Upstream: https://github.com/sanderland/ctok (MIT, Sander Land)

Two kinds of artifact are emitted into src/ctok/data/:

  vocab-v3.json / vocab-v47.json
      The vocabulary, stripped of the per-piece `witness` provenance records that
      make the upstream files 3.7 MB / 1.1 MB. We only need membership (every
      piece costs exactly 1 token), so a witness is dead weight in a content
      script. Pieces are stored in the upstream PUBLIC notation (⟨bow⟩the⟨eow⟩)
      and parsed to internal glyphs at load time by notation.js.

  unicode-tables.json
      Every per-codepoint predicate ctok's encoder needs, precomputed here and
      range-compressed.

WHY precompute instead of reimplementing in JS: ctok's classifier leans on
`unicodedata` for canonical combining class (no JS API exists at all), general
categories, and Python's exact `isupper`/`islower` semantics. Reimplementing
those with `\\p{...}` regexes would silently drift whenever the browser's Unicode
version differs from the one that built the vocabulary — and a single misclassified
codepoint changes a token count with no visible error. Each predicate below is a
PURE function of one codepoint, so we evaluate all of them once, here, against the
same `unicodedata` that ctok itself uses, and ship the answers. The browser then
does a binary search over sorted ranges and needs no Unicode knowledge of its own.

The tables cost ~40 KB and remove an entire class of correctness risk.

Usage:  python tools/build-ctok-data.py --ctok <path to cloned ctok repo>
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

# The upstream group that holds byte-prefix tokens rather than cost-1 pieces.
BYTES_GROUP = "bytes_fallback"
KEEP_GROUPS = ("word_pieces", "ascii_digits", "other_digits", "punctuation",
               "whitespace", "markers", "contractions", BYTES_GROUP)

FAMILIES = {
    "v3":   {"file": "pieces_v3.json",   "vocab": "v3"},
    "v4.7": {"file": "pieces_v4_7.json", "vocab": "v47"},
    # v5 reuses v4.7's vocabulary and overrides only the frame; see src/ctok/index.js.
}

# Stream classes, encoded as small ints for the shipped table.
CLS_WORDY, CLS_HARD, CLS_DIGIT, CLS_PUNCT, CLS_SPACE = 0, 1, 2, 3, 4

MAX_CP = 0x110000


def _load_ctok(ctok_repo: Path):
    """Import the upstream package straight from the clone, so every predicate we
    table is evaluated by ctok's own code rather than a paraphrase of it.

    NB import_module, not `from ctok import normalize`: ctok's __init__ re-exports a
    `normalize()` FUNCTION that shadows the submodule of the same name."""
    import importlib
    sys.path.insert(0, str(ctok_repo))
    return (importlib.import_module("ctok.constants"),
            importlib.import_module("ctok.normalize"))


def compress_ranges(pairs: list[tuple[int, int]]) -> list[list[int]]:
    """[(cp, value), ...] sorted by cp → [[lo, hi, value], ...] inclusive."""
    out: list[list[int]] = []
    for cp, val in pairs:
        if out and out[-1][2] == val and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp, val])
    return out


def compress_bool(codepoints: list[int]) -> list[list[int]]:
    """Sorted codepoint list → [[lo, hi], ...] inclusive ranges."""
    out: list[list[int]] = []
    for cp in codepoints:
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def build_unicode_tables(constants, normalize) -> dict:
    """Evaluate every per-codepoint predicate the encoder uses."""
    cls_pairs: list[tuple[int, int]] = []
    num_pairs: list[tuple[int, int]] = []
    sep, stray, punct_like, digit_border = [], [], [], []
    is_upper, is_lower, unlowerable = [], [], []
    lower_exceptions: dict[str, str] = {}

    cls_code = {constants.WORDY: CLS_WORDY, constants.HARD: CLS_HARD,
                constants.DIGIT: CLS_DIGIT, constants.PUNCT: CLS_PUNCT,
                constants.SPACE: CLS_SPACE}

    for cp in range(MAX_CP):
        if 0xD800 <= cp <= 0xDFFF:      # lone surrogates are never real input
            continue
        c = chr(cp)

        cls_pairs.append((cp, cls_code[normalize.classify(c)]))

        cat = unicodedata.category(c)
        num_pairs.append((cp, 1 if cat == "Nd" else 2 if cat == "No" else 0))

        if normalize.is_separator(c):
            sep.append(cp)
        if normalize._stray_mark(c):
            stray.append(cp)
        if normalize._marks_like_punct(c):
            punct_like.append(cp)
        if normalize._digit_border(c):
            digit_border.append(cp)

        up, lo = normalize._is_upper(c), normalize._is_lower(c)
        if up:
            is_upper.append(cp)
        if lo:
            is_lower.append(cp)

        # The per-character half of mark_case's `unlowerable` test.
        if (c in constants_new_cased(normalize) or cat[0] in ("L", "M")) \
                and not lo and (not up or normalize._lower(c) == c):
            unlowerable.append(cp)

        # We use JS toLowerCase() for the body rewrite; record any codepoint where
        # Python's per-character lower() would differ so JS can patch it. (JS and
        # Python both implement full Unicode simple+special lowering, so this is
        # expected to be empty — we verify rather than assume.)
        py_low = normalize._lower(c)
        if py_low != c.lower():
            lower_exceptions[c] = py_low

    return {
        "unicodeVersion": unicodedata.unidata_version,
        "builtBy": f"python {sys.version.split()[0]}",
        # [[lo, hi, classCode], ...]
        "cls": compress_ranges(cls_pairs),
        # [[lo, hi, 0|1(Nd)|2(No)], ...]
        "numKind": compress_ranges([p for p in num_pairs if p[1]]),
        "separator":   compress_bool(sep),
        "strayMark":   compress_bool(stray),
        "punctLike":   compress_bool(punct_like),
        "digitBorder": compress_bool(digit_border),
        "isUpper":     compress_bool(is_upper),
        "isLower":     compress_bool(is_lower),
        "unlowerable": compress_bool(unlowerable),
        "lowerExceptions": lower_exceptions,
    }


def constants_new_cased(normalize):
    """ctok keeps the Unicode-16 case pairs it back-ports in a module-private set."""
    return normalize._NEW_CASED


def build_vocab(src: Path) -> dict:
    doc = json.loads(src.read_text(encoding="utf-8"))
    tokens = doc["tokens"]
    unknown = set(tokens) - set(KEEP_GROUPS)
    if unknown:
        raise SystemExit(f"{src.name}: unexpected token group(s) {sorted(unknown)} — "
                         f"upstream format changed, review before shipping")

    meta = doc["meta"]
    return {
        "meta": {
            "family":           meta["family"],
            "sourceModel":      meta["source_model"],
            "messageOverhead":  meta["message_overhead"],
            "foldQuotes":       meta["fold_quotes"],
            "allcapsMin":       meta["allcaps_min"],
            "frameBow":         meta.get("frame_bow", True),
            "frameTail":        meta.get("frame_tail", "ladder"),
        },
        # Every cost-1 piece, public notation, one flat list (upstream grouping is
        # provenance only — ctok/main.py takes all groups except bytes_fallback).
        "pieces": [p for g, entries in tokens.items()
                   if g != BYTES_GROUP for p in entries],
        "bytesFallback": list(tokens[BYTES_GROUP]),
        "contractions": list(tokens["contractions"]),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ctok", required=True, type=Path,
                    help="path to a cloned sanderland/ctok repository")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent / "src" / "ctok" / "data")
    args = ap.parse_args()

    data_dir = args.ctok / "ctok" / "data"
    if not data_dir.is_dir():
        raise SystemExit(f"no ctok/data directory under {args.ctok}")
    constants, normalize = _load_ctok(args.ctok)

    args.out.mkdir(parents=True, exist_ok=True)

    for family, spec in FAMILIES.items():
        vocab = build_vocab(data_dir / spec["file"])
        dest = args.out / f"vocab-{spec['vocab']}.json"
        dest.write_text(json.dumps(vocab, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
        print(f"  {dest.name:20} {len(vocab['pieces']):>6} pieces  "
              f"{dest.stat().st_size / 1024:8.1f} KB")

    tables = build_unicode_tables(constants, normalize)
    dest = args.out / "unicode-tables.json"
    dest.write_text(json.dumps(tables, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    print(f"  {dest.name:20} {dest.stat().st_size / 1024:8.1f} KB  "
          f"(Unicode {tables['unicodeVersion']})")
    for key in ("cls", "numKind", "separator", "strayMark", "punctLike",
                "digitBorder", "isUpper", "isLower", "unlowerable"):
        print(f"      {key:14} {len(tables[key]):>5} ranges")
    print(f"      lowerExceptions {len(tables['lowerExceptions']):>4} "
          f"(non-empty means JS toLowerCase differs from Python and needs the patch map)")


if __name__ == "__main__":
    main()
