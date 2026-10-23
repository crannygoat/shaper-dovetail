import unittest
import xml.etree.ElementTree as ET

import layout as lo
from dovetail_gen import Bit


class LayoutTests(unittest.TestCase):
    def even(self, **kw):
        n = kw.pop("n", 5)
        thickness = kw.pop("thickness", 15.0)
        fr = kw.pop("fractions", lo.parse_fractions("2/3"))
        return lo.even_layout(150.0, thickness, n, lo.cycled_lengths(thickness, fr, n), **kw)

    def test_even_layout_fills_width(self):
        lay = self.even()
        first, last = lay.tails[0], lay.tails[-1]
        p = lay.tails[1].left() - first.right()
        self.assertAlmostEqual(first.left(), 0.5 * p, places=6)          # half-pin
        self.assertAlmostEqual(lay.width - last.right(), 0.5 * p, places=6)
        gaps = [b.left() - a.right() for a, b in zip(lay.tails, lay.tails[1:])]
        self.assertTrue(all(abs(g - p) < 1e-9 for g in gaps))
        self.assertAlmostEqual(first.tip_width, 2.0 * p, places=6)

    def test_houndstooth_cycles_lengths(self):
        fr = lo.parse_fractions("5/8,7/8")
        got = lo.cycled_lengths(15.0, fr, 5)
        self.assertEqual([round(x, 4) for x in got], [9.375, 13.125, 9.375, 13.125, 9.375])

    def test_houndstooth_on_thick_stock_is_rejected(self):
        # 7/8 of 19 mm = 16.6 mm, longer than the 13.5 mm cutter
        with self.assertRaises(ValueError) as cm:
            self.even(thickness=19.0, fractions=lo.parse_fractions("5/8,7/8"))
        self.assertIn("cutter length", str(cm.exception))

    def test_min_wall(self):
        with self.assertRaises(ValueError):
            self.even(thickness=12.0, fractions=lo.parse_fractions("7/8"))

    def test_irregular_widths(self):
        lay = lo.from_widths(100.0, 15.0, [5, 20, 10, 25, 10, 20, 10], [8, 8, 8])
        self.assertEqual(len(lay.tails), 3)
        self.assertAlmostEqual(lay.tails[1].center, 5 + 20 + 10 + 12.5)

    def test_irregular_sum_mismatch(self):
        with self.assertRaises(ValueError):
            lo.from_widths(100.0, 15.0, [5, 20, 5], [8])

    def test_base_width_and_neck_warning(self):
        lay = self.even()
        _, warnings = lay.check()
        t = lay.tails[0]
        self.assertAlmostEqual(
            t.base_width(Bit()), t.tip_width - 2 * t.length * 0.26794919243112270, places=6)

    def test_angle_warning(self):
        lay = self.even(joint_angle_deg=30.0)
        _, warnings = lay.check()
        self.assertTrue(any("45 degrees" in w for w in warnings))

    def test_preview_is_valid_svg(self):
        root = ET.fromstring(lo.preview_svg(self.even()))
        polys = root.findall("{http://www.w3.org/2000/svg}polygon")
        self.assertEqual(len(polys), 5)


if __name__ == "__main__":
    unittest.main()
