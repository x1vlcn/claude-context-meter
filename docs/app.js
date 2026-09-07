/* Renders the hero's token strip.
 *
 * Both tilings are REAL output, generated once and pasted here rather than
 * computed in the page — the tokenizer is 205 KB of vocabulary and this is a
 * static site. Regenerate with:
 *
 *   Claude:  python -c "from ctok import tokenize; print(tokenize(S, '5.0'))"
 *   o200k:   node -e "import('gpt-tokenizer/esm/encoding/o200k_base')..."
 *
 * The Claude row is content tiles only; its message frame adds 6 more for a
 * single-message request, which is not what the comparison is about.
 */
(function () {
  var SENTENCE = "Tokenizers don't agree on what a word costs.";

  var OLD = ['Token', 'izers', ' don', "'t", ' agree', ' on', ' what', ' a', ' word', ' costs', '.'];

  // Structural markers stay visible: they are why the count is higher, and hiding
  // them would make the comparison look arbitrary instead of explained.
  var NEW = [
    '⟨shift⟩', '⟨bow⟩t', 'ok', 'en', 'iz', 'ers⟨eow⟩', '⟨bow⟩don⟨eow⟩', "'t⟨eow⟩",
    '⟨bow⟩ag', 'ree⟨eow⟩', '⟨bow⟩on⟨eow⟩', '⟨bow⟩what⟨eow⟩', '⟨bow⟩a⟨eow⟩',
    '⟨bow⟩word⟨eow⟩', '⟨bow⟩cost', 's⟨eow⟩', '.',
  ];

  var MARKER = /(⟨(?:bow|eow|shift|caps)⟩)/g;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render(id, pieces, startDelay) {
    var host = document.getElementById(id);
    if (!host) return;
    pieces.forEach(function (piece, i) {
      var el = document.createElement('span');
      el.className = 'pc';
      // Split so markers can be dimmed while the readable text stays legible.
      piece.split(MARKER).filter(Boolean).forEach(function (part) {
        var node = document.createElement('span');
        if (MARKER.test(part)) {
          MARKER.lastIndex = 0;
          node.className = 'mk';
          node.textContent = part.replace(/[⟨⟩]/g, '');
        } else {
          node.textContent = part.replace(/ /g, '·');   // show leading spaces
        }
        el.appendChild(node);
      });
      if (!reduced) el.style.animationDelay = (startDelay + i * 26) + 'ms';
      else el.style.animation = 'none';
      host.appendChild(el);
    });
  }

  // o200k first, then Claude, so the extra length is what the eye lands on.
  render('row-old', OLD, 120);
  render('row-new', NEW, 120 + OLD.length * 26 + 160);

  // Sanity: the tallies in the markup must match the arrays above.
  var check = { 'row-old': OLD.length, 'row-new': NEW.length };
  Object.keys(check).forEach(function (id) {
    var row = document.getElementById(id).closest('.row');
    var shown = parseInt(row.querySelector('.tally b').textContent, 10);
    if (shown !== check[id]) {
      console.warn('[docs] token tally out of sync for ' + id +
                   ': markup says ' + shown + ', data has ' + check[id]);
    }
  });
})();
