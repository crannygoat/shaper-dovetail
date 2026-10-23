/* Reads JSON cases on stdin, runs them through layout.js, prints JSON results.
 * Used by test_crosscheck.py to keep layout.js and layout.py in step. */
const DL = require('./layout.js');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const cases = JSON.parse(input);
  const out = cases.map((c) => {
    const n = c.kind === 'even' ? c.n : Math.floor(c.widths.length / 2);
    const lengths = DL.cycledLengths(c.thickness, c.fractions, n);
    const opts = { minWall: c.minWall, minNeck: c.minNeck, ratio: c.ratio, halfPin: c.halfPin };
    const res = c.kind === 'even'
      ? DL.evenLayout(c.width, c.thickness, c.n, lengths, opts)
      : DL.fromWidths(c.thickness, c.widths, lengths, opts);
    const lay = res.layout;
    const chk = DL.check(lay);
    return {
      tails: DL.sortedTails(lay).map((t) => ({
        center: t.center, tipWidth: t.tipWidth, length: t.length, base: DL.baseWidth(t, lay.bit),
      })),
      errors: chk.errors.length,
      warnings: chk.warnings.length,
    };
  });
  process.stdout.write(JSON.stringify(out));
});
