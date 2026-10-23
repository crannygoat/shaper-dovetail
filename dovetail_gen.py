"""Sliding dovetail slot (female) generator for Shaper Origin. v0.

Scope: straight through-slot for a sliding dovetail. Male tail, through and
half-blind dovetails are not implemented; their geometry needs physical test
cuts before it is emitted.

Encoding used (Shaper docs):
  - namespace xmlns:shaper="http://www.shapertools.com/namespaces/shaper"
  - shaper:cutDepth="<n>mm"                      (Manual SVG Cut Depth Encoding)
  - custom anchor: closed right triangle, red fill, no stroke (Custom Anchors)

Unverified (see manifest "unverified"): cutType value strings other than
"outside", whether Origin honors shaper:cutType on import, the anchor corner.
"""
import argparse
import json
import math
import os
from dataclasses import dataclass, field, asdict

SHAPER_NS = "http://www.shapertools.com/namespaces/shaper"
UNVERIFIED = [
    "cutType strings 'online' and 'pocket' (only 'outside' seen in a forum export)",
    "whether Origin honors shaper:cutType on import (forum: only cutDepth and cutType)",
    "which corner of the custom-anchor triangle is the anchor point",
    "bit side angle convention (15 deg assumed to be wall angle from the plunge axis)",
    "cut-type color codes (not emitted; attributes only)",
]


@dataclass
class Bit:
    side_angle_deg: float = 15.0
    cutter_dia: float = 13.8   # mm, widest point (Shaper 15 deg bit spec)
    cutter_len: float = 13.5   # mm


@dataclass
class SlidingSlot:
    slot_depth: float                  # mm
    length: float                      # mm, along the slot
    bit: Bit = field(default_factory=Bit)
    straight_bit_dia: float = 6.0      # mm, hogging bit
    finish_allowance: float = 0.4      # mm per side left for the dovetail bit
    hog_floor_allowance: float = 1.0   # mm left above final depth when hogging

    def validate(self):
        b = self.bit
        if not 0 < b.side_angle_deg < 45:
            raise ValueError("side_angle_deg must be in (0, 45)")
        if not 0 < self.slot_depth <= b.cutter_len:
            raise ValueError("slot_depth must be in (0, cutter_len]")
        if self.length <= 0:
            raise ValueError("length must be positive")
        if self.surface_width() <= 0:
            raise ValueError("depth too large for this bit: surface width <= 0")
        if self.straight_bit_dia > self.hog_width():
            raise ValueError("straight bit is wider than the hog pocket")
        if self.hog_floor_allowance >= self.slot_depth:
            raise ValueError("hog_floor_allowance must be < slot_depth")

    def surface_width(self):
        b = self.bit
        return b.cutter_dia - 2 * self.slot_depth * math.tan(math.radians(b.side_angle_deg))

    def bottom_width(self):
        return self.bit.cutter_dia

    def hog_width(self):
        return self.surface_width() - 2 * self.finish_allowance


def _depth(mm):
    return f"{mm:.3f}mm"


def build_svg(slot: SlidingSlot) -> str:
    slot.validate()
    hw = slot.hog_width() / 2
    anchor = 10.0
    margin = 2.0
    min_x, min_y = -anchor - margin, -max(anchor, hw) - margin
    width = slot.length + anchor + 2 * margin
    height = 2 * max(anchor, hw) + 2 * margin
    hog = f"M0 {-hw:.4f} H{slot.length:.4f} V{hw:.4f} H0 Z"
    finish = f"M0 0 H{slot.length:.4f}"
    anchor_d = f"M0 0 L{-anchor:.1f} 0 L0 {-anchor:.1f} Z"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="{SHAPER_NS}" '
        f'width="{width:.3f}mm" height="{height:.3f}mm" '
        f'viewBox="{min_x:.3f} {min_y:.3f} {width:.3f} {height:.3f}">\n'
        f'  <path id="anchor" d="{anchor_d}" fill="red" stroke="none"/>\n'
        f'  <path id="hog" d="{hog}" shaper:cutType="pocket" '
        f'shaper:cutDepth="{_depth(slot.slot_depth - slot.hog_floor_allowance)}"/>\n'
        f'  <path id="finish" d="{finish}" shaper:cutType="online" '
        f'shaper:cutDepth="{_depth(slot.slot_depth)}"/>\n'
        f'</svg>\n'
    )


def manifest(slot: SlidingSlot) -> dict:
    slot.validate()
    return {
        "params": asdict(slot),
        "derived": {
            "surface_width_mm": round(slot.surface_width(), 4),
            "bottom_width_mm": round(slot.bottom_width(), 4),
            "hog_width_mm": round(slot.hog_width(), 4),
        },
        "on_tool": [
            "Cut 'hog' first with the straight bit (set its diameter on tool, Z-touch).",
            "Swap to the dovetail bit, set its width, Z-touch.",
            "Cut 'finish' (online) at the encoded depth.",
        ],
        "unverified": UNVERIFIED,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--depth", type=float, required=True)
    p.add_argument("--length", type=float, required=True)
    p.add_argument("--angle", type=float, default=15.0)
    p.add_argument("--cutter-dia", type=float, default=13.8)
    p.add_argument("--cutter-len", type=float, default=13.5)
    p.add_argument("--straight-dia", type=float, default=6.0)
    p.add_argument("--out", default=".")
    a = p.parse_args(argv)
    slot = SlidingSlot(
        slot_depth=a.depth, length=a.length,
        bit=Bit(a.angle, a.cutter_dia, a.cutter_len),
        straight_bit_dia=a.straight_dia,
    )
    svg, man = build_svg(slot), manifest(slot)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "slot.svg"), "w") as f:
        f.write(svg)
    with open(os.path.join(a.out, "manifest.json"), "w") as f:
        json.dump(man, f, indent=2)
    print(json.dumps(man["derived"]))


if __name__ == "__main__":
    main()
