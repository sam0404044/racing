// ─── 入口點 ─────────────────────────────────────────────────────────────
// 等 DOM 準備好後抓 #qteTestRoot 並啟動遊戲。

import { start } from './game.js';

function initQteTest() {
  const root = document.querySelector('#qteTestRoot');
  if (root) start(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQteTest);
} else {
  initQteTest();
}
