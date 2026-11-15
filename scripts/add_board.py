#!/usr/bin/env python3
"""Add a board to the gallery, data/boards.json.

By hand, with a share link or its code (then commit and push the file):

    python3 scripts/add_board.py "https://www.nizzedart.de/#b=..."

Or from a GitHub Actions workflow, when someone opens an issue from the "Send
til galleriet" link on the site. The issue body, in $ISSUE_BODY, holds a line

    board:<share code>

The code is checked against the format described in js/codec.js, and appended
to the gallery unless it is already there. The outcome is printed, and written
to $GITHUB_OUTPUT as `result` (added, duplicate or invalid) and `message`.

The issue text is untrusted: nothing but the code is read from it, and the
code can only consist of base64url characters.
"""

import base64
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent / "data" / "boards.json"

# The share code format, version 1. Keep in step with js/codec.js and js/glyphs.js.
VERSION = 1
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789@*'<"
ROW_MIN, ROW_MAX = 2, 30
MAX_TILES = 200
TILE_BITS = 23
HEADER_BYTES = 12  # version, time, parent id, length of the name

CODE_LINE = re.compile(r"^board:([A-Za-z0-9_-]{12,1400})\s*$", re.MULTILINE)


def find_code(text):
    """The share code in an issue body, or None."""
    match = CODE_LINE.search(text or "")
    return match.group(1) if match else None


def check_code(code):
    """Raise ValueError unless `code` is a board the site can show."""
    try:
        data = base64.b64decode(code + "=" * (-len(code) % 4), altchars=b"-_", validate=True)
    except ValueError as error:
        raise ValueError("not base64url") from error

    if len(data) < HEADER_BYTES + 1 or data[0] != VERSION:
        raise ValueError("unknown version")

    name_end = HEADER_BYTES + data[HEADER_BYTES - 1]
    if len(data) <= name_end:
        raise ValueError("cut short")
    try:
        data[HEADER_BYTES:name_end].decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("name is not UTF-8") from error

    count = data[name_end]
    tile_bytes = data[name_end + 1 :]
    if count > MAX_TILES or len(tile_bytes) != (count * TILE_BITS + 7) // 8:
        raise ValueError("wrong length")

    bits = int.from_bytes(tile_bytes, "big")
    total_bits = len(tile_bytes) * 8
    for index in range(count):
        tile = (bits >> (total_bits - (index + 1) * TILE_BITS)) & ((1 << TILE_BITS) - 1)
        letter = tile >> 17
        row = tile & 31
        if letter >= len(ALPHABET) or not ROW_MIN <= row <= ROW_MAX:
            raise ValueError("tile off the board")


def add_to_gallery(code, issue, path=GALLERY):
    """Append the board to the gallery file. Returns False if it is already there."""
    gallery = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    boards = gallery.setdefault("boards", [])
    if any(board.get("code") == code for board in boards):
        return False
    boards.append(
        {
            "code": code,
            "issue": issue,
            "addedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    )
    path.write_text(json.dumps(gallery, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def main():
    if len(sys.argv) > 1:
        # By hand: a share link, or just its code.
        code = find_code("board:" + sys.argv[1].strip().rpartition("#b=")[2])
    else:
        code = find_code(os.environ.get("ISSUE_BODY"))
    issue = int(os.environ.get("ISSUE_NUMBER") or 0)

    result, message = "invalid", "Jeg kunne ikke finde en gyldig tavle i teksten. Prøv at sende den fra siden igen."
    if code:
        try:
            check_code(code)
        except ValueError as error:
            print(f"Rejected: {error}", file=sys.stderr)
        else:
            if add_to_gallery(code, issue):
                result, message = "added", "Tak! Tavlen er med i galleriet om et par minutter."
            else:
                result, message = "duplicate", "Den tavle er allerede i galleriet."

    print(f"{result}: {message}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as file:
            file.write(f"result={result}\nmessage={message}\n")


if __name__ == "__main__":
    main()
