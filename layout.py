"""Dovetail layout engine, layer 1: joint layout in board coordinates.

Pure geometry. No tool encoding, no toolpaths. A layout is a list of tails
(center, tip width, length) across a board of a given width, plus the bit and
the mating-board thickness used for depth checks.

Conventions (assumptions flagged, confirm with test cuts):
  - tip_width is measured at the wide end of the tail; base width is derived
    as tip_width - 2 * length * tan(bit side angle).
  - "Houndstooth": tail lengths alternate through a list of thickness
    fractions (e.g. 5/8, 7/8). I read "pin height" as how far a tail enters
    the mating board (socket depth). Confirm this reading.
  - min_wall, min_neck, glue_offset and the default tail:pin ratio are
    assumptions, not sourced standards.
  - joint_angle_deg is stored only; angled-joint geometry is not applied yet.
"""
import argparse
import math
from dataclasses import dataclass, field
from fractions import Fraction
from itertools import cycle, islice

from dovetail_gen import Bit


@dataclass
class Tail:
    center: float       # mm from the board's left edge
    tip_width: float    # mm, wide end
    length: float       # mm, how far the tail enters the mating board

    def base_width(self, bit: Bit) -> float:
        return self.tip_width - 2 * self.length * math.tan(math.radians(bit.side_angle_deg))

    def left(self):
        return self.center - self.tip_width / 2

    def right(self):
        return self.center + self.tip_width / 2


@dataclass
class Layout:
    width: float                       # mm, board width
    thickness: float                   # mm, mating board thickness
    tails: list
    bit: Bit = field(default_factory=Bit)
    min_wall: float = 3.0              # mm left in front of a half-blind socket (assumed)
    min_neck: float = 3.0              # mm minimum tail base width (assumed)
    glue_offset: float = 0.1           # mm per side (assumed; used by the toolpath layer)
    joint_angle_deg: float = 90.0      # stored only
    tails_thickness: float = None      # mm, tails board thickness; None means same as the mating board (stored; the toolpath layer will use it)

    def check(self):
        errors, warnings = [], []
        if self.width <= 0 or self.thickness <= 0:
            errors.append("width and thickness must be positive")
        if not self.tails:
            errors.append("layout has no tails")
        ts = sorted(self.tails, key=lambda t: t.center)
        for i, t in enumerate(ts, 1):
            if t.tip_width <= 0:
                errors.append(f"tail {i}: tip width must be positive")
            if t.length <= 0:
                errors.append(f"tail {i}: length must be positive")
            if t.length > self.bit.cutter_len:
                errors.append(
                    f"tail {i}: length {t.length:.2f} mm exceeds cutter length {self.bit.cutter_len} mm")
            if t.length > self.thickness - self.min_wall:
                errors.append(
                    f"tail {i}: length {t.length:.2f} mm leaves under {self.min_wall} mm of wall "
                    f"in a {self.thickness} mm board")
            bw = t.base_width(self.bit)
            if bw <= 0:
                errors.append(f"tail {i}: base width {bw:.2f} mm is not positive")
            elif bw < self.min_neck:
                warnings.append(f"tail {i}: base width {bw:.2f} mm is under {self.min_neck} mm")
        if ts:
            if ts[0].left() < -1e-9:
                errors.append("first tail extends past the left edge")
            if ts[-1].right() > self.width + 1e-9:
                errors.append("last tail extends past the right edge")
        for a, b in zip(ts, ts[1:]):
            if b.left() - a.right() <= 1e-9:
                errors.append("adjacent tails overlap or touch at the tips")
        if not 45 <= self.joint_angle_deg <= 135:
            warnings.append("joint angle is more than 45 degrees from square; "
                            "fixture limits are unverified")
        return errors, warnings

    def validate(self):
        errors, _ = self.check()
        if errors:
            raise ValueError("; ".join(errors))


def parse_fractions(text):
    return [Fraction(p.strip()) for p in text.split(",") if p.strip()]


def cycled_lengths(thickness, fractions, n):
    """Houndstooth: tail lengths cycle through thickness fractions."""
    return [float(f) * thickness for f in islice(cycle(fractions), n)]


def even_layout(width, thickness, n_tails, lengths, bit=None, ratio=2.0, half_pin=0.5,
                validate=True, shift=0.0, **kw):
    """n tails across width. ratio = tail tip width / pin gap at the tips.
    half_pin = edge half-pin width as a fraction of a full pin gap.
    width = p * (2*half_pin + n*(ratio + 1) - 1), solved for the pin gap p.
    shift slides the whole pattern sideways (mm, positive is right); sizes do not change,
    so the left edge pin grows by shift and the right one shrinks by it."""
    if n_tails < 1:
        raise ValueError("need at least one tail")
    p = width / (2 * half_pin + n_tails * (ratio + 1) - 1)
    t = ratio * p
    x = half_pin * p + shift
    tails = []
    for i in range(n_tails):
        tails.append(Tail(center=x + t / 2, tip_width=t, length=lengths[i]))
        x += t + p
    lay = Layout(width, thickness, tails, bit or Bit(), **kw)
    if validate:
        lay.validate()
    return lay


def from_widths(width, thickness, widths, lengths, bit=None, validate=True, **kw):
    """Irregular spacing. widths alternate pin, tail, pin, ..., pin (odd count,
    edge half-pins included) and must sum to the board width."""
    if len(widths) % 2 == 0 or len(widths) < 3:
        raise ValueError("widths must alternate pin, tail, ..., pin (odd count, at least 3)")
    if abs(sum(widths) - width) > 1e-6:
        raise ValueError(f"widths sum to {sum(widths):.4f}, board width is {width}")
    tails, x = [], 0.0
    for i, w in enumerate(widths):
        if i % 2 == 1:
            tails.append(Tail(center=x + w / 2, tip_width=w, length=lengths[len(tails)]))
        x += w
    lay = Layout(width, thickness, tails, bit or Bit(), **kw)
    if validate:
        lay.validate()
    return lay


