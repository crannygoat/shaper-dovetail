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
    if (!(n >= 1)) return { layout: null, errors: ['need at least one tail'] };
    const p = width / (2 * halfPin + n * (ratio + 1) - 1);
    const t = ratio * p;
    let x = halfPin * p;
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

  /* ---------- drawing ---------- */

  function svgOpen(W, H, fs, st, label) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W.toFixed(3) + ' ' + H.toFixed(3) +
      '" width="' + (W * 4).toFixed(0) + '" height="' + (H * 4).toFixed(0) +
      '" role="img" aria-label="' + label + '" font-family="' + st.font + '" font-size="' + fs.toFixed(3) + '">';
  }

  function statusColor(lay, t, st) {
    const s = tailStatus(lay, t);
    if (s.errors.length) return st.err;
    if (s.warnings.length) return st.warn;
    return st.woodInk;
  }

  function dimLine(x1, x2, y, fs, st, text) {
    const k = 0.4 * fs;
    return '<g style="stroke:' + st.muted + '" stroke-width="' + (0.07 * fs).toFixed(3) + '">' +
      '<line x1="' + x1.toFixed(3) + '" y1="' + y.toFixed(3) + '" x2="' + x2.toFixed(3) + '" y2="' + y.toFixed(3) + '"/>' +
      '<line x1="' + x1.toFixed(3) + '" y1="' + (y - k).toFixed(3) + '" x2="' + x1.toFixed(3) + '" y2="' + (y + k).toFixed(3) + '"/>' +
      '<line x1="' + x2.toFixed(3) + '" y1="' + (y - k).toFixed(3) + '" x2="' + x2.toFixed(3) + '" y2="' + (y + k).toFixed(3) + '"/></g>' +
      '<text x="' + ((x1 + x2) / 2).toFixed(3) + '" y="' + (y - 0.7 * fs).toFixed(3) + '" text-anchor="middle" style="fill:' + st.muted + '">' + text + '</text>';
  }

  function faceSvg(lay, st) {
    const ts = sortedTails(lay);
    const fs = lay.width / 56.8;
    const pad = 2.6 * fs;
    const top = 3.2 * fs;
    const bodyH = 4.2 * fs;
    const lmax = Math.max.apply(null, [0].concat(ts.map((t) => t.length)));
    const W = lay.width + 2 * pad;
    const H = top + bodyH + lmax + 3.6 * fs;
    const y0 = top + bodyH;
    let s = svgOpen(W, H, fs, st, 'Face view of the tails board, ' + ts.length + ' tails across ' + st.fmt(lay.width));
    s += dimLine(pad, pad + lay.width, top * 0.55, fs, st, st.fmt(lay.width));
    s += '<rect x="' + pad.toFixed(3) + '" y="' + top.toFixed(3) + '" width="' + lay.width.toFixed(3) +
      '" height="' + bodyH.toFixed(3) + '" style="fill:' + st.board + ';stroke:' + st.ink + '" stroke-width="' + (0.08 * fs).toFixed(3) + '"/>';
    ts.forEach((t) => {
      const bw = baseWidth(t, lay.bit);
      const y1 = y0 + t.length;
      const cx = pad + t.center;
      const color = statusColor(lay, t, st);
      const pts = [
        [cx - bw / 2, y0], [cx + bw / 2, y0], [cx + t.tipWidth / 2, y1], [cx - t.tipWidth / 2, y1],
      ].map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
      s += '<polygon points="' + pts + '" style="fill:' + st.wood + ';stroke:' + color + '" stroke-width="' + (0.14 * fs).toFixed(3) + '" stroke-linejoin="round"/>';
      s += '<text x="' + cx.toFixed(3) + '" y="' + (y1 + 1.5 * fs).toFixed(3) + '" text-anchor="middle" style="fill:' + color + '">' + st.fmt(t.length, true) + '</text>';
    });
    return s + '</svg>';
  }

  function sectionSvg(lay, st) {
    const ts = sortedTails(lay);
    const fs = lay.width / 50.4;
    const pad = 2.6 * fs;
    const padR = 9 * fs;
    const top = 3.2 * fs;
    const extent = Math.max(lay.thickness, lay.bit.cutterLen);
    const W = lay.width + pad + padR;
    const H = top + extent + 3.6 * fs;
    let s = svgOpen(W, H, fs, st, 'Section through the mating board showing socket depths against the cutter and wall limits');
    s += '<text x="' + pad.toFixed(3) + '" y="' + (top - 0.9 * fs).toFixed(3) + '" style="fill:' + st.muted + '">board face</text>';
    s += '<rect x="' + pad.toFixed(3) + '" y="' + top.toFixed(3) + '" width="' + lay.width.toFixed(3) +
      '" height="' + lay.thickness.toFixed(3) + '" style="fill:' + st.board + ';stroke:' + st.ink + '" stroke-width="' + (0.08 * fs).toFixed(3) + '"/>';
    ts.forEach((t) => {
      const bw = baseWidth(t, lay.bit);
      const y1 = top + t.length;
      const cx = pad + t.center;
      const color = statusColor(lay, t, st);
      const pts = [
        [cx - bw / 2, top], [cx + bw / 2, top], [cx + t.tipWidth / 2, y1], [cx - t.tipWidth / 2, y1],
      ].map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
      s += '<polygon points="' + pts + '" style="fill:' + st.wood + ';stroke:' + color + '" stroke-width="' + (0.14 * fs).toFixed(3) + '" stroke-linejoin="round"/>';
      s += '<text x="' + cx.toFixed(3) + '" y="' + (y1 - 0.6 * fs).toFixed(3) + '" text-anchor="middle" style="fill:' + st.woodInk + '">' + st.fmt(t.length, true) + '</text>';
    });
    const yCut = top + lay.bit.cutterLen;
    const yWall = top + (lay.thickness - lay.minWall);
    let lyCut = yCut + 0.35 * fs;
    let lyWall = yWall + 0.35 * fs;
    if (Math.abs(lyCut - lyWall) < 1.2 * fs) {
      if (lyWall >= lyCut) lyWall = lyCut + 1.2 * fs; else lyCut = lyWall + 1.2 * fs;
    }
    const xr = pad + lay.width;
    s += '<line x1="' + pad.toFixed(3) + '" y1="' + yCut.toFixed(3) + '" x2="' + (xr + 0.6 * fs).toFixed(3) + '" y2="' + yCut.toFixed(3) +
      '" style="stroke:' + st.warn + '" stroke-width="' + (0.1 * fs).toFixed(3) + '" stroke-dasharray="' + (0.8 * fs).toFixed(3) + ' ' + (0.5 * fs).toFixed(3) + '"/>';
    s += '<text x="' + (xr + 1 * fs).toFixed(3) + '" y="' + lyCut.toFixed(3) + '" style="fill:' + st.warn + '">cutter ' + st.fmt(lay.bit.cutterLen, true) + '</text>';
    s += '<line x1="' + pad.toFixed(3) + '" y1="' + yWall.toFixed(3) + '" x2="' + (xr + 0.6 * fs).toFixed(3) + '" y2="' + yWall.toFixed(3) +
      '" style="stroke:' + st.err + '" stroke-width="' + (0.1 * fs).toFixed(3) + '" stroke-dasharray="' + (0.8 * fs).toFixed(3) + ' ' + (0.5 * fs).toFixed(3) + '"/>';
    s += '<text x="' + (xr + 1 * fs).toFixed(3) + '" y="' + lyWall.toFixed(3) + '" style="fill:' + st.err + '">wall ' + st.fmt(lay.minWall, true) + '</text>';
    s += '<text x="' + pad.toFixed(3) + '" y="' + (top + extent + 2.4 * fs).toFixed(3) + '" style="fill:' + st.muted + '">mating board thickness ' + st.fmt(lay.thickness, true) + '</text>';
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
    tailStatus: tailStatus,
    check: check,
    evenLayout: evenLayout,
    fromWidths: fromWidths,
    faceSvg: faceSvg,
    sectionSvg: sectionSvg,
  };
}));
