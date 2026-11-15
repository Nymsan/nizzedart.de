# nizzedart.de
Fjol og sjov og ballade

A letter board. You get the letters of the previous message and rearrange them
into a new one; the letters you did not use end up in a pile at the bottom.
Your message then becomes the board the next person builds on.

## Running it

The site is static files with no build step, but it uses ES modules, so it has
to be served rather than opened from disk:

    python3 -m http.server

Then open http://localhost:8000/.

## Sharing

- **Links.** A saved board is packed into a short code in the address
  (`#b=...`, format described in `js/codec.js`). Whoever opens the link gets the
  board and can build on it.
- **Gallery.** `data/boards.json` lists the codes of the boards everyone sees,
  so the repository is the database. To add a board by hand, run
  `python3 scripts/add_board.py "<share link>"`, then commit and push.
  "Send til galleriet" on the site opens a GitHub issue with the code filled
  in; the same script can add those automatically from a GitHub Actions
  workflow, which is not in the repository yet.

## Layout

    index.html, styles.css
    js/glyphs.js      the board's size and its letters
    js/board.js       the rules: where letters fit, reading a board, the pile
    js/codec.js       board <-> share code
    js/editor.js      cursor, typing, moving letters; the supply of letters
    js/board-view.js  drawing a board, taps and drags
    js/workspace.js   the two big boards, the tray, the keyboard
    js/library.js     saved boards (localStorage) and the gallery
    js/legacy.js      carries over boards saved by the first version
    js/main.js        wiring

## Tests

    python3 -m unittest discover tests     # the gallery script
    open http://localhost:8000/tests.html  # everything else, in the browser
