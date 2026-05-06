const DEFAULTS = {
  suggestions: 5,
  maxVars: 28,
  timeBudgetMs: 180,
};

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function execInTab(tabId, func, args = []) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: "ISOLATED",
  });
}

async function runSolver(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["solver.js"],
    world: "ISOLATED",
  });
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("suggestions").value = stored.suggestions;
  document.getElementById("maxVars").value = stored.maxVars;
  document.getElementById("timeBudgetMs").value = stored.timeBudgetMs;
}

async function saveSettings() {
  const suggestions = clampInt(document.getElementById("suggestions").value, 1, 10, DEFAULTS.suggestions);
  const maxVars = clampInt(document.getElementById("maxVars").value, 12, 40, DEFAULTS.maxVars);
  const timeBudgetMs = clampInt(
    document.getElementById("timeBudgetMs").value,
    30,
    800,
    DEFAULTS.timeBudgetMs,
  );

  await chrome.storage.sync.set({ suggestions, maxVars, timeBudgetMs });
}

async function main() {
  await loadSettings();

  ["suggestions", "maxVars", "timeBudgetMs"].forEach((id) => {
    document.getElementById(id).addEventListener("change", async () => {
      await saveSettings();
      setStatus("已儲存設定");
      setTimeout(() => setStatus(""), 900);
    });
  });

  document.getElementById("run").addEventListener("click", async () => {
    setStatus("計算中…");
    const tabId = await getActiveTabId();
    if (!tabId) return setStatus("找不到目前分頁");
    await runSolver(tabId);
    setStatus("完成");
    setTimeout(() => setStatus(""), 900);
  });

  document.getElementById("clear").addEventListener("click", async () => {
    const tabId = await getActiveTabId();
    if (!tabId) return;
    await execInTab(tabId, () => {
      document.querySelectorAll(".__solver_overlay").forEach((e) => e.remove());
      document.getElementById("__solver_panel")?.remove();
      document.querySelectorAll('[id^="cell_"]').forEach((el) => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      });
    });
    setStatus("已清除提示");
    setTimeout(() => setStatus(""), 900);
  });
}

main().catch((e) => {
  console.error(e);
  setStatus("發生錯誤，請看 Console");
});

