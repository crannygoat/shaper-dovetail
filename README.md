# shaper-dovetail

Generates cut files for dovetail joinery on the Shaper Origin handheld router.
Unofficial; not affiliated with Shaper Tools.

## Status: v0, untested on a machine

Implemented: female slot of a sliding dovetail (hog pocket plus finish path).
Not implemented: male tail, through and half-blind dovetails.

```
python3 dovetail_gen.py --depth 12 --length 200 --out out/
python3 -m unittest -v test_dovetail_gen
```

Outputs `slot.svg` and `manifest.json` (parameters, derived widths, on-tool
steps, unverified items).

## Layout engine (layer 1, no tool needed)

`layout.py` describes a joint in board coordinates: tails with center, tip
width, and length, checked against the bit and the mating board.

```
python3 layout.py --width 150 --thickness 15 --tails 5 --preview out.svg
python3 layout.py --width 150 --thickness 15 --tails 5 --fractions 5/8,7/8 --min-wall 1.5   # houndstooth
python3 layout.py --width 100 --thickness 15 --widths 5,20,10,25,10,20,10                    # irregular
```

Houndstooth means tail lengths cycle through thickness fractions (assumed to
be socket depth in a half-blind joint). Limits it enforces: tail length at most
the cutter length (13.5 mm), and a minimum wall in front of the socket
(`--min-wall`, default 3 mm, an assumption). With the 13.5 mm bit, 7/8 of the
thickness fits only on stock up to about 15.4 mm, which leaves about 1.9 mm of
wall, so lower `--min-wall` or use a longer bit.

### Browser preview

`preview.html` (with `layout.js`) is a local page: open it in a browser. There
is no form. The drawings are the controls:

- Three drawings to one scale: the tails board (face), the mating board
  (section) and a side section. Width and thickness of both boards are on the
  drawings. Both boards are taken as the same width, as in a box corner.
- Drag the round handles: tail tips set length, the lower corners of a tail set
  its width, board edges set sizes, dashed lines set cutter length and wall.
  Shift skips snapping.
- Click any number to type it (`5/8`, `1 1/2`, `0.75`, `12mm`, or `7/8t` for a
  fraction of the mating board thickness). The bit and limits are click-to-type
  values under the drawings.
- Toolbar: Even or Irregular spacing, tail count, length presets, in/mm.

It flags errors and warnings, lists each tail, and prints the matching
`layout.py` command. Tails board thickness is stored (`--tails-thickness`) for
the toolpath layer and does not change the layout.

`layout.js` is a port of `layout.py`; `test_crosscheck.py` runs both on the
same cases and compares them (skipped when Node is missing).
`build_artifact.py out.html` makes a single-file version with `layout.js`
inlined.

Angled (non-orthogonal) joints: `joint_angle_deg` is stored but not applied yet.
Twisted dovetails are not supported; a straight-axis bit likely cannot cut them.

## Encoding

Uses Shaper's SVG namespace, `shaper:cutDepth`, `shaper:cutType`, and a custom
anchor (closed right triangle, red fill, no stroke). Shaper docs:
- Manual SVG Cut Depth Encoding
- Cut Type Encoding
- Custom Anchors
- Encoded Depth

## Unverified (confirm with a scrap test cut)

- Whether Origin honors `shaper:cutType` on import, and the `online` / `pocket` values
- Which corner of the anchor triangle is the origin
- Bit angle convention: 15 degrees assumed per side from the plunge axis;
  check by measuring the cutter diameter 13.5 mm above the tip
  (about 6.57 mm if per side, about 10.25 mm if included)

## Fit offset

Origin has its own Cut Offset setting (positive cuts inside the design,
negative outside), used for fit and for rough then finish passes
([Shaper: Cut Offset](https://support.shapertools.com/hc/articles/115002894693)).
It cannot be applied to On Line or Guide cuts. So the glue offset likely belongs
on the tool, not in the file, and the v0 slot generator's `online` finish path
would not take an offset. To be reworked in the toolpath layer.

## Retraction risk

Origin retracts the cutter when the tool leaves its correction range, which is
hard on an undercut bit. The generator hogs most of the waste with a straight
bit first so the dovetail bit takes only a thin finishing cut.

## License

MIT. See LICENSE.
