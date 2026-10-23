import math
import unittest
import xml.etree.ElementTree as ET

import dovetail_gen as dg

NS = {"s": "http://www.w3.org/2000/svg"}
SH = "{" + dg.SHAPER_NS + "}"


class SlotTests(unittest.TestCase):
    def slot(self, **kw):
        return dg.SlidingSlot(slot_depth=kw.pop("slot_depth", 12.0), length=kw.pop("length", 100.0), **kw)

    def test_widths(self):
        s = dg.SlidingSlot(slot_depth=13.5, length=100)
        self.assertAlmostEqual(s.bottom_width(), 13.8)
        self.assertAlmostEqual(s.surface_width(), 13.8 - 27 * math.tan(math.radians(15)), places=6)

    def test_svg_encoding(self):
        root = ET.fromstring(dg.build_svg(self.slot()))
        paths = {p.get("id"): p for p in root.findall("s:path", NS)}
        self.assertEqual(paths["hog"].get(SH + "cutDepth"), "11.000mm")
        self.assertEqual(paths["finish"].get(SH + "cutDepth"), "12.000mm")
        self.assertEqual(paths["hog"].get(SH + "cutType"), "pocket")
        # attributes only: no fill/stroke that could override the cut type
        for k in ("hog", "finish"):
            self.assertIsNone(paths[k].get("fill"))
            self.assertIsNone(paths[k].get("stroke"))

    def test_anchor_is_closed_red_no_stroke(self):
        root = ET.fromstring(dg.build_svg(self.slot()))
        a = [p for p in root.findall("s:path", NS) if p.get("id") == "anchor"][0]
        self.assertEqual(a.get("fill"), "red")
        self.assertEqual(a.get("stroke"), "none")
        self.assertTrue(a.get("d").strip().endswith("Z"))

    def test_hog_inside_final_slot(self):
        s = self.slot()
        self.assertLess(s.hog_width(), s.surface_width())

    def test_validation(self):
        with self.assertRaises(ValueError):
            self.slot(slot_depth=20).validate()            # deeper than cutter
        with self.assertRaises(ValueError):
            self.slot(straight_bit_dia=20).validate()      # hog bit too wide
        with self.assertRaises(ValueError):
            self.slot(length=0).validate()

    def test_manifest_flags_unverified(self):
        m = dg.manifest(self.slot())
        self.assertTrue(m["unverified"])


if __name__ == "__main__":
    unittest.main()
