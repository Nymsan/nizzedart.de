"""Tests for scripts/add_board.py. Run with: python3 -m unittest discover tests"""

import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import add_board  # noqa: E402

ALPHABET = add_board.ALPHABET

# The same board and code as in tests/run.js, so the two implementations of the
# format are held to each other.
GOLDEN = {
    "tiles": [("A", 16, 2, False, False), ("M", 52, 2, True, False), ("'", 100, 30, False, True), ("<", 486, 5, True, True)],
    "author": "Æg & Ål",
    "minutes": 29333333,
    "parent": "0123456789ab",
}
GOLDEN_CODE = "AQG_l1UBI0VniasJw4ZnICYgw4VsBAAEBGQaCpRk9VvMUA"


def encode(tiles, author="", minutes=0, parent="000000000000", version=1):
    """A share code, built straight from the description in js/codec.js. A letter may be given as its number."""
    name = author.encode("utf-8")
    data = bytes([version]) + minutes.to_bytes(4, "big") + bytes.fromhex(parent) + bytes([len(name)]) + name + bytes([len(tiles)])
    bits = 0
    for ch, x, row, flip, loose in tiles:
        letter = ch if isinstance(ch, int) else ALPHABET.index(ch)
        bits = (bits << 23) | (letter << 17) | (flip << 16) | (loose << 15) | (x << 5) | row
    width = len(tiles) * 23
    padded = (width + 7) // 8 * 8
    data += (bits << (padded - width)).to_bytes(padded // 8, "big")
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


class CheckCode(unittest.TestCase):
    def test_golden_code(self):
        self.assertEqual(encode(**GOLDEN), GOLDEN_CODE)
        add_board.check_code(GOLDEN_CODE)

    def test_accepts_an_empty_board(self):
        add_board.check_code(encode([]))

    def test_accepts_a_full_board(self):
        add_board.check_code(encode([("A", 0, 2, False, False)] * add_board.MAX_TILES, author="x" * 40))

    def test_rejects_what_is_not_a_board(self):
        valid = encode(GOLDEN["tiles"])
        broken = {
            "not base64url": "!!!!",
            "another version": encode(GOLDEN["tiles"], version=2),
            "cut short": valid[:-3],
            "too long": valid + "AAAA",
            "unknown letter": encode([(len(ALPHABET), 0, 2, False, False)]),
            "row above the board": encode([("A", 0, 1, False, False)]),
            "row below the board": encode([("A", 0, 31, False, False)]),
            "name that is not UTF-8": base64.urlsafe_b64encode(bytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xFF, 0])).decode().rstrip("="),
        }
        for what, code in broken.items():
            with self.subTest(what):
                self.assertRaises(ValueError, add_board.check_code, code)

    def test_too_many_tiles(self):
        code = encode([("A", 0, 2, False, False)] * (add_board.MAX_TILES + 1))
        self.assertRaises(ValueError, add_board.check_code, code)


class FindCode(unittest.TestCase):
    def test_finds_the_code_line(self):
        body = f"Besked: HEJ\nAf: Ann\n\nboard:{GOLDEN_CODE}\n"
        self.assertEqual(add_board.find_code(body), GOLDEN_CODE)

    def test_survives_windows_line_endings(self):
        self.assertEqual(add_board.find_code(f"Besked: HEJ\r\nboard:{GOLDEN_CODE}\r\n"), GOLDEN_CODE)

    def test_ignores_everything_else(self):
        self.assertIsNone(add_board.find_code(None))
        self.assertIsNone(add_board.find_code("just a normal issue"))
        self.assertIsNone(add_board.find_code("board:$(rm -rf /)"))
        self.assertIsNone(add_board.find_code(f"see board:{GOLDEN_CODE}"))


class AddToGallery(unittest.TestCase):
    def test_appends_once(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "boards.json"
            path.write_text('{"boards": []}', encoding="utf-8")

            self.assertTrue(add_board.add_to_gallery(GOLDEN_CODE, 7, path))
            self.assertFalse(add_board.add_to_gallery(GOLDEN_CODE, 8, path))

            boards = json.loads(path.read_text(encoding="utf-8"))["boards"]
            self.assertEqual(len(boards), 1)
            self.assertEqual(boards[0]["code"], GOLDEN_CODE)
            self.assertEqual(boards[0]["issue"], 7)

    def test_creates_the_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "boards.json"
            self.assertTrue(add_board.add_to_gallery(GOLDEN_CODE, 1, path))
            self.assertEqual(len(json.loads(path.read_text(encoding="utf-8"))["boards"]), 1)


if __name__ == "__main__":
    unittest.main()
