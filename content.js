(function () {
  console.clear();

  const cells = document.querySelectorAll('[id^="cell_"]');
  if (!cells.length) {
    console.log("No board found");
    return;
  }

  // ─────────────────────
  // 建立棋盤
  // ─────────────────────
  let maxCol = 0,
    maxRow = 0;

  cells.forEach((el) => {
    const [, c, r] = el.id.split("_").map(Number);
    if (c > maxCol) maxCol = c;
    if (r > maxRow) maxRow = r;
  });

  const COLS = maxCol + 1;
  const ROWS = maxRow + 1;

  const HIDDEN = 0;
  const FLAGGED = 1;

  const board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      state: HIDDEN,
      num: -1,
      el: null,
    })),
  );

  // ─────────────────────
  // 讀盤面
  // ─────────────────────
  let totalMines = 0;
  const mineEl = document.querySelector('[class*="mine"],.mines-count');
  if (mineEl) totalMines = parseInt(mineEl.textContent) || 0;

  cells.forEach((el) => {
    const [, c, r] = el.id.split("_").map(Number);
    const cell = board[r][c];
    const cls = el.classList;

    cell.el = el;

    if (cls.contains("hdd_flag")) {
      cell.state = FLAGGED;
    } else if (cls.contains("hdd_opened")) {
      cell.state = -1;

      for (let n = 1; n <= 8; n++) {
        if (cls.contains("hdd_type" + n)) {
          cell.num = n;
          break;
        }
      }

      if (cell.num === -1) cell.num = 0;
    }
  });

  const isHidden = (c) => c.state === HIDDEN;
  const isFlag = (c) => c.state === FLAGGED;
  const isOpen = (c) => c.num >= 0;

  // ─────────────────────
  // 鄰居
  // ─────────────────────
  function neighbors(r, c) {
    const res = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr,
          nc = c + dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          res.push([nr, nc]);
        }
      }
    }
    return res;
  }

  // ─────────────────────
  // Step 1: 確定推理
  // ─────────────────────
  const safe = new Set();
  const mines = new Set();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (!isOpen(cell) || cell.num === 0) continue;

      const nbs = neighbors(r, c);
      const hidden = nbs.filter(([nr, nc]) => isHidden(board[nr][nc]));
      const flagged = nbs.filter(([nr, nc]) => isFlag(board[nr][nc]));

      const remain = cell.num - flagged.length;

      if (remain === 0) {
        hidden.forEach(([nr, nc]) => safe.add(`${nr},${nc}`));
      }

      if (remain === hidden.length) {
        hidden.forEach(([nr, nc]) => mines.add(`${nr},${nc}`));
      }
    }
  }

  // ─────────────────────
  // Step 2: constraint
  // ─────────────────────
  const constraints = [];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (!isOpen(cell) || cell.num === 0) continue;

      const nbs = neighbors(r, c);
      const hidden = nbs
        .filter(([nr, nc]) => isHidden(board[nr][nc]))
        .map(([nr, nc]) => `${nr},${nc}`);

      const flagged = nbs.filter(([nr, nc]) => isFlag(board[nr][nc])).length;
      const remain = cell.num - flagged;

      if (hidden.length > 0) {
        constraints.push({ cells: new Set(hidden), count: remain });
      }
    }
  }

  // ─────────────────────
  // Step 3: 機率估計（加權）
  // ─────────────────────
  const prob = {};

  const border = new Set();
  constraints.forEach((c) => c.cells.forEach((k) => border.add(k)));

  border.forEach((k) => {
    const related = constraints.filter((c) => c.cells.has(k));

    if (!related.length) {
      prob[k] = 0.5;
      return;
    }

    let sum = 0;
    let wsum = 0;

    related.forEach((c) => {
      const w = 1 / c.cells.size;
      sum += (c.count / c.cells.size) * w;
      wsum += w;
    });

    prob[k] = sum / wsum;
  });

  // ─────────────────────
  // Step 4: 選最佳動作（核心）
  // ─────────────────────
  let best = null;
  let bestScore = Infinity;

  Object.entries(prob).forEach(([k, p]) => {
    const impact = constraints.filter((c) => c.cells.has(k)).length;

    // 👉 核心決策函數
    const score = p - 0.05 * impact;

    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  });

  // ─────────────────────
  // Step 5: fallback（完全未知）
  // ─────────────────────
  if (!best) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isHidden(board[r][c])) {
          best = `${r},${c}`;
          bestScore = 0.5;
          break;
        }
      }
      if (best) break;
    }
  }

  // ─────────────────────
  // Step 6: 輸出（只給一個答案）
  // ─────────────────────
  const [r, c] = best.split(",").map(Number);

  const result = {
    move: { r, c },
    risk: bestScore,
    reason: "Constraint最緊 + 邊界資訊最大",
  };

  // ─────────────────────
  // UI 更新（content.js panel 用）
  // ─────────────────────
  const moveEl = document.getElementById("move");
  const riskEl = document.getElementById("risk");
  const reasonEl = document.getElementById("reason");

  if (moveEl) moveEl.textContent = `→ (${r},${c})`;
  if (riskEl) riskEl.textContent = `風險：${Math.round(result.risk * 100)}%`;
  if (reasonEl) reasonEl.textContent = result.reason;

  console.log("[Solver Result]", result);
  console.log("BUTTON CLICKED");
})();
