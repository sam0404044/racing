// ─────────────────────────────────────────────
//  cards.js v2 — 指令卡定義
// ─────────────────────────────────────────────

const KW = {
  SKILLED:  "熟練",
  BURDEN:   "負擔",
  REACTION: "反應",
};

// ── 工具（供 resolve 使用）────────────────────
function getOppositeSide(side) { return side === "left" ? "right" : "left"; }
function randomSide() { return Math.random() < 0.5 ? "left" : "right"; }

function removeCard(pile, idx) {
  const fc = pile.splice(idx, 1)[0];
  if (!fc) return null;
  game.discard.push(fc);
  if (fc.keywords?.includes(KW.BURDEN)) {
    game.playerBurden++;
    game.message(`「${fc.name}」移除（負擔：佔用 INT）。`, "warn");
  } else {
    game.message(`「${fc.name}」移除。`, "warn");
  }
  fireEvent("onCardRemoved", { card: fc, pile, byOpponent: false });
  return fc;
}

function removeNpcCard(pile, idx, byOpponent = true) {
  const fc = pile.splice(idx, 1)[0];
  if (!fc) return null;
  game.discard.push(fc);
  game.message(`對手「${fc.name}」被移除。`);
  fireEvent("onCardRemoved", { card: fc, pile, byOpponent });
  return fc;
}

function removeRandomNpcCard() {
  const all = [...game.npcLeft, ...game.npcRight];
  if (all.length === 0) return;
  const target = all[Math.floor(Math.random() * all.length)];
  const pile = game.npcLeft.includes(target) ? game.npcLeft : game.npcRight;
  const i = pile.indexOf(target);
  if (i !== -1) removeNpcCard(pile, i, true);
}

function operateEngineAuto() {
  if (game.engineBlockedThisTurn) {
    game.message("動力單元已封鎖（增壓輸出效果），跳過。");
    return;
  }
  const comp = game.components?.engine;
  if (!comp || comp.components.length === 0) return;
  const el = comp.components[comp.ptr];
  const speedBefore = game.player.speed;
  el.effect(game.player, game, null);
  game.turnEngineSpeed += (game.player.speed - speedBefore);
  clampCar(game.player);
  comp.ptr = (comp.ptr + 1) % comp.components.length;
}

function operateAeroAuto() {
  const comp = game.components?.aero;
  if (!comp || comp.components.length === 0) return;
  const el = comp.components[comp.ptr];
  el.effect(game.player, game, null);
  clampCar(game.player);
  comp.ptr = (comp.ptr + 1) % comp.components.length;
}

