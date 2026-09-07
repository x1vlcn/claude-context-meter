/**
 * The marker notation shared by the vocabulary files and the encoder.
 *
 * Vocabulary pieces ship in ctok's PUBLIC notation — named atoms in mathematical
 * angle brackets, e.g. `<shift><bow>token<eow>` written with U+27E8/U+27E9 — because
 * that form is readable and round-trips through JSON. The encoder works in the
 * INTERNAL form, where every structural marker is a single noncharacter codepoint,
 * so that one marker occupies exactly one position in the tiling DP.
 * parseMarked() converts public -> internal at load time.
 *
 * Every marker below is written as a \u escape on purpose: U+FDD0..U+FDD4 are
 * Unicode noncharacters and U+E000..U+E004 are private-use, and neither survives
 * being round-tripped through editors, terminals, or copy-paste as a literal.
 */

// Internal single-codepoint markers (noncharacters — never valid input text).
export const BOW_G   = '﷐';
export const EOW_G   = '﷑';
export const PAD_G   = '﷒';
export const SHIFT_G = '﷓';
export const CAPS_G  = '﷔';

export const MARKER_GLYPHS = new Set([BOW_G, EOW_G, SHIFT_G, CAPS_G]);

// U+27E8 / U+27E9 — the public notation's brackets.
const L = '⟨', R = '⟩';

const ATOM_TO_GLYPH = {
  [`${L}bow${R}`]: BOW_G,
  [`${L}eow${R}`]: EOW_G,
  [`${L}shift${R}`]: SHIFT_G,
  [`${L}caps${R}`]: CAPS_G,
};
const PAD_ATOM = `${L}pad${R}`;

/**
 * Scraped text can itself contain the noncharacters used as markers. NFC strips
 * BMP private-use input, so these five PUA codepoints are safe internal escapes
 * inserted AFTER normalization; the byte floor maps them back before pricing.
 * Order matches ctok's GLYPH_TO_ATOM insertion order (bow, eow, pad, shift, caps).
 */
export const LITERAL_MARKER_ESCAPES = {
  [BOW_G]:   '',
  [EOW_G]:   '',
  [PAD_G]:   '',
  [SHIFT_G]: '',
  [CAPS_G]:  '',
};
export const ESCAPED_MARKER_LITERALS = Object.fromEntries(
  Object.entries(LITERAL_MARKER_ESCAPES).map(([glyph, esc]) => [esc, glyph]),
);

const ATOM_RE = new RegExp(`${L}(?:bow|eow|shift|caps|pad|0x[0-9A-Fa-f]{2})${R}|[\\s\\S]`, 'gu');
const BYTE_ATOM_RE = new RegExp(`^${L}0x([0-9A-Fa-f]{2})${R}$`);

const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * Public notation -> internal marked string. Named atoms collapse to their single
 * glyph; `<0xNN>` escape runs are buffered and UTF-8 decoded back to characters.
 */
export function parseMarked(publicStr) {
  // Fast path: the overwhelming majority of vocabulary pieces are plain text with
  // no atoms at all, and this scan is the load-time hot spot (~63k pieces).
  if (publicStr.indexOf(L) === -1) return publicStr;

  let out = '';
  let bytes = [];
  const flush = () => {
    if (bytes.length) {
      out += UTF8_DECODER.decode(new Uint8Array(bytes));
      bytes = [];
    }
  };

  ATOM_RE.lastIndex = 0;
  let m;
  while ((m = ATOM_RE.exec(publicStr)) !== null) {
    const tok = m[0];
    const glyph = ATOM_TO_GLYPH[tok];
    if (glyph !== undefined) { flush(); out += glyph; continue; }
    const byte = BYTE_ATOM_RE.exec(tok);
    if (byte) { bytes.push(parseInt(byte[1], 16)); continue; }
    // `<pad>` is zero-surface (a frame token with no glyph form) and never appears
    // in a vocabulary key; anything else is literal text.
    if (tok === PAD_ATOM) { flush(); continue; }
    flush();
    out += tok;
  }
  flush();
  return out;
}
