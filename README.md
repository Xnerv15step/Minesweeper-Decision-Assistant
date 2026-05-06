# Minesweeper Decision Assistant
<img width="1280" height="800" alt="Screenshot_20260506183427" src="https://github.com/user-attachments/assets/82798109-c106-4ba9-83ea-6beea8b35027" />

Chrome Extension（Manifest V3）for **minesweeperonline.com**：
當你玩到中盤遇到必猜局面時，手動一鍵計算並標示下一步建議，
並提供側欄分析與「確定插錯旗」檢查。

> 本專案為非官方玩家輔助工具，與 Minesweeper Online 無任何隸屬或關聯。

## Features

- 手動觸發：點擊擴充功能 icon 或快捷鍵 `Alt+M` 才會計算（不會自動跑）
- 多格建議：在盤面以 `#1 ~ #N` 標示多個候選格（提示不遮擋格子、不中斷操作）
- 側欄分析：顯示推理線索數量、候選格風險比較等資訊（風險為快速估算，非精確枚舉）
- 旗子檢查（確定才提示）：在可證明的情況下標出「確定插錯」的旗（紅色 `!`）
- 自動清除提示：新局、點開格子或插旗後，上一輪提示會自動消失
- 可調整設定：popup 可調整建議顯示數量與旗子檢查強度/時間上限

## Install (Developer Mode)

1. 打開 Chrome → `chrome://extensions/`
2. 右上角開啟「開發人員模式」
3. 點「載入未封裝項目」並選擇此資料夾  
   - Windows 範例：`C:\Users\DET\minesweeper-solver`（或你的 clone 路徑）
4. 進入 Minesweeper Online 遊戲頁面

## Usage

- 在遊戲頁面點擊擴充功能 icon → 按 `顯示建議`
- 或使用快捷鍵：`Alt+M`
- 若要移除目前提示：popup 內按 `清除提示`

盤面上只顯示 `#1 ~ #N` 的建議順序；更精確的風險/說明在右上角側欄面板。

## Settings

在擴充功能 popup 中可調整：

- 建議顯示幾格：預設 5（1~10）
- 旗子檢查強度（maxVars）：越高越可能判得出「確定插錯」，但也越慢
- 每次檢查上限（ms）：避免卡住頁面；超時會顯示「計算超時跳過」

設定使用 `chrome.storage.sync` 保存。

## Permissions

此擴充功能僅使用必要權限：

- `activeTab` / `scripting`：在你目前的遊戲分頁中注入 `solver.js` 進行計算並顯示提示
- `storage`：保存你的設定（建議顯示數量與檢查強度等）

## Project Structure

- `manifest.json`：Extension 設定（MV3）
- `background.js`：點擊 icon / 快捷鍵觸發注入 `solver.js`
- `solver.js`：讀取盤面 DOM、建立約束、產生候選建議、側欄面板、旗子確定性檢查
- `popup.html` / `popup.js`：popup UI（顯示建議、清除提示、設定）
- `icons/`：Extension icons

## Notes / Limitations

- 風險數值是 heuristic 快速估算（非完整枚舉所有可能盤面），用於「純邏輯無法判斷」時的輔助決策。
- 「確定插錯旗」在大型邊界區域可能會因為效能限制而改為局部檢查，或在時間上限內無法完成。
  此時側欄會提示「資訊不足/超時跳過」，不會硬判。

## License

尚未選定授權條款。
若你準備上架商店或開源分享，建議加入 `LICENSE`（例如 MIT）。
