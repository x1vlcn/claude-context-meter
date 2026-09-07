# Third-party notices

## ctok — Sander Land

`src/ctok/` is a JavaScript port of [sanderland/ctok](https://github.com/sanderland/ctok),
and `src/ctok/data/` is derived from that project's vocabulary files by
`tools/build-ctok-data.py`. The reconstruction of Claude's tokenizer — the
vocabulary, the marked-stream encoding, and the minimum-cost tiling that makes an
exact count possible — is Sander Land's work. This project reimplements it for the
browser; it did not discover it.

Upstream is MIT licensed:

```
MIT License

Copyright (c) 2026 Sander Land

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Feature cost measurements — lugia19

Per-feature token costs in `src/config.js` (`toolBaselines`) were re-derived from
measurements published by
[lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension).
That project is GPL-3.0; **no code from it is used here** — only the published
numbers, which are facts rather than expression.

## System prompt baseline — Piebald-AI

The `baselineTokens` default is derived from measurements published by
[Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) (MIT).

---

This project is not affiliated with, endorsed by, or sponsored by Anthropic.
"Claude" is a trademark of Anthropic PBC.