// ── 玩家指令牌庫 ──────────────────────────────
const cardPool = [

  // ── 新設計牌 ────────────────────────────────


  { id:"step_by_step", name:"步步進逼", type:"complex", pressure:0,
    keywords:[KW.SKILLED], bonus:"operate",
    text:"X 為場上獲得加速的牌數量，壓力值 = X。",
    changes:{},
    resolve(ctx) {
      const x = [...game.playerLeft,...game.playerRight]
        .filter(c => c.changes?.speed_bs > 0 || c.changes?.speed > 0).length;
      ctx.card.pressure = x;
      game.message(`步步進逼：${x} 張加速牌，壓力值 = ${x}。`);
    }
  },

  { id:"double_lane", name:"二次變線", type:"complex", pressure:1,
    bonus:"operate",
    text:"將自己場上所有牌轉移到彎道外側。移除此牌。",
    changes:{},
    resolve(ctx) {
      const oppSide = getOppositeSide(ctx.side);
      const fromPile = ctx.side==="left" ? game.playerLeft : game.playerRight;
      const toPile   = oppSide==="left"  ? game.playerLeft : game.playerRight;
      const toMove = fromPile.filter(c => c !== ctx.card);
      toMove.forEach(c => {
        toPile.push(c);
        c._currentSide = oppSide;  // 更新側別記錄
        fromPile.splice(fromPile.indexOf(c), 1);
        // 若比賽節奏指定側 = oppSide，觸發
        fireEvent("onCardMoved", { card: c, fromSide: ctx.side, toSide: oppSide });
      });
      game.message(`二次變線：${toMove.length} 張牌移至${oppSide==="left"?"左":"右"}側。`);
      const selfIdx = fromPile.indexOf(ctx.card);
      if (selfIdx !== -1) removeCard(fromPile, selfIdx);
    }
  },

  { id:"tyre_manage", name:"輪胎管理", type:"complex", pressure:0,
    keywords:[KW.BURDEN],
    text:"選擇場上 X 張牌移除（不含此牌），-X 速度，下次消耗輪胎時預防 X/2 耗損。移除此牌。",
    changes:{},
    resolve(ctx) {
      const choices = [...game.playerLeft,...game.playerRight].filter(c => c !== ctx.card);
      game.pendingChoice = {
        type:"multiSelect", prompt:"輪胎管理：選擇要移除的牌（可多選）", choices,
        onConfirm(selected) {
          const x = selected.length;
          selected.forEach(fc => {
            const pile = game.playerLeft.includes(fc) ? game.playerLeft : game.playerRight;
            removeCard(pile, pile.indexOf(fc));
          });
          applyChanges(game.player, {speed:-x});
          game.tyreSaveCharges = (game.tyreSaveCharges||0) + Math.floor(x/2);
          game.message(`輪胎管理：移除 ${x} 張，速度 -${x}，預防 ${Math.floor(x/2)} 次輪胎耗損。`);
          const pile = ctx.side==="left" ? game.playerLeft : game.playerRight;
          const idx = pile.indexOf(ctx.card);
          if (idx!==-1) removeCard(pile, idx);
          game.pendingChoice = null; render();
        },
        onSkip() {
          const pile = ctx.side==="left" ? game.playerLeft : game.playerRight;
          const idx = pile.indexOf(ctx.card);
          if (idx!==-1) removeCard(pile, idx);
          game.pendingChoice = null; render();
        }
      };
      render();
    }
  },

  { id:"radio_intercept", name:"無線電監聽", type:"simple", pressure:0,
    text:"查看對手此牌同側的總壓力值並移除此牌。或：將對手場上一道指令移除。",
    changes:{},
    resolve(ctx) {
      game.pendingChoice = {
        type:"twoOption",
        options:[
          { label:"查看同側壓力", action() {
            const npcPile = ctx.side==="left" ? game.npcLeft : game.npcRight;
            const total = npcPile.reduce((s,c)=>s+(c.pressure||0),0);
            game.message(`無線電監聽：對手${ctx.side==="left"?"左":"右"}側總壓力 ${total}。`);
            const pile = ctx.side==="left" ? game.playerLeft : game.playerRight;
            removeCard(pile, pile.indexOf(ctx.card));
            game.pendingChoice = null; render();
          }},
          { label:"移除對手一道指令", action() {
            const all = [...game.npcLeft,...game.npcRight];
            if (all.length===0) { game.message("對手場上無牌。"); game.pendingChoice=null; render(); return; }
            game.pendingChoice = {
              type:"singleSelect", prompt:"選擇要移除的對手指令", choices:all, maxSelect:1,
              onConfirm(sel) {
                sel.forEach(fc => { const p=game.npcLeft.includes(fc)?game.npcLeft:game.npcRight; removeNpcCard(p,p.indexOf(fc),true); });
                const pile = ctx.side==="left" ? game.playerLeft : game.playerRight;
                removeCard(pile, pile.indexOf(ctx.card));
                game.pendingChoice=null; render();
              }
            };
            render();
          }}
        ]
      };
      render();
    }
  },

  { id:"push_push", name:"Push! Push!", type:"complex", pressure:4,
    bonus:"tyre",
    text:"連續操作 3 次動力單元元件。",
    changes:{},
    resolve(ctx) {
      game.message(`Push! Push!：連續操作動力單元 3 次。`);
      for (let i=0; i<3; i++) operateEngineAuto();
    }
  },

  { id:"fake_cut", name:"假動作切線", type:"complex", pressure:2,
    text:"此回合結束時，可將自己一個行動換側。移除此牌。",
    changes:{},
    resolve(ctx) {
      ctx.card._fakeCutActive = true;
      game.message("假動作切線：回合結束時可換側一張牌。");
    },
    fieldEffects:{
      onRoundEnd() {
        const self = [...game.playerLeft,...game.playerRight].find(c=>c.id==="fake_cut"&&c._fakeCutActive);
        if (!self) return;
        const others = [...game.playerLeft,...game.playerRight].filter(c=>c!==self);
        if (others.length===0) { const p=game.playerLeft.includes(self)?game.playerLeft:game.playerRight; removeCard(p,p.indexOf(self)); return; }
        game.pendingChoice = {
          type:"singleSelect", prompt:"假動作切線：選擇換側的牌（或跳過）", choices:others, maxSelect:1,
          onConfirm(sel) {
            sel.forEach(fc=>{
              const fromLeft=game.playerLeft.includes(fc);
              const from=fromLeft?game.playerLeft:game.playerRight;
              const to=fromLeft?game.playerRight:game.playerLeft;
              from.splice(from.indexOf(fc),1); to.push(fc);
              game.message(`假動作切線：「${fc.name}」換至${fromLeft?"右":"左"}側。`);
            });
            const p=game.playerLeft.includes(self)?game.playerLeft:game.playerRight; removeCard(p,p.indexOf(self));
            game.pendingChoice=null; render();
          },
          onSkip() { const p=game.playerLeft.includes(self)?game.playerLeft:game.playerRight; removeCard(p,p.indexOf(self)); game.pendingChoice=null; render(); }
        };
        render();
      }
    }
  },

  { id:"race_rhythm", name:"比賽節奏", type:"complex", pressure:-2,
    text:"隨機指定 1 側，每次此牌移入或移出（含移除）此側時，操作動力元件。",
    changes:{},
    resolve(ctx) {
      const side = randomSide();
      ctx.card._rhythmSide = side;
      const sideName = side === "left" ? "左側" : "右側";
      game.message(`比賽節奏：隨機指定【${sideName}】。每次此牌移入或移出${sideName}時，觸發動力元件。`, "player");
    },
    fieldEffects:{
      onCardRemoved(payload) {
        if (payload.card.id !== "race_rhythm") return;
        const self = payload.card;
        if (self._currentSide === self._rhythmSide) {
          game.message(`比賽節奏：此牌從指定側（${self._rhythmSide === "left" ? "左" : "右"}側）移除，觸發動力元件。`, "player");
          operateEngineAuto();
        }
      },
      onCardMoved(payload) {
        if (payload.card.id !== "race_rhythm") return;
        const self = payload.card;
        if (payload.toSide === self._rhythmSide) {
          game.message(`比賽節奏：此牌移入指定側（${self._rhythmSide === "left" ? "左" : "右"}側），觸發動力元件。`, "player");
          operateEngineAuto();
        }
        if (payload.fromSide === self._rhythmSide) {
          game.message(`比賽節奏：此牌移出指定側（${self._rhythmSide === "left" ? "左" : "右"}側），觸發動力元件。`, "player");
          operateEngineAuto();
        }
      }
    }
  },

  { id:"mind_game", name:"心理戰", type:"info", pressure:2,
    text:"此牌在場上時，所有人都不能行動。回合開始時棄一張手牌，否則移除此牌。",
    changes:{},
    resolve(ctx) { game.message("心理戰：行動鎖定，直到此牌離場。", "player"); },
    fieldEffects:{
      lockActions: true,
      onRoundStart(payload) {
        const self = [...game.playerLeft, ...game.playerRight].find(c => c.id === "mind_game");
        if (!self) return;
        if (game.hand.length === 0) {
          game.message("心理戰：手牌為空，無法棄牌，移除此牌。", "warn");
          const pile = game.playerLeft.includes(self) ? game.playerLeft : game.playerRight;
          removeCard(pile, pile.indexOf(self));
          if (game._planPhasePending) finishPlanPhase();
          return;
        }
        game.pendingChoice = {
          type: "singleSelect",
          prompt: "心理戰：棄一張手牌，否則移除此牌。",
          choices: [...game.hand],
          maxSelect: 1,
          onConfirm(sel) {
            sel.forEach(fc => {
              game.hand.splice(game.hand.indexOf(fc), 1);
              game.discard.push(fc);
              game.message(`心理戰：棄「${fc.name}」，繼續鎖定行動。`, "player");
            });
            game.pendingChoice = null;
            if (game._planPhasePending) { finishPlanPhase(); return; }
            render();
          },
          onSkip() {
            game.message("心理戰：不棄牌，移除此牌。", "warn");
            const pile = game.playerLeft.includes(self) ? game.playerLeft : game.playerRight;
            removeCard(pile, pile.indexOf(self));
            game.pendingChoice = null;
            if (game._planPhasePending) { finishPlanPhase(); return; }
            render();
          }
        };
        render();
      }
    }
  },

  { id:"noise_jam", name:"雜訊干擾", type:"info", pressure:0,
    text:"隨機指定 1 側。回合結束時，若此牌在指定側：棄對手 1 道指令；反之，棄自己 1 道指令。",
    changes:{},
    resolve(ctx) { ctx.card._jamSide=randomSide(); game.message(`雜訊干擾：指定${ctx.card._jamSide==="left"?"左":"右"}側。`); },
    fieldEffects:{
      onRoundEnd() {
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="noise_jam");
        if (!self) return;
        const cur=game.playerLeft.includes(self)?"left":"right";
        if (cur===self._jamSide) {
          const all=[...game.npcLeft,...game.npcRight];
          if (all.length>0) { const t=all[Math.floor(Math.random()*all.length)]; const p=game.npcLeft.includes(t)?game.npcLeft:game.npcRight; removeNpcCard(p,p.indexOf(t),false); }
        } else {
          const myAll=[...game.playerLeft,...game.playerRight].filter(c=>c!==self);
          if (myAll.length>0) { const t=myAll[Math.floor(Math.random()*myAll.length)]; const p=game.playerLeft.includes(t)?game.playerLeft:game.playerRight; removeCard(p,p.indexOf(t)); }
        }
      }
    }
  },

  { id:"oversteer", name:"過度轉向", type:"simple", pressure:2,
    text:"可打出一道可操作的指令。移除此牌。",
    changes:{},
    resolve(ctx) {
      const eligible = game.hand.filter(c => c.bonus === "operate");
      if (eligible.length === 0) {
        game.message("過度轉向：手牌中無有附贈操作車子的指令，跳過。", "player");
        const pile = ctx.side === "left" ? game.playerLeft : game.playerRight;
        removeCard(pile, pile.indexOf(ctx.card));
        return;
      }
      game.pendingChoice = {
        type: "singleSelect",
        prompt: "過度轉向：選一張有附贈操作車子的手牌入場（立刻觸發附贈動作）",
        choices: eligible,
        maxSelect: 1,
        onConfirm(sel) {
          sel.forEach(card => {
            // 從手牌移除
            const i = game.hand.indexOf(card);
            if (i !== -1) game.hand.splice(i, 1);
            // 入場（面朝下）
            const targetSide = ctx.side;
            const fieldCard = { ...card, revealed: false, owner: "player", _currentSide: targetSide };
            if (targetSide === "left") game.playerLeft.push(fieldCard);
            else                       game.playerRight.push(fieldCard);
            game.message(`過度轉向：「${card.name}」入場至${targetSide === "left" ? "左" : "右"}側。`, "player");
            triggerBonus("operate", fieldCard);
          });
          // 移除過度轉向
          const pile = ctx.side === "left" ? game.playerLeft : game.playerRight;
          const idx = pile.indexOf(ctx.card);
          if (idx !== -1) removeCard(pile, idx);
          game.pendingChoice = null;
          render();
        }
      };
      render();
    }
  },

  { id:"mastery", name:"得心應手", type:"simple", pressure:2,
    bonus:"operate", bonusDouble:true,
    text:"此牌的附贈動作可執行兩次。",
    changes:{},
    resolve(ctx) { game.message("得心應手：附贈動作可執行兩次。"); }
  },

  { id:"fake_info", name:"假資訊", type:"info", pressure:0,
    text:"隨機指定 1 側。結算階段開始時，若此指令在指定側，此側施加壓力 +3。",
    changes:{},
    resolve(ctx) { ctx.card._fakeInfoSide=randomSide(); game.message(`假資訊：指定${ctx.card._fakeInfoSide==="left"?"左":"右"}側，結算時判斷。`); },
    fieldEffects:{
      onResolutionStart() {
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="fake_info");
        if (!self) return;
        if ((game.playerLeft.includes(self)?"left":"right")===self._fakeInfoSide) {
          self.pressure=(self.pressure||0)+3;
          game.message(`假資訊：在指定側，壓力 +3（現為 ${self.pressure}）。`);
        }
      }
    }
  },

  { id:"calm_breath", name:"調整呼吸", type:"simple", pressure:-2,
    bonus:"reorder",
    text:"將此牌與自己另 1 張牌移除，抽 1 張牌。",
    changes:{},
    resolve(ctx) {
      const others=[...game.playerLeft,...game.playerRight].filter(c=>c!==ctx.card);
      if (others.length===0) {
        const pile=ctx.side==="left"?game.playerLeft:game.playerRight;
        removeCard(pile,pile.indexOf(ctx.card));
        const d=drawCards(1); game.hand.push(...d);
        game.message("調整呼吸：無其他牌，僅移除此牌並抽 1 張。");
        return;
      }
      game.pendingChoice={
        type:"singleSelect", prompt:"調整呼吸：選擇另一張要移除的牌", choices:others, maxSelect:1,
        onConfirm(sel) {
          sel.forEach(fc=>{ const p=game.playerLeft.includes(fc)?game.playerLeft:game.playerRight; removeCard(p,p.indexOf(fc)); });
          const pile=ctx.side==="left"?game.playerLeft:game.playerRight;
          removeCard(pile,pile.indexOf(ctx.card));
          const d=drawCards(1); game.hand.push(...d);
          game.message("調整呼吸：移除 2 張，抽 1 張牌。");
          game.pendingChoice=null; render();
        }
      };
      render();
    }
  },

  { id:"full_approach", name:"全速逼近", type:"simple", pressure:3,
    bonus:"operate",
    text:"此側壓力 +3。操作 1 動力元件。",
    changes:{},
    resolve(ctx) {
      ctx.card.pressure=(ctx.card.pressure||0)+3;
      game.message(`全速逼近：壓力 +3（現為 ${ctx.card.pressure}）。`);
      operateEngineAuto();
    }
  },

  { id:"cut_corner", name:"截彎取直", type:"complex", pressure:4,
    bonus:"operate",
    text:"將自己另 1 側場上的 1 張牌棄掉，此牌施加壓力 +3。",
    changes:{},
    resolve(ctx) {
      const oppSide=getOppositeSide(ctx.side);
      const oppPile=oppSide==="left"?game.playerLeft:game.playerRight;
      if (oppPile.length===0) {
        ctx.card.pressure=(ctx.card.pressure||0)+3;
        game.message("截彎取直：另一側無牌，壓力 +3。");
        return;
      }
      game.pendingChoice={
        type:"singleSelect", prompt:"截彎取直：選擇另一側要棄掉的牌", choices:[...oppPile], maxSelect:1,
        onConfirm(sel) {
          sel.forEach(fc=>{ removeCard(oppPile,oppPile.indexOf(fc)); });
          ctx.card.pressure=(ctx.card.pressure||0)+3;
          game.message(`截彎取直：棄掉對側牌，壓力 +3（現為 ${ctx.card.pressure}）。`);
          game.pendingChoice=null; render();
        }
      };
      render();
    }
  },

  { id:"plasma_boost", name:"等離子增壓", type:"simple", pressure:1,
    bonus:"operate", text:"+1 SP。", changes:{sp:1},
    resolve(ctx) { applyChanges(ctx.owner,{sp:1}); game.message("等離子增壓：SP +1。"); }
  },

  { id:"racing_101", name:"賽車 101", type:"simple", pressure:2,
    keywords:[KW.BURDEN], bonus:"reorder",
    text:"抽 1 張牌。移除此牌。", changes:{},
    resolve(ctx) {
      const d=drawCards(1); game.hand.push(...d);
      game.message("賽車 101：抽 1 張牌。");
      const pile=ctx.side==="left"?game.playerLeft:game.playerRight;
      removeCard(pile,pile.indexOf(ctx.card));
    }
  },

  { id:"conserve", name:"養精蓄銳", type:"complex", pressure:1,
    keywords:[KW.BURDEN],
    text:"放逐一道手牌。下回合通訊階段自動入場，不佔出牌計數。移除此牌。", changes:{},
    resolve(ctx) {
      if (game.hand.length === 0) {
        game.message("養精蓄銳：手牌為空，無法放逐。");
        const pile = ctx.side === "left" ? game.playerLeft : game.playerRight;
        removeCard(pile, pile.indexOf(ctx.card));
        return;
      }
      game.pendingChoice = {
        type:"singleSelect", prompt:"養精蓄銳：選擇一張手牌放逐（下回合自動入場）",
        choices:[...game.hand], maxSelect:1,
        onConfirm(sel) {
          sel.forEach(fc => {
            const i = game.hand.indexOf(fc);
            if (i !== -1) {
              game.hand.splice(i, 1);
              // 儲存放逐牌，下回合通訊階段自動入場
              game.conservedCard = { ...fc };
              game.message(`養精蓄銳：「${fc.name}」放逐，下回合通訊階段自動入場。`);
            }
          });
          const pile = ctx.side === "left" ? game.playerLeft : game.playerRight;
          removeCard(pile, pile.indexOf(ctx.card));
          game.pendingChoice = null; render();
        }
      };
      render();
    }
  },

  { id:"phishing", name:"釣魚郵件", type:"complex", pressure:1,
    keywords:[KW.REACTION],
    text:"若此牌被對手移除時，對手下回合不能下指令。", changes:{},
    resolve(ctx) { game.message("釣魚郵件：在場監聽。"); },
    onRemovedByOpponent() { game.npcRadioBlocked=true; game.message("釣魚郵件觸發：對手下回合無法下指令！"); }
  },

  { id:"big_data", name:"大數據運算", type:"info", pressure:0,
    text:"OPT 2：看牌庫頂 2 張，以任意順序放回牌庫頂或牌庫底。", changes:{},
    resolve(ctx) {
      if (game.deck.length === 0) { game.message("大數據運算：牌庫為空。"); return; }
      const top = [];
      const count = Math.min(2, game.deck.length);
      for (let i = 0; i < count; i++) top.push(game.deck.pop());
      game.message(`大數據運算：查看牌庫頂 ${count} 張，請決定順序。`);
      game.pendingChoice = {
        type: "opt2",
        cards: top,
        onConfirm(toTop, toBottom) {
          // toTop 順序：第一個放入的最後在頂
          toBottom.forEach(c => game.deck.unshift(c));  // 放到底
          toTop.reverse().forEach(c => game.deck.push(c));  // 放到頂（最後 push 的在最頂）
          game.message(`大數據運算：${toTop.length} 張放回頂，${toBottom.length} 張放到底。`);
          game.pendingChoice = null; render();
        }
      };
      render();
    }
  },

  { id:"position_press", name:"卡位壓迫", type:"complex", pressure:2,
    bonus:"operate",
    text:"每次後方車在此側施加壓力，此牌壓力 +1。", changes:{},
    resolve(ctx) { ctx.card._pressSide=ctx.side; game.message("卡位壓迫：監聽後方車施壓。"); },
    fieldEffects:{
      onPressureApplied(payload) {
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="position_press");
        if (!self) return;
        if (payload.side===self._pressSide && payload.fromPosition===2) {
          self.pressure=(self.pressure||0)+1;
          game.message(`卡位壓迫：壓力 +1（現為 ${self.pressure}）。`);
        }
      }
    }
  },

  { id:"solidarity", name:"有難同當", type:"simple", pressure:0,
    keywords:[KW.REACTION],
    text:"若自己場上的牌被移除時，移除對手場上 1 張牌。移除此牌。", changes:{},
    resolve(ctx) { game.message("有難同當：在場監聽。"); },
    fieldEffects:{
      onCardRemoved(payload) {
        if (payload.byOpponent) return;
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="solidarity");
        if (!self||payload.card===self) return;
        removeRandomNpcCard();
        const p=game.playerLeft.includes(self)?game.playerLeft:game.playerRight;
        removeCard(p,p.indexOf(self));
      }
    }
  },

  { id:"schadenfreude", name:"幸災樂禍", type:"simple", pressure:1,
    keywords:[KW.REACTION],
    text:"當對方場上牌被移除時，操作 1 動力單元元件。移除此牌。", changes:{},
    resolve(ctx) { game.message("幸災樂禍：在場監聽。"); },
    fieldEffects:{
      onCardRemoved(payload) {
        if (!payload.byOpponent) return;
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="schadenfreude");
        if (!self) return;
        game.message("幸災樂禍觸發：操作動力單元。");
        operateEngineAuto();
        const p=game.playerLeft.includes(self)?game.playerLeft:game.playerRight;
        removeCard(p,p.indexOf(self));
      }
    }
  },

  { id:"kick_them_down", name:"落井下石", type:"simple", pressure:1,
    keywords:[KW.REACTION],
    text:"當對方場上牌被移除時，可以下 1 道反應指令。移除此牌。", changes:{},
    resolve(ctx) { game.message("落井下石：在場監聽。"); },
    fieldEffects:{
      onCardRemoved(payload) {
        if (!payload.byOpponent) return;
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="kick_them_down");
        if (!self) return;
        game.message("落井下石觸發：可下 1 道指令。");
        triggerBonus("reorder",self);
        const p=game.playerLeft.includes(self)?game.playerLeft:game.playerRight;
        removeCard(p,p.indexOf(self));
      }
    }
  },

  { id:"showoff", name:"作秀", type:"complex", pressure:0,
    keywords:[KW.SKILLED],
    text:"每當場上有牌被移除時，可隨機移除自己 1 張牌並 +1 作秀指示物。結算時依指示物數消耗 SP，選擇等量效果。",
    changes:{},
    resolve(ctx) {
      const counters=ctx.card._showoffCounters||0;
      ctx.card.pressure=-counters;
      if (counters===0||game.player.sp<counters) {
        game.message(`作秀：${counters===0?"無指示物":"SP 不足"}，無效果。`); return;
      }
      game.player.sp-=counters;
      game.pendingChoice={
        type:"showoff", remaining:counters, card:ctx.card, side:ctx.side,
        effects:[
          {label:"操作 1 動力元件",    fn(){operateEngineAuto();}},
          {label:"操作 1 空力元件",    fn(){operateAeroAuto();}},
          {label:"抽 1 張牌並下指令", fn(){const d=drawCards(1);game.hand.push(...d);triggerBonus("reorder",ctx.card);}},
          {label:"移除對手 1 張牌",   fn(){removeRandomNpcCard();}},
          {label:"移除此牌",          fn(){const p=ctx.side==="left"?game.playerLeft:game.playerRight;removeCard(p,p.indexOf(ctx.card));}},
        ]
      };
      game.message(`作秀：消耗 ${counters} SP，選擇 ${counters} 個效果。`);
      render();
    },
    fieldEffects:{
      onCardRemoved(payload) {
        const self=[...game.playerLeft,...game.playerRight].find(c=>c.id==="showoff");
        if (!self) return;
        game.pendingChoice={
          type:"showoffTrigger", selfCard:self,
          onYes(){
            const others=[...game.playerLeft,...game.playerRight].filter(c=>c!==self);
            if (others.length>0){
              const t=others[Math.floor(Math.random()*others.length)];
              const p=game.playerLeft.includes(t)?game.playerLeft:game.playerRight;
              removeCard(p,p.indexOf(t));
              self._showoffCounters=(self._showoffCounters||0)+1;
              self.pressure=-(self._showoffCounters);
              game.message(`作秀：指示物 +1（共 ${self._showoffCounters}）。`);
            }
            game.pendingChoice=null; render();
          },
          onNo(){ game.pendingChoice=null; render(); }
        };
        render();
      }
    }
  },
];

// ── NPC 指令牌庫 ──────────────────────────────
const npcCardPool = [
  { id:"npc_accel",   name:"紅車加速",  type:"complex", pressure:2, text:"速度 +2、抓地力 -1。",             changes:{speed_bs:2, grip:-1} },
  { id:"npc_defend",  name:"紅車防守",  type:"simple",  pressure:2, text:"車體操控 +1、抓地力 +1。防干擾。",  changes:{vh:1, grip:1}, shield:true },
  { id:"npc_block",   name:"紅車干擾",  type:"complex", pressure:3, text:"對手速度 -1、抓地力 -1。",          changes:{}, targetChanges:{speed:-1, grip:-1} },
  { id:"npc_conserve",name:"紅車保守",  type:"simple",  pressure:1, text:"抓地力 +2。",                      changes:{grip:2} },
  { id:"npc_sprint",  name:"紅車衝刺",  type:"complex", pressure:3, text:"速度 +3、車體操控 -1、抓地力 -2。",  changes:{speed_bs:3, vh:-1, grip:-2} },
  { id:"npc_corner",  name:"紅車入彎",  type:"simple",  pressure:2, text:"車體操控 +2、抓地力 +1。",          changes:{vh:2, grip:1} },
];
