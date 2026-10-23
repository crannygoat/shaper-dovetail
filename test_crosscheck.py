"""Checks that layout.js and layout.py agree. Skipped when Node is not installed."""
import json
import os
import shutil
import subprocess
import unittest

import layout as lo

HERE = os.path.dirname(os.path.abspath(__file__))


def fl(text):
    return [float(f) for f in lo.parse_fractions(text)]


CASES = [
    dict(kind="even", width=152.4, thickness=15.875, n=5, fractions=fl("2/3"), ratio=2.0, halfPin=0.5, minWall=3.0, minNeck=3.0),
    dict(kind="even", width=150.0, thickness=15.0, n=5, fractions=fl("5/8,7/8"), ratio=2.0, halfPin=0.5, minWall=1.5, minNeck=3.0),
    dict(kind="even", width=150.0, thickness=15.0, n=5, fractions=fl("5/8,7/8"), ratio=2.0, halfPin=0.5, minWall=3.0, minNeck=3.0),
    dict(kind="even", width=300.0, thickness=19.0, n=9, fractions=fl("5/8,7/8"), ratio=1.5, halfPin=0.75, minWall=3.0, minNeck=3.0),
    dict(kind="even", width=60.0, thickness=12.0, n=3, fractions=fl("1/2"), ratio=3.0, halfPin=0.0, minWall=3.0, minNeck=6.0),
    dict(kind="widths", width=100.0, thickness=15.0, widths=[5, 20, 10, 25, 10, 20, 10], fractions=fl("2/3"), ratio=2.0, halfPin=0.5, minWall=3.0, minNeck=3.0),
]


@unittest.skipUnless(shutil.which("node"), "node not installed")
class CrossCheck(unittest.TestCase):
    def test_js_matches_python(self):
        proc = subprocess.run(
            ["node", os.path.join(HERE, "crosscheck.js")],
            input=json.dumps(CASES), capture_output=True, text=True, check=True, cwd=HERE)
        js = json.loads(proc.stdout)
        self.assertEqual(len(js), len(CASES))
        for c, got in zip(CASES, js):
            lengths = lo.cycled_lengths(c["thickness"], c["fractions"],
                                        c["n"] if c["kind"] == "even" else len(c["widths"]) // 2)
            kw = dict(min_wall=c["minWall"], min_neck=c["minNeck"], validate=False)
            if c["kind"] == "even":
                lay = lo.even_layout(c["width"], c["thickness"], c["n"], lengths,
                                     ratio=c["ratio"], half_pin=c["halfPin"], **kw)
            else:
                lay = lo.from_widths(c["width"], c["thickness"], c["widths"], lengths, **kw)
            errors, warnings = lay.check()
            self.assertEqual(len(errors), got["errors"], c)
            self.assertEqual(len(warnings), got["warnings"], c)
            ts = sorted(lay.tails, key=lambda t: t.center)
            self.assertEqual(len(ts), len(got["tails"]))
            for t, g in zip(ts, got["tails"]):
                self.assertAlmostEqual(t.center, g["center"], places=9)
                self.assertAlmostEqual(t.tip_width, g["tipWidth"], places=9)
                self.assertAlmostEqual(t.length, g["length"], places=9)
                self.assertAlmostEqual(t.base_width(lay.bit), g["base"], places=9)


if __name__ == "__main__":
    unittest.main()
