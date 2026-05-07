/**
 * background.js
 *
 * 作用：這是 Chrome 擴充功能的 Service Worker (背景腳本)。
 * 負責監聽瀏覽器層級的事件（如點擊圖標、按下快捷鍵），
 * 並負責將核心邏輯腳本 (solver.js) 注入到當前活動的網頁中。
 */

/**
 * 執行 Solver 的核心函式
 * 作用：尋找當前使用者正在瀏覽的標籤頁，並在該頁面執行指定的 JS 檔案。
 */
function runSolver() {
  // 查詢當前視窗中處於「活動狀態 (active)」的標籤頁
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    // 安全檢查：確保有抓取到標籤頁且標籤頁有有效的 ID
    if (!tabs || !tabs[0]?.id) return;

    // 使用腳本注入 API
    chrome.scripting.executeScript({
      // 指定注入的目標為當前標籤頁的 ID
      target: { tabId: tabs[0].id },
      // 要注入並執行的檔案清單
      files: ["solver.js"],
    });
  });
}

/**
 * 事件監聽 1：點擊擴充功能圖標
 * 當使用者點擊瀏覽器工具列上的插件圖示時，觸發 runSolver
 */
chrome.action.onClicked.addListener(runSolver);

/**
 * 事件監聽 2：鍵盤快捷鍵
 * 當使用者按下在 manifest.json 中定義的快捷鍵時觸發
 * @param {string} command - 觸發的指令名稱（需與 manifest 中的 commands 欄位對應）
 */
chrome.commands.onCommand.addListener((command) => {
  // 檢查指令名稱是否為預設的 "run-solver"
  if (command === "run-solver") {
    runSolver();
  }
});
