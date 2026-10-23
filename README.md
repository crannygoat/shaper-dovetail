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

## Retraction risk

Origin retracts the cutter when the tool leaves its correction range, which is
hard on an undercut bit. The generator hogs most of the waste with a straight
bit first so the dovetail bit takes only a thin finishing cut.

## License

MIT. See LICENSE.
