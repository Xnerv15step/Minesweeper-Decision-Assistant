function runSolver() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]?.id) return;
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ["solver.js"],
    });
  });
}

// 點擊插件
chrome.action.onClicked.addListener(runSolver);

// 快捷鍵
chrome.commands.onCommand.addListener((command) => {
  if (command === "run-solver") {
    runSolver();
  }
});