def summary(lay: Layout) -> str:
    tt = lay.tails_thickness if lay.tails_thickness is not None else lay.thickness
    rows = [f"tails board {lay.width:g} x {tt:g} mm, mating board {lay.width:g} x {lay.thickness:g} mm",
            "  #  center  tip_w  base_w  length"]
    for i, t in enumerate(sorted(lay.tails, key=lambda t: t.center), 1):
        rows.append(f"{i:3d} {t.center:7.2f} {t.tip_width:6.2f} {t.base_width(lay.bit):7.2f} {t.length:7.2f}")
    errors, warnings = lay.check()
    rows += [f"warning: {w}" for w in warnings]
    return "\n".join(rows)


def preview_svg(lay: Layout) -> str:
    """Face-on view of the tails board: body above, tails projecting down."""
    body = 12.0
    pad = 6.0
    lmax = max(t.length for t in lay.tails)
    palette = ["#c9a66b", "#8fb3a0", "#b08fa8", "#9aa7c7"]
    lengths = sorted({round(t.length, 3) for t in lay.tails})
    color = {L: palette[i % len(palette)] for i, L in enumerate(lengths)}
    W = lay.width + 2 * pad
    H = body + lmax + 2 * pad + 8
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W * 4:.0f}" height="{H * 4:.0f}" '
        f'viewBox="0 0 {W:.3f} {H:.3f}" font-family="sans-serif" font-size="2.4">',
        f'<rect x="{pad}" y="{pad}" width="{lay.width}" height="{body}" fill="#e6e6e6" stroke="#555" stroke-width="0.2"/>',
    ]
    for t in sorted(lay.tails, key=lambda t: t.center):
        bw = t.base_width(lay.bit)
        y0, y1 = pad + body, pad + body + t.length
        cx = pad + t.center
        pts = (f"{cx - bw / 2:.3f},{y0:.3f} {cx + bw / 2:.3f},{y0:.3f} "
               f"{cx + t.tip_width / 2:.3f},{y1:.3f} {cx - t.tip_width / 2:.3f},{y1:.3f}")
        out.append(f'<polygon points="{pts}" fill="{color[round(t.length, 3)]}" stroke="#333" stroke-width="0.2"/>')
        out.append(f'<text x="{cx:.3f}" y="{y1 + 3.2:.3f}" text-anchor="middle">{t.length:.1f}</text>')
    out.append(
        f'<text x="{pad}" y="{H - 2:.3f}">board {lay.width:g} mm wide, mating board {lay.thickness:g} mm, '
        f'bit {lay.bit.side_angle_deg:g} deg per side (assumed)</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def main(argv=None):
    p = argparse.ArgumentParser(description="Dovetail layout (layer 1)")
    p.add_argument("--width", type=float, required=True, help="board width, mm")
    p.add_argument("--thickness", type=float, required=True, help="mating board thickness, mm")
    p.add_argument("--tails", type=int, default=5)
    p.add_argument("--ratio", type=float, default=2.0, help="tail tip width / pin gap (default is arbitrary)")
    p.add_argument("--fractions", default="2/3",
                   help="tail lengths as fractions of thickness, cycled; '5/8,7/8' is houndstooth")
    p.add_argument("--widths", help="irregular: pin,tail,pin,...,pin widths in mm (overrides --tails/--ratio)")
    p.add_argument("--half-pin", type=float, default=0.5,
                   help="edge half-pin width as a fraction of a full pin gap")
    p.add_argument("--min-wall", type=float, default=3.0,
                   help="minimum wall left in front of a socket, mm (default is an assumption)")
    p.add_argument("--min-neck", type=float, default=3.0,
                   help="minimum tail base width, mm (default is an assumption)")
    p.add_argument("--angle", type=float, default=15.0, help="bit side angle, degrees")
    p.add_argument("--cutter-dia", type=float, default=13.8, help="bit widest diameter, mm")
    p.add_argument("--cutter-len", type=float, default=13.5, help="bit cutter length, mm")
    p.add_argument("--shift", type=float, default=0.0,
                   help="even layout: slide the whole pattern sideways, mm (positive is right)")
    p.add_argument("--tails-thickness", type=float, default=None,
                   help="tails board thickness, mm (stored for the toolpath layer; default same as --thickness)")
    p.add_argument("--preview", help="write a preview SVG to this path")
    a = p.parse_args(argv)
    fr = parse_fractions(a.fractions)
    bit = Bit(a.angle, a.cutter_dia, a.cutter_len)
    if a.widths:
        w = [float(x) for x in a.widths.split(",")]
        lengths = cycled_lengths(a.thickness, fr, len(w) // 2)
        lay = from_widths(a.width, a.thickness, w, lengths, bit=bit,
                          min_wall=a.min_wall, min_neck=a.min_neck, tails_thickness=a.tails_thickness)
    else:
        lay = even_layout(a.width, a.thickness, a.tails,
                          cycled_lengths(a.thickness, fr, a.tails),
                          bit=bit, ratio=a.ratio, half_pin=a.half_pin, shift=a.shift,
                          min_wall=a.min_wall, min_neck=a.min_neck, tails_thickness=a.tails_thickness)
    print(summary(lay))
    if a.preview:
        with open(a.preview, "w") as f:
            f.write(preview_svg(lay))


if __name__ == "__main__":
    main()
