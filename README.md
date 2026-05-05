# 賽車 / Racing

卡牌與賽道為主的 HTML5 試玩專案：**New York New York**（`index.html`）為主遊戲試玩；另含 **最後車手 / Final Driver** 的 QTE 測試頁（`qte-test.html`）與各自對應的規則文件。

## 線上瀏覽（GitHub Pages）

本倉庫若已啟用 GitHub Pages（根目錄為網站根），可直接使用下列連結（依實際帳號／倉庫名稱為準）：

| 頁面 | 網址 |
|------|------|
| 主遊戲試玩（New York New York） | https://sam0404044.github.io/racing/ |
| **主遊戲規則（Markdown）** | https://github.com/sam0404044/racing/blob/main/GAME_RULES_NEW_YORK.md |
| QTE 測試（最後車手） | https://sam0404044.github.io/racing/qte-test.html |
| 最後車手規則（HTML） | https://sam0404044.github.io/racing/GAME_RULES.html |
| 最後車手規則（Markdown） | https://github.com/sam0404044/racing/blob/main/GAME_RULES.md |

若你 fork 或改名倉庫，請把路徑中的 `sam0404044` / `racing` 改成自己的帳號與專案名稱。

## 本機執行

此專案為靜態檔案，無需建置步驟：

1. 直接以瀏覽器開啟 `index.html` 或 `qte-test.html`，或  
2. 在專案目錄啟動本機靜態伺服器（可避免部分瀏覽器對 `file://` 的限制），例如：

```bash
npx --yes serve .
```

## 專案結構（精簡）

| 檔案 / 目錄 | 說明 |
|-------------|------|
| `index.html` | 主遊戲介面 |
| `game.js`, `cards.js`, `track.js` | 遊戲邏輯、卡牌、賽道 |
| `styles.css` | 主樣式 |
| `qte-test.html`, `qte-test.js`, `qte-test.css` | QTE 測試頁（Canvas） |
| `qte-preview.png` | QTE 頁分享預覽圖 |
| `GAME_RULES_NEW_YORK.md` | 主遊戲（index）規則 |
| `GAME_RULES.md`, `GAME_RULES.html` | 最後車手 QTE 試玩規則 |

## 授權

若未另行標示，請以倉庫內既有授權或作者約定為準。
