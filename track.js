// ─────────────────────────────────────────────
//  track.js — 鳥瞰賽道動畫 v3
//  整合賽場：左右車道 = drop zone
// ─────────────────────────────────────────────

const Track = (() => {

  const W = 560, H = 460;
  const ROAD_TOP = 80, ROAD_BTM = 380;
  const ROAD_H   = ROAD_BTM - ROAD_TOP;

  const LANE_L = W * 0.35, LANE_R = W * 0.65;
  const ROAD_L = W * 0.18, ROAD_R = W * 0.82;

  const Y_FRONT = ROAD_TOP + ROAD_H * 0.22;
  const Y_REAR  = ROAD_TOP + ROAD_H * 0.72;
  const CAR_W = 22, CAR_H = 38;

  const CLR = {
    bg:"#0d100e", kerb:"#1a1f1c", road:"#1e2820", roadEdge:"#2e4232",
    centerDash:"#3a5040", player:"#25d17f", npc:"#f05d5e",
    playerGlow:"rgba(37,209,127,0.28)", npcGlow:"rgba(240,93,94,0.28)",
    text:"#f7faf7", muted:"#b8c4ba", shield:"#ffcf4d",
  };

  let anim = {
    pX:LANE_R, pY:Y_REAR, nX:LANE_L, nY:Y_FRONT,
    pSpeed:0, nSpeed:0, dashOffset:0, frame:0,
    hoverLeft:false, hoverRight:false,
  };

  let canvas, ctx;

  function init() {
    canvas = document.getElementById("trackCanvas");
    if (!canvas) return;
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext("2d");
    requestAnimationFrame(loop);
  }

  function loop() { requestAnimationFrame(loop); update(); draw(); }

  let ov = { phase:null, dir:null, progress:0 };
  let lastOvertakeAnim = null;

  function update() {
    if (typeof game === "undefined") return;
    const p = game.player, n = game.npc;
    const MID = (ROAD_L + ROAD_R) / 2;

    const oa = game.overtakeAnim;
    if (oa && oa !== lastOvertakeAnim) { ov.phase="sweeping"; ov.dir=oa; ov.progress=0; }
    lastOvertakeAnim = oa;

    if (ov.phase === "sweeping") {
      ov.progress += 0.025;
      if (ov.progress >= 1) { ov.progress=1; ov.phase="done"; }
    } else if (ov.phase === "done") { ov.phase=null; }

    let pTargetX = MID;
    if (ov.phase === "sweeping") {
      const offset = Math.sin(ov.progress * Math.PI) * (ROAD_R - ROAD_L) * 0.28;
      pTargetX = ov.dir === "left" ? MID - offset : MID + offset;
    }

    anim.pX = lerp(anim.pX, pTargetX, 0.08);
    anim.pY = lerp(anim.pY, p.position===1 ? Y_FRONT : Y_REAR, 0.045);
    anim.nX = lerp(anim.nX, MID, 0.045);
    anim.nY = lerp(anim.nY, n.position===1 ? Y_FRONT : Y_REAR, 0.045);
    anim.pSpeed = lerp(anim.pSpeed, p.speed||0, 0.1);
    anim.nSpeed = lerp(anim.nSpeed, n.speed||0, 0.1);
    anim.dashOffset = (anim.dashOffset + 1.2 + (anim.pSpeed+anim.nSpeed)/2*0.35) % 48;
    anim.frame++;
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawBg();
    drawZoneBg();
    drawRoad();
    drawLaneDivider();
    if (typeof game !== "undefined") {
      drawDropZoneHints();
      drawPressureZones();
      drawCar(anim.nX, anim.nY, CLR.npc,    CLR.npcGlow,    "NPC", anim.nSpeed, game.npc.shield);
      drawCar(anim.pX, anim.pY, CLR.player, CLR.playerGlow, "YOU", anim.pSpeed, game.player.shield);
      drawLaneInfo();
      drawFieldStatus();
      drawSpeedBadges();
      drawCornerLabel();
    }
  }

  // ── 場上狀態列 ──────────────────────────────
  // 顯示有持續效果的牌，分左右道、上下（NPC/玩家）
  function drawFieldStatus() {
    const roadMid = (ROAD_L + ROAD_R) / 2;

    // 收集有狀態的牌
    const getStatusTags = (cards) => cards
      .filter(c => c.revealed && hasFieldStatus(c))
      .map(c => buildStatusTag(c));

    // 玩家左右道
    const pL = getStatusTags(game.playerLeft  || []);
    const pR = getStatusTags(game.playerRight || []);
    // NPC 左右道
    const nL = getStatusTags(game.npcLeft  || []);
    const nR = getStatusTags(game.npcRight || []);

    // 玩家狀態：賽道內側底部（ROAD_BTM 往上）
    const pY = ROAD_BTM - 6;
    drawStatusColumn(ROAD_L,  roadMid, pY, pL, CLR.player, "bottom");
    drawStatusColumn(roadMid, ROAD_R,  pY, pR, CLR.player, "bottom");

    // NPC 狀態：賽道內側頂部（ROAD_TOP 往下）
    const nY = ROAD_TOP + 6;
    drawStatusColumn(ROAD_L,  roadMid, nY, nL, CLR.npc, "top");
    drawStatusColumn(roadMid, ROAD_R,  nY, nR, CLR.npc, "top");
  }

  function hasFieldStatus(card) {
    // 有持續狀態標籤的牌
    return card._rhythmSide || card._fakeInfoSide || card._jamSide ||
           card._fakeCutActive || card._showoffCounters ||
           card._pressSide || card.fieldEffects;
  }

  function buildStatusTag(card) {
    // 回傳簡短狀態文字
    if (card.id === "race_rhythm")    return `⟳ ${card.name}：${card._rhythmSide === "left" ? "左" : "右"}側`;
    if (card.id === "fake_info")      return `🎭 ${card.name}：${card._fakeInfoSide === "left" ? "左" : "右"}側`;
    if (card.id === "noise_jam")      return `📡 ${card.name}：${card._jamSide === "left" ? "左" : "右"}側`;
    if (card.id === "fake_cut")       return `↔ ${card.name}：待換側`;
    if (card.id === "showoff")        return `★ ${card.name}：${card._showoffCounters || 0} 指示物`;
    if (card.id === "position_press") return `⬆ ${card.name}`;
    if (card.id === "mind_game")      return `🔒 ${card.name}`;
    if (card.fieldEffects)            return `◈ ${card.name}`;
    return card.name;
  }

  function drawStatusColumn(x1, x2, y, tags, color, baseline) {
    if (tags.length === 0) return;
    const cx = (x1 + x2) / 2;
    const lineH = 13;
    ctx.save();
    ctx.font = "bold 9px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = baseline;
    tags.forEach((tag, i) => {
      const tagY = baseline === "top"
        ? y + i * lineH
        : y - i * lineH;
      // 背景膠囊
      const tw = ctx.measureText(tag).width;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#0d100e";
      const padX = 4, padY = 2;
      ctx.beginPath();
      ctx.roundRect(cx - tw/2 - padX, tagY - (baseline==="top"?padY:lineH-padY), tw + padX*2, lineH, 3);
      ctx.fill();
      // 文字
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.fillText(tag, cx, tagY);
    });
    ctx.restore();
  }

  function drawBg() {
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = CLR.kerb;
    ctx.fillRect(0, 0, ROAD_L, H);
    ctx.fillRect(ROAD_R, 0, W-ROAD_R, H);
  }

  function drawZoneBg() {
    // NPC 牌區
    ctx.fillStyle = "rgba(110,46,46,0.10)";
    ctx.fillRect(ROAD_L, 0, ROAD_R-ROAD_L, ROAD_TOP);
    ctx.save();
    ctx.fillStyle = CLR.npc; ctx.globalAlpha = 0.55;
    ctx.font = "bold 10px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🔴 紅車", (ROAD_L+ROAD_R)/2, 10);
    ctx.restore();

    // 玩家牌區
    const isActive = typeof game !== "undefined" && (game.phase==="radio" || (game.phase==="action" && game.pendingBonus?.type==="reorder"));
    ctx.fillStyle = isActive ? "rgba(37,209,127,0.07)" : "rgba(37,209,127,0.04)";
    ctx.fillRect(ROAD_L, ROAD_BTM, ROAD_R-ROAD_L, H-ROAD_BTM);
    ctx.save();
    ctx.fillStyle = CLR.player; ctx.globalAlpha = 0.55;
    ctx.font = "bold 10px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🟢 你", (ROAD_L+ROAD_R)/2, H-10);
    ctx.restore();
  }

  function drawDropZoneHints() {
    if (typeof game === "undefined") return;
    const isRadio   = game.phase === "radio";
    const isReorder = game.phase === "action" && game.pendingBonus?.type === "reorder";
    if (!isRadio && !isReorder) return;

    const roadMid = (ROAD_L + ROAD_R) / 2;
    const zoneY = ROAD_BTM, zoneH = H - ROAD_BTM;
    const zones = [
      { x:ROAD_L,   w:roadMid-ROAD_L, label:"← 左側", hover:anim.hoverLeft  },
      { x:roadMid,  w:ROAD_R-roadMid, label:"右側 →",  hover:anim.hoverRight },
    ];
    zones.forEach(z => {
      ctx.save();
      ctx.fillStyle = z.hover ? "rgba(255,207,77,0.18)" : "rgba(255,207,77,0.06)";
      ctx.fillRect(z.x, zoneY, z.w, zoneH);
      ctx.strokeStyle = z.hover ? "rgba(255,207,77,0.7)" : "rgba(255,207,77,0.28)";
      ctx.lineWidth = z.hover ? 2 : 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(z.x+2, zoneY+2, z.w-4, zoneH-4);
      ctx.setLineDash([]);
      ctx.fillStyle = z.hover ? CLR.shield : "rgba(255,207,77,0.55)";
      ctx.font = `bold ${z.hover?13:11}px 'Segoe UI', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(z.label, z.x + z.w/2, zoneY + zoneH/2);
      ctx.restore();
    });
  }

  function drawLaneInfo() {
    if (typeof game === "undefined") return;
    const roadMid = (ROAD_L + ROAD_R) / 2;

    // 玩家
    const pL = game.playerLeft||[], pR = game.playerRight||[];
    drawZoneTag(ROAD_L, roadMid, ROAD_BTM+4, pL.length, calcSidePressure(pL), CLR.player, "top");
    drawZoneTag(roadMid, ROAD_R, ROAD_BTM+4, pR.length, calcSidePressure(pR), CLR.player, "top");

    // NPC
    const nL = game.npcLeft||[], nR = game.npcRight||[];
    drawZoneTag(ROAD_L, roadMid, ROAD_TOP-4, nL.length, calcRevealedPressure(nL), CLR.npc, "bottom", nL.filter(c=>!c.revealed).length);
    drawZoneTag(roadMid, ROAD_R, ROAD_TOP-4, nR.length, calcRevealedPressure(nR), CLR.npc, "bottom", nR.filter(c=>!c.revealed).length);
  }

  function drawZoneTag(x1, x2, y, count, pressure, color, baseline, hidden) {
    if (count === 0) return;
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = baseline;
    ctx.font = "bold 10px 'Segoe UI', sans-serif";
    ctx.fillStyle = color; ctx.globalAlpha = 0.85;
    const hiddenTxt = hidden !== undefined ? ` (${hidden}蓋)` : "";
    ctx.fillText(`${count}張${hiddenTxt}　壓力${pressure}`, (x1+x2)/2, y);
    ctx.restore();
  }

  function drawRoad() {
    ctx.fillStyle = CLR.road;
    ctx.fillRect(ROAD_L, ROAD_TOP, ROAD_R-ROAD_L, ROAD_H);

    ctx.strokeStyle = CLR.roadEdge; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ROAD_L, ROAD_TOP); ctx.lineTo(ROAD_L, ROAD_BTM);
    ctx.moveTo(ROAD_R, ROAD_TOP); ctx.lineTo(ROAD_R, ROAD_BTM);
    ctx.stroke();

    // 賽道與牌區分隔線
    ctx.strokeStyle = "rgba(70,82,71,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ROAD_L, ROAD_TOP); ctx.lineTo(ROAD_R, ROAD_TOP);
    ctx.moveTo(ROAD_L, ROAD_BTM); ctx.lineTo(ROAD_R, ROAD_BTM);
    ctx.stroke();

    // 路肩斜紋
    ctx.save(); ctx.globalAlpha = 0.32;
    const sh=14, sg=14, off=anim.dashOffset%(sh+sg);
    for (let y=ROAD_TOP-sh+off; y<ROAD_BTM; y+=sh+sg) {
      ctx.fillStyle="#ffcf4d";
      ctx.fillRect(ROAD_L-10, y, 10, sh); ctx.fillRect(ROAD_R, y, 10, sh);
      ctx.fillStyle="#141918";
      ctx.fillRect(ROAD_L-10, y+sh, 10, sg); ctx.fillRect(ROAD_R, y+sh, 10, sg);
    }
    ctx.restore();
  }

  function drawLaneDivider() {
    const mid = (LANE_L+LANE_R)/2;
    ctx.strokeStyle = CLR.centerDash; ctx.lineWidth = 1.5;
    ctx.setLineDash([16,14]); ctx.lineDashOffset = -anim.dashOffset;
    ctx.beginPath(); ctx.moveTo(mid, ROAD_TOP); ctx.lineTo(mid, ROAD_BTM); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;

    ctx.save();
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(184,196,186,0.45)";
    ctx.fillText("左道", LANE_L, ROAD_TOP+6);
    ctx.fillText("右道", LANE_R, ROAD_TOP+6);
    ctx.restore();
  }

  function drawPressureZones() {
    if (typeof game === "undefined") return;
    const pLP = calcSidePressure(game.playerLeft);
    const pRP = calcSidePressure(game.playerRight);
    const nLRP = calcRevealedPressure(game.npcLeft);
    const nRRP = calcRevealedPressure(game.npcRight);
    if (pLP > 0) drawPressureBeam(LANE_L, anim.pY, pLP, CLR.player, "left");
    if (pRP > 0) drawPressureBeam(LANE_R, anim.pY, pRP, CLR.player, "right");
    if (nLRP > 0) drawNpcPressureBeam(LANE_L, anim.nY, nLRP);
    if (nRRP > 0) drawNpcPressureBeam(LANE_R, anim.nY, nRRP);
  }

  function drawPressureBeam(laneX, carY, pressure, color, side) {
    const pulse = 0.5 + 0.22*Math.sin(anim.frame*0.07);
    const beamH = Math.min(60+pressure*18, ROAD_H*0.55);
    const roadMid = (ROAD_L+ROAD_R)/2;
    const x1 = side==="left" ? ROAD_L+2 : roadMid+2;
    const x2 = side==="left" ? roadMid-2 : ROAD_R-2;
    const bw = x2-x1, ax = x1+bw/2;
    ctx.save();
    ctx.globalAlpha = pulse*0.4;
    const grad = ctx.createLinearGradient(0,carY,0,carY-beamH);
    grad.addColorStop(0,"transparent"); grad.addColorStop(1,color);
    ctx.fillStyle=grad; ctx.fillRect(x1,carY-beamH,bw,beamH);
    ctx.globalAlpha=pulse*0.9; ctx.fillStyle=color;
    const ay=carY-beamH-10;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(ax-8,ay+14); ctx.lineTo(ax+8,ay+14); ctx.closePath(); ctx.fill();
    ctx.font="bold 12px 'Segoe UI', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(`${pressure}`,ax,carY-beamH-26);
    ctx.restore();
  }

  function drawNpcPressureBeam(laneX, carY, pressure) {
    const pulse = 0.5+0.22*Math.sin(anim.frame*0.07+1);
    const beamH = Math.min(50+pressure*14, ROAD_H*0.35);
    const roadMid = (ROAD_L+ROAD_R)/2;
    const side = laneX < W/2 ? "left" : "right";
    const x1 = side==="left" ? ROAD_L+2 : roadMid+2;
    const x2 = side==="left" ? roadMid-2 : ROAD_R-2;
    const bw = x2-x1, ax = x1+bw/2;
    ctx.save();
    ctx.globalAlpha=pulse*0.32;
    const grad=ctx.createLinearGradient(0,carY,0,carY+beamH);
    grad.addColorStop(0,"transparent"); grad.addColorStop(1,CLR.npc);
    ctx.fillStyle=grad; ctx.fillRect(x1,carY,bw,beamH);
    ctx.globalAlpha=pulse*0.8; ctx.fillStyle=CLR.npc;
    const ay=carY+beamH+8;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(ax-8,ay-14); ctx.lineTo(ax+8,ay-14); ctx.closePath(); ctx.fill();
    ctx.font="bold 12px 'Segoe UI', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(`${pressure}`,ax,carY+beamH+24);
    ctx.restore();
  }

  function drawCar(x, y, color, glow, label, speed, hasShield) {
    ctx.save();
    const gr=ctx.createRadialGradient(x,y,2,x,y,CAR_W*2.4);
    gr.addColorStop(0,glow); gr.addColorStop(1,"transparent");
    ctx.fillStyle=gr; ctx.beginPath(); ctx.ellipse(x,y,CAR_W*2,CAR_H*1.1,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=color; roundRect(ctx,x-CAR_W/2,y-CAR_H/2,CAR_W,CAR_H,5); ctx.fill();
    ctx.fillStyle=shadeColor(color,-35); roundRect(ctx,x-CAR_W/2+3,y-CAR_H/2,CAR_W-6,10,4); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,0.4)"; roundRect(ctx,x-CAR_W/2+4,y-CAR_H/2+11,CAR_W-8,11,3); ctx.fill();
    const bh=CAR_H*0.65, bw=4, bx=x+CAR_W/2+5, by=y-bh/2;
    ctx.fillStyle="rgba(255,255,255,0.1)"; roundRect(ctx,bx,by,bw,bh,2); ctx.fill();
    const fr=Math.min((speed||0)/6,1);
    ctx.fillStyle=color; roundRect(ctx,bx,by+bh*(1-fr),bw,bh*fr,2); ctx.fill();
    if (hasShield) {
      ctx.strokeStyle=CLR.shield; ctx.lineWidth=2;
      ctx.globalAlpha=0.6+0.35*Math.sin(anim.frame*0.09);
      ctx.beginPath(); ctx.ellipse(x,y,CAR_W*0.95,CAR_H*0.65,0,0,Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha=1; ctx.fillStyle=CLR.text;
    ctx.font="bold 9px 'Segoe UI', sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(label,x,y+5);
    ctx.restore();
  }

  function drawSpeedBadges() {
    if (typeof game === "undefined") return;
    const p=game.player, n=game.npc;
    ctx.font="bold 11px 'Segoe UI', sans-serif"; ctx.textBaseline="middle"; ctx.textAlign="right";
    ctx.fillStyle=CLR.player; ctx.fillText(`速度 ${p.speed.toFixed(1)}`,anim.pX-CAR_W/2-10,anim.pY);
    ctx.fillStyle=CLR.npc;    ctx.fillText(`速度 ${n.speed}`,anim.nX-CAR_W/2-10,anim.nY);
  }

  function drawCornerLabel() {
    if (typeof game === "undefined") return;
    const names={plan:"計畫",radio:"通訊",action:"行動",field:"賽場",resolution:"結算"};
    ctx.fillStyle="rgba(0,0,0,0.52)"; roundRect(ctx,6,ROAD_TOP+6,110,24,5); ctx.fill();
    ctx.fillStyle=CLR.muted; ctx.font="bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign="left"; ctx.textBaseline="middle";
    ctx.fillText(`R${game.round}  ${names[game.phase]||""}階段`,12,ROAD_TOP+18);
    ctx.fillStyle="rgba(184,196,186,0.4)"; ctx.font="10px 'Segoe UI', sans-serif";
    ctx.textAlign="right"; ctx.fillText("↑ 前方",W-10,ROAD_BTM-10);
  }

  function lerp(a,b,t){return a+(b-a)*t;}

  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
    ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }

  function shadeColor(hex,amount){
    const num=parseInt(hex.replace("#",""),16);
    const r=Math.min(255,Math.max(0,(num>>16)+amount));
    const g=Math.min(255,Math.max(0,((num>>8)&0xff)+amount));
    const b=Math.min(255,Math.max(0,(num&0xff)+amount));
    return `rgb(${r},${g},${b})`;
  }

  function calcSidePressure(cards){
    if(!cards) return 0;
    return cards.reduce((s,c)=>s+(c.pressure||0),0);
  }

  function calcRevealedPressure(cards){
    if(!cards) return 0;
    return cards.filter(c=>c.revealed).reduce((s,c)=>s+(c.pressure||0),0);
  }

  return {
    init,
    getLayout: () => ({ W, H, ROAD_L, ROAD_R, ROAD_TOP, ROAD_BTM }),
    setHover:  (left, right) => { anim.hoverLeft=left; anim.hoverRight=right; },
  };
})();

window.addEventListener("DOMContentLoaded", () => Track.init());
