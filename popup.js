/**
 * popup.js
 *
 * 作用：處理彈出視窗介面的邏輯，包括：
 * 1. 設定值 (Settings) 的讀取與存入同步儲存空間。
 * 2. 控制運算核心 (solver.js) 的執行。
 * 3. 清理網頁上的提示標記 (UI Overlays)。
 */

// 預設設定值常數
const DEFAULTS = {
  suggestions: 5, // 建議顯示的格子數量
  maxVars: 28, // 複雜邏輯運算的最大變數限制（防止卡死）
  timeBudgetMs: 180, // 運算時間上限（毫秒）
};

/**
 * 獲取當前使用中的分頁 ID
 */
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

/**
 * 在指定的標籤頁中執行特定函式
 * @param {number} tabId - 目標分頁 ID
 * @param {Function} func - 要注入的函式
 * @param {Array} args - 函式的參數
 */
async function execInTab(tabId, func, args = []) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: "ISOLATED", // 在擴充功能專屬的隔離環境執行，不干擾網頁原本的 JS
  });
}

/**
 * 在分頁中執行 solver.js 腳本
 */
async function runSolver(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["solver.js"],
    world: "ISOLATED",
  });
}

/**
 * 更新 Popup 視窗下方的狀態文字
 */
function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

/**
 * 數值範圍限制器：確保使用者輸入的值在合理區間內
 * @param {string|number} v - 欲檢查的值
 */
function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback; // 非數字則回傳預設值
  return Math.max(min, Math.min(max, n));
}

/**
 * 從 chrome.storage 讀取設定並套用到 UI 表單
 */
async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("suggestions").value = stored.suggestions;
  document.getElementById("maxVars").value = stored.maxVars;
  document.getElementById("timeBudgetMs").value = stored.timeBudgetMs;
}

/**
 * 從 UI 表單讀取數值並儲存到 chrome.storage
 */
async function saveSettings() {
  const suggestions = clampInt(
    document.getElementById("suggestions").value,
    1,
    10,
    DEFAULTS.suggestions,
  );
  const maxVars = clampInt(
    document.getElementById("maxVars").value,
    12,
    40,
    DEFAULTS.maxVars,
  );
  const timeBudgetMs = clampInt(
    document.getElementById("timeBudgetMs").value,
    30,
    800,
    DEFAULTS.timeBudgetMs,
  );

  await chrome.storage.sync.set({ suggestions, maxVars, timeBudgetMs });
}

/**
 * 主程式入口
 */
async function main() {
  // 1. 初始化頁面數據
  await loadSettings();

  // 2. 監聽設定變動：當欄位內容改變時自動儲存
  ["suggestions", "maxVars", "timeBudgetMs"].forEach((id) => {
    document.getElementById(id).addEventListener("change", async () => {
      await saveSettings();
      setStatus("已儲存設定");
      setTimeout(() => setStatus(""), 900); // 0.9秒後清除文字
    });
  });

  // 3. 監聽「開始計算」按鈕
  document.getElementById("run").addEventListener("click", async () => {
    setStatus("計算中…");
    const tabId = await getActiveTabId();
    if (!tabId) return setStatus("找不到目前分頁");

    await runSolver(tabId);

    setStatus("完成");
    setTimeout(() => setStatus(""), 900);
  });

  // 4. 監聽「清除提示」按鈕
  document.getElementById("clear").addEventListener("click", async () => {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    // 注入一段匿名函式來清理網頁上的 DOM 標記
    await execInTab(tabId, () => {
      // 移除所有機率覆蓋層
      document.querySelectorAll(".__solver_overlay").forEach((e) => e.remove());
      // 移除提示面板
      document.getElementById("__solver_panel")?.remove();
      // 還原格子的框線樣式
      document.querySelectorAll('[id^="cell_"]').forEach((el) => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      });
    });

    setStatus("已清除提示");
    setTimeout(() => setStatus(""), 900);
  });
}

// 啟動主程式並捕捉可能的錯誤
main().catch((e) => {
  console.error(e);
  setStatus("發生錯誤，請看 Console");
});
