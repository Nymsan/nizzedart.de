(function () {
  const LEFT_BOARD_ID = "leftBoard";
  const RIGHT_BOARD_ID = "rightBoard";
  const HISTORY_ID = "historyList";
  const CLEAR_ID = "clearButton";
  const SAVE_ID = "saveButton";
  const RESTART_ID = "restartButton";
  const EDIT_SOURCE_ID = "editSourceButton";
  const CANCEL_EDIT_ID = "cancelEditButton";
  const ACCEPT_EDIT_ID = "acceptEditButton";
  const LEFT_PANEL_ID = "leftPanelCard";
  const MOBILE_CAPTURE_ID = "mobileKeyCapture";
  const WRITER_DIALOG_ID = "writerNameDialog";
  const WRITER_INPUT_ID = "writerNameInput";
  const WRITER_CANCEL_ID = "writerCancelButton";
  const WRITER_SAVE_ID = "writerSaveButton";

  const STORAGE_KEY = "letterboard.v6";
  const LEGACY_STORAGE_KEYS = ["letterboard.v5", "letterboard.v4", "letterboard.v3", "letterboard.v2", "letterboard.v1"];
  const ACTIVE_MODE_ORIGINAL = "original";
  const ACTIVE_MODE_HISTORY = "history";

  const KERNING_PAIR_GAP = {
    AV: -2,
    VA: -2,
    TA: -1,
    AT: -1,
    MA: 2,
    AM: 2,
    WW: 15,
    MW: 2,
    WM: 2,
    "<>": 2,
    "><": 2,
    "<<": 1,
    ">>": 1
  };

  const TOKEN_WIDTH_ADJUST = {
    I: -24,
    L: -5,
    "1": -6,
    M: 3,
    W: 8,
    "@": 2
  };

  const SMALL_TOKEN_CONFIG = {
    "*": { width: 12, collisionWidth: 8, trailingGap: 1 },
    "'": { width: 9, collisionWidth: 3, trailingGap: 0 },
    "<": { width: 12, collisionWidth: 8, trailingGap: 1 },
    ">": { width: 12, collisionWidth: 8, trailingGap: 1 }
  };

  const GROOVE_STEP = 20;
  const TILE_HEIGHT = GROOVE_STEP * 2.35;
  const LETTER_BASE_WIDTH = 30;
  const RIGHT_START_X = 16;
  const RIGHT_GAP = 6;
  const WORD_GAP = 22;
  const MIN_X_GAP = 6;
  const MIN_Y_GAP = 0;
  const MIN_X_GAP_COMPACT = 1;
  const MIN_X_GAP_COMPACT_PAIR = 0;
  const SCATTER_PREFERRED_ENTER_GAP = 2;
  const SCATTER_FALLBACK_ENTER_GAP = 1;

  const LEFT_MARGIN_X = 16;
  const LEFT_TOP_GROOVE = 2;
  const RIGHT_TOP_GROOVE = 2;

  const ORIGINAL_ID = "original-root";
  const ORIGINAL_TITLE = "LEBBE SALLE SIGER NEJ TIL EL I MARTS";
  const ORIGINAL_ORIGIN_LABEL = "LEBBE SALLE";

  const DEFAULT_TEXT = [
    "   LEBBE SALLE",
    "   SIGER NEJ TIL",
    "   EL I MARTS",
    "",
    "   DR ANDREAZZ*",
    "   DEN ED <",
    "   699     @ <"
  ].join("\n");

  const DEFAULT_LINE_GROOVES = [
    LEFT_TOP_GROOVE,
    LEFT_TOP_GROOVE + 5,
    LEFT_TOP_GROOVE + 10,
    LEFT_TOP_GROOVE + 13,
    LEFT_TOP_GROOVE + 18,
    LEFT_TOP_GROOVE + 21,
    LEFT_TOP_GROOVE + 24
  ];

  const state = {
    leftTiles: [],
    rightTiles: [],
    history: [],
    activeSourceId: ORIGINAL_ID,
    activeMode: ACTIVE_MODE_ORIGINAL,
    editMode: false,
    dragging: null,
    rightCursor: {
      x: RIGHT_START_X,
      groove: RIGHT_TOP_GROOVE
    },
    leftCursor: {
      x: LEFT_MARGIN_X,
      groove: LEFT_TOP_GROOVE
    },
    rightCursorStack: [],
    leftCursorStack: [],
    preEditSnapshot: null,
    lastWriterName: "",
    deletePromptId: null,
    undoDelete: null,
    deletePromptTimerId: null
  };

  const els = {
    leftPanelCard: document.getElementById(LEFT_PANEL_ID),
    leftBoard: document.getElementById(LEFT_BOARD_ID),
    rightBoard: document.getElementById(RIGHT_BOARD_ID),
    historyList: document.getElementById(HISTORY_ID),
    clearButton: document.getElementById(CLEAR_ID),
    saveButton: document.getElementById(SAVE_ID),
    restartButton: document.getElementById(RESTART_ID),
    editSourceButton: document.getElementById(EDIT_SOURCE_ID),
    cancelEditButton: document.getElementById(CANCEL_EDIT_ID),
    acceptEditButton: document.getElementById(ACCEPT_EDIT_ID),
    mobileCapture: document.getElementById(MOBILE_CAPTURE_ID),
    writerDialog: document.getElementById(WRITER_DIALOG_ID),
    writerNameInput: document.getElementById(WRITER_INPUT_ID),
    writerCancelButton: document.getElementById(WRITER_CANCEL_ID),
    writerSaveButton: document.getElementById(WRITER_SAVE_ID)
  };

  const arrowOffsets = {
    left: -10.0,
    right: -10.0
  };

  const ROTATION_OFFSET_ADJUST = {
    D: { y: -0.6 }
  };

  const rotationOffsetCache = Object.create(null);
  let measureCtx = null;

  init();

  function init() {
    const stored = loadStorage();
    if (stored) {
      state.history = migrateHistory(stored.history || []);
      state.activeMode = stored.activeMode === ACTIVE_MODE_HISTORY ? ACTIVE_MODE_HISTORY : ACTIVE_MODE_ORIGINAL;
      state.activeSourceId = typeof stored.activeSourceId === "string" ? stored.activeSourceId : ORIGINAL_ID;
      state.lastWriterName = typeof stored.lastWriterName === "string" ? stored.lastWriterName : "";
    }

    ensureOriginalPinned();
    applyActiveSourceFromStorage();
    bindEvents();
    updateEditModeUI();

    if (els.historyList && els.leftBoard) {
      els.historyList.style.setProperty("--preview-ar", boardAspectRatio(els.leftBoard).toFixed(4));
    }

    renderAll();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        clearRotationOffsetCache();
        renderBoards();
      });
    }
  }

  function bindEvents() {
    window.addEventListener("keydown", onKeyDown);

    els.clearButton.addEventListener("click", onClear);
    els.saveButton.addEventListener("click", onSaveFromRightBoard);
    els.restartButton.addEventListener("click", onRestart);

    els.editSourceButton.addEventListener("click", onToggleEditMode);
    els.cancelEditButton.addEventListener("click", onCancelEdit);
    els.acceptEditButton.addEventListener("click", onAcceptEdit);

    els.leftBoard.addEventListener("pointerdown", onLeftBoardPointerDown);
    els.rightBoard.addEventListener("pointerdown", onRightBoardPointerDown);
    els.leftBoard.addEventListener("pointerdown", onLeftBoardActivateMobileKeyboard);

    els.mobileCapture.addEventListener("input", onMobileCaptureInput);
    els.mobileCapture.addEventListener("keydown", onMobileCaptureKeyDown);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", onResize);
  }

  function onResize() {
    enforceRightBoundsForAll();
    if (state.editMode) {
      enforceLeftBoundsForAll();
    }

    if (els.historyList && els.leftBoard) {
      els.historyList.style.setProperty("--preview-ar", boardAspectRatio(els.leftBoard).toFixed(4));
    }

    renderBoards();
    renderHistory();
  }

  function onToggleEditMode() {
    if (state.editMode) {
      return;
    }

    state.editMode = true;
    state.preEditSnapshot = snapshotLeftBoard();
    updateEditModeUI();
    recomputeLeftCursorFromLayout();
    if (els.leftBoard) {
      els.leftBoard.focus();
    }
    renderBoards();
  }

  function onCancelEdit() {
    if (!state.editMode) {
      return;
    }

    if (state.preEditSnapshot) {
      restoreLeftBoardSnapshot(state.preEditSnapshot);
    }

    state.editMode = false;
    state.preEditSnapshot = null;
    updateEditModeUI();
    recomputeRightCursorFromLayout();
    renderBoards();
  }

  function onAcceptEdit() {
    if (!state.editMode) {
      return;
    }

    const snapshot = snapshotFromLeftBoard();
    createAndActivateHistoryEntry(snapshot, {
      branchRoot: true
    });
    clearDeletePrompt();
    state.editMode = false;
    state.preEditSnapshot = null;
    updateEditModeUI();
    renderAll();
  }

  function updateEditModeUI() {
    if (els.leftPanelCard) {
      els.leftPanelCard.classList.toggle("is-editing", state.editMode);
    }

    if (state.editMode) {
      els.editSourceButton.hidden = true;
      els.cancelEditButton.hidden = false;
      els.acceptEditButton.hidden = false;
    } else {
      els.editSourceButton.hidden = false;
      els.cancelEditButton.hidden = true;
      els.acceptEditButton.hidden = true;
    }
  }

  function onMobileCaptureInput(event) {
    if (!state.editMode) {
      event.target.value = "";
      return;
    }

    const value = event.target.value || "";
    if (!value) {
      return;
    }

    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === " ") {
        pushLeftCursorStep();
        state.leftCursor.x += WORD_GAP;
        ensureCursorFits(state.leftCursor, LETTER_BASE_WIDTH, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);
        continue;
      }

      const upper = ch.toUpperCase();
      if (/^[A-ZÆØÅ0-9@*<>']$/.test(upper)) {
        addTokenToLeftByKeyboard(upper, false);
      }
    }

    event.target.value = "";
  }

  function onMobileCaptureKeyDown(event) {
    if (!state.editMode) {
      return;
    }

    if (isCursorMoveKey(event.key)) {
      event.preventDefault();
      moveCursorByArrow(state.leftCursor, event.key, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);
      renderLeftBoard();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      pushLeftCursorStep();
      moveCursorToNextLine(state.leftCursor, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);
      renderLeftBoard();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      backspaceLeftEdit();
    }
  }

  function onLeftBoardActivateMobileKeyboard() {
    if (!state.editMode) {
      return;
    }
    if (!els.mobileCapture) {
      return;
    }
    els.leftBoard.focus();
    els.mobileCapture.focus();
  }

  function onKeyDown(event) {
    if (event.target instanceof HTMLElement) {
      const tag = event.target.tagName;
      const isInputLike = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      const isButton = tag === "BUTTON";

      if (isInputLike) {
        return;
      }

      if (isButton && !state.editMode) {
        return;
      }
    }

    if (state.editMode) {
      handleLeftEditKey(event);
      return;
    }

    handleRightComposeKey(event);
  }

  function handleRightComposeKey(event) {
    if (isCursorMoveKey(event.key)) {
      event.preventDefault();
      moveCursorByArrow(state.rightCursor, event.key, els.rightBoard, RIGHT_TOP_GROOVE, RIGHT_START_X);
      renderRightBoard();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      backspaceRightSpatial();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      pushRightCursorStep();
      moveCursorToNextLine(state.rightCursor, els.rightBoard, RIGHT_TOP_GROOVE, RIGHT_START_X);
      renderRightBoard();
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      pushRightCursorStep();
      state.rightCursor.x += WORD_GAP;
      ensureCursorFits(state.rightCursor, LETTER_BASE_WIDTH, els.rightBoard, RIGHT_TOP_GROOVE, RIGHT_START_X);
      renderRightBoard();
      return;
    }

    const token = keyToToken(event);
    if (!token) {
      return;
    }

    const rotate180 = event.ctrlKey && (/^[A-ZÆØÅ0-9]$/.test(token) || token === "<" || token === ">");
    const placed = placeTokenFromLeft(token, rotate180);
    if (placed) {
      event.preventDefault();
    }
  }

  function handleLeftEditKey(event) {
    if (isCursorMoveKey(event.key)) {
      event.preventDefault();
      moveCursorByArrow(state.leftCursor, event.key, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);
      renderLeftBoard();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      backspaceLeftEdit();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      pushLeftCursorStep();
      moveCursorToNextLine(state.leftCursor, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);
      renderLeftBoard();
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      pushLeftCursorStep();
      state.leftCursor.x += WORD_GAP;
      ensureCursorFits(state.leftCursor, LETTER_BASE_WIDTH, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);
      renderLeftBoard();
      return;
    }

    const token = keyToToken(event);
    if (!token) {
      return;
    }

    const rotate180 = event.ctrlKey && (/^[A-ZÆØÅ0-9]$/.test(token) || token === "<" || token === ">");
    const placed = addTokenToLeftByKeyboard(token, rotate180);
    if (placed) {
      event.preventDefault();
    }
  }

  function keyToToken(event) {
    if (event.key.length !== 1) {
      return null;
    }

    const raw = event.key.toUpperCase();
    if (/^[A-ZÆØÅ0-9@*<>']$/.test(raw)) {
      return raw;
    }

    return null;
  }

  function isCursorMoveKey(key) {
    return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
  }

  function moveCursorByArrow(cursor, key, boardEl, topGroove, startX) {
    const boardWidth = Math.max(220, boardEl.clientWidth || 0);
    const boardHeight = Math.max(220, boardEl.clientHeight || 0);
    const maxX = Math.max(startX, boardWidth - LETTER_BASE_WIDTH - 10);
    const maxGroove = Math.max(topGroove, Math.floor((boardHeight - TILE_HEIGHT / 2) / GROOVE_STEP));

    if (key === "ArrowLeft") {
      cursor.x = Math.max(startX, cursor.x - unitStep());
      return;
    }

    if (key === "ArrowRight") {
      cursor.x = Math.min(maxX, cursor.x + unitStep());
      return;
    }

    if (key === "ArrowUp") {
      cursor.groove = Math.max(topGroove, cursor.groove - 3);
      return;
    }

    if (key === "ArrowDown") {
      cursor.groove = Math.min(maxGroove, cursor.groove + 3);
    }
  }

  function pushRightCursorStep() {
    state.rightCursorStack.push({ x: state.rightCursor.x, groove: state.rightCursor.groove });
  }

  function pushLeftCursorStep() {
    state.leftCursorStack.push({ x: state.leftCursor.x, groove: state.leftCursor.groove });
  }

  function backspaceRightSpatial() {
    const target = findBackspaceTargetBeforeCursor(state.rightTiles, state.rightCursor, function () {
      return true;
    });
    if (target) {
      const idx = state.rightTiles.findIndex(function (tile) {
        return tile.id === target.id;
      });
      if (idx !== -1) {
        state.rightTiles.splice(idx, 1);
      }

      const source = state.leftTiles.find(function (tile) {
        return tile.id === target.sourceId;
      });
      if (source) {
        source.used = false;
      }

      state.rightCursor.groove = approximateGroove(target.y);
      state.rightCursor.x = target.x;
      renderBoards();
      return;
    }

    const prev = state.rightCursorStack.pop();
    if (prev) {
      state.rightCursor.x = prev.x;
      state.rightCursor.groove = prev.groove;
      renderRightBoard();
    }
  }

  function backspaceLeftEdit() {
    const target = findBackspaceTargetBeforeCursor(state.leftTiles, state.leftCursor, function (tile) {
      return !tile.used;
    });
    if (target) {
      const idx = state.leftTiles.findIndex(function (tile) {
        return tile.id === target.id;
      });
      if (idx !== -1) {
        state.leftTiles.splice(idx, 1);
      }

      state.leftCursor.groove = approximateGroove(target.y);
      state.leftCursor.x = target.x;
      normalizeLeftSourceOrder();
      renderLeftBoard();
      return;
    }

    const prev = state.leftCursorStack.pop();
    if (prev) {
      state.leftCursor.x = prev.x;
      state.leftCursor.groove = prev.groove;
      renderLeftBoard();
    }
  }

  function findBackspaceTargetBeforeCursor(tiles, cursor, filterFn) {
    const eligible = tiles.filter(function (tile) {
      return filterFn(tile);
    });

    if (!eligible.length) {
      return null;
    }

    let best = null;
    for (let i = 0; i < eligible.length; i += 1) {
      const tile = eligible[i];
      const tileGroove = approximateGroove(tile.y);
      const tileEndX = tile.x + tile.width;

      if (tileGroove > cursor.groove) {
        continue;
      }

      if (tileGroove === cursor.groove && tileEndX > cursor.x + 0.5) {
        continue;
      }

      if (!best) {
        best = tile;
        continue;
      }

      const bestGroove = approximateGroove(best.y);
      if (tileGroove > bestGroove) {
        best = tile;
        continue;
      }

      if (tileGroove === bestGroove) {
        if (tile.x > best.x) {
          best = tile;
          continue;
        }
        if (tile.x === best.x && (tile.placedAt || 0) > (best.placedAt || 0)) {
          best = tile;
        }
      }
    }

    return best;
  }

  function onLeftBoardPointerDown(event) {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }

    const target = rawTarget.closest(".board-letter");
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tileId = target.dataset.tileId;
    if (!tileId) {
      return;
    }

    const tile = state.leftTiles.find(function (item) {
      return item.id === tileId;
    });
    if (!tile) {
      return;
    }

    event.preventDefault();

    if (state.editMode && els.leftBoard) {
      els.leftBoard.focus();
    }

    if (state.editMode) {
      const rect = els.leftBoard.getBoundingClientRect();
      state.dragging = {
        kind: "left-move",
        pointerId: event.pointerId,
        tileId: tile.id,
        offsetX: event.clientX - rect.left - tile.x,
        offsetY: event.clientY - rect.top - tile.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false
      };
      return;
    }

    if (tile.used) {
      return;
    }

    state.dragging = {
      kind: "left-pick",
      pointerId: event.pointerId,
      tileId: tile.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      ctrlOnStart: event.ctrlKey,
      proxyEl: createDragProxy(tile, event.clientX, event.clientY)
    };
  }

  function onRightBoardPointerDown(event) {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) {
      return;
    }

    const target = rawTarget.closest(".is-right");
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tileId = target.dataset.tileId;
    if (!tileId) {
      return;
    }

    const tile = state.rightTiles.find(function (item) {
      return item.id === tileId;
    });
    if (!tile) {
      return;
    }

    event.preventDefault();

    const rect = els.rightBoard.getBoundingClientRect();
    state.dragging = {
      kind: "right-move",
      pointerId: event.pointerId,
      tileId: tile.id,
      offsetX: event.clientX - rect.left - tile.x,
      offsetY: event.clientY - rect.top - tile.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false
    };
  }

  function onPointerMove(event) {
    if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
      return;
    }

    if (state.dragging.kind === "left-pick") {
      const drag = state.dragging;
      const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
      if (distance > 4) {
        drag.moved = true;
      }
      moveDragProxy(drag.proxyEl, event.clientX, event.clientY);
      return;
    }

    if (state.dragging.kind === "right-move") {
      const drag = state.dragging;
      const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
      if (distance <= 3) {
        return;
      }

      drag.moved = true;
      moveTileOnBoardDrag(event, state.rightTiles, els.rightBoard, drag.tileId, drag.offsetX, drag.offsetY);
      renderRightBoard();
      return;
    }

    if (state.dragging.kind === "left-move") {
      const drag = state.dragging;
      const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
      if (distance <= 3) {
        return;
      }

      drag.moved = true;
      moveTileOnBoardDrag(event, state.leftTiles, els.leftBoard, drag.tileId, drag.offsetX, drag.offsetY);
      renderLeftBoard();
    }
  }

  function onPointerUp(event) {
    if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
      return;
    }

    const drag = state.dragging;
    state.dragging = null;

    if (drag.kind === "left-pick") {
      removeDragProxy(drag.proxyEl);

      const sourceTile = state.leftTiles.find(function (item) {
        return item.id === drag.tileId;
      });
      if (!sourceTile || sourceTile.used) {
        return;
      }

      const rotate180 = drag.ctrlOnStart || event.ctrlKey;
      const droppedOnRight = isPointInsideElement(els.rightBoard, event.clientX, event.clientY);

      if (drag.moved && droppedOnRight) {
        placeSpecificSourceTile(sourceTile, {
          mode: "drop",
          clientX: event.clientX,
          clientY: event.clientY,
          rotate180
        });
      } else if (!drag.moved) {
        placeSpecificSourceTile(sourceTile, {
          mode: "logical",
          rotate180
        });
      }
      return;
    }

    if (drag.kind === "right-move") {
      if (isPointInsideElement(els.leftBoard, event.clientX, event.clientY)) {
        returnRightTileToLeft(drag.tileId, event.clientX, event.clientY);
      } else if (drag.moved) {
        renderBoards();
      }
      return;
    }

    if (drag.kind === "left-move") {
      if (drag.moved) {
        normalizeLeftSourceOrder();
        renderLeftBoard();
      }
    }
  }

  function moveTileOnBoardDrag(event, tiles, boardEl, tileId, offsetX, offsetY) {
    const tile = tiles.find(function (item) {
      return item.id === tileId;
    });
    if (!tile) {
      return;
    }

    const rect = boardEl.getBoundingClientRect();
    const boardWidth = Math.max(220, rect.width);

    const rawX = event.clientX - rect.left - offsetX;
    const rawTop = event.clientY - rect.top - offsetY;

    const groove = nearestGrooveFromTop(rawTop);
    const y = grooveToTop(groove);

    const maxX = Math.max(0, boardWidth - tile.width);
    const desiredX = clamp(rawX, 0, maxX);
    const freeX = findNearestFreeXOnBoard(desiredX, y, tile.width, tiles, boardWidth, tile.id, tile.token || "");
    if (freeX === null) {
      return;
    }

    tile.x = freeX;
    tile.y = y;
  }

  function returnRightTileToLeft(rightTileId, clientX, clientY) {
    const index = state.rightTiles.findIndex(function (tile) {
      return tile.id === rightTileId;
    });
    if (index === -1) {
      return;
    }

    const rightTile = state.rightTiles[index];
    state.rightTiles.splice(index, 1);

    let sourceTile = state.leftTiles.find(function (tile) {
      return tile.id === rightTile.sourceId;
    });

    if (!sourceTile) {
      sourceTile = {
        id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
        token: rightTile.token,
        x: LEFT_MARGIN_X,
        y: grooveToTop(LEFT_TOP_GROOVE),
        width: tokenWidth(rightTile.token),
        rotation: rightTile.rotation,
        used: false,
        sourceOrder: state.leftTiles.length,
        placedAt: Date.now()
      };
      state.leftTiles.push(sourceTile);
    }

    sourceTile.used = false;
    sourceTile.rotation = rightTile.rotation;

    const slot = findDropSlotOnBoard({
      boardEl: els.leftBoard,
      tiles: state.leftTiles,
      width: sourceTile.width,
      token: sourceTile.token,
      clientX,
      clientY,
      ignoreId: sourceTile.id
    });

    if (slot) {
      sourceTile.x = slot.x;
      sourceTile.y = grooveToTop(slot.groove);
    }

    normalizeLeftSourceOrder();
    renderBoards();
  }

  function createDragProxy(tile, clientX, clientY) {
    const node = document.createElement("div");
    node.className = "board-letter drag-proxy";
    const proxyToken = tokenForRender(tile.token, tile.rotation || 0);
    if (isArrowToken(proxyToken)) {
      node.classList.add("token-arrow");
    }

    const glyph = document.createElement("span");
    glyph.className = "letter-glyph";
    glyph.textContent = displayToken(proxyToken);
    node.appendChild(glyph);

    node.style.width = `${tile.width}px`;
    node.style.height = `${TILE_HEIGHT}px`;

    document.body.appendChild(node);
    moveDragProxy(node, clientX, clientY);
    return node;
  }

  function moveDragProxy(proxyEl, clientX, clientY) {
    if (!proxyEl) {
      return;
    }
    proxyEl.style.left = `${clientX}px`;
    proxyEl.style.top = `${clientY}px`;
  }

  function removeDragProxy(proxyEl) {
    if (proxyEl && proxyEl.parentNode) {
      proxyEl.parentNode.removeChild(proxyEl);
    }
  }

  function placeTokenFromLeft(token, rotate180) {
    const sourceTile = nextAvailableSourceTile(token);
    if (!sourceTile) {
      return false;
    }

    return placeSpecificSourceTile(sourceTile, {
      mode: "logical",
      rotate180
    });
  }

  function placeSpecificSourceTile(sourceTile, options) {
    if (!sourceTile || sourceTile.used) {
      return false;
    }

    const width = tokenWidth(sourceTile.token);
    let slot = null;

    if (options.mode === "drop") {
      slot = findDropSlotOnBoard({
        boardEl: els.rightBoard,
        tiles: state.rightTiles,
        width,
        token: sourceTile.token,
        clientX: options.clientX,
        clientY: options.clientY,
        ignoreId: null
      });
    } else {
      ensureCursorFits(state.rightCursor, width, els.rightBoard, RIGHT_TOP_GROOVE, RIGHT_START_X);
      slot = findTypingSlotOnBoard({
        boardEl: els.rightBoard,
        tiles: state.rightTiles,
        cursor: state.rightCursor,
        width,
        token: sourceTile.token,
        topGroove: RIGHT_TOP_GROOVE,
        startX: RIGHT_START_X
      });
    }

    if (!slot) {
      return false;
    }

    sourceTile.used = true;

    const rightTile = {
      id: `R_${sourceTile.id}_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      sourceId: sourceTile.id,
      token: sourceTile.token,
      width,
      x: slot.x,
      y: grooveToTop(slot.groove),
      rotation: options.rotate180 ? 180 : 0,
      placedAt: Date.now()
    };

    state.rightTiles.push(rightTile);

    if (options.mode === "logical") {
      state.rightCursor.groove = slot.groove;
      state.rightCursor.x = rightTile.x + rightTile.width + trailingGapForToken(rightTile.token);
      ensureCursorFits(state.rightCursor, LETTER_BASE_WIDTH, els.rightBoard, RIGHT_TOP_GROOVE, RIGHT_START_X);
    }

    renderBoards();
    return true;
  }

  function addTokenToLeftByKeyboard(token, rotate180) {
    const width = tokenWidth(token);
    ensureCursorFits(state.leftCursor, width, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);

    const slot = findTypingSlotOnBoard({
      boardEl: els.leftBoard,
      tiles: state.leftTiles,
      cursor: state.leftCursor,
      width,
      token,
      topGroove: LEFT_TOP_GROOVE,
      startX: LEFT_MARGIN_X
    });

    if (!slot) {
      return false;
    }

    const tile = {
      id: `U_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      token,
      x: slot.x,
      y: grooveToTop(slot.groove),
      width,
      rotation: rotate180 ? 180 : 0,
      used: false,
      sourceOrder: state.leftTiles.length,
      placedAt: Date.now()
    };

    state.leftTiles.push(tile);
    normalizeLeftSourceOrder();

    state.leftCursor.groove = slot.groove;
    state.leftCursor.x = tile.x + tile.width + trailingGapForToken(tile.token);
    ensureCursorFits(state.leftCursor, LETTER_BASE_WIDTH, els.leftBoard, LEFT_TOP_GROOVE, LEFT_MARGIN_X);

    renderLeftBoard();
    return true;
  }

  function findTypingSlotOnBoard(options) {
    const grooves = typingGroovesForBoard(options.boardEl, options.topGroove);
    if (!grooves.length) {
      return null;
    }

    const currentIndex = grooves.includes(options.cursor.groove)
      ? grooves.indexOf(options.cursor.groove)
      : 0;

    const boardRect = options.boardEl.getBoundingClientRect();
    const boardWidth = Math.max(220, boardRect.width);

    for (let offset = 0; offset < grooves.length; offset += 1) {
      const groove = grooves[(currentIndex + offset) % grooves.length];
      const y = grooveToTop(groove);
      const startX = offset === 0 ? options.cursor.x : options.startX;

      const x = findForwardFreeXOnBoard(startX, y, options.width, options.tiles, boardWidth, null, options.token || "");
      if (x !== null) {
        return { x, groove };
      }
    }

    return null;
  }

  function findDropSlotOnBoard(options) {
    if (!isPointInsideElement(options.boardEl, options.clientX, options.clientY)) {
      return null;
    }

    const boardRect = options.boardEl.getBoundingClientRect();
    const boardWidth = Math.max(220, boardRect.width);

    const rawTop = options.clientY - boardRect.top - TILE_HEIGHT / 2;
    const groove = nearestGrooveFromTop(rawTop);
    const y = grooveToTop(groove);

    const maxX = Math.max(0, boardWidth - options.width);
    const desiredX = clamp(options.clientX - boardRect.left - options.width / 2, 0, maxX);
    const x = findNearestFreeXOnBoard(
      desiredX,
      y,
      options.width,
      options.tiles,
      boardWidth,
      options.ignoreId || null,
      options.token || ""
    );

    if (x === null) {
      return null;
    }

    return { x, groove };
  }

  function findForwardFreeXOnBoard(startX, y, width, tiles, boardWidth, ignoreId, movingToken) {
    const maxX = Math.max(0, boardWidth - width);
    if (startX > maxX) {
      return null;
    }

    let x = clamp(startX, 0, maxX);
    let iterations = 0;
    const moving = movingToken || "";
    const movingInset = collisionInsetX(moving, width);

    while (x <= maxX && iterations < 500) {
      const rect = makeCollisionRect(x, y, width, TILE_HEIGHT, moving);
      const collision = firstCollision(rect, tiles, ignoreId, moving);
      if (!collision) {
        return x;
      }

      const pairGap = pairSpacing(moving, collision.tile.token || "");
      const minGapX = minXGapForTokens(moving, collision.tile.token || "");
      x = Math.max(x + 1, collision.rect.right + minGapX + pairGap - movingInset);
      iterations += 1;
    }

    return null;
  }

  function findNearestFreeXOnBoard(desiredX, y, width, tiles, boardWidth, ignoreId, movingToken) {
    const maxX = Math.max(0, boardWidth - width);
    const start = Math.round(clamp(desiredX, 0, maxX));

    for (let delta = 0; delta <= maxX + 2; delta += 1) {
      const left = start - delta;
      if (left >= 0 && isRectFreeOnBoard(left, y, width, tiles, ignoreId, movingToken || "")) {
        return left;
      }

      if (delta === 0) {
        continue;
      }

      const right = start + delta;
      if (right <= maxX && isRectFreeOnBoard(right, y, width, tiles, ignoreId, movingToken || "")) {
        return right;
      }
    }

    return null;
  }

  function isRectFreeOnBoard(x, y, width, tiles, ignoreId, movingToken) {
    const rect = makeCollisionRect(x, y, width, TILE_HEIGHT, movingToken || "");
    return !firstCollision(rect, tiles, ignoreId, movingToken || "");
  }

  function firstCollision(rect, tiles, ignoreId, movingToken) {
    const colliders = tiles
      .filter(function (tile) {
        return tile.id !== ignoreId;
      })
      .sort(function (a, b) {
        if (a.x !== b.x) {
          return a.x - b.x;
        }
        return a.y - b.y;
      });

    for (let i = 0; i < colliders.length; i += 1) {
      const tile = colliders[i];
      const tileRect = makeCollisionRect(tile.x, tile.y, tile.width, TILE_HEIGHT, tile.token || "");
      const minGapX = minXGapForTokens(movingToken || "", tile.token || "");
      if (rectanglesOverlap(rect, tileRect, minGapX)) {
        return {
          tile,
          rect: tileRect
        };
      }
    }

    return null;
  }

  function rectanglesOverlap(a, b, minGapX) {
    const gapX = Number.isFinite(minGapX) ? minGapX : MIN_X_GAP;

    if (a.right + gapX <= b.left) {
      return false;
    }
    if (a.left >= b.right + gapX) {
      return false;
    }
    if (a.bottom + MIN_Y_GAP <= b.top) {
      return false;
    }
    if (a.top >= b.bottom + MIN_Y_GAP) {
      return false;
    }
    return true;
  }

  function moveCursorToNextLine(cursor, boardEl, topGroove, startX) {
    const grooves = typingGroovesForBoard(boardEl, topGroove);
    if (!grooves.length) {
      return;
    }

    const idx = grooves.includes(cursor.groove) ? grooves.indexOf(cursor.groove) : 0;
    const nextIdx = (idx + 1) % grooves.length;
    cursor.groove = grooves[nextIdx];
    cursor.x = startX;
  }

  function typingGroovesForBoard(boardEl, topGroove) {
    const boardHeight = Math.max(220, boardEl.clientHeight || 0);
    const maxGroove = Math.max(topGroove, Math.floor((boardHeight - TILE_HEIGHT / 2) / GROOVE_STEP));
    const grooves = [];

    for (let groove = topGroove; groove <= maxGroove; groove += 3) {
      grooves.push(groove);
    }

    return grooves;
  }

  function snapToTypingGroove(groove, topGroove) {
    if (groove <= topGroove) {
      return topGroove;
    }

    const delta = groove - topGroove;
    return topGroove + Math.floor(delta / 3) * 3;
  }

  function randomTypingGroove(minGroove, maxGroove, topGroove) {
    const snappedMin = snapToTypingGroove(minGroove, topGroove);
    const snappedMax = snapToTypingGroove(maxGroove, topGroove);

    if (snappedMax <= snappedMin) {
      return snappedMin;
    }

    const count = Math.floor((snappedMax - snappedMin) / 3) + 1;
    const index = randomInt(0, Math.max(0, count - 1));
    return snappedMin + index * 3;
  }

  function ensureCursorFits(cursor, nextWidth, boardEl, topGroove, startX) {
    const boardWidth = Math.max(220, boardEl.clientWidth || 0);
    const maxStartX = Math.max(startX, boardWidth - nextWidth - 10);

    if (cursor.x > maxStartX) {
      cursor.x = startX;
      cursor.groove += 3;
    }

    const boardHeight = Math.max(220, boardEl.clientHeight || 0);
    const maxGroove = Math.max(topGroove, Math.floor((boardHeight - TILE_HEIGHT / 2) / GROOVE_STEP));
    if (cursor.groove > maxGroove) {
      cursor.groove = topGroove;
    }
  }

  function recomputeRightCursorFromLayout() {
    const grooves = typingGroovesForBoard(els.rightBoard, RIGHT_TOP_GROOVE);
    const boardWidth = Math.max(220, els.rightBoard.clientWidth || 0);

    for (let i = 0; i < grooves.length; i += 1) {
      const y = grooveToTop(grooves[i]);
      const x = findForwardFreeXOnBoard(RIGHT_START_X, y, LETTER_BASE_WIDTH, state.rightTiles, boardWidth, null);
      if (x !== null) {
        state.rightCursor.groove = grooves[i];
        state.rightCursor.x = x;
        return;
      }
    }

    state.rightCursor.groove = RIGHT_TOP_GROOVE;
    state.rightCursor.x = RIGHT_START_X;
  }

  function recomputeLeftCursorFromLayout() {
    const grooves = typingGroovesForBoard(els.leftBoard, LEFT_TOP_GROOVE);
    const boardWidth = Math.max(220, els.leftBoard.clientWidth || 0);

    for (let i = 0; i < grooves.length; i += 1) {
      const y = grooveToTop(grooves[i]);
      const x = findForwardFreeXOnBoard(LEFT_MARGIN_X, y, LETTER_BASE_WIDTH, state.leftTiles, boardWidth, null);
      if (x !== null) {
        state.leftCursor.groove = grooves[i];
        state.leftCursor.x = x;
        return;
      }
    }

    state.leftCursor.groove = LEFT_TOP_GROOVE;
    state.leftCursor.x = LEFT_MARGIN_X;
  }

  function enforceRightBoundsForAll() {
    const boardWidth = Math.max(220, els.rightBoard.clientWidth || 0);

    for (let i = 0; i < state.rightTiles.length; i += 1) {
      const tile = state.rightTiles[i];
      const maxX = Math.max(0, boardWidth - tile.width);
      const bounded = clamp(tile.x, 0, maxX);
      const freeX = findNearestFreeXOnBoard(bounded, tile.y, tile.width, state.rightTiles, boardWidth, tile.id, tile.token || "");
      if (freeX !== null) {
        tile.x = freeX;
      }
    }
  }

  function enforceLeftBoundsForAll() {
    const boardWidth = Math.max(220, els.leftBoard.clientWidth || 0);

    for (let i = 0; i < state.leftTiles.length; i += 1) {
      const tile = state.leftTiles[i];
      const maxX = Math.max(0, boardWidth - tile.width);
      const bounded = clamp(tile.x, 0, maxX);
      const freeX = findNearestFreeXOnBoard(bounded, tile.y, tile.width, state.leftTiles, boardWidth, tile.id, tile.token || "");
      if (freeX !== null) {
        tile.x = freeX;
      }
    }
  }

  function onClear() {
    state.rightTiles = [];
    state.rightCursorStack = [];
    state.rightCursor.x = RIGHT_START_X;
    state.rightCursor.groove = RIGHT_TOP_GROOVE;

    for (let i = 0; i < state.leftTiles.length; i += 1) {
      state.leftTiles[i].used = false;
    }

    renderBoards();
  }

  function onRestart() {
    state.activeMode = ACTIVE_MODE_ORIGINAL;
    state.activeSourceId = ORIGINAL_ID;
    applyOriginalAsSource();
    persistStorage();
    renderAll();
  }

  async function onSaveFromRightBoard() {
    const snapshot = createSnapshotWithRemainders();
    if (!snapshot.tiles.length) {
      return;
    }

    const writerName = await requestWriterName();
    if (!writerName) {
      return;
    }

    state.lastWriterName = writerName;

    createAndActivateHistoryEntry(snapshot, {
      branchRoot: false,
      writerName
    });
    renderAll();
  }

  function createAndActivateHistoryEntry(snapshot, options) {
    const opts = options || {};
    const parentId = opts.branchRoot ? null : (state.activeSourceId || ORIGINAL_ID);
    const writerName = normalizeWriterName(opts.writerName) || "Ukendt";

    const entry = {
      id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      title: generateSnapshotTitle(snapshot),
      parentId,
      writerName,
      snapshot
    };

    const withoutOriginal = state.history.filter(function (item) {
      return item.id !== ORIGINAL_ID;
    });

    state.history = [entry].concat(withoutOriginal);
    state.history = state.history.slice(0, 80);
    ensureOriginalPinned();

    state.activeMode = ACTIVE_MODE_HISTORY;
    state.activeSourceId = entry.id;

    applySourceFromEntry(entry);
    persistStorage();
  }

  function createSnapshotWithRemainders() {
    const boardWidth = Math.max(220, els.rightBoard.clientWidth || 0);
    const boardHeight = Math.max(220, els.rightBoard.clientHeight || 0);

    const placedTiles = state.rightTiles.map(function (tile, order) {
      return {
        token: tile.token,
        x: round2(tile.x),
        y: round2(tile.y),
        width: tile.width,
        rotation: tile.rotation,
        order
      };
    });

    const leftovers = state.leftTiles.filter(function (tile) {
      return !tile.used;
    });

    const scatterTiles = makeBottomScatterTiles(leftovers, placedTiles, boardWidth, boardHeight);
    const tiles = placedTiles.concat(scatterTiles);

    return {
      tiles,
      boardWidth,
      boardHeight
    };
  }

  function snapshotFromLeftBoard() {
    const boardWidth = Math.max(220, els.leftBoard.clientWidth || 0);
    const boardHeight = Math.max(220, els.leftBoard.clientHeight || 0);

    const sorted = state.leftTiles.slice().sort(compareReadingOrder);

    const tiles = sorted.map(function (tile, order) {
      return {
        token: tile.token,
        x: round2(tile.x),
        y: round2(tile.y),
        width: tile.width,
        rotation: tile.rotation || 0,
        order
      };
    });

    return {
      tiles,
      boardWidth,
      boardHeight
    };
  }

  function makeBottomScatterTiles(leftovers, placedTiles, boardWidth, boardHeight) {
    if (!leftovers.length) {
      return [];
    }

    const occupied = placedTiles.map(function (tile) {
      return makeRect(tile.x, tile.y, tile.width, TILE_HEIGHT);
    });

    const baseMinGroove = Math.max(RIGHT_TOP_GROOVE, snapToTypingGroove(Math.floor((boardHeight * 0.66) / GROOVE_STEP), RIGHT_TOP_GROOVE));
    const maxGrooveRaw = Math.max(baseMinGroove, Math.floor((boardHeight - TILE_HEIGHT / 2) / GROOVE_STEP));
    const maxGroove = Math.max(baseMinGroove, snapToTypingGroove(maxGrooveRaw, RIGHT_TOP_GROOVE));

    const lastPlacedGroove = placedTiles.length
      ? placedTiles.reduce(function (max, tile) {
        return Math.max(max, approximateGroove(tile.y));
      }, RIGHT_TOP_GROOVE)
      : RIGHT_TOP_GROOVE;

    const preferredGapGrooves = SCATTER_PREFERRED_ENTER_GAP * 3;
    const fallbackGapGrooves = SCATTER_FALLBACK_ENTER_GAP * 3;

    const preferredStart = snapToTypingGroove(lastPlacedGroove + preferredGapGrooves, RIGHT_TOP_GROOVE);
    const fallbackStart = snapToTypingGroove(lastPlacedGroove + fallbackGapGrooves, RIGHT_TOP_GROOVE);

    const preferredMinGroove = Math.max(baseMinGroove, preferredStart);
    const fallbackMinGroove = Math.max(baseMinGroove, fallbackStart);

    const canKeepPreferredGap = preferredMinGroove <= maxGroove;
    const canKeepFallbackGap = fallbackMinGroove <= maxGroove;

    const denseStartGroove = canKeepFallbackGap
      ? fallbackMinGroove
      : Math.max(baseMinGroove, maxGroove - fallbackGapGrooves);

    const attempts = [];
    if (canKeepPreferredGap) {
      attempts.push({ minGroove: preferredMinGroove, packTight: true });
    }
    if (canKeepFallbackGap) {
      attempts.push({ minGroove: fallbackMinGroove, packTight: true });
    }
    attempts.push({ minGroove: denseStartGroove, packTight: true });

    for (let i = 0; i < attempts.length; i += 1) {
      const attempt = attempts[i];
      const trial = placeScatterTiles(
        leftovers,
        occupied,
        boardWidth,
        attempt.minGroove,
        maxGroove,
        attempt.packTight,
        false,
        placedTiles.length
      );
      if (trial) {
        return trial;
      }
    }

    return placeScatterTiles(
      leftovers,
      occupied,
      boardWidth,
      denseStartGroove,
      maxGroove,
      true,
      true,
      placedTiles.length
    ) || [];
  }

  function placeScatterTiles(leftovers, occupiedSeed, boardWidth, minGroove, maxGroove, packTight, allowForcedPlacement, startOrder) {
    const occupied = occupiedSeed.slice();
    const scatter = [];

    for (let i = 0; i < leftovers.length; i += 1) {
      const source = leftovers[i];
      const width = tokenWidth(source.token);
      const rotation = Math.random() < 0.5 ? 0 : 180;
      const pos = findRandomBottomPosition(
        width,
        minGroove,
        maxGroove,
        boardWidth,
        occupied,
        packTight,
        allowForcedPlacement
      );

      if (!pos) {
        return null;
      }

      const tile = {
        token: source.token,
        x: round2(pos.x),
        y: round2(pos.y),
        width,
        rotation,
        order: startOrder + scatter.length
      };

      scatter.push(tile);
      occupied.push(makeRect(tile.x, tile.y, tile.width, TILE_HEIGHT));
    }

    return scatter;
  }

  function findRandomBottomPosition(width, minGroove, maxGroove, boardWidth, occupied, packTight, allowForcedPlacement) {
    const maxX = Math.max(0, boardWidth - width);

    for (let attempt = 0; attempt < 160; attempt += 1) {
      const groove = packTight
        ? randomInt(minGroove, maxGroove)
        : randomTypingGroove(minGroove, maxGroove, RIGHT_TOP_GROOVE);
      const y = grooveToTop(groove);
      const x = Math.random() * maxX;
      const rect = makeRect(x, y, width, TILE_HEIGHT);
      if (rectIsFreeAgainst(rect, occupied)) {
        return { x, y };
      }
    }

    for (let groove = minGroove; groove <= maxGroove; groove += packTight ? 1 : 3) {
      const y = grooveToTop(groove);
      for (let x = 0; x <= maxX; x += packTight ? 3 : 6) {
        const rect = makeRect(x, y, width, TILE_HEIGHT);
        if (rectIsFreeAgainst(rect, occupied)) {
          return { x, y };
        }
      }
    }

    if (!allowForcedPlacement) {
      return null;
    }

    return {
      x: Math.random() * maxX,
      y: grooveToTop(packTight
        ? randomInt(minGroove, maxGroove)
        : randomTypingGroove(minGroove, maxGroove, RIGHT_TOP_GROOVE))
    };
  }

  function rectIsFreeAgainst(rect, rects) {
    for (let i = 0; i < rects.length; i += 1) {
      if (rectanglesOverlap(rect, rects[i])) {
        return false;
      }
    }
    return true;
  }

  function onLoadHistorySource(entryId) {
    clearDeletePrompt();

    if (entryId === ORIGINAL_ID) {
      state.activeMode = ACTIVE_MODE_ORIGINAL;
      state.activeSourceId = ORIGINAL_ID;
      applyOriginalAsSource();
      persistStorage();
      renderAll();
      return;
    }

    const entry = state.history.find(function (item) {
      return item.id === entryId;
    });
    if (!entry) {
      return;
    }

    state.activeMode = ACTIVE_MODE_HISTORY;
    state.activeSourceId = entry.id;
    applySourceFromEntry(entry);
    persistStorage();
    renderAll();
  }

  function applyActiveSourceFromStorage() {
    if (state.activeSourceId === ORIGINAL_ID || state.activeMode === ACTIVE_MODE_ORIGINAL) {
      state.activeMode = ACTIVE_MODE_ORIGINAL;
      state.activeSourceId = ORIGINAL_ID;
      applyOriginalAsSource();
      return;
    }

    if (state.activeMode === ACTIVE_MODE_HISTORY && state.activeSourceId) {
      const entry = state.history.find(function (item) {
        return item.id === state.activeSourceId;
      });

      if (entry) {
        applySourceFromEntry(entry);
        return;
      }
    }

    state.activeMode = ACTIVE_MODE_ORIGINAL;
    state.activeSourceId = ORIGINAL_ID;
    applyOriginalAsSource();
  }

  function applyOriginalAsSource() {
    clearDeletePrompt();
    state.leftTiles = parseTextToTiles(DEFAULT_TEXT);
    state.rightTiles = [];
    state.rightCursorStack = [];
    state.leftCursorStack = [];
    state.rightCursor.x = RIGHT_START_X;
    state.rightCursor.groove = RIGHT_TOP_GROOVE;
    recomputeLeftCursorFromLayout();
  }

  function applySourceFromEntry(entry) {
    clearDeletePrompt();
    const sourceTiles = entry.snapshot.tiles.map(function (tile, index) {
      return {
        id: `S_${entry.id}_${index}`,
        token: tile.token,
        x: tile.x,
        y: tile.y,
        width: tile.width || tokenWidth(tile.token),
        rotation: tile.rotation || 0,
        used: false,
        sourceOrder: index,
        placedAt: index
      };
    });

    state.leftTiles = cloneTiles(sourceTiles);
    state.rightTiles = [];
    state.rightCursorStack = [];
    state.leftCursorStack = [];
    state.rightCursor.x = RIGHT_START_X;
    state.rightCursor.groove = RIGHT_TOP_GROOVE;
    recomputeLeftCursorFromLayout();
  }

  function snapshotLeftBoard() {
    return cloneTiles(state.leftTiles);
  }

  function restoreLeftBoardSnapshot(snapshot) {
    state.leftTiles = cloneTiles(snapshot || []);
    state.leftCursorStack = [];
    recomputeLeftCursorFromLayout();
  }

  function ensureOriginalPinned() {
    const existing = state.history.find(function (item) {
      return item.id === ORIGINAL_ID;
    });

    const originalEntry = existing || {
      id: ORIGINAL_ID,
      createdAt: new Date(0).toISOString(),
      title: ORIGINAL_TITLE,
      parentId: null,
      snapshot: snapshotFromText(DEFAULT_TEXT)
    };

    originalEntry.title = ORIGINAL_TITLE;
    originalEntry.parentId = null;
    originalEntry.snapshot = snapshotFromText(DEFAULT_TEXT);

    const withoutOriginal = state.history.filter(function (item) {
      return item.id !== ORIGINAL_ID;
    });

    state.history = withoutOriginal.concat([originalEntry]);
  }

  function snapshotFromText(text) {
    const tiles = parseTextToTiles(text).map(function (tile, index) {
      return {
        token: tile.token,
        x: tile.x,
        y: tile.y,
        width: tile.width,
        rotation: tile.rotation || 0,
        order: index
      };
    });

    return {
      tiles,
      boardWidth: 420,
      boardHeight: 520
    };
  }

  function migrateHistory(rawHistory) {
    const history = Array.isArray(rawHistory) ? rawHistory.slice() : [];

    for (let i = 0; i < history.length; i += 1) {
      const item = history[i];
      if (!item || typeof item !== "object") {
        continue;
      }
      if (!item.id) {
        item.id = `legacy_${Date.now()}_${i}`;
      }
      if (!item.createdAt) {
        item.createdAt = new Date().toISOString();
      }
      if (!item.snapshot || !Array.isArray(item.snapshot.tiles)) {
        item.snapshot = { tiles: [], boardWidth: 420, boardHeight: 520 };
      }
      if (!item.title) {
        item.title = generateSnapshotTitle(item.snapshot);
      }
      item.writerName = normalizeWriterName(item.writerName);
      if (item.parentId === undefined) {
        item.parentId = ORIGINAL_ID;
      }
    }

    return history;
  }

  function generateSnapshotTitle(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.tiles) || !snapshot.tiles.length) {
      return "Tom besked";
    }

    const lines = snapshotFirstLines(snapshot);
    if (!lines.length) {
      return "Tom besked";
    }

    const first = lines[0].trim();
    if (!first) {
      return "Tom besked";
    }

    return first.slice(0, 80);
  }

  function snapshotFirstLines(snapshot) {
    const rowsMap = new Map();

    const sorted = snapshot.tiles.slice().sort(function (a, b) {
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

    for (let i = 0; i < sorted.length; i += 1) {
      const tile = sorted[i];
      const row = Math.round((tile.y + TILE_HEIGHT / 2) / GROOVE_STEP / 3);
      if (!rowsMap.has(row)) {
        rowsMap.set(row, []);
      }
      rowsMap.get(row).push(tile);
    }

    const lines = [];
    const rows = Array.from(rowsMap.keys()).sort(function (a, b) {
      return a - b;
    });

    for (let r = 0; r < rows.length; r += 1) {
      const rowTiles = rowsMap.get(rows[r]).slice().sort(function (a, b) {
        return a.x - b.x;
      });
      lines.push(tilesToReadableLine(rowTiles));
    }

    return lines;
  }

  function tilesToReadableLine(tiles) {
    if (!tiles.length) {
      return "";
    }

    let line = displayToken(tokenForRender(tiles[0].token, tiles[0].rotation || 0));
    for (let i = 1; i < tiles.length; i += 1) {
      const prev = tiles[i - 1];
      const curr = tiles[i];
      const prevEnd = prev.x + (prev.width || tokenWidth(prev.token));
      const gap = curr.x - prevEnd;
      if (gap > WORD_GAP * 0.7) {
        line += " ";
      }
      line += displayToken(tokenForRender(curr.token, curr.rotation || 0));
    }

    return line;
  }

  function lineageLabel(entry) {
    if (!entry || entry.id === ORIGINAL_ID) {
      return ORIGINAL_ORIGIN_LABEL;
    }
    if (!entry.parentId) {
      return "Ny Start";
    }
    if (entry.parentId === ORIGINAL_ID) {
      return `Fra: ${ORIGINAL_ORIGIN_LABEL}`;
    }

    const parent = state.history.find(function (item) {
      return item.id === entry.parentId;
    });

    if (!parent) {
      return "Fra: Ukendt";
    }

    return `Fra: ${parent.title || formatDate(parent.createdAt)}`;
  }

  function entryWriterLabel(entry) {
    if (!entry || entry.id === ORIGINAL_ID) {
      return "Ophav: LEBBE SALLE";
    }
    return `Af: ${normalizeWriterName(entry.writerName) || "Ukendt"}`;
  }

  function lineageChain(entry) {
    if (!entry || entry.id === ORIGINAL_ID) {
      return ORIGINAL_TITLE;
    }

    const labels = [];
    const seen = new Set();
    let current = entry;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      labels.push(current.title || formatDate(current.createdAt));

      if (!current.parentId) {
        break;
      }

      if (current.parentId === ORIGINAL_ID) {
        labels.push(ORIGINAL_TITLE);
        break;
      }

      current = state.history.find(function (item) {
        return item.id === current.parentId;
      });
    }

    return labels.reverse().join(" -> ");
  }

  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }

      for (let i = 0; i < LEGACY_STORAGE_KEYS.length; i += 1) {
        const key = LEGACY_STORAGE_KEYS[i];
        const legacyRaw = localStorage.getItem(key);
        if (!legacyRaw) {
          continue;
        }

        const legacy = JSON.parse(legacyRaw);
        if (!legacy || typeof legacy !== "object") {
          continue;
        }

        const migrated = {
          history: migrateHistory(legacy.history || []),
          activeMode: legacy.activeMode === ACTIVE_MODE_HISTORY ? ACTIVE_MODE_HISTORY : ACTIVE_MODE_ORIGINAL,
          activeSourceId: typeof legacy.activeSourceId === "string" ? legacy.activeSourceId : ORIGINAL_ID,
          lastWriterName: normalizeWriterName(legacy.lastWriterName)
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function persistStorage() {
    ensureOriginalPinned();

    const payload = {
      history: state.history.slice(0, 120),
      activeMode: state.activeMode,
      activeSourceId: state.activeSourceId,
      lastWriterName: state.lastWriterName
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      return;
    }
  }

  function parseTextToTiles(text) {
    const lines = text.split(/\r?\n/);
    const tiles = [];
    let tileIndex = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const tokenized = tokenizeLine(line);
      const lineGroove = lineIndex < DEFAULT_LINE_GROOVES.length
        ? DEFAULT_LINE_GROOVES[lineIndex]
        : lineToGroove(lineIndex);
      let xCursor = LEFT_MARGIN_X;

      for (let i = 0; i < tokenized.tokens.length; i += 1) {
        const token = tokenized.tokens[i];
        if (token.type === "space") {
          xCursor += WORD_GAP;
          continue;
        }

        if (token.type !== "token") {
          continue;
        }

        const width = tokenWidth(token.value);

        tiles.push({
          id: `L${tileIndex}`,
          token: token.value,
          x: xCursor,
          y: grooveToTop(lineGroove),
          width,
          rotation: 0,
          used: false,
          sourceOrder: tileIndex,
          placedAt: tileIndex
        });

        xCursor += width + trailingGapForToken(token.value);
        tileIndex += 1;
      }
    }

    return tiles;
  }

  function tokenizeLine(line) {
    const tokens = [];
    let cursor = 0;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];
      if (ch === " ") {
        tokens.push({ type: "space", value: " ", unitStart: cursor });
        cursor += 1;
        i += 1;
        continue;
      }

      tokens.push({ type: "token", value: ch, unitStart: cursor });
      cursor += 2;
      i += 1;
    }

    return { tokens };
  }

  function normalizeLeftSourceOrder() {
    const sorted = state.leftTiles.slice().sort(compareReadingOrder);
    for (let i = 0; i < sorted.length; i += 1) {
      sorted[i].sourceOrder = i;
    }
  }

  function nextAvailableSourceTile(token) {
    const candidates = state.leftTiles.filter(function (tile) {
      return !tile.used && tile.token === token;
    });

    if (!candidates.length) {
      return null;
    }

    candidates.sort(compareReadingOrder);
    return candidates[0];
  }

  function compareReadingOrder(a, b) {
    const gA = approximateGroove(a.y);
    const gB = approximateGroove(b.y);

    if (gA !== gB) {
      return gA - gB;
    }
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    if (a.x !== b.x) {
      return a.x - b.x;
    }
    return a.sourceOrder - b.sourceOrder;
  }

  function renderAll() {
    renderBoards();
    renderHistory();
  }

  function renderBoards() {
    renderLeftBoard();
    renderRightBoard();
  }

  function renderLeftBoard() {
    clearElement(els.leftBoard);

    for (let i = 0; i < state.leftTiles.length; i += 1) {
      const tile = state.leftTiles[i];
      const node = createLetterNode(tile, "left");
      node.dataset.tileId = tile.id;
      if (state.editMode) {
        node.addEventListener("dblclick", function () {
          toggleRotation(tile.id);
        });
      }

      if (tile.used) {
        node.classList.add("is-used");
      }

      if (!tile.used || state.editMode) {
        node.classList.add("is-left-available");
      }

      els.leftBoard.appendChild(node);
    }

    if (state.editMode) {
      renderCursorMarker(els.leftBoard, state.leftCursor, LEFT_MARGIN_X, "left");
    }
  }

  function renderRightBoard() {
    clearElement(els.rightBoard);

    for (let i = 0; i < state.rightTiles.length; i += 1) {
      const tile = state.rightTiles[i];
      const node = createLetterNode(tile, "right");
      node.dataset.tileId = tile.id;
      node.addEventListener("dblclick", function () {
        toggleRotation(tile.id);
      });
      els.rightBoard.appendChild(node);
    }

    if (!state.editMode) {
      renderCursorMarker(els.rightBoard, state.rightCursor, RIGHT_START_X, "right");
    }
  }

  function renderCursorMarker(boardEl, cursor, startX, side) {
    const marker = document.createElement("div");
    marker.className = `cursor-marker cursor-${side}`;

    marker.style.left = `${Math.max(startX, cursor.x)}px`;
    marker.style.top = `${grooveToTop(cursor.groove) - (GROOVE_STEP * 0.1)}px`;
    boardEl.appendChild(marker);
  }

  function rotateArrowToken(token) {
    if (token === "<") {
      return ">";
    }
    if (token === ">") {
      return "<";
    }
    return token;
  }

  function renderHistory() {
    clearElement(els.historyList);

    if (!state.history.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "Ingen gemte beskeder endnu.";
      els.historyList.appendChild(empty);
      return;
    }

    for (let i = 0; i < state.history.length; i += 1) {
      const entry = state.history[i];
      const item = document.createElement("article");
      item.className = "history-item";

      if (entry.id === state.activeSourceId) {
        item.classList.add("active-source");
      }

      const chain = lineageChain(entry);
      item.title = chain;

      const meta = document.createElement("div");
      meta.className = "history-meta";

      const leftMeta = document.createElement("div");
      leftMeta.className = "history-meta-main";

      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = entry.id === ORIGINAL_ID ? ORIGINAL_TITLE : (entry.title || formatDate(entry.createdAt));
      leftMeta.appendChild(title);

      const origin = document.createElement("div");
      origin.className = "history-origin";
      origin.textContent = lineageLabel(entry);
      leftMeta.appendChild(origin);

      const writer = document.createElement("div");
      writer.className = "history-writer";
      writer.textContent = entryWriterLabel(entry);
      leftMeta.appendChild(writer);

      const time = document.createElement("div");
      time.className = "history-time";
      if (entry.id !== ORIGINAL_ID) {
        time.textContent = formatDate(entry.createdAt);
        leftMeta.appendChild(time);
      }

      meta.appendChild(leftMeta);

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "history-load-btn";
      loadButton.textContent = "Indlæs";
      loadButton.disabled = entry.id === state.activeSourceId;
      loadButton.addEventListener("click", function () {
        clearDeletePrompt();
        onLoadHistorySource(entry.id);
      });
      actions.appendChild(loadButton);

      if (entry.id !== ORIGINAL_ID) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "history-delete-btn";
        deleteButton.textContent = state.deletePromptId === entry.id ? "Er du sikker?" : "Slet";
        if (state.deletePromptId === entry.id) {
          deleteButton.classList.add("is-confirming");
        }
        deleteButton.addEventListener("click", function () {
          if (state.deletePromptId === entry.id) {
            confirmDeleteHistoryEntry(entry.id);
            return;
          }

          state.deletePromptId = entry.id;
          renderHistory();
          scheduleDeletePromptReset();
        });
        actions.appendChild(deleteButton);
      }

      if (state.undoDelete && state.undoDelete.deletedId === entry.id) {
        const undoButton = document.createElement("button");
        undoButton.type = "button";
        undoButton.className = "history-undo-btn";
        undoButton.textContent = "Gendan";
        undoButton.addEventListener("click", function () {
          restoreDeletedEntry(entry.id);
        });
        actions.appendChild(undoButton);
      }

      meta.appendChild(actions);

      const preview = document.createElement("div");
      preview.className = "history-preview";

      const fit = computePreviewFit(entry.snapshot, preview.clientWidth || 250, preview.clientHeight || 188);
      for (let t = 0; t < entry.snapshot.tiles.length; t += 1) {
        const tile = entry.snapshot.tiles[t];
        const mini = document.createElement("div");
        mini.className = "history-letter";
        const previewToken = tokenForRender(tile.token, tile.rotation || 0);
        if (isArrowToken(previewToken)) {
          mini.classList.add("token-arrow");
        }

        mini.textContent = displayToken(previewToken);
        mini.style.left = `${Math.round((tile.x - fit.minX) * fit.scale + fit.offsetX)}px`;
        mini.style.top = `${Math.round((tile.y - fit.minY) * fit.scale + fit.offsetY)}px`;
        mini.style.width = `${Math.max(12, Math.round((tile.width || tokenWidth(tile.token)) * fit.scale))}px`;
        mini.style.transform = "rotate(0deg)";

        preview.appendChild(mini);
      }

      item.appendChild(meta);
      item.appendChild(preview);
      els.historyList.appendChild(item);
    }
  }

  function computePreviewFit(snapshot, previewW, previewH) {
    const width = Math.max(120, previewW || 250);
    const height = Math.max(120, previewH || 190);

    if (!snapshot || !Array.isArray(snapshot.tiles) || !snapshot.tiles.length) {
      return {
        minX: 0,
        minY: 0,
        scale: 1,
        offsetX: 8,
        offsetY: 8
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < snapshot.tiles.length; i += 1) {
      const tile = snapshot.tiles[i];
      const w = tile.width || tokenWidth(tile.token);
      minX = Math.min(minX, tile.x);
      minY = Math.min(minY, tile.y);
      maxX = Math.max(maxX, tile.x + w);
      maxY = Math.max(maxY, tile.y + TILE_HEIGHT);
    }

    const contentW = Math.max(40, maxX - minX);
    const contentH = Math.max(40, maxY - minY);

    const sx = (width - 18) / contentW;
    const sy = (height - 18) / contentH;
    const scale = Math.min(0.76, Math.max(0.22, Math.min(sx, sy)));

    const drawW = contentW * scale;
    const drawH = contentH * scale;

    return {
      minX,
      minY,
      scale,
      offsetX: Math.max(6, Math.round((width - drawW) / 2)),
      offsetY: Math.max(6, Math.round((height - drawH) / 2))
    };
  }

  function boardAspectRatio(element) {
    if (!element) {
      return 0.76;
    }

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return 0.76;
    }

    return rect.width / rect.height;
  }

  function confirmDeleteHistoryEntry(entryId) {
    if (entryId === ORIGINAL_ID) {
      return;
    }

    const entry = state.history.find(function (item) {
      return item.id === entryId;
    });
    if (!entry) {
      return;
    }

    clearDeletePrompt();

    const backup = {
      deleted: entry,
      historyBefore: state.history.slice(),
      activeModeBefore: state.activeMode,
      activeSourceBefore: state.activeSourceId
    };

    state.history = state.history.filter(function (item) {
      return item.id !== entryId;
    });

    state.undoDelete = {
      deletedId: entryId,
      backup,
      timeoutId: setTimeout(function () {
        state.undoDelete = null;
        renderHistory();
      }, 5000)
    };

    if (state.activeSourceId === entryId) {
      const newest = state.history.find(function (item) {
        return item.id !== ORIGINAL_ID;
      });

      if (newest) {
        state.activeMode = ACTIVE_MODE_HISTORY;
        state.activeSourceId = newest.id;
        applySourceFromEntry(newest);
      } else {
        state.activeMode = ACTIVE_MODE_ORIGINAL;
        state.activeSourceId = ORIGINAL_ID;
        applyOriginalAsSource();
      }
    }

    rewireOrphanChildren(entryId, entry.parentId || ORIGINAL_ID);
    ensureOriginalPinned();
    persistStorage();
    renderAll();

    renderHistory();
  }

  function restoreDeletedEntry(entryId) {
    if (!state.undoDelete || state.undoDelete.deletedId !== entryId) {
      return;
    }

    const backup = state.undoDelete.backup;
    clearTimeout(state.undoDelete.timeoutId);
    state.undoDelete = null;

    state.history = backup.historyBefore.slice();
    state.activeMode = backup.activeModeBefore;
    state.activeSourceId = backup.activeSourceBefore;

    if (state.activeSourceId === ORIGINAL_ID || state.activeMode === ACTIVE_MODE_ORIGINAL) {
      applyOriginalAsSource();
    } else {
      const active = state.history.find(function (item) {
        return item.id === state.activeSourceId;
      });
      if (active) {
        applySourceFromEntry(active);
      } else {
        applyOriginalAsSource();
        state.activeSourceId = ORIGINAL_ID;
        state.activeMode = ACTIVE_MODE_ORIGINAL;
      }
    }

    persistStorage();
    renderAll();
  }

  function clearDeletePrompt() {
    state.deletePromptId = null;
    if (state.deletePromptTimerId) {
      clearTimeout(state.deletePromptTimerId);
      state.deletePromptTimerId = null;
    }
  }

  function scheduleDeletePromptReset() {
    if (state.deletePromptTimerId) {
      clearTimeout(state.deletePromptTimerId);
    }

    state.deletePromptTimerId = setTimeout(function () {
      if (state.deletePromptId) {
        state.deletePromptId = null;
        renderHistory();
      }
      state.deletePromptTimerId = null;
    }, 5000);
  }

  function rewireOrphanChildren(oldParentId, newParentId) {
    for (let i = 0; i < state.history.length; i += 1) {
      if (state.history[i].parentId === oldParentId) {
        state.history[i].parentId = newParentId || ORIGINAL_ID;
      }
    }
  }

  function pairSpacing(leftToken, rightToken) {
    const key = `${leftToken}${rightToken}`;
    if (Object.prototype.hasOwnProperty.call(KERNING_PAIR_GAP, key)) {
      return KERNING_PAIR_GAP[key];
    }
    return 0;
  }

  function createLetterNode(tile, side) {
    const node = document.createElement("div");
    node.className = "board-letter";

    if (side === "right") {
      node.classList.add("is-right");
    }

    const renderToken = tokenForRender(tile.token, tile.rotation || 0);

    if (isArrowToken(renderToken)) {
      node.classList.add("token-arrow");
    }

    const glyph = document.createElement("span");
    glyph.className = "letter-glyph";
    glyph.textContent = displayToken(renderToken);
    glyph.style.transform = glyphTransform(tile, renderToken);

    node.appendChild(glyph);
    node.style.left = `${tile.x}px`;
    node.style.top = `${tile.y}px`;
    node.style.width = `${tile.width}px`;
    node.style.height = `${TILE_HEIGHT}px`;

    return node;
  }

  function glyphTransform(tile, renderToken) {
    if (isArrowToken(renderToken)) {
      return `translate(0px, ${arrowYOffset(renderToken)}px) rotate(0deg)`;
    }

    const rotation = tile.rotation || 0;
    if (rotation === 180) {
      const offset = rotationOffsetForToken(tile.token);
      return `translate(${offset.x}px, ${offset.y}px) rotate(180deg)`;
    }

    if (rotation === 0) {
      return "translate(0px, 0px) rotate(0deg)";
    }

    return `translate(0px, 0px) rotate(${rotation}deg)`;
  }

  function toggleRotation(tileId) {
    const rightTile = state.rightTiles.find(function (item) {
      return item.id === tileId;
    });
    if (rightTile) {
      if (isArrowToken(rightTile.token)) {
        const shown = tokenForRender(rightTile.token, rightTile.rotation || 0);
        rightTile.token = rotateArrowToken(shown);
        rightTile.rotation = 0;
      } else {
        rightTile.rotation = rightTile.rotation === 180 ? 0 : 180;
      }
      renderRightBoard();
      return;
    }

    const leftTile = state.leftTiles.find(function (item) {
      return item.id === tileId;
    });
    if (!leftTile) {
      return;
    }

    if (isArrowToken(leftTile.token)) {
      const shown = tokenForRender(leftTile.token, leftTile.rotation || 0);
      leftTile.token = rotateArrowToken(shown);
      leftTile.rotation = 0;
    } else {
      leftTile.rotation = leftTile.rotation === 180 ? 0 : 180;
    }

    renderLeftBoard();
  }

  function rotationOffsetForToken(token) {
    if (rotationOffsetCache[token]) {
      return rotationOffsetCache[token];
    }

    const text = displayToken(token);
    const metrics = measureTextMetrics(text);
    if (!metrics) {
      rotationOffsetCache[token] = { x: 0, y: 0 };
      return rotationOffsetCache[token];
    }

    const left = -numberOrZero(metrics.actualBoundingBoxLeft);
    const right = numberOrZero(metrics.actualBoundingBoxRight);
    const bboxCenterX = (left + right) / 2;
    const advanceCenterX = numberOrZero(metrics.width) / 2;

    const ascent = numberOrZero(metrics.actualBoundingBoxAscent);
    const descent = numberOrZero(metrics.actualBoundingBoxDescent);
    const bboxCenterY = (-ascent + descent) / 2;

    let lineCenterY = 0;
    if (Number.isFinite(metrics.fontBoundingBoxAscent) && Number.isFinite(metrics.fontBoundingBoxDescent)) {
      lineCenterY = (-metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / 2;
    }

    const deltaX = bboxCenterX - advanceCenterX;
    const deltaY = bboxCenterY - lineCenterY;

    const result = {
      x: clamp(round3(deltaX * 2), -3, 3),
      y: clamp(round3(deltaY * 2), -2.5, 2.5)
    };

    const adjust = ROTATION_OFFSET_ADJUST[token];
    if (adjust) {
      result.x = clamp(round3(result.x + numberOrZero(adjust.x)), -3, 3);
      result.y = clamp(round3(result.y + numberOrZero(adjust.y)), -2.5, 2.5);
    }

    rotationOffsetCache[token] = result;

    return rotationOffsetCache[token];
  }

  function measureTextMetrics(text) {
    if (!measureCtx) {
      const canvas = document.createElement("canvas");
      measureCtx = canvas.getContext("2d");
    }

    if (!measureCtx) {
      return null;
    }

    const fontSize = GROOVE_STEP * 2.25;
    measureCtx.font = `640 ${fontSize}px "Google Sans Flex", "Roboto Mono", monospace`;
    return measureCtx.measureText(text);
  }

  function clearRotationOffsetCache() {
    const keys = Object.keys(rotationOffsetCache);
    for (let i = 0; i < keys.length; i += 1) {
      delete rotationOffsetCache[keys[i]];
    }
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function displayToken(token) {
    if (token === "<") {
      return "\u2190";
    }
    if (token === ">") {
      return "\u2192";
    }
    return token;
  }

  function isArrowToken(token) {
    return token === "<" || token === ">";
  }

  function isCompactToken(token) {
    return Object.prototype.hasOwnProperty.call(SMALL_TOKEN_CONFIG, token);
  }

  function getSmallTokenConfig(token) {
    if (!Object.prototype.hasOwnProperty.call(SMALL_TOKEN_CONFIG, token)) {
      return null;
    }
    return SMALL_TOKEN_CONFIG[token];
  }

  function trailingGapForToken(token) {
    const config = getSmallTokenConfig(token);
    if (config && Number.isFinite(config.trailingGap)) {
      return config.trailingGap;
    }
    return RIGHT_GAP;
  }

  function minXGapForTokens(leftToken, rightToken) {
    const leftCompact = isCompactToken(leftToken);
    const rightCompact = isCompactToken(rightToken);

    if (leftCompact && rightCompact) {
      return MIN_X_GAP_COMPACT_PAIR;
    }
    if (leftCompact || rightCompact) {
      return MIN_X_GAP_COMPACT;
    }
    return MIN_X_GAP;
  }

  function collisionInsetX(token, width) {
    const config = getSmallTokenConfig(token);
    if (config && Number.isFinite(config.collisionWidth)) {
      return Math.max(0, Math.floor((width - config.collisionWidth) / 2));
    }
    return 0;
  }

  function makeCollisionRect(x, y, width, height, token) {
    const inset = collisionInsetX(token || "", width);
    let left = x + inset;
    let right = x + width - inset;

    if (right - left < 3) {
      const center = x + width / 2;
      left = center - 1.5;
      right = center + 1.5;
    }

    return {
      left,
      top: y,
      right,
      bottom: y + height
    };
  }

  function tokenForRender(token, rotation) {
    if (!isArrowToken(token)) {
      return token;
    }
    if ((rotation || 0) === 180) {
      return rotateArrowToken(token);
    }
    return token;
  }

  function arrowYOffset(token) {
    return token === "<" ? arrowOffsets.left : arrowOffsets.right;
  }

  function tokenWidth(token) {
    const smallConfig = getSmallTokenConfig(token);
    if (smallConfig && Number.isFinite(smallConfig.width)) {
      return smallConfig.width;
    }

    const adjust = Object.prototype.hasOwnProperty.call(TOKEN_WIDTH_ADJUST, token)
      ? TOKEN_WIDTH_ADJUST[token]
      : 0;

    return Math.max(20, LETTER_BASE_WIDTH + adjust);
  }

  function unitStep() {
    return 18;
  }

  function lineToGroove(lineIndex) {
    return LEFT_TOP_GROOVE + lineIndex * 3;
  }

  function grooveToTop(grooveIndex) {
    const center = grooveIndex * GROOVE_STEP;
    return center - TILE_HEIGHT / 2;
  }

  function nearestGrooveFromTop(topPx) {
    const center = topPx + TILE_HEIGHT / 2;
    return Math.max(0, Math.round(center / GROOVE_STEP));
  }

  function approximateGroove(topPx) {
    const center = topPx + TILE_HEIGHT / 2;
    return Math.round(center / GROOVE_STEP);
  }

  function makeRect(x, y, width, height) {
    return {
      left: x,
      top: y,
      right: x + width,
      bottom: y + height
    };
  }

  function isPointInsideElement(element, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return date.toLocaleString("da-DK", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function normalizeWriterName(name) {
    if (typeof name !== "string") {
      return "";
    }
    return name.trim().slice(0, 60);
  }

  function requestWriterName() {
    if (
      !els.writerDialog ||
      !els.writerNameInput ||
      !els.writerSaveButton ||
      !els.writerCancelButton ||
      typeof els.writerDialog.showModal !== "function"
    ) {
      const fallback = window.prompt("Hvem skriver beskeden?", state.lastWriterName || "");
      if (fallback === null) {
        return Promise.resolve(null);
      }
      const normalized = normalizeWriterName(fallback);
      return Promise.resolve(normalized || null);
    }

    return new Promise(function (resolve) {
      const dialog = els.writerDialog;
      const input = els.writerNameInput;
      const saveButton = els.writerSaveButton;
      const cancelButton = els.writerCancelButton;

      let done = false;

      function cleanup() {
        if (done) {
          return;
        }
        done = true;

        saveButton.removeEventListener("click", onSave);
        cancelButton.removeEventListener("click", onCancel);
        input.removeEventListener("keydown", onKeyDown);
        dialog.removeEventListener("cancel", onCancelEvent);
      }

      function closeWith(value) {
        cleanup();
        if (dialog.open) {
          dialog.close();
        }
        resolve(value);
      }

      function onSave() {
        const normalized = normalizeWriterName(input.value);
        if (!normalized) {
          input.focus();
          return;
        }
        closeWith(normalized);
      }

      function onCancel() {
        closeWith(null);
      }

      function onCancelEvent(event) {
        event.preventDefault();
        closeWith(null);
      }

      function onKeyDown(event) {
        if (event.key === "Enter") {
          event.preventDefault();
          onSave();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }

      saveButton.addEventListener("click", onSave);
      cancelButton.addEventListener("click", onCancel);
      input.addEventListener("keydown", onKeyDown);
      dialog.addEventListener("cancel", onCancelEvent);

      input.value = state.lastWriterName || "";
      input.select();
      dialog.showModal();
      input.focus();
    });
  }

  function cloneTiles(tiles) {
    return tiles.map(function (tile) {
      return { ...tile };
    });
  }

  function numberOrZero(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function randomInt(min, max) {
    if (max <= min) {
      return min;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }
})();
