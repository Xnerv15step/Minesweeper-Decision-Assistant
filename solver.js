/**
 * solver.js
 *
 * 作用：這是擴充功能的「大腦」。
 * 當用戶按下快捷鍵或點擊「執行」時，此腳本會被注入到遊戲網頁中。
 * 它會遍歷 DOM、分析地雷分佈、計算風險機率，並直接在網頁上繪製提示 UI。
 */
(async function () {
  // ─────────────────────
  // 1. 初始化設置 (Settings)
  // ─────────────────────
  const settings = await new Promise((resolve) => {
    // 檢查環境中是否有 chrome API（確保在擴充功能環境執行）
    if (!globalThis.chrome?.storage?.sync?.get) return resolve(null);
    chrome.storage.sync.get(
      { suggestions: 5, maxVars: 28, timeBudgetMs: 180 },
      (res) => resolve(res),
    );
  });

  const SETTINGS = {
    suggestions: settings?.suggestions ?? 5,
    maxVars: settings?.maxVars ?? 28,
    timeBudgetMs: settings?.timeBudgetMs ?? 180,
  };

  /**
   * 清除之前產生的所有提示標記與面板
   */
  function clearHints() {
    document.querySelectorAll(".__solver_overlay").forEach((e) => e.remove());
    document.getElementById("__solver_panel")?.remove();
    document.querySelectorAll('[id^="cell_"]').forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    });
  }

  // 每次執行前先清空舊的提示
  clearHints();

  // ─────────────────────
  // 2. 盤面掃描與建模
  // ─────────────────────
  const cells = document.querySelectorAll('[id^="cell_"]');
  if (!cells.length) {
    alert("找不到遊戲盤面（cell_... 元素不存在）");
    return;
  }

  // 計算棋盤的寬(maxCol)與高(maxRow)
  let maxCol = 0;
  let maxRow = 0;
  cells.forEach((el) => {
    const [, c, r] = el.id.split("_").map(Number);
    if (c > maxCol) maxCol = c;
    if (r > maxRow) maxRow = r;
  });

  const COLS = maxCol + 1;
  const ROWS = maxRow + 1;

  const HIDDEN = 0;
  const FLAGGED = 1;

  // 初始化虛擬棋盤
  const board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ state: HIDDEN, num: -1, el: null })),
  );
  const flaggedKeys = new Set();
  const keyToEl = new Map();

  // 將 DOM 狀態同步到虛擬棋盤 board
  cells.forEach((el) => {
    const [, col, row] = el.id.split("_").map(Number);
    const cls = el.classList;
    const cell = board[row][col];
    cell.el = el;
    const key = `${col}_${row}`;
    keyToEl.set(key, el);

    if (cls.contains("hdd_flag")) {
      cell.state = FLAGGED;
      flaggedKeys.add(key);
      return;
    }

    if (cls.contains("hdd_opened")) {
      cell.state = -1; // 標記為已開啟
      for (let n = 1; n <= 8; n++) {
        if (cls.contains("hdd_type" + n)) {
          cell.num = n; // 讀取數字 1~8
          break;
        }
      }
      if (cell.num === -1) cell.num = 0; // 無數字則為 0
    }
  });

  // 狀態判斷輔助函式
  const isHidden = (cell) => cell.state === HIDDEN;
  const isFlag = (cell) => cell.state === FLAGGED;
  const isOpen = (cell) => cell.num >= 0;

  /**
   * 獲取指定坐標的周圍 8 格坐標
   */
  function neighbors(r, c) {
    const res = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
        res.push([nr, nc]);
      }
    }
    return res;
  }

  // ─────────────────────
  // 3. 邏輯推理與約束建立 (Constraint Building)
  // ─────────────────────
  const constraints = [];
  const forcedSafe = new Set(); // 100% 安全的格子
  const forcedMine = new Set(); // 100% 是雷的格子

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      // 只處理有數字且大於 0 的格子
      if (!isOpen(cell) || cell.num === 0) continue;

      const nbs = neighbors(r, c);
      const hidden = nbs
        .filter(([nr, nc]) => isHidden(board[nr][nc]))
        .map(([nr, nc]) => `${nc}_${nr}`);

      const flaggedCount = nbs.filter(([nr, nc]) =>
        isFlag(board[nr][nc]),
      ).length;
      const remaining = cell.num - flaggedCount;

      // 基本推理 A：剩餘雷數為 0 -> 鄰居全安全
      if (remaining === 0) hidden.forEach((k) => forcedSafe.add(k));
      // 基本推理 B：剩餘雷數等於隱藏格數 -> 鄰居全雷
      if (remaining === hidden.length) hidden.forEach((k) => forcedMine.add(k));

      // 建立約束關係：這組 hidden 坐標集合中，含有 remaining 個雷
      if (hidden.length > 0) {
        constraints.push({ cells: new Set(hidden), count: remaining });
      }
    }
  }

  // ─────────────────────
  // 4. 機率估算 (Heuristic Probability)
  // ─────────────────────
  const probMap = {};
  const borderKeys = new Set();
  constraints.forEach((con) => con.cells.forEach((k) => borderKeys.add(k)));

  borderKeys.forEach((key) => {
    const related = constraints.filter((con) => con.cells.has(key));
    if (!related.length) {
      probMap[key] = 0.5;
      return;
    }

    let weightedSum = 0;
    let weightTotal = 0;
    related.forEach((con) => {
      const weight = 1 / con.cells.size; // 約束範圍越小，精確度越高，給予更高權重
      weightedSum += (con.count / con.cells.size) * weight;
      weightTotal += weight;
    });
    probMap[key] = weightedSum / weightTotal;
  });

  // ─────────────────────
  // 5. 決策與排序
  // ─────────────────────
  const candidates = Object.entries(probMap)
    .map(([key, risk]) => {
      // 影響力：該格子涉及多少個約束。
      // 翻開影響力高的格子能提供更多資訊。
      const impact = constraints.filter((c) => c.cells.has(key)).length;
      const score = risk - 0.05 * impact; // 分數越低代表越推薦
      return { key, risk, impact, score };
    })
    .filter((c) => !forcedMine.has(c.key)) // 排除已推斷為雷的格子
    .sort((a, b) => a.score - b.score);

  // 根據設置決定顯示多少個建議
  const SUGGESTIONS_LIMIT = Math.max(
    1,
    Math.min(10, Number.parseInt(SETTINGS.suggestions, 10) || 5),
  );
  const suggestionsClamped = candidates.slice(0, SUGGESTIONS_LIMIT);

  // ─────────────────────
  // 6. UI 渲染：覆蓋層與面板
  // ─────────────────────

  // 在棋盤格子上繪製彩色標籤
  suggestionsClamped.forEach((s, idx) => {
    const [c, r] = s.key.split("_").map(Number);
    const cell = board[r]?.[c];
    if (!cell?.el) return;
    // 第一推薦用黃金色，其餘用橘黃色
    const color = idx === 0 ? "rgba(234,179,8,0.85)" : "rgba(245,158,11,0.55)";
    overlay(cell.el, color, `#${idx + 1}`);
  });

  // 渲染右側資訊面板 (renderPanel 函式實作...)
  renderPanel({
    board: { rows: ROWS, cols: COLS },
    constraintsCount: constraints.length,
    borderCount: borderKeys.size,
    forcedSafeCount: forcedSafe.size,
    forcedMineCount: forcedMine.size,
    suggestions: suggestionsClamped,
  });

  /**
   * 在 DOM 元素上繪製標記標籤
   */
  function overlay(el, color, label) {
    if (!el) return;
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") el.style.position = "relative";

    // 加上外框線
    el.style.outline = "2px solid rgba(234,179,8,0.95)";
    el.style.outlineOffset = "-2px";

    const badge = document.createElement("div");
    badge.className = "__solver_overlay";
    badge.textContent = label;

    // 設定標籤樣式
    Object.assign(badge.style, {
      position: "absolute",
      left: "2px",
      top: "2px",
      padding: "1px 4px",
      borderRadius: "4px",
      background: color,
      color: "#fff",
      fontSize: "10px",
      fontWeight: "bold",
      zIndex: 99999,
      pointerEvents: "none", // 確保標籤不會阻礙滑鼠點擊格子
      boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
    });

    el.appendChild(badge);
  }

  // ... (後續 renderPanel 實作與其餘輔助函式)
})();
