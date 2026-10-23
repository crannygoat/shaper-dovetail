/* Dovetail layout engine, layer 1 (JavaScript port of layout.py).
 * Pure geometry plus SVG drawing. No tool encoding, no toolpaths.
 * Same conventions and assumptions as layout.py; keep the two in step
 * (test_crosscheck.py compares them). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DovetailLayout = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MM_PER_IN = 25.4;
  const DEFAULT_BIT = { sideAngleDeg: 15, cutterDia: 13.8, cutterLen: 13.5 };
  const DEFAULT_LIMITS = { minWall: 3.0, minNeck: 3.0, glueOffset: 0.1 };

  function parseFraction(text) {
    const s = String(text).trim();
    if (!s) return NaN;
    const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const v = parseFloat(m[1]) / parseFloat(m[2]);
      return isFinite(v) ? v : NaN;
    }
    if (/^(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    return NaN;
  }

  function parseFractions(text) {
    return String(text).split(',').map((s) => s.trim()).filter(Boolean).map(parseFraction);
  }

  /* "5/8", "1 1/2", "0.75", "12mm", '3/4"', "2 in". Returns millimetres, or NaN. */
  function parseDim(text, units) {
    let s = String(text).trim().toLowerCase();
    if (!s) return NaN;
    let u = units === 'mm' ? 'mm' : 'in';
    if (s.endsWith('mm')) { u = 'mm'; s = s.slice(0, -2).trim(); }
    else if (s.endsWith('in')) { u = 'in'; s = s.slice(0, -2).trim(); }
    else if (s.endsWith('"')) { u = 'in'; s = s.slice(0, -1).trim(); }
    let v;
    const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) v = parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
    else v = parseFraction(s);
    if (!isFinite(v)) return NaN;
    return u === 'in' ? v * MM_PER_IN : v;
  }

  function cycledLengths(thickness, fractions, n) {
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(fractions[i % fractions.length] * thickness);
    return out;
  }

  function baseWidth(t, bit) {
    return t.tipWidth - 2 * t.length * Math.tan(bit.sideAngleDeg * Math.PI / 180);
  }

  function sortedTails(lay) {
    return lay.tails.slice().sort((a, b) => a.center - b.center);
  }

  const defaultFmt = (mm) => mm.toFixed(2) + ' mm';

  function tailStatus(lay, t, fmt) {
    const f = fmt || defaultFmt;
    const errors = [];
    const warnings = [];
    if (!(t.tipWidth > 0)) errors.push('tip width must be positive');
    if (!(t.length > 0)) errors.push('length must be positive');
    if (t.length > lay.bit.cutterLen) {
      errors.push('length ' + f(t.length) + ' exceeds the cutter length ' + f(lay.bit.cutterLen));
    }
    if (t.length > lay.thickness - lay.minWall) {
      errors.push('length ' + f(t.length) + ' leaves under ' + f(lay.minWall) +
        ' of wall in a ' + f(lay.thickness) + ' board');
    }
    const bw = baseWidth(t, lay.bit);
    if (bw <= 0) errors.push('base width ' + f(bw) + ' is not positive');
    else if (bw < lay.minNeck) warnings.push('base width ' + f(bw) + ' is under ' + f(lay.minNeck));
    return { errors: errors, warnings: warnings };
  }

  function check(lay, fmt) {
    const errors = [];
    const warnings = [];
    if (!(lay.width > 0) || !(lay.thickness > 0)) errors.push('width and thickness must be positive');
    if (!lay.tails.length) errors.push('layout has no tails');
    const ts = sortedTails(lay);
    ts.forEach((t, i) => {
      const s = tailStatus(lay, t, fmt);
      s.errors.forEach((m) => errors.push('tail ' + (i + 1) + ': ' + m));
      s.warnings.forEach((m) => warnings.push('tail ' + (i + 1) + ': ' + m));
    });
    if (ts.length) {
      if (ts[0].center - ts[0].tipWidth / 2 < -1e-9) errors.push('first tail extends past the left edge');
      const last = ts[ts.length - 1];
      if (last.center + last.tipWidth / 2 > lay.width + 1e-9) errors.push('last tail extends past the right edge');
    }
    for (let i = 1; i < ts.length; i += 1) {
      const gap = (ts[i].center - ts[i].tipWidth / 2) - (ts[i - 1].center + ts[i - 1].tipWidth / 2);
      if (gap <= 1e-9) errors.push('adjacent tails overlap or touch at the tips');
    }
    return { errors: errors, warnings: warnings };
  }

  function makeLayout(width, thickness, tails, opts) {
    const o = opts || {};
    return {
      width: width,
      thickness: thickness,
      tails: tails,
      bit: o.bit || Object.assign({}, DEFAULT_BIT),
      minWall: o.minWall !== undefined ? o.minWall : DEFAULT_LIMITS.minWall,
      minNeck: o.minNeck !== undefined ? o.minNeck : DEFAULT_LIMITS.minNeck,
      glueOffset: o.glueOffset !== undefined ? o.glueOffset : DEFAULT_LIMITS.glueOffset,
    };
  }

  /* width = p * (2*halfPin + n*(ratio + 1) - 1), solved for the pin gap p. */
  function evenLayout(width, thickness, n, lengths, opts) {
    const o = opts || {};
    const ratio = o.ratio !== undefined ? o.ratio : 2.0;
    const halfPin = o.halfPin !== undefined ? o.halfPin : 0.5;
    const shift = o.shift || 0;
    if (!(n >= 1)) return { layout: null, errors: ['need at least one tail'] };
    const p = width / (2 * halfPin + n * (ratio + 1) - 1);
    const t = ratio * p;
    let x = halfPin * p + shift;
    const tails = [];
    for (let i = 0; i < n; i += 1) {
      tails.push({ center: x + t / 2, tipWidth: t, length: lengths[i] });
      x += t + p;
    }
    return { layout: makeLayout(width, thickness, tails, o), errors: [] };
  }

  /* widths alternate pin, tail, ..., pin (odd count). The layout width is the sum. */
  function fromWidths(thickness, widths, lengths, opts) {
    if (widths.length % 2 === 0 || widths.length < 3) {
      return { layout: null, errors: ['widths must alternate pin, tail, ..., pin (odd count, at least 3)'] };
    }
    const tails = [];
    let x = 0;
    widths.forEach((w, i) => {
      if (i % 2 === 1) tails.push({ center: x + w / 2, tipWidth: w, length: lengths[tails.length] });
      x += w;
    });
    return { layout: makeLayout(x, thickness, tails, opts), errors: [] };
  }

  /* ---------- drawing ----------
   * Each function returns an SVG string in millimetre units. With o.interactive the
   * string also carries drag handles (.hd, data-h) and click-to-edit numbers (.ed,
   * data-edit) for the page to wire up. o.refWidth fixes the scale (the page freezes it
   * during a drag); o.minH / o.fixedH keep the figure height steady during a drag. */

  const f3 = (v) => v.toFixed(3);

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function attrs(d) {
    return d ? Object.keys(d).map((k) => ' data-' + k + '="' + esc(d[k]) + '"').join('') : '';
  }

  function frame(lay, o) {
    const ref = (o && o.refWidth) || lay.width;
    const fs = ref / 50;
    return { fs: fs, ref: ref, padL: 6.5 * fs, padR: 13 * fs, VW: ref + 19.5 * fs };
  }

  function fracText(f, tol) {
    const t = tol === undefined ? 0.002 : tol;
    if (Math.abs(f - 1) <= t) return '1';
    const dens = [2, 3, 4, 8, 16];
    for (let j = 0; j < dens.length; j += 1) {
      const n = Math.round(f * dens[j]);
      if (n > 0 && n < dens[j] && Math.abs(f - n / dens[j]) <= t) return n + '/' + dens[j];
    }
    return null;
  }

  function svgOpen(W, H, fs, st, label, data) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f3(W) + ' ' + f3(H) +
      '" width="' + (W * 4).toFixed(0) + '" height="' + (H * 4).toFixed(0) +
      '" role="img" aria-label="' + esc(label) + '" font-family="' + st.font + '" font-size="' + f3(fs) + '"' +
      attrs(data) + '>';
  }

  function heightFor(natural, o) {
    if (o.fixedH) return o.fixedH;
    return Math.max(natural, o.minH || 0);
  }

  /* A number on the drawing. With an edit spec it becomes a clickable target. */
  function label(o, x, y, text, color, fs, opts) {
    const p = opts || {};
    const anchor = p.anchor || 'middle';
    const body = '<text x="' + f3(x) + '" y="' + f3(y) + '" text-anchor="' + anchor + '"' +
      (p.bold ? ' font-weight="600"' : '') + ' style="fill:' + color + '">' + esc(text) + '</text>';
    if (!(o.interactive && p.edit)) return p.rot ? '<g transform="rotate(-90 ' + f3(x) + ' ' + f3(y) + ')">' + body + '</g>' : body;
    const w = text.length * 0.62 * fs + 0.9 * fs;
    const x1 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x - 0.2 * fs;
    const hit = '<rect x="' + f3(x1) + '" y="' + f3(y - 1.3 * fs) + '" width="' + f3(w) + '" height="' + f3(1.8 * fs) + '" fill="transparent"/>';
    const g = '<g class="ed" tabindex="0" role="button" aria-label="' + esc(p.aria || ('Edit ' + text)) + '"' + attrs(p.edit) + '>' + hit + body + '</g>';
    return p.rot ? '<g transform="rotate(-90 ' + f3(x) + ' ' + f3(y) + ')">' + g + '</g>' : g;
  }

  /* A round drag handle. h names the drag; extra carries indexes; edit also opens the editor on click. */
  function handle(o, st, fs, x, y, aria, h, extra, edit, cursor) {
    if (!o.interactive) return '';
    const d = Object.assign({ h: h }, extra || {});
    if (edit) d.edit = edit;
    return '<g class="hd" tabindex="0" role="button" aria-label="' + esc(aria) + '"' + attrs(d) +
      ' style="cursor:' + (cursor || 'grab') + '">' +
      '<circle cx="' + f3(x) + '" cy="' + f3(y) + '" r="' + f3(1.5 * fs) + '" fill="transparent"/>' +
      '<circle class="dot" cx="' + f3(x) + '" cy="' + f3(y) + '" r="' + f3(0.5 * fs) + '" stroke-width="' + f3(0.16 * fs) +
      '" style="fill:' + (st.surface || '#fff') + ';stroke:' + (st.accent || '#0f6b73') + '"/></g>';
  }

  /* Horizontal dimension line with its number above. */
  function dimH(o, st, fs, x1, x2, y, text, edit, aria, hnd) {
    const k = 0.4 * fs;
    let s = '<g style="stroke:' + st.muted + '" stroke-width="' + f3(0.07 * fs) + '">' +
      '<line x1="' + f3(x1) + '" y1="' + f3(y) + '" x2="' + f3(x2) + '" y2="' + f3(y) + '"/>' +
      '<line x1="' + f3(x1) + '" y1="' + f3(y - k) + '" x2="' + f3(x1) + '" y2="' + f3(y + k) + '"/>' +
      '<line x1="' + f3(x2) + '" y1="' + f3(y - k) + '" x2="' + f3(x2) + '" y2="' + f3(y + k) + '"/></g>';
    s += label(o, (x1 + x2) / 2, y - 0.7 * fs, text, st.muted, fs, { edit: edit, aria: aria });
    if (hnd) s += handle(o, st, fs, x2, y, aria + ', drag to change', hnd.h, hnd.extra, hnd.edit, 'ew-resize');
    return s;
  }

  /* Vertical dimension line; the number sits left or right of it, rotated. */
  function dimV(o, st, fs, x, y1, y2, text, edit, aria, hnd, side) {
    const k = 0.4 * fs;
    let s = '<g style="stroke:' + st.muted + '" stroke-width="' + f3(0.07 * fs) + '">' +
      '<line x1="' + f3(x) + '" y1="' + f3(y1) + '" x2="' + f3(x) + '" y2="' + f3(y2) + '"/>' +
      '<line x1="' + f3(x - k) + '" y1="' + f3(y1) + '" x2="' + f3(x + k) + '" y2="' + f3(y1) + '"/>' +
      '<line x1="' + f3(x - k) + '" y1="' + f3(y2) + '" x2="' + f3(x + k) + '" y2="' + f3(y2) + '"/></g>';
    const bx = side === 'right' ? x + 1.4 * fs : x - 0.5 * fs;
    s += label(o, bx, (y1 + y2) / 2, text, st.muted, fs, { edit: edit, aria: aria, rot: true });
    if (hnd) s += handle(o, st, fs, x, y2, aria + ', drag to change', hnd.h, hnd.extra, hnd.edit, 'ns-resize');
    return s;
  }

  /* Pins and tails across the board, measured at the tips: pin, tail, pin, ..., pin. */
  function segments(lay) {
    const segs = [];
    let x = 0;
    sortedTails(lay).forEach((t) => {
      const l = t.center - t.tipWidth / 2;
      segs.push({ kind: 'pin', w: l - x, x0: x });
      segs.push({ kind: 'tail', w: t.tipWidth, x0: l });
      x = t.center + t.tipWidth / 2;
    });
    segs.push({ kind: 'pin', w: lay.width - x, x0: x });
    return segs;
  }

  function statusColor(lay, t, st) {
    const s = tailStatus(lay, t);
    if (s.errors.length) return st.err;
    if (s.warnings.length) return st.warn;
    return st.woodInk;
  }

  /* How far the whole pattern sits off the board centre (positive is right), from the outer tips. */
  function patternOffset(lay) {
    const ts = sortedTails(lay);
    if (!ts.length) return 0;
    const l = ts[0].center - ts[0].tipWidth / 2;
    const r = ts[ts.length - 1].center + ts[ts.length - 1].tipWidth / 2;
    return (l + r) / 2 - lay.width / 2;
  }

  function shiftHandle(o, st, fs, x, y) {
    if (!o.interactive) return '';
    return '<g class="hd" tabindex="0" role="button" aria-label="Slide the whole pattern sideways" data-h="shift" data-edit="shift" style="cursor:ew-resize">' +
      '<rect x="' + f3(x - 3.4 * fs) + '" y="' + f3(y - 1.4 * fs) + '" width="' + f3(6.8 * fs) + '" height="' + f3(2.8 * fs) + '" fill="transparent"/>' +
      '<rect class="dot" x="' + f3(x - 2.6 * fs) + '" y="' + f3(y - 0.9 * fs) + '" width="' + f3(5.2 * fs) + '" height="' + f3(1.8 * fs) + '" rx="' + f3(0.9 * fs) +
      '" stroke-width="' + f3(0.16 * fs) + '" style="fill:' + (st.surface || '#fff') + ';stroke:' + (st.accent || '#0f6b73') + '"/>' +
      '<text x="' + f3(x) + '" y="' + f3(y + 0.32 * fs) + '" text-anchor="middle" font-size="' + f3(0.95 * fs) + '" style="fill:' + (st.accent || '#0f6b73') + '">\u25c2 \u25b8</text></g>';
  }

  function tailPoly(lay, t, xBase, yTop, dir, st, fs) {
    const bw = baseWidth(t, lay.bit);
    const y1 = yTop + t.length;
    const cx = xBase + t.center;
    const color = statusColor(lay, t, st);
    const pts = [
      [cx - bw / 2, yTop], [cx + bw / 2, yTop], [cx + t.tipWidth / 2, y1], [cx - t.tipWidth / 2, y1],
    ].map((p) => f3(p[0]) + ',' + f3(p[1])).join(' ');
    return { svg: '<polygon points="' + pts + '" style="fill:' + st.wood + ';stroke:' + color + '" stroke-width="' + f3(0.14 * fs) + '" stroke-linejoin="round"/>',
      cx: cx, y1: y1, color: color };
  }

  function faceSvg(lay, st, o) {
    const op = o || {};
    const ts = sortedTails(lay);
    const F = frame(lay, op), fs = F.fs, x0 = F.padL, W = lay.width;
    const T1 = lay.tailsThickness || lay.thickness;
    const titleY = 1.6 * fs, dimY = 5.4 * fs, top = 6.8 * fs, bodyH = 4.8 * fs, y0 = top + bodyH;
    const lmax = Math.max.apply(null, [0].concat(ts.map((t) => t.length)));
    const chainY = y0 + lmax + 5.8 * fs;
    const H = heightFor(chainY + 1.8 * fs, op);
    let s = svgOpen(F.VW, H, fs, st, 'Tails board, face view: ' + ts.length + ' tails, ' + st.fmt(W) + ' wide, ' + st.fmt(T1) + ' thick', { x0: f3(x0), top: f3(y0) });
    s += '<text x="' + f3(x0) + '" y="' + f3(titleY) + '" font-weight="600" style="fill:' + st.ink + '">Tails board: ' +
      esc(st.fmt(W)) + ' wide × ' + esc(st.fmt(T1)) + ' thick</text>';
    s += dimH(op, st, fs, x0, x0 + W, dimY, st.fmt(W), { edit: 'width' }, 'Board width', { h: 'width', edit: 'width' });
    s += '<polygon points="' + [[x0, top], [x0 + W, top], [x0 + W, y0], [x0, y0]].map((p) => f3(p[0]) + ',' + f3(p[1])).join(' ') +
      '" style="fill:' + st.board + '" stroke="none"/>';
    s += '<polyline points="' + [[x0, top], [x0, y0], [x0 + W, y0], [x0 + W, top]].map((p) => f3(p[0]) + ',' + f3(p[1])).join(' ') +
      '" fill="none" style="stroke:' + st.ink + '" stroke-width="' + f3(0.08 * fs) + '"/>';
    s += label(op, x0 + W / 2, top + bodyH / 2 + 0.35 * fs, 'thickness ' + st.fmt(T1), st.muted, fs, { edit: { edit: 't1' }, aria: 'Tails board thickness' });
    let handles = '';
    const off = patternOffset(lay);
    if (ts.length) {
      const shiftTxt = Math.abs(off) < 0.005 ? 'pattern centered' : 'pattern ' + st.fmt(Math.abs(off), true) + (off < 0 ? ' left' : ' right');
      s += label(op, x0 + 1.2 * fs, top + bodyH / 2 + 0.35 * fs, shiftTxt, st.muted, fs, { anchor: 'start', edit: { edit: 'shift' }, aria: 'Pattern shift' });
      const ctr = x0 + W / 2 + off;
      handles += shiftHandle(op, st, fs, ctr, top);
    }
    ts.forEach((t, i) => {
      const p = tailPoly(lay, t, x0, y0, 1, st, fs);
      s += p.svg;
      s += label(op, p.cx, p.y1 + 1.7 * fs, st.fmt(t.length, true), p.color, fs, { edit: { edit: 'len', i: i }, aria: 'Tail ' + (i + 1) + ' length' });
      const ft = fracText(t.length / lay.thickness);
      if (ft) s += '<text x="' + f3(p.cx) + '" y="' + f3(p.y1 + 3.1 * fs) + '" text-anchor="middle" style="fill:' + st.muted + '">' + ft + ' t</text>';
      handles += handle(op, st, fs, p.cx, p.y1, 'Tail ' + (i + 1) + ' length, drag up or down', 'len', { i: i }, 'len', 'ns-resize');
      handles += handle(op, st, fs, p.cx, y0 + 0.4 * t.length, 'Tail ' + (i + 1) + ', slide sideways', 'tailmove', { i: i }, null, 'ew-resize');
      if (op.mode === 'irregular') {
        handles += handle(op, st, fs, p.cx - t.tipWidth / 2, p.y1, 'Tail ' + (i + 1) + ' left edge', 'edge', { k: 2 * i + 1 }, null, 'ew-resize');
        handles += handle(op, st, fs, p.cx + t.tipWidth / 2, p.y1, 'Tail ' + (i + 1) + ' right edge', 'edge', { k: 2 * i + 2 }, null, 'ew-resize');
      } else {
        handles += handle(op, st, fs, p.cx + t.tipWidth / 2, p.y1, 'Tail width, drag sideways', 'tipw', { i: i }, 'tipw', 'ew-resize');
        if (i === 0) handles += handle(op, st, fs, p.cx - t.tipWidth / 2, p.y1, 'Edge half-pin, drag sideways', 'half', {}, null, 'ew-resize');
      }
    });
    const yL = chainY - 1.7 * fs;
    s += '<g style="stroke:' + st.muted + '" stroke-width="' + f3(0.06 * fs) + '"><line x1="' + f3(x0) + '" y1="' + f3(yL) + '" x2="' + f3(x0 + W) + '" y2="' + f3(yL) + '"/>';
    const segs = segments(lay);
    segs.forEach((g, j) => {
      s += '<line x1="' + f3(x0 + g.x0) + '" y1="' + f3(yL - 0.35 * fs) + '" x2="' + f3(x0 + g.x0) + '" y2="' + f3(yL + 0.35 * fs) + '"/>';
    });
    s += '<line x1="' + f3(x0 + W) + '" y1="' + f3(yL - 0.35 * fs) + '" x2="' + f3(x0 + W) + '" y2="' + f3(yL + 0.35 * fs) + '"/></g>';
    s += '<text x="' + f3(x0 - 0.8 * fs) + '" y="' + f3(chainY) + '" text-anchor="end" style="fill:' + st.muted + '">at tips</text>';
    segs.forEach((g, j) => {
      const txt = st.fmt(g.w, true);
      if (g.w < txt.length * 0.62 * fs + 0.6 * fs) return;
      const tail = g.kind === 'tail';
      s += label(op, x0 + g.x0 + g.w / 2, chainY, txt, tail ? st.woodInk : st.muted, fs,
        { edit: tail ? { edit: 'tipw', i: (j - 1) / 2 } : { edit: 'pin', i: j / 2 }, aria: tail ? 'Tail ' + ((j - 1) / 2 + 1) + ' width at the tip' : 'Pin ' + (j / 2 + 1) + ' width at the tips' });
    });
    return s + handles + '</svg>';
  }

  function sectionSvg(lay, st, o) {
    const op = o || {};
    const ts = sortedTails(lay);
    const F = frame(lay, op), fs = F.fs, x0 = F.padL, W = lay.width, T2 = lay.thickness;
    const titleY = 1.6 * fs, dimY = 5.4 * fs, top = 6.8 * fs;
    const extent = Math.max(T2, lay.bit.cutterLen);
    const H = heightFor(top + extent + 3.4 * fs, op);
    let s = svgOpen(F.VW, H, fs, st, 'Mating board, section: ' + st.fmt(W) + ' wide, ' + st.fmt(T2) + ' thick, with socket depths against the cutter and wall limits', { x0: f3(x0), top: f3(top) });
    s += '<text x="' + f3(x0) + '" y="' + f3(titleY) + '" font-weight="600" style="fill:' + st.ink + '">Mating board: ' +
      esc(st.fmt(W)) + ' wide × ' + esc(st.fmt(T2)) + ' thick</text>';
    s += dimH(op, st, fs, x0, x0 + W, dimY, st.fmt(W), { edit: 'width' }, 'Board width', { h: 'width', edit: 'width' });
    s += '<rect x="' + f3(x0) + '" y="' + f3(top) + '" width="' + f3(W) + '" height="' + f3(T2) +
      '" style="fill:' + st.board + ';stroke:' + st.ink + '" stroke-width="' + f3(0.08 * fs) + '"/>';
    s += dimV(op, st, fs, x0 - 2.4 * fs, top, top + T2, st.fmt(T2), { edit: 't2' }, 'Mating board thickness', { h: 't2', edit: 't2' }, 'left');
    let handles = handle(op, st, fs, x0 + W / 2, top + T2, 'Mating board thickness, drag up or down', 't2', {}, 't2', 'ns-resize');
    ts.forEach((t, i) => {
      const p = tailPoly(lay, t, x0, top, 1, st, fs);
      s += p.svg;
      s += label(op, p.cx, p.y1 - 0.7 * fs, st.fmt(t.length, true), st.woodInk, fs, { edit: { edit: 'len', i: i }, aria: 'Socket ' + (i + 1) + ' depth' });
      handles += handle(op, st, fs, p.cx, p.y1, 'Socket ' + (i + 1) + ' depth, drag up or down', 'len', { i: i }, 'len', 'ns-resize');
      handles += handle(op, st, fs, p.cx, top + 0.2 * t.length, 'Socket ' + (i + 1) + ', slide sideways', 'tailmove', { i: i }, null, 'ew-resize');
    });
    const yCut = top + lay.bit.cutterLen;
    const yWall = top + (T2 - lay.minWall);
    let lyCut = yCut + 0.35 * fs;
    let lyWall = yWall + 0.35 * fs;
    if (Math.abs(lyCut - lyWall) < 1.5 * fs) {
      if (lyWall >= lyCut) lyWall = lyCut + 1.5 * fs; else lyCut = lyWall + 1.5 * fs;
    }
    const xr = x0 + W;
    const dash = ' stroke-width="' + f3(0.1 * fs) + '" stroke-dasharray="' + f3(0.8 * fs) + ' ' + f3(0.5 * fs) + '"';
    const xCutH = xr + 2.6 * fs, xWallH = xr + 0.6 * fs, xLab = xr + 4.6 * fs;
    s += '<line x1="' + f3(x0) + '" y1="' + f3(yCut) + '" x2="' + f3(xCutH) + '" y2="' + f3(yCut) + '" style="stroke:' + st.warn + '"' + dash + '/>';
    s += label(op, xLab, lyCut, 'cutter ' + st.fmt(lay.bit.cutterLen, true), st.warn, fs, { anchor: 'start', edit: { edit: 'cutlen' }, aria: 'Cutter length' });
    s += '<line x1="' + f3(x0) + '" y1="' + f3(yWall) + '" x2="' + f3(xWallH) + '" y2="' + f3(yWall) + '" style="stroke:' + st.err + '"' + dash + '/>';
    s += label(op, xLab, lyWall, 'wall ' + st.fmt(lay.minWall, true), st.err, fs, { anchor: 'start', edit: { edit: 'wall' }, aria: 'Minimum wall' });
    handles += handle(op, st, fs, xCutH, yCut, 'Cutter length, drag up or down', 'cutlen', {}, 'cutlen', 'ns-resize');
    handles += handle(op, st, fs, xWallH, yWall, 'Minimum wall, drag up or down', 'wall', {}, 'wall', 'ns-resize');
    return s + handles + '</svg>';
  }

  /* Side section through the longest tail: the tails board enters the face of the mating board. */
  function sideSvg(lay, st, o) {
    const op = o || {};
    const ts = sortedTails(lay);
    const F = frame(lay, op), fs = F.fs;
    const T1 = lay.tailsThickness || lay.thickness, T2 = lay.thickness;
    const lens = ts.map((t) => t.length);
    const lmax = Math.max.apply(null, [0].concat(lens));
    const xa = 9.5 * fs;
    const M = Math.max(0.5 * T1, 15 * fs);
    const titleY = 1.6 * fs, dimY = 5.4 * fs, top = 6.8 * fs, yFace = top + 5 * fs;
    const xr = xa + T1 + M;
    const xd = xr + 2.6 * fs;
    const VW = xd + 3.4 * fs;
    const H = heightFor(yFace + T2 + 3.4 * fs, op);
    let s = svgOpen(VW, H, fs, st, 'Side section: tails board ' + st.fmt(T1) + ' thick entering a mating board ' + st.fmt(T2) + ' thick', { x0: f3(xa), top: f3(yFace) });
    s += '<text x="' + f3(xa - 8.5 * fs) + '" y="' + f3(titleY) + '" font-weight="600" style="fill:' + st.ink + '">Side section</text>';
    const sw = ' stroke-width="' + f3(0.08 * fs) + '"';
    s += '<rect x="' + f3(xa) + '" y="' + f3(yFace) + '" width="' + f3(T1 + M) + '" height="' + f3(T2) + '" style="fill:' + st.board + ';stroke:' + st.ink + '"' + sw + '/>';
    s += '<polygon points="' + [[xa, top], [xa + T1, top], [xa + T1, yFace + lmax], [xa, yFace + lmax]].map((p) => f3(p[0]) + ',' + f3(p[1])).join(' ') +
      '" style="fill:' + st.wood + ';stroke:' + st.woodInk + '"' + sw + '/>';
    s += '<line x1="' + f3(xa) + '" y1="' + f3(yFace) + '" x2="' + f3(xa + T1) + '" y2="' + f3(yFace) + '" style="stroke:' + st.woodInk + '" stroke-width="' + f3(0.05 * fs) + '" stroke-dasharray="' + f3(0.4 * fs) + ' ' + f3(0.4 * fs) + '"/>';
    s += '<text x="' + f3(xa - 0.8 * fs) + '" y="' + f3(top + 2.7 * fs) + '" text-anchor="end" style="fill:' + st.muted + '">tails board</text>';
    s += '<text x="' + f3(xa - 0.8 * fs) + '" y="' + f3(yFace + T2 / 2 + 0.35 * fs) + '" text-anchor="end" style="fill:' + st.muted + '">mating board</text>';
    s += dimH(op, st, fs, xa, xa + T1, dimY, st.fmt(T1), { edit: 't1' }, 'Tails board thickness', { h: 't1', edit: 't1' });
    s += dimV(op, st, fs, xd, yFace, yFace + T2, st.fmt(T2), { edit: 't2' }, 'Mating board thickness', { h: 't2', edit: 't2' }, 'right');
    const distinct = [];
    lens.slice().sort((a, b) => b - a).forEach((l) => { if (!distinct.some((d) => Math.abs(d - l) < 1e-6)) distinct.push(l); });
    let lastY = -1e9;
    distinct.slice(0, 4).forEach((l) => {
      const y = yFace + l;
      if (l < lmax - 1e-6) {
        s += '<line x1="' + f3(xa) + '" y1="' + f3(y) + '" x2="' + f3(xa + T1) + '" y2="' + f3(y) + '" style="stroke:' + st.woodInk + '" stroke-width="' + f3(0.08 * fs) + '" stroke-dasharray="' + f3(0.5 * fs) + ' ' + f3(0.4 * fs) + '"/>';
      }
      let ly = y + 0.35 * fs;
      if (ly - lastY < 1.4 * fs) ly = lastY + 1.4 * fs;
      lastY = ly;
      s += '<text x="' + f3(xa + T1 + 0.8 * fs) + '" y="' + f3(ly) + '" style="fill:' + st.woodInk + '">tail ' + esc(st.fmt(l, true)) + '</text>';
    });
    const wall = T2 - lmax;
    if (lmax > 0) {
      const xw = xa + T1 + 8.2 * fs;
      const col = wall < lay.minWall - 1e-9 ? st.err : st.muted;
      s += '<g style="stroke:' + col + '" stroke-width="' + f3(0.07 * fs) + '"><line x1="' + f3(xw) + '" y1="' + f3(yFace + lmax) + '" x2="' + f3(xw) + '" y2="' + f3(yFace + T2) + '"/>' +
        '<line x1="' + f3(xw - 0.4 * fs) + '" y1="' + f3(yFace + lmax) + '" x2="' + f3(xw + 0.4 * fs) + '" y2="' + f3(yFace + lmax) + '"/>' +
        '<line x1="' + f3(xw - 0.4 * fs) + '" y1="' + f3(yFace + T2) + '" x2="' + f3(xw + 0.4 * fs) + '" y2="' + f3(yFace + T2) + '"/></g>';
      s += '<text x="' + f3(xw + 0.8 * fs) + '" y="' + f3(yFace + lmax + (T2 - lmax) / 2 + 0.35 * fs) + '" style="fill:' + col + '">wall ' + esc(st.fmt(wall, true)) + '</text>';
    }
    return s + '</svg>';
  }

  return {
    MM_PER_IN: MM_PER_IN,
    DEFAULT_BIT: DEFAULT_BIT,
    DEFAULT_LIMITS: DEFAULT_LIMITS,
    parseFraction: parseFraction,
    parseFractions: parseFractions,
    parseDim: parseDim,
    cycledLengths: cycledLengths,
    baseWidth: baseWidth,
    sortedTails: sortedTails,
    segments: segments,
    patternOffset: patternOffset,
    fracText: fracText,
    tailStatus: tailStatus,
    check: check,
    evenLayout: evenLayout,
    fromWidths: fromWidths,
    faceSvg: faceSvg,
    sectionSvg: sectionSvg,
    sideSvg: sideSvg,
  };
}));
