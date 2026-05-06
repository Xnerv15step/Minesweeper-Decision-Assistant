(async function () {
  const settings = await new Promise((resolve) => {
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

  function clearHints() {
    document.querySelectorAll(".__solver_overlay").forEach((e) => e.remove());
    document.getElementById("__solver_panel")?.remove();
    document.querySelectorAll('[id^="cell_"]').forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    });
  }

  // Clear previous hints (this run)
  clearHints();

  // Auto-clear hints after user actions or board resets.
  installAutoClear(clearHints);

  const cells = document.querySelectorAll('[id^="cell_"]');
  if (!cells.length) {
    alert("找不到遊戲盤面（cell_... 元素不存在）");
    return;
  }

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

  const board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ state: HIDDEN, num: -1, el: null })),
  );
  const flaggedKeys = new Set();
  const keyToEl = new Map();

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

  const isHidden = (cell) => cell.state === HIDDEN;
  const isFlag = (cell) => cell.state === FLAGGED;
  const isOpen = (cell) => cell.num >= 0;

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

  // Build constraints: opened numbered cell -> unknown neighbors + remaining mines
  // Also collect deterministic safe/mine cells (basic single-cell inference).
  const constraints = [];
  const forcedSafe = new Set();
  const forcedMine = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (!isOpen(cell) || cell.num === 0) continue;

      const nbs = neighbors(r, c);
      const hiddenCoords = nbs.filter(([nr, nc]) => isHidden(board[nr][nc]));
      const hidden = hiddenCoords
        .filter(([nr, nc]) => isHidden(board[nr][nc]))
        .map(([nr, nc]) => `${nc}_${nr}`);

      const flaggedCount = nbs.filter(([nr, nc]) => isFlag(board[nr][nc])).length;
      const remaining = cell.num - flaggedCount;

      if (remaining === 0) hidden.forEach((k) => forcedSafe.add(k));
      if (remaining === hidden.length) hidden.forEach((k) => forcedMine.add(k));

      if (hidden.length > 0) constraints.push({ cells: new Set(hidden), count: remaining });
    }
  }

  // CSP constraints for "definitely wrong flag" check:
  // Treat ALL unopened cells (including flagged) as variables, and numbers as exact counts.
  const csp = buildCspConstraints();

  // If no constraints exist, just mark one closed cell as "unknown best"
  if (!constraints.length) {
    const firstClosed = Array.from(cells).find((el) => el.classList.contains("hdd_closed"));
    if (firstClosed) overlay(firstClosed, "rgba(59,130,246,0.85)", "#1");
    renderPanel({
      board: { rows: ROWS, cols: COLS },
      constraintsCount: 0,
      borderCount: 0,
      forcedSafeCount: 0,
      forcedMineCount: 0,
      suggestions: [],
      note: "目前盤面沒有可用的 constraints（通常是剛開局或全是 0 區域）。",
    });
    return;
  }

  // Heuristic probability estimate: weighted average over related constraints
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
      const weight = 1 / con.cells.size;
      weightedSum += (con.count / con.cells.size) * weight;
      weightTotal += weight;
    });
    probMap[key] = weightedSum / weightTotal;
  });

  // Pick: low risk + higher informational impact
  const candidates = Object.entries(probMap)
    .map(([key, risk]) => {
      const impact = constraints.filter((c) => c.cells.has(key)).length;
      const score = risk - 0.05 * impact;
      return { key, risk, impact, score };
    })
    .filter((c) => !forcedMine.has(c.key)) // if we believe it's a mine, don't suggest clicking it
    .sort((a, b) => a.score - b.score);

  const suggestions = candidates.slice(0, 5);
  const SUGGESTIONS_LIMIT = Math.max(1, Math.min(10, Number.parseInt(SETTINGS.suggestions, 10) || 5));
  const suggestionsClamped = candidates.slice(0, SUGGESTIONS_LIMIT);

  if (!suggestionsClamped.length) {
    renderPanel({
      board: { rows: ROWS, cols: COLS },
      constraintsCount: constraints.length,
      borderCount: borderKeys.size,
      forcedSafeCount: forcedSafe.size,
      forcedMineCount: forcedMine.size,
      suggestions: [],
      note: "沒有可建議的候選格（可能都被推定為雷或狀態不一致）。",
    });
    return;
  }

  // Highlight multiple suggestions
  suggestionsClamped.forEach((s, idx) => {
    const [c, r] = s.key.split("_").map(Number);
    const cell = board[r]?.[c];
    if (!cell?.el) return;
    const color = idx === 0 ? "rgba(234,179,8,0.85)" : "rgba(245,158,11,0.55)";
    overlay(cell.el, color, `#${idx + 1}`);
  });

  renderPanel({
    board: { rows: ROWS, cols: COLS },
    constraintsCount: constraints.length,
    borderCount: borderKeys.size,
    forcedSafeCount: forcedSafe.size,
    forcedMineCount: forcedMine.size,
    suggestions: suggestionsClamped,
    flagCheck: checkWrongFlags(),
  });

  function overlay(el, color, label) {
    if (!el) return;

    const computed = window.getComputedStyle(el);
    if (computed.position === "static") el.style.position = "relative";

    el.style.outline = "2px solid rgba(234,179,8,0.95)";
    el.style.outlineOffset = "-2px";

    const badge = document.createElement("div");
    badge.className = "__solver_overlay";
    badge.textContent = label;

    Object.assign(badge.style, {
      position: "absolute",
      left: "2px",
      top: "2px",
      padding: "1px 4px",
      borderRadius: "4px",
      background: color,
      color: "#fff",
      fontSize: "10px",
      lineHeight: "12px",
      zIndex: 99999,
      pointerEvents: "none",
      userSelect: "none",
      boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
      opacity: "0.95",
      whiteSpace: "nowrap",
    });

    el.appendChild(badge);
  }

  function renderPanel({
    board,
    constraintsCount,
    borderCount,
    forcedSafeCount,
    forcedMineCount,
    suggestions,
    note,
    flagCheck,
  }) {
    const panel = document.createElement("div");
    panel.id = "__solver_panel";

    Object.assign(panel.style, {
      position: "fixed",
      right: "12px",
      top: "12px",
      width: "280px",
      maxHeight: "80vh",
      overflow: "auto",
      zIndex: 100000,
      background: "rgba(17,24,39,0.92)",
      color: "#E5E7EB",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      fontSize: "12px",
      borderRadius: "10px",
      padding: "10px 10px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      border: "1px solid rgba(255,255,255,0.08)",
    });

    const title = document.createElement("div");
    title.textContent = "Minesweeper Decision Assistant";
    Object.assign(title.style, { fontWeight: "700", marginBottom: "6px" });
    panel.appendChild(title);

    const meta = document.createElement("div");
    meta.textContent = `可推理線索：${constraintsCount}  |  邊界格：${borderCount}`;
    Object.assign(meta.style, { opacity: "0.9", marginBottom: "6px" });
    panel.appendChild(meta);

    const meta2 = document.createElement("div");
    meta2.textContent = `確定安全：${forcedSafeCount}  |  推定地雷：${forcedMineCount}  |  建議：${suggestions.length}`;
    Object.assign(meta2.style, { opacity: "0.9", marginBottom: "8px" });
    panel.appendChild(meta2);

    if (flagCheck) {
      const flagTitle = document.createElement("div");
      flagTitle.textContent = "旗子檢查";
      Object.assign(flagTitle.style, { fontWeight: "700", marginBottom: "6px" });
      panel.appendChild(flagTitle);

      const flagBody = document.createElement("div");
      flagBody.textContent = flagCheck.summary;
      Object.assign(flagBody.style, {
        padding: "6px 8px",
        borderRadius: "8px",
        background:
          flagCheck.level === "bad"
            ? "rgba(239,68,68,0.16)"
            : flagCheck.level === "warn"
              ? "rgba(245,158,11,0.16)"
              : "rgba(16,185,129,0.14)",
        border:
          flagCheck.level === "bad"
            ? "1px solid rgba(239,68,68,0.28)"
            : flagCheck.level === "warn"
              ? "1px solid rgba(245,158,11,0.26)"
              : "1px solid rgba(16,185,129,0.22)",
        marginBottom: "8px",
        lineHeight: "16px",
      });
      panel.appendChild(flagBody);
    }

    if (note) {
      const noteEl = document.createElement("div");
      noteEl.textContent = note;
      Object.assign(noteEl.style, {
        padding: "6px 8px",
        borderRadius: "8px",
        background: "rgba(59,130,246,0.16)",
        border: "1px solid rgba(59,130,246,0.28)",
        marginBottom: "8px",
      });
      panel.appendChild(noteEl);
    }

    const listTitle = document.createElement("div");
    listTitle.textContent = "建議下一步（已在盤面標上 #1～#5）";
    Object.assign(listTitle.style, { fontWeight: "700", marginBottom: "6px" });
    panel.appendChild(listTitle);

    const list = document.createElement("div");
    suggestions.forEach((s, idx) => {
      const riskPct = Math.max(0, Math.min(100, Math.round(s.risk * 100)));
      const row = document.createElement("div");
      row.textContent = `#${idx + 1}  風險約 ${riskPct}%  ｜  可帶來更多線索：${humanImpact(s.impact)}`;
      Object.assign(row.style, {
        padding: "6px 8px",
        borderRadius: "8px",
        background: idx === 0 ? "rgba(234,179,8,0.16)" : "rgba(255,255,255,0.06)",
        border: idx === 0 ? "1px solid rgba(234,179,8,0.28)" : "1px solid rgba(255,255,255,0.08)",
        marginBottom: "6px",
        whiteSpace: "nowrap",
      });
      list.appendChild(row);
    });
    panel.appendChild(list);

    const foot = document.createElement("div");
    foot.textContent = "註：風險為快速估算（非精確枚舉），用來在無法純邏輯判斷時輔助選點。";
    Object.assign(foot.style, { opacity: "0.75", marginTop: "6px", lineHeight: "16px" });
    panel.appendChild(foot);

    document.body.appendChild(panel);

    function humanImpact(impact) {
      if (impact >= 6) return "高";
      if (impact >= 3) return "中";
      return "低";
    }
  }

  function buildCspConstraints() {
    // constraints: sum(vars) == count
    const cons = [];
    const vars = new Set();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = board[r][c];
        if (!isOpen(cell) || cell.num === 0) continue;

        const nbs = neighbors(r, c);
        const unopened = nbs
          .filter(([nr, nc]) => !isOpen(board[nr][nc]))
          .map(([nr, nc]) => `${nc}_${nr}`);

        if (!unopened.length) continue;
        unopened.forEach((k) => vars.add(k));
        cons.push({ vars: unopened, count: cell.num });
      }
    }

    return { vars: Array.from(vars), constraints: cons };
  }

  function checkWrongFlags() {
    if (!flaggedKeys.size) {
      return { level: "ok", summary: "目前沒有插旗。", wrongKeys: [] };
    }

    // If CSP is empty, we can't prove anything.
    if (!csp.constraints.length) {
      return { level: "warn", summary: "目前資訊不足，無法判定旗子是否插錯。", wrongKeys: [] };
    }

    const MAX_VARS = Math.max(12, Math.min(40, Number.parseInt(SETTINGS.maxVars, 10) || 28));
    const TIME_BUDGET_MS = Math.max(30, Math.min(800, Number.parseInt(SETTINGS.timeBudgetMs, 10) || 180));
    const wrongKeys = [];
    let skippedFlags = 0;
    let timedOutFlags = 0;
    let inconsistent = false;

    // Partition by connected components (via constraints).
    const components = buildComponents(csp.vars, csp.constraints);

    for (const comp of components) {
      if (comp.vars.length > MAX_VARS) {
        // Too large to brute force as a whole: try per-flag localized proof.
        for (const flagKey of comp.flags) {
          const local = buildLocalComponent(comp, flagKey, MAX_VARS);
          if (!local) {
            skippedFlags += 1;
            continue;
          }

          // If local constraints already show "flag cannot be mine", it's definitely wrong globally.
          const fixed = new Map([[flagKey, 1]]);
          const res = existsSolution(local, fixed, TIME_BUDGET_MS);
          if (res === false) wrongKeys.push(flagKey);
          else if (res === null) timedOutFlags += 1;
          else skippedFlags += 1;
        }
        continue;
      }

      // If the component has no solutions at all, something is inconsistent (at least one flag is wrong somewhere).
      const base = existsSolution(comp, null, TIME_BUDGET_MS);
      if (base === null) {
        timedOutFlags += comp.flags.length;
        continue;
      }
      if (base === false) {
        inconsistent = true;
        // We still can't point to a specific wrong flag with certainty.
        skippedFlags += comp.flags.length;
        continue;
      }

      for (const flagKey of comp.flags) {
        // A flag is definitely wrong if there is NO solution with that cell being a mine.
        const fixed = new Map([[flagKey, 1]]);
        const possibleAsMine = existsSolution(comp, fixed, TIME_BUDGET_MS);
        if (possibleAsMine === null) timedOutFlags += 1;
        else if (possibleAsMine === false) wrongKeys.push(flagKey);
      }
    }

    // Mark wrong flags on board for easy locating.
    wrongKeys.forEach((k, idx) => {
      const el = keyToEl.get(k);
      if (!el) return;
      markWrongFlag(el, idx + 1);
    });

    if (wrongKeys.length) {
      const extras = [];
      if (skippedFlags) extras.push(`${skippedFlags} 面旗無法做確定判定`);
      if (timedOutFlags) extras.push(`${timedOutFlags} 面旗因計算超時而跳過`);
      const extra = extras.length ? `（另有 ${extras.join("；")}）` : "";
      return {
        level: "bad",
        summary: `有 ${wrongKeys.length} 面旗「確定插錯」${extra}，已用紅色「!」標出，建議先取消再繼續推理。`,
        wrongKeys,
      };
    }

    if (inconsistent) {
      return {
        level: "warn",
        summary:
          "目前盤面資訊出現矛盾：至少有一面旗可能插錯，但無法確定是哪一面（可能區域過大或矛盾分散）。",
        wrongKeys: [],
      };
    }

    if (skippedFlags || timedOutFlags) {
      return {
        level: "warn",
        summary: `已檢查部分旗子；另有 ${skippedFlags} 面旗目前資訊不足以做「確定」判定，${timedOutFlags} 面旗因計算超時而跳過。`,
        wrongKeys: [],
      };
    }

    return { level: "ok", summary: "目前沒有找到「確定插錯」的旗子。", wrongKeys: [] };
  }

  function markWrongFlag(el, idx) {
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") el.style.position = "relative";

    el.style.outline = "2px solid rgba(239,68,68,0.95)";
    el.style.outlineOffset = "-2px";

    const badge = document.createElement("div");
    badge.className = "__solver_overlay";
    badge.textContent = "!";
    Object.assign(badge.style, {
      position: "absolute",
      right: "2px",
      top: "2px",
      padding: "1px 4px",
      borderRadius: "4px",
      background: "rgba(239,68,68,0.92)",
      color: "#fff",
      fontSize: "10px",
      lineHeight: "12px",
      zIndex: 99999,
      pointerEvents: "none",
      userSelect: "none",
      boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
      opacity: "0.98",
    });
    el.appendChild(badge);
  }

  function buildComponents(allVars, allConstraints) {
    // Union-Find over vars, edges exist when two vars appear in the same constraint.
    const parent = new Map();
    const find = (x) => {
      let p = parent.get(x) ?? x;
      if (p !== x) p = find(p);
      parent.set(x, p);
      return p;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    allVars.forEach((v) => parent.set(v, v));

    allConstraints.forEach((con) => {
      const vs = con.vars;
      for (let i = 1; i < vs.length; i++) union(vs[0], vs[i]);
    });

    const rootToVars = new Map();
    allVars.forEach((v) => {
      const root = find(v);
      const list = rootToVars.get(root) ?? [];
      list.push(v);
      rootToVars.set(root, list);
    });

    const components = [];
    for (const vars of rootToVars.values()) {
      const varSet = new Set(vars);
      const constraints = allConstraints
        .filter((c) => c.vars.some((v) => varSet.has(v)))
        .map((c) => ({ vars: c.vars.filter((v) => varSet.has(v)), count: c.count }));

      const flags = vars.filter((v) => flaggedKeys.has(v));
      components.push({ vars, constraints, flags });
    }

    // Drop components with no constraints (can't prove anything).
    return components.filter((c) => c.constraints.length);
  }

  function buildLocalComponent(component, centerVar, maxVars) {
    // Grow a subgraph around centerVar by alternating constraints/vars until maxVars.
    const vars = new Set([centerVar]);
    const constraints = [];

    // Index: var -> constraints
    const varToConstraints = new Map();
    component.constraints.forEach((con, idx) => {
      con.vars.forEach((v) => {
        const list = varToConstraints.get(v) ?? [];
        list.push(idx);
        varToConstraints.set(v, list);
      });
    });

    const queue = [centerVar];
    const usedCon = new Set();

    while (queue.length && vars.size < maxVars) {
      const v = queue.shift();
      const conIdxs = varToConstraints.get(v) ?? [];
      for (const ci of conIdxs) {
        if (usedCon.has(ci)) continue;
        usedCon.add(ci);
        const con = component.constraints[ci];
        constraints.push(con);

        for (const nv of con.vars) {
          if (vars.size >= maxVars) break;
          if (vars.has(nv)) continue;
          vars.add(nv);
          queue.push(nv);
        }
        if (vars.size >= maxVars) break;
      }
    }

    if (!constraints.length) return null;

    const varList = Array.from(vars);
    const varSet = vars;
    const conList = constraints.map((c) => ({
      vars: c.vars.filter((v) => varSet.has(v)),
      count: c.count,
    }));

    // Keep only constraints that still have vars after filtering.
    const filteredCons = conList.filter((c) => c.vars.length);
    const flags = varList.filter((v) => flaggedKeys.has(v));
    return { vars: varList, constraints: filteredCons, flags };
  }

  function existsSolution(component, fixed, timeBudgetMs) {
    const vars = component.vars;
    const cons = component.constraints;
    const n = vars.length;
    const m = cons.length;
    const deadline = typeof timeBudgetMs === "number" ? performance.now() + timeBudgetMs : null;

    const varIndex = new Map(vars.map((v, i) => [v, i]));
    const conVars = cons.map((c) => c.vars.map((v) => varIndex.get(v)));
    const conCount = cons.map((c) => c.count);
    const conLen = conVars.map((a) => a.length);

    const varToCons = Array.from({ length: n }, () => []);
    conVars.forEach((arr, ci) => arr.forEach((vi) => varToCons[vi].push(ci)));

    const assigned = new Int8Array(n);
    assigned.fill(-1);

    const assignedCount = new Int16Array(m);
    const mineCount = new Int16Array(m);

    // Apply fixed assignments.
    if (fixed) {
      for (const [k, v] of fixed.entries()) {
        const idx = varIndex.get(k);
        if (idx == null) continue;
        if (!applyAssign(idx, v)) return false;
      }
    }

    // Variable order: most constrained first.
    const order = [...Array(n).keys()].sort((a, b) => varToCons[b].length - varToCons[a].length);

    const ok = dfs(0);
    return ok;

    function dfs(pos) {
      if (deadline != null && performance.now() > deadline) return null;
      // Find next unassigned in order.
      let next = -1;
      for (let i = pos; i < order.length; i++) {
        const v = order[i];
        if (assigned[v] === -1) {
          next = v;
          break;
        }
      }

      if (next === -1) return true;

      // Try 0 then 1 (favors finding any solution quickly).
      if (applyAssign(next, 0)) {
        const r = dfs(pos + 1);
        if (r) return true;
        if (r === null) return null;
        undoAssign(next);
      } else {
        undoAssign(next);
      }

      if (applyAssign(next, 1)) {
        const r = dfs(pos + 1);
        if (r) return true;
        if (r === null) return null;
        undoAssign(next);
      } else {
        undoAssign(next);
      }

      return false;
    }

    // Minimal reversible updates: we recompute deltas per var on undo by scanning constraints.
    function applyAssign(vi, val) {
      if (assigned[vi] !== -1) return assigned[vi] === val;
      assigned[vi] = val;
      for (const ci of varToCons[vi]) {
        assignedCount[ci] += 1;
        mineCount[ci] += val;

        const needed = conCount[ci];
        const mines = mineCount[ci];
        const used = assignedCount[ci];
        const unassignedLeft = conLen[ci] - used;

        if (mines > needed) return false;
        if (mines + unassignedLeft < needed) return false;
      }
      return true;
    }

    function undoAssign(vi) {
      const val = assigned[vi];
      if (val === -1) return;
      assigned[vi] = -1;
      for (const ci of varToCons[vi]) {
        assignedCount[ci] -= 1;
        mineCount[ci] -= val;
      }
    }
  }

  function installAutoClear(clearFn) {
    if (window.__solverAutoClearInstalled) return;
    window.__solverAutoClearInstalled = true;

    // Any interaction with a cell should clear hints (click to open / right-click to flag).
    const onPointerDown = (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[id^="cell_"]')) clearFn();
    };
    document.addEventListener("pointerdown", onPointerDown, true);

    // New game / restart button (best-effort; site may vary).
    const onClick = (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.closest("#face, .face, #newgame, .newgame, .new-game")) clearFn();
    };
    document.addEventListener("click", onClick, true);

    // If the board updates (cell class changes), clear hints once.
    const classObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== "attributes") continue;
        if (m.attributeName !== "class") continue;
        const target = m.target;
        if (!(target instanceof Element)) continue;
        if (!target.matches?.('[id^="cell_"]')) continue;
        clearFn();
        break;
      }
    });

    // Observe existing cells; if a new game rebuilds DOM, the pointerdown/click handlers still work.
    document.querySelectorAll('[id^="cell_"]').forEach((el) => {
      classObs.observe(el, { attributes: true, attributeFilter: ["class"] });
    });

    // Board rebuilds may remove/add many cell nodes without changing existing classes;
    // watch for cell nodes being added/removed in the DOM.
    const domObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== "childList") continue;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        for (const n of nodes) {
          if (!(n instanceof Element)) continue;
          if (n.id?.startsWith?.("cell_") || n.querySelector?.('[id^="cell_"]')) {
            clearFn();
            return;
          }
        }
      }
    });
    domObs.observe(document.body, { childList: true, subtree: true });

    window.__solverAutoClearObserver = { classObs, domObs };
  }
})();
