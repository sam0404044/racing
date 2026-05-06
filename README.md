# 賽車 / Racing

卡牌與賽道為主的 HTML5 專案：**最後車手 / Final Driver**（`index.html`）已成為正式版本與後續迭代基礎；原本的 **New York New York** 試玩版保留為歷史參考檔。

## 線上瀏覽（GitHub Pages）

本倉庫若已啟用 GitHub Pages（根目錄為網站根），可直接使用下列連結（依實際帳號／倉庫名稱為準）：

| 頁面 | 網址 |
|------|------|
| 最後車手 / Final Driver | https://sam0404044.github.io/racing/ |
| 最後車手規則（HTML） | https://sam0404044.github.io/racing/GAME_RULES.html |
| 最後車手規則（Markdown） | https://github.com/sam0404044/racing/blob/main/GAME_RULES.md |
| New York New York 歷史試玩 | https://sam0404044.github.io/racing/index-legacy-new-york-playtest.html |
| New York New York 規則（Markdown） | https://github.com/sam0404044/racing/blob/main/GAME_RULES_NEW_YORK.md |

若你 fork 或改名倉庫，請把路徑中的 `sam0404044` / `racing` 改成自己的帳號與專案名稱。

## 本機執行

此專案為靜態檔案，無需建置步驟：

1. 直接以瀏覽器開啟 `index.html`，或  
2. 在專案目錄啟動本機靜態伺服器（可避免部分瀏覽器對 `file://` 的限制），例如：

```bash
npx --yes serve .
```

## 專案結構（精簡）

| 檔案 / 目錄 | 說明 |
|-------------|------|
| `index.html` | 最後車手正式版入口 |
| `final-driver.js`, `final-driver.css` | 最後車手正式版 Canvas 遊戲 |
| `qte-test.html` | 舊連結相容入口，載入正式版資源 |
| `index-legacy-new-york-playtest.html` | New York New York 歷史試玩頁 |
| `game.js`, `cards.js`, `track.js`, `styles.css` | New York New York 歷史試玩資源 |
| `qte-preview.png` | 最後車手分享預覽圖 |
| `GAME_RULES.md`, `GAME_RULES.html` | 最後車手規則 |
| `GAME_RULES_NEW_YORK.md` | New York New York 歷史規則 |

## 授權

若未另行標示，請以倉庫內既有授權或作者約定為準。
