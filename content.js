/**
 * content.js
 *
 * 作用：負責讀取網頁上的棋盤 DOM 結構、解析地雷分布現況、
 * 執行邏輯推理與機率計算，最後找出最推薦的下一步並更新 UI。
 */
(function () {
  console.clear();

  // 1. 抓取所有棋盤格點（假設 ID 格式為 cell_x_y）
  const cells = document.querySelectorAll('[id^="cell_"]');
  if (!cells.length) {
    console.log("找不到棋盤區域");
    return;
  }

  // ─────────────────────
  // 建立虛擬棋盤矩陣
  // ─────────────────────
  let maxCol = 0,
    maxRow = 0;

  // 遍歷所有 DOM 元素來確認棋盤的總行列數
  cells.forEach((el) => {
    const [, c, r] = el.id.split("_").map(Number);
    if (c > maxCol) maxCol = c;
    if (r > maxRow) maxRow = r;
  });

  const COLS = maxCol + 1;
  const ROWS = maxRow + 1;

  // 定義格子狀態常數
  const HIDDEN = 0; // 未翻開
  const FLAGGED = 1; // 已插旗

  // 初始化二維陣列來儲存棋盤狀態
  const board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      state: HIDDEN,
      num: -1, // 周圍雷數，-1 代表未知或空
      el: null, // 存放對應的 DOM 元素以便操作
    })),
  );

  // ─────────────────────
  // 讀取當前盤面資訊
  // ─────────────────────
  let totalMines = 0;
  // 嘗試從頁面抓取剩餘雷數顯示（支援多種常見類名）
  const mineEl = document.querySelector('[class*="mine"],.mines-count');
  if (mineEl) totalMines = parseInt(mineEl.textContent) || 0;

  cells.forEach((el) => {
    const [, c, r] = el.id.split("_").map(Number);
    const cell = board[r][c];
    const cls = el.classList;

    cell.el = el; // 關聯 DOM

    if (cls.contains("hdd_flag")) {
      cell.state = FLAGGED;
    } else if (cls.contains("hdd_opened")) {
      cell.state = -1; // 標記為已打開

      // 檢查 class 來判斷格子上的數字 (1~8)
      for (let n = 1; n <= 8; n++) {
        if (cls.contains("hdd_type" + n)) {
          cell.num = n;
          break;
        }
      }
      // 如果已打開但沒數字，代表周圍 0 雷
      if (cell.num === -1) cell.num = 0;
    }
  });

  // 狀態判定輔助函式
  const isHidden = (c) => c.state === HIDDEN;
  const isFlag = (c) => c.state === FLAGGED;
  const isOpen = (c) => c.num >= 0;

  // ─────────────────────
  // 鄰居搜尋工具：獲取周圍 8 格的坐標
  // ─────────────────────
  function neighbors(r, c) {
    const res = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue; // 跳過自己
        const nr = r + dr,
          nc = c + dc;
        // 確保坐標在棋盤範圍內
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          res.push([nr, nc]);
        }
      }
    }
    return res;
  }

  // ─────────────────────
  // Step 1: 基礎邏輯推理 (確定性判斷)
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

      // 剩餘需找出的地雷數 = 格子數字 - 周圍已插旗數
      const remain = cell.num - flagged.length;

      // 情況 A：剩餘雷數為 0，則周圍未翻開的格子全是安全的
      if (remain === 0) {
        hidden.forEach(([nr, nc]) => safe.add(`${nr},${nc}`));
      }

      // 情況 B：剩餘雷數等於未翻開格子數，則周圍全是雷
      if (remain === hidden.length) {
        hidden.forEach(([nr, nc]) => mines.add(`${nr},${nc}`));
      }
    }
  }

  // ─────────────────────
  // Step 2: 建立約束條件集 (Constraints)
  // 用於處理複雜機率運算的基礎數據
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

      // 如果周圍還有未知的格子，記錄這是一個約束（如：這 3 格裡面有 1 顆雷）
      if (hidden.length > 0) {
        constraints.push({ cells: new Set(hidden), count: remain });
      }
    }
  }

  // ─────────────────────
  // Step 3: 加權機率估計
  // ─────────────────────
  const prob = {}; // 存放每個格子的危險機率

  // 找出所有與已知數字相鄰的邊界格子
  const border = new Set();
  constraints.forEach((c) => c.cells.forEach((k) => border.add(k)));

  border.forEach((k) => {
    const related = constraints.filter((c) => c.cells.has(k));

    if (!related.length) {
      prob[k] = 0.5; // 完全無資訊的邊界格子預設 50%
      return;
    }

    let sum = 0;
    let wsum = 0;

    // 根據受影響的約束條件計算加權平均機率
    related.forEach((c) => {
      const w = 1 / c.cells.size; // 約束範圍越小，權重越高
      sum += (c.count / c.cells.size) * w;
      wsum += w;
    });

    prob[k] = sum / wsum;
  });

  // ─────────────────────
  // Step 4: 核心決策（選出最佳動作）
  // ─────────────────────
  let best = null;
  let bestScore = Infinity;

  Object.entries(prob).forEach(([k, p]) => {
    // 該格子出現在多少個約束中（影響力）
    const impact = constraints.filter((c) => c.cells.has(k)).length;

    /**
     * 核心分數計算：
     * 分數越低越好。p 是爆炸機率，impact 是該點帶來的資訊量報酬。
     * 我們傾向選擇「機率低」且「一旦翻開能解決最多約束」的格子。
     */
    const score = p - 0.05 * impact;

    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  });

  // ─────────────────────
  // Step 5: Fallback 備案
  // 如果沒有任何邊界資訊（例如開局），就隨便找一格未翻開的
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
  // Step 6: 輸出結果
  // ─────────────────────
  const [bestR, bestC] = best.split(",").map(Number);

  const result = {
    move: { r: bestR, c: bestC },
    risk: bestScore,
    reason: "約束條件最緊 + 邊界資訊價值最大",
  };

  // ─────────────────────
  // 更新 UI 面板
  // ─────────────────────
  const moveEl = document.getElementById("move");
  const riskEl = document.getElementById("risk");
  const reasonEl = document.getElementById("reason");

  if (moveEl) moveEl.textContent = `→ (${bestC}, ${bestR})`; // 注意通常顯示為 (x, y) 即 (col, row)
  if (riskEl)
    riskEl.textContent = `估計風險：${Math.max(0, Math.round(result.risk * 100))}%`;
  if (reasonEl) reasonEl.textContent = result.reason;

  console.log("[Solver 運算完成]", result);
  console.log("計算觸發成功");
})();
