/* 極速駕駛-最終指令 比賽層 v3 原型（六角格・轉向版）v0 */
"use strict";

/* ═══ 可調數值（對應討論定案，全部可改）═══ */
const CFG = {
  handMax: 7,              // 手牌上限
  gears: [                 // 檔位：速度量上限＋加速倍率（v3.5）
    {max:4,  mult:1.5},
    {max:6,  mult:1.3},
    {max:8,  mult:1.1},
    {max:10, mult:0.9},
  ],
  engineAdj: 0,            // 引擎調整值（Lv1＝0）
  brakePart: {per:2, max:1}, // 煞車部件：每 per 點減速耗 1 胎；每回合煞車點上限
  aeroCoef: 0,             // 空力（停用中，正式引入再議形態）
  probStep: 0.25,          // 轉向失敗階梯：p＝1−E×probStep
  cardsPerRound: 3,        // 每回合固定指令數（車手智慧日後改這裡）
  aeroTech: 0,             // 空力 Lv1：每回合起手 🎯（Lv2=1）
  beatsPerRound: 4,        // 一回合 4 拍
  lapsToWin: 2,            // 完賽圈數
  tiresStart: 5,           // 起始輪胎
  avalancheCap: 2,         // 失誤雪崩：單拍失誤上限，溢出扣胎
  // 失誤＝把牌變成失誤牌；打出它就恢復（檔位清洗已退役）
  drawPerRound: 3,         // 回合結束固定抽牌數；超過手牌上限的直接棄牌（牌庫照樣循環）
  inertiaDiv: 2,           // 慣性項＝⌊動量÷inertiaDiv⌋，再被當前格摩擦力鉗制
  slipstreamBonus: 1,      // 尾流：下回合第 1 拍 +⚡
  qteBase: { corner:3, block:2 },  // QTE 情境基準
  qteMaxDiff: 6,
  rageRounds: 2,           // 禿鷹暴怒持續回合
  rageBonus: 1,            // 暴怒每拍 +速度
  animMs: 260,             // 保留給非移動停頓
  stepMs: 120,             // 玩家每格滑行毫秒（連續補間）
  oppStepMs: 130,          // 對手每格滑行毫秒（全體並行）
  simpleOpponents: true,   // 對手降智：純路障（無警戒格、無鉤子）
  simpleRhythms: [[1,1,1,1]], // 降智對手：每拍走 1 格
  cornerModel: "limit",    // "limit"＝速限制（現行）；"band"＝速度帶（Plan B）
  // 過彎成功率＝1 −超額÷(速限＋1)：急彎門檻低、衰減也陡（限3：75/50/25/0%；限4：80/60/40/20/0%）
  qteProbMod: {perfect:0.20, good:0.10, fail:-0.10, bigfail:-0.20}, // QTE 修正封頂 ±20%
  overshootMistake: 1,     // 衝出去：車手驚嚇吃失誤
  wallTire: 1,             // 衝出撞路緣：扣胎
  straightFriction: 2,     // 賽道摩擦力統一 2（只用於轉向的抓地力貢獻）
  // 速度（慣性狀態）：直行+1、轉向⌊÷2⌋、煞車−QTE、失控歸0、跨回合；免費移動＝⌊速度÷2⌋
  grassFriction: 1,        // 草地（緩衝區）摩擦力
  cornerZones: [           // 彎區：中心線索引範圍＋摩擦力（入彎檢查：E＝動量−摩擦力−投入🎯）
    {from:11, to:16, limit:2, name:"右髮夾"},
    {from:28, to:33, limit:2, name:"左彎"},
  ],
  speedBands: [            // Plan B：轉向單價看「回合總⚡」：total≤max → 每60°付 cost 🎯
    {max:3, cost:0, name:"慢"},
    {max:6, cost:1, name:"中"},
    {max:9, cost:2, name:"快"},
    {max:99,cost:3, name:"極速"},
  ],
};

/* ═══ 六角數學（pointy-top axial）═══ */
const DIRS = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]]; // E SE SW W NW NE
const key = (q,r)=>q+","+r;
const hexAdd=(a,d)=>({q:a.q+d[0],r:a.r+d[1]});
const hexEq=(a,b)=>a.q===b.q&&a.r===b.r;
function hexDist(a,b){const dq=a.q-b.q,dr=a.r-b.r;return (Math.abs(dq)+Math.abs(dr)+Math.abs(dq+dr))/2;}
function dirBetween(a,b){for(let i=0;i<6;i++){if(a.q+DIRS[i][0]===b.q&&a.r+DIRS[i][1]===b.r)return i;}return -1;}
function turnUnits(h1,h2){if(h1<0||h2<0)return 0;let d=Math.abs(h1-h2)%6;return d>3?6-d:d;}
function neighbors(h){return DIRS.map(d=>hexAdd(h,d));}

/* ═══ 賽道：中心線閉環 34 格、路寬 3 ═══ */
function buildTrack(){
  const steps=[];
  for(let i=0;i<11;i++)steps.push(0);          // E ×11
  steps.push(1,2,1,2,1,2);                      // 右彎下行
  for(let i=0;i<11;i++)steps.push(3);          // W ×11
  steps.push(5,4,5,4,5,4);                      // 左彎上行
  const center=[{q:0,r:0}];
  let cur={q:0,r:0};
  for(const s of steps){cur=hexAdd(cur,DIRS[s]);center.push(cur);}
  center.pop(); // 最後一步回到起點，去重
  const road=new Map();
  center.forEach((c,idx)=>{
    [c,...neighbors(c)].forEach(h=>{
      const k=key(h.q,h.r);
      if(!road.has(k))road.set(k,{q:h.q,r:h.r,prog:idx});
    });
  });
  // 中心線格的 prog 以自身索引為準（鄰格沿用生成時的 idx）
  center.forEach((c,idx)=>{road.get(key(c.q,c.r)).prog=idx;});
  road.forEach(cell=>{
    cell.zone=null;
    for(const z of CFG.cornerZones){if(cell.prog>=z.from&&cell.prog<=z.to){cell.zone=z;break;}}
  });
  return {center,road,len:center.length};
}
const TRACK=buildTrack();
function buildSurround(){
  const dist=new Map();
  let frontier=[];
  TRACK.road.forEach(c=>{dist.set(key(c.q,c.r),0);frontier.push(c);});
  for(let d=1;d<=3;d++){
    const next=[];
    for(const h of frontier){
      for(const n of neighbors(h)){
        const k=key(n.q,n.r);
        if(!dist.has(k)){dist.set(k,d);next.push(n);}
      }
    }
    frontier=next;
  }
  const grass=new Map(),wall=new Map();
  dist.forEach((d,k)=>{
    const [q,r]=k.split(",").map(Number);
    if(d>=1&&d<=2)grass.set(k,{q,r});
    else if(d===3)wall.set(k,{q,r});
  });
  return {grass,wall};
}
const SURROUND=buildSurround();
const isWall=h=>SURROUND.wall.has(key(h.q,h.r));
const isRoad=h=>TRACK.road.has(key(h.q,h.r));
const zoneOf=h=>{const c=TRACK.road.get(key(h.q,h.r));return c?c.zone:null;};
const progOf=h=>{const c=TRACK.road.get(key(h.q,h.r));return c?c.prog:-1;};

/* ═══ 卡牌 ═══
   sym: 印刷符號 {p:⚡, g:🎯, f:♒, t:🛞}，負值＝警示色符號
   col: red 激進 / green 保守 / yellow 技巧 / blue 謀略 / black 結構 / none 失誤 */
/* seq＝印刷符號序列（左＝入口、右＝出口），"-"前綴＝負符號（警示色） */
const CARD_DEFS = {
  /* ── 紅：激進數值＋代價 ── */
  eject:  {name:"彈射起步",   col:"red",   seq:["p","p","p","p"], badge:{t:1}, gears:[1,2], cost:2, fx:"nocap",
           note:"超載2：本回合無視檔位上限"},
  nitro:  {name:"氮氣噴射",   col:"red",   seq:["p","p","p","p"], badge:{t:1}, gears:[3,4], cost:2, fx:"nitrofree",
           note:"超載2：免胎耗"},
  drift:  {name:"甩尾過彎",   col:"red",   seq:["-p","g","g","g"], gears:[3,4], cost:3, fx:"freeturn",
           note:"超載3：本回合轉向判定全免"},
  /* ── 綠：節奏文法家族（心流引擎） ── */
  startr: {name:"起步節奏",   col:"green", seq:["p","p","f"],     gears:[1,2], cost:1, od:{add:"p"},
           note:"超載1：加印⚡（可選頭或尾）"},
  shift2: {name:"換檔銜接",   col:"green", seq:["p","g"],         gears:[2,3], cost:1, od:{add:"g"},
           note:"超載1：加印🎯（可選頭或尾）"},
  cruise: {name:"巡航",       col:"green", seq:["f","p"],         gears:[2,3], cost:1, od:{add:"f"},
           note:"超載1：加印♒（可選頭或尾）"},
  /* ── 黃：警戒互動家族 ── */
  foresee:{name:"預判",       col:"yellow",seq:["g","f"],         gears:[1,4], cost:1, fx:"foresee",
           note:"被擋時繞行免轉向判定｜超載1：繞行後額外前進 1 格"},
  slips:  {name:"尾流獵手",   col:"yellow",seq:["p","f"],         gears:[2,4], cost:1, fx:"slips",
           note:"咬到尾流 +1｜超載1：距離 2 格內也算咬到"},
  weave:  {name:"車陣穿梭",   col:"yellow",seq:["g","g"],         gears:[1,3], cost:1, fx:"weave",
           note:"跟車時速度不歸零｜超載1：跟車後下回合尾流再 +1"},
  /* ── 藍：超車詭計 ── */
  feint:  {name:"假動作",     col:"blue",  dual:{a:["-p","g","g"],b:["-g","p","p"]}, gears:[1,4], cost:1, od:{addDual:true},
           note:"雙面選邊｜超載1：選定面加印一顆主符號（頭或尾）"},
  apex:   {name:"內線強襲",   col:"blue",  seq:["p","g"],         gears:[3,4], cost:2, fx:"apex",
           note:"急拐視為緩轉（判定不減摩、速度÷2）｜超載2：急拐後速度完全不減"},
  /* ── 黑：教練（無超載、強制費 4 心流） ── */
  coach:  {name:"節奏教練",   col:"black", seq:[], star:true,     gears:[1,4], flowReq:4,
           note:"入鏈需 4 心流（出發時扣除）：相鄰兩張印刷符號×2"},
  mistake:{name:"失誤",       col:"none",  seq:[], gears:[1,4],   n:0},
};
const TABLE_IDS=["eject","nitro","drift","startr","shift2","cruise","foresee","slips","weave","feint","apex","coach"];
let CARD_SEQ=0;
function calcSym(seq){
  const sym={};
  seq.forEach(el=>{const neg=el.startsWith("-"),k=neg?el.slice(1):el;sym[k]=(sym[k]||0)+(neg?-1:1);});
  return sym;
}
function makeCard(id){
  const d=CARD_DEFS[id];
  const seq=(d.dual?d.dual.a:(d.seq||[])).slice();
  const sym=calcSym(seq);
  if(d.badge){for(const k in d.badge)sym[k]=(sym[k]||0)+d.badge[k];}
  const c={uid:++CARD_SEQ,id,name:d.name,col:d.col,seq,sym,badge:d.badge||null,fx:d.fx||null,star:!!d.star,cost:d.cost||0,armed:false,note:d.note||"",gears:d.gears||[1,4],flowReq:d.flowReq||0,used:false,locked:false};
  if(d.dual){c.dual={a:d.dual.a.slice(),b:d.dual.b.slice()};c.side="a";}
  return c;
}
function odAddSym(c){
  const d=CARD_DEFS[c.id];
  if(!d.od)return null;
  if(d.od.addDual)return c.side==="b"?"p":"g";
  return d.od.add||null;
}
function applyOD(c){ // 加印型超載：重建序列（頭或尾）
  const add=odAddSym(c);
  if(!add)return;
  if(!c.baseSeq)c.baseSeq=(c.dual?c.dual[c.side]:CARD_DEFS[c.id].seq).slice();
  if(c.armed&&c.odMode==="head")c.seq=[add,...c.baseSeq];
  else if(c.armed)c.seq=[...c.baseSeq,add];
  else c.seq=c.baseSeq.slice();
  c.sym=calcSym(c.seq);
  if(c.badge){for(const k in c.badge)c.sym[k]=(c.sym[k]||0)+c.badge[k];}
}
function chainHas(id){return S.chain.some(c=>c.id===id);}
function armedHas(id){return S.chain.some(c=>c.id===id&&c.armed);}
function flowSpend(){ // 本回合心流總支出＝超載費＋強制費
  return S.chain.reduce((a,c)=>a+((c.cost&&c.armed)?c.cost:0)+(c.flowReq||0),0);
}
function setCardSide(c,s){
  if(!c.dual)return;
  c.side=s;c.seq=c.dual[s].slice();c.sym=calcSym(c.seq);
  if(c.badge){for(const k in c.badge)c.sym[k]=(c.sym[k]||0)+c.badge[k];}
  c.baseSeq=null;applyOD(c);
}
function iface(c){ // 接口：頭尾符號種類（sign-blind；🛞不當接口）
  if(c.star)return {head:"*",tail:"*"};
  if(!c.seq.length)return null;
  const strip=x=>x.startsWith("-")?x.slice(1):x;
  const h=strip(c.seq[0]),t=strip(c.seq[c.seq.length-1]);
  return {head:h==="t"?null:h,tail:t==="t"?null:t};
}
function buildTable(){return TABLE_IDS.map(id=>{const c=makeCard(id);c.used=false;c.locked=false;return c;});}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

/* ═══ 對手名冊 ═══ */
function makeOpponents(){
  return [
    {id:"P",name:"陪跑員 P",color:"#ffb347",rhythm:CFG.simpleOpponents?[1,0,1,0]:[1,2,1,2],pathIdx:6,laps:0,rage:0,hook:"糾纏"},
    {id:"A",name:"禿鷹 A", color:"#ff5c5c",rhythm:CFG.simpleOpponents?[1,0,1,1]:[2,2,2,1],pathIdx:10,laps:0,rage:0,hook:"暴怒"},
  ];
}
const oppHex=o=>TRACK.center[o.pathIdx%TRACK.len];
const oppTotalProg=o=>o.laps*TRACK.len+(o.pathIdx%TRACK.len);

/* ═══ 遊戲狀態 ═══ */
const S = {
  driver:null,           // "rhythm" 節奏型 | "burst" 爆發型
  phase:"plan",          // plan | exec | over
  round:1, gear:1, // Default 1 檔起步
  deck:[], discard:[], hand:[], table:[],
  chain:[], path:[],     // path: 依序的格（不含起點）
  planStage:"chain",     // chain 出牌 → line 畫線
  budget:null,           // {speeds:[{card,speed}],total}
  pos:{q:2,r:0}, heading:0,
  laps:0, prog:2, totalSteps:0,
  tires:CFG.tiresStart,
  slipNext:0, flowPts:0, rfx:null, runLen:0, runDir:-1, movedThisRound:0, lastSV:0, brakePoints:[], overRevCharged:false,
  feintOn:false, pushOn:false,
  followTarget:null,     // 跟車目標 opp id
  opponents:makeOpponents(),
  submitted:null,        // 提交快照 {flow,negPips,lights,vals}
  log:[],
};

function log(msg,cls){S.log.push({msg,cls:cls||""});if(S.log.length>60)S.log.shift();renderLog();}

/* ═══ 排鏈計算：放大、亮燈、Flow、負符號 ═══ */
function effectiveSyms(chain){
  // 黑牌放大相鄰各一張 ×2（每張限一次）
  const doubled=new Set();
  chain.forEach((c,i)=>{
    if(c.star){
      [i-1,i+1].forEach(j=>{
        if(j>=0&&j<chain.length&&!chain[j].star&&chain[j].id!=="mistake"&&!doubled.has(chain[j].uid))doubled.add(chain[j].uid);
      });
    }
  });
  return chain.map(c=>{
    const m=doubled.has(c.uid)?2:1; // 教練固定 ×2
    const s={};
    for(const k in c.sym)s[k]=c.sym[k]*m;
    return {card:c,sym:s,doubled:m===2};
  });
}
function symTypes(sym){ // sign-blind：看種類不看正負
  const t=new Set();
  for(const k in sym){if(sym[k]!==0)t.add(k);}
  return t;
}
function lightsOf(chain){
  const on=[];
  for(let i=0;i<chain.length-1;i++){
    const a=chain[i],b=chain[i+1];
    if(a.id==="mistake"||b.id==="mistake"){on.push(false);continue;} // 失誤斷一切
    if(S.driver==="burst"&&(a.star||b.star)){on.push(true);continue;} // 爆發型：✦亦萬用
    if(S.driver==="rhythm"){
      const ia=iface(a),ib=iface(b);
      on.push(!!(ia&&ib&&(ia.tail==="*"||ib.head==="*"||(ia.tail&&ia.tail===ib.head)))); // 尾接頭（sign-blind）
    }else{
      on.push(a.col===b.col&&a.col!=="none");
    }
  }
  return on;
}
function gearOK(c){return S.gear>=c.gears[0]&&S.gear<=c.gears[1];}
function gearText(c){return c.gears[0]===c.gears[1]?`${c.gears[0]}檔`:(c.gears[0]===1&&c.gears[1]===4?"全檔":`${c.gears[0]}–${c.gears[1]}檔`);}
function makeMistake(c){ // 這張牌變成失誤牌：無符號、無角標、斷文法
  if(c.locked)return;
  c.locked=true;
  c.savedSeq=c.seq.slice();c.savedBadge=c.badge;
  c.seq=[];c.sym=calcSym([]);c.badge=null;
}
function healMistake(c){ // 打出後恢復原貌
  if(!c.locked)return;
  c.locked=false;
  c.seq=c.savedSeq?c.savedSeq.slice():c.seq;
  c.badge=c.savedBadge||null;
  c.savedSeq=null;c.savedBadge=null;
  c.baseSeq=null;c.armed=false;c.odMode=null;
  c.sym=calcSym(c.seq);
  if(c.badge){for(const k in c.badge)c.sym[k]=(c.sym[k]||0)+c.badge[k];}
  applyOD(c);
}
function lockRandom(n){
  for(let i=0;i<n;i++){
    const cand=S.table.filter(c=>!c.locked&&!c.used); // 只砸未用的牌：懲罰當場兌現
    if(!cand.length){S.tires=Math.max(0,S.tires-1);log("牌桌全鎖：改扣 1 胎","warn");if(S.tires<=0)dnf();continue;}
    const c=cand[Math.random()*cand.length|0];
    makeMistake(c);
    log(`失誤：【${c.name}】變成失誤牌（打出它即可恢復）`,"warn");
  }
}
function svText(B){
  if(B.overRev)return `${B.sv}（紅轉速保持）`;
  const core=B.inertia>0?`動量${B.inertia}＋引擎${B.engine}`:`引擎⌊P${B.P}×${B.gearMult}⌋＝${B.engine}`;
  return `min(上限${B.gearCap}, ${core})＝${B.sv}${S.slipNext?`（含尾流+${S.slipNext}）`:""}${B.free?`＋慣性${B.free}＝行程${B.travel}`:""}`;
}
function chainSize(){return CFG.cardsPerRound;} // 固定指令數（車手智慧日後改）
function planStats(){
  const eff=effectiveSyms(S.chain);
  const lights=lightsOf(S.chain);
  const lit=lights.filter(x=>x).length;
  let flowSym=0,negPips=0;
  eff.forEach(e=>{
    for(const k in e.sym){
      if(k==="f"&&e.sym[k]>0)flowSym+=e.sym[k];
      if(e.sym[k]<0)negPips+=-e.sym[k];
    }
  });
  return {eff,lights,lit,stab:flowSym,negPips,
    cornerDiff:Math.max(1,Math.min(CFG.qteMaxDiff,CFG.qteBase.corner-flowSym)),
    blockDiff:Math.max(1,Math.min(CFG.qteMaxDiff,CFG.qteBase.block-flowSym))};
}

/* ═══ 畫線 ═══ */
function lineBudget(){ // 單一事實來源：委派給 computeBudget
  if(S.budget)return S.budget.total;
  const saved=S.submitted;
  S.submitted=planStats();
  const b=computeBudget();
  S.submitted=saved;
  return b.total;
}
function pathTip(){return S.path.length?S.path[S.path.length-1]:S.pos;}
function canExtendTo(h){
  const tip=pathTip();
  const offTrack=!isRoad(tip); // 受困緩衝區：允許經草地爬回（上了路就不能再切草）
  if(!isRoad(h)&&!(offTrack&&SURROUND.grass.has(key(h.q,h.r))))return false;
  if(hexDist(pathTip(),h)!==1)return false;
  if(hexEq(h,S.pos))return false;
  if(S.path.some(p=>hexEq(p,h)))return false; // 不重踩
  return true;
}
function occupiedBy(h){
  for(const o of S.opponents){if(hexEq(oppHex(o),h))return o;}
  return null;
}
function hoverExtend(h){
  const tip=pathTip();
  if(hexEq(h,tip))return;
  if(S.path.length>0){
    const prev=S.path.length>=2?S.path[S.path.length-2]:S.pos;
    if(hexEq(h,prev)){S.path.pop();renderAll();return;} // 滑回上一格＝收線
  }
  if(!canExtendTo(h))return;
  if(S.budget&&travelAfterPath()<=0)return; // 速度量用完
  S.path.push({q:h.q,r:h.r}); // 可直接畫過對手現位（執行時他可能已移走）
  renderAll();
}
function tryExtendPath(h){
  if(S.phase!=="plan"||S.planStage!=="line")return;
  if(!S.budget){log("先按「確定出牌」再畫線","warn");return;}
  if(S.followTarget){log("已選跟車：線封死（點線尾可收回）","warn");return;}
  if(!isRoad(h))return;
  if(hexDist(pathTip(),h)!==1){log("只能從線尾往相鄰格延伸","warn");return;}
  if(hexEq(h,S.pos)||S.path.some(p=>hexEq(p,h))){log("不可重踩","warn");return;}
  if(S.path.length>=lineBudget()){log(`已達⚡上限（${lineBudget()} 格）`,"warn");return;}
  S.path.push({q:h.q,r:h.r}); // 可畫穿對手現在的格（執行時他可能已移走；沒移走則當下跳選項）
  renderAll();
}
function chooseIntent(opt,occ,h){
  hideIntentMenu();
  if(opt==="follow"){
    S.followTarget=occ.id; // 線收在他後方（現有線尾即停點）
    log(`指令：跟車 ${occ.name}（線尾＝他身後、吃尾流）`);
  }else{
    S.path.push({q:h.q,r:h.r}); // 線穿過他，執行時繞行
    log(`指令：超越 ${occ.name}（執行時自動繞行）`);
  }
  renderAll();
}

/* ═══ 執行引擎 ═══ */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function tweenPath(obj,hexes,ms){ // 沿多格軌跡固定時間滑行
  if(typeof window==="undefined"||ms<=0||hexes.length<2){obj.visPix=null;renderBoard();return Promise.resolve();}
  const pts=hexes.map(hexPix);
  return new Promise(res=>{
    const t0=performance.now();
    function fr(now){
      const k=Math.min(1,Math.max(0,(now-t0)/ms)); // rAF 時間戳可能早於 t0
      const f=k*(pts.length-1);
      const i=Math.max(0,Math.min(pts.length-2,Math.floor(f)));
      const u=f-i,a=pts[i],b=pts[i+1];
      obj.visPix={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
      renderBoard();
      if(k>=1){obj.visPix=null;renderBoard();res();}
      else requestAnimationFrame(fr);
    }
    requestAnimationFrame(fr);
  });
}
function tweenCar(obj,fromHex,toHex,ms){
  if(typeof window==="undefined"||ms<=0){obj.visPix=null;renderBoard();return Promise.resolve();}
  const a=hexPix(fromHex),b=hexPix(toHex);
  return new Promise(res=>{
    const t0=performance.now();
    function fr(now){
      const k=Math.min(1,(now-t0)/ms);
      obj.visPix={x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k};
      renderBoard();
      if(k>=1){obj.visPix=null;renderBoard();res();}
      else requestAnimationFrame(fr);
    }
    requestAnimationFrame(fr);
  });
}
function warningHexes(){
  const set=new Map();
  if(CFG.simpleOpponents)return set; // 降智模式：無警戒格
  if(S.feintOn)return set; // 預判：本回合警戒無效
  for(const o of S.opponents){
    const h=oppHex(o);
    neighbors(h).forEach(n=>{if(isRoad(n))set.set(key(n.q,n.r),o);});
  }
  return set;
}
function passProb(E){return Math.max(0,1-E*(CFG.probStep||0.25));} // p＝1−E×25%
function bandOf(total){
  for(const b of CFG.speedBands){if(total<=b.max)return b;}
  return CFG.speedBands[CFG.speedBands.length-1];
}
function cardsPerRound(){return CFG.cardsPerRound+((S.driver==="burst"&&S.flowPts>=6)?1:0);}
function computeBudget(){ // v3.5：速度量 SV＝min(檔位上限, min(⌊動量/2⌋,當前格摩擦力)＋⌊(P＋引擎)×倍率⌋)
  const st=S.submitted;
  const hasPush=S.chain.some(c=>c.fx==="push");
  let P=0;
  st.eff.forEach(e=>{
    let p=e.sym.p||0;
    if(hasPush&&e.card.col==="red")p+=1;
    if(e.card.fx==="roar"&&S.flowPts>=4)p+=1;
    P+=p;
  });
  if(S.driver==="burst"&&S.flowPts>=4)P+=1;
  const gear=CFG.gears[S.gear-1];
  const engine=Math.max(0,Math.floor((P+CFG.engineAdj)*gear.mult));
  const nocap=S.chain.some(c=>c.fx==="nocap"&&c.armed);
  let sv,overRev=false;
  if(S.gear<S.lastGear&&S.lastSV>gear.max){
    sv=S.lastSV;overRev=true; // 紅轉速：降檔保持原速、本回合不得加速
  }else{
    sv=engine;
    if(!nocap)sv=Math.min(sv,gear.max);
  }
  sv+=S.slipNext||0; // 尾流＝額外自由速度（不吃倍率、可破上限）
  const free=Math.floor(S.runLen/CFG.inertiaDiv); // 免費移動＝⌊速度÷2⌋（引擎外、不吃檔位上限）
  return {sv,free,engine,P,nocap,overRev,gearCap:gear.max,gearMult:gear.mult,travel:sv+free,total:sv+free};
}
function travelAfterPath(){ // 沿現有線走完後剩多少行程（離格付當前格摩擦力）
  if(!S.budget)return 0;
  let t=S.budget.travel;
  for(const p of S.path){
    if(t<=0)return 0;
    t--;
  }
  return t;
}
function simulateLine(){
  const st=S.submitted;
  if(!st||!S.budget)return null;
  let heading=S.heading,pos=S.pos,rdir=S.runDir;
  let pool=0;
  st.eff.forEach(e=>{pool+=(e.sym.g||0);});
  const poolStart=Math.max(0,pool);
  let travel=S.budget.travel,run=S.runLen;
  const events=[],lines=[];
  let stopAt=-1;
  for(let pi=0;pi<S.path.length;pi++){
    const nx=S.path[pi],d=dirBetween(pos,nx);
    if(travel<=0){stopAt=pi;break;}
    const isTurn=d>=0&&rdir>=0&&d!==rdir;
    const uu=(d>=0)?turnUnits(heading,d):0;
    const approach=run;
    if(d>=0){
      let dv=(uu>=2)?4:2;
      if(uu>=2&&chainHas("apex"))dv=armedHas("apex")?1:2;
      run=(rdir<0||d===rdir)?((rdir<0)?1:run+1):Math.max(1,Math.floor(run/dv));
    }
    if(CFG.cornerModel==="limit"&&isTurn){
      const sharp=uu>=2&&!chainHas("apex");
      const fricGrip=Math.max(0,frictionAt(pos)-(sharp?1:0));
      const need=approach-fricGrip;
      if(need<=0){/* 免費轉向：不掛徽章（摩擦力吃住、無事發生） */}
      else{
        const g=Math.min(Math.max(0,pool),need);
        pool-=g;
        const E=need-g,pp=passProb(E);
        const fm=`速度${approach}−抓地(摩${fricGrip}${sharp?"·急拐":""}${g?`＋🎯${g}`:""})＝超${E}`;
        if(E<=0){lines.push({t:fm+"→100%",bad:false});events.push({q:nx.q,r:nx.r,pct:100});}
        else if(pp<=0){lines.push({t:fm+"→必衝出！",bad:true});events.push({q:nx.q,r:nx.r,pct:0});}
        else{lines.push({t:`${fm}→${Math.round(pp*100)}%（QTE±20%）`,bad:pp<0.6});events.push({q:nx.q,r:nx.r,pct:Math.round(pp*100)});}
      }
    }
    if(d>=0){heading=d;rdir=d;}
    travel--;pos=nx;
    const bp=S.brakePoints.find(x=>x.key===key(nx.q,nx.r));
    if(bp){run=Math.max(0,run-2);lines.push({t:`煞車點＠第${pi+1}格（QTE 定減 1~3；試算以 −2 計、速度 ${run}）`,bad:false});}
  }
  return {lines,events,poolStart,poolLeft:Math.max(0,pool),stopAt,travelEnd:travel};
}
function lockChain(){
  if(S.phase!=="plan"||S.planStage!=="chain")return;
  // 出牌數自由：0 張＝整備回合（SV 0、清失誤、抽 3）
  S.submitted=planStats();
  S.budget=computeBudget();
  if(S.budget.overRev&&!S.overRevCharged){
    S.overRevCharged=true;
    log(`紅轉速！降檔後保持速度 ${S.budget.sv}（超過上限 ${S.budget.gearCap}）：本回合不得加速`,"warn");
  }
  S.planStage="line";
  log(`出牌鎖定：速度量 SV＝${svText(S.budget)}。hover 畫線 → 點擊確定路線`);
  renderAll();
}
function backToChain(){
  if(S.phase!=="plan"||(S.planStage!=="line"&&S.planStage!=="route"))return;
  S.planStage="chain";S.path=[];S.followTarget=null;S.submitted=null;S.budget=null;
  S.brakePoints=[];
  renderAll();
}
function confirmRoute(){
  if(S.phase!=="plan"||S.planStage!=="line")return;
  if(S.path.length===0){log("先畫一條路線","warn");return;}
  S.planStage="route";
  log("路線確定：點路徑格＝部件動作（煞車）、點線尾＝出發、點其他處＝回去改線");
  renderAll();
}
async function launch(){
  if(S.phase!=="plan"||S.planStage!=="route")return;
  if(CFG.simpleOpponents)S.opponents.forEach(o=>{o.rhythm=CFG.simpleRhythms[Math.random()*CFG.simpleRhythms.length|0];});
  const armedCost=flowSpend();
  if(armedCost>S.flowPts){log(`心流不足（需 ${armedCost}、現有 ${S.flowPts}）`,"warn");return;}
  S.phase="exec";
  S.submitted=planStats();S.budget=computeBudget();
  S.lastSV=S.budget.sv;
  if(armedCost>0){S.flowPts-=armedCost;log(`消耗心流 ${armedCost}（剩 ${S.flowPts}）`,"blue");}
  let gain=S.submitted.lit;
  S.chain.forEach((c,i)=>{
    const touched=(i>0&&S.submitted.lights[i-1])||(i<S.chain.length-1&&S.submitted.lights[i]);
    if(touched&&c.fx==="adren")gain+=2;
    if(touched&&c.fx==="hblood")gain+=1;
  });
  if(gain>0){S.flowPts+=gain;log(`亮燈入心流 +${gain}（累積 ${S.flowPts}）`,"gold");}
  S.rfx={freeturn:S.chain.some(c=>c.fx==="freeturn"&&c.armed)};
  S.feintOn=S.chain.some(c=>c.fx==="sight"&&c.armed);
  if(S.feintOn)log("預判生效：本回合對手警戒格無效","blue");
  S.pushOn=S.chain.some(c=>c.fx==="push");
  S.prevZone=zoneOf(S.pos);S.movedThisRound=0;
  const startProgP=playerTotalProg();
  const oppProg0={};S.opponents.forEach(o=>oppProg0[o.id]=oppTotalProg(o));
  document.getElementById("beatLabel").textContent="執行中…";
  renderAll();
  await raceRun();
  if(S.phase!=="exec")return;
  if(checkFinish())return;
  S.slipNext=0;
  const slipRng=armedHas("slips")?2:1;
  for(const o of S.opponents){
    if(S.stallBehind===o.id||(hexDist(S.pos,oppHex(o))<=slipRng&&playerTotalProg()<oppTotalProg(o))){
      S.slipNext=CFG.slipstreamBonus
        +(chainHas("slips")?1:0)
        +((armedHas("weave")&&S.stallBehind===o.id)?1:0);
      log(`咬住 ${o.name} 尾流：下回合速度 +${S.slipNext}`,"gold");break;
    }
  }
  if(!CFG.simpleOpponents)S.opponents.forEach(o=>{
    if(o.id==="A"&&oppProg0[o.id]>startProgP&&playerTotalProg()>oppTotalProg(o)&&o.rage<=0){
      o.rage=CFG.rageRounds+1;log("禿鷹 A 暴怒！","warn");
    }
  });
  endRound();
}
function playerTotalProg(){return S.laps*TRACK.len+S.prog;}

async function raceRun(){
  let g=CFG.aeroTech,t=0;
  S.submitted.eff.forEach(e=>{
    g+=(e.sym.g||0);
    const free=(e.card.fx==="nitrofree"&&e.card.armed);
    if(free&&(e.sym.t||0)>0)log("氮氣超載：免胎耗","gold");
    t+=free?0:Math.max(0,e.sym.t||0);
  });
  S.beatG=g; // 抓地池＝牌面🎯（摩擦力貢獻於每次轉向當場計入、不消耗）
  if(t>0){S.tires=Math.max(0,S.tires-t);log(`🛞 胎耗 −${t}（剩 ${S.tires}）`,"warn");if(S.tires<=0)return dnf();}
  S.chain.forEach(c=>{
    if(c.fx==="clean"&&c.armed){const ix=S.hand.findIndex(x=>x.id==="mistake");if(ix>=0){S.hand.splice(ix,1);log("行雲流水：清 1 張失誤","gold");}}
    if(c.fx==="nocap"&&c.armed)log("完美換檔：本回合無視檔位上限","gold");
  });
  let travel=S.budget.travel;
  log(`出發：行程 ${travel}（速度量 ${S.budget.sv}${S.budget.free?`＋慣性 ${S.budget.free}`:""}）、抓地力 ${Math.max(0,S.beatG)}`);
  const quota=new Map();
  S.opponents.forEach(o=>{
    let q=o.rhythm.reduce((s,x)=>s+x,0);
    if(o.rage>0)q+=CFG.rageBonus*CFG.beatsPerRound;
    quota.set(o.id,q);
  });
  // 軌跡緩衝：邏輯先算、事件前一次演完
  let segP=[{q:S.pos.q,r:S.pos.r}];
  const segO=new Map();S.opponents.forEach(o=>segO.set(o.id,[oppHex(o)]));
  async function flush(){
    const steps=Math.max(segP.length,...[...segO.values()].map(x=>x.length))-1;
    if(steps<=0)return;
    const ms=Math.min(1400,Math.max(380,steps*CFG.stepMs));
    const jobs=[];
    if(segP.length>1)jobs.push(tweenPath(S,segP,ms));
    S.opponents.forEach(o=>{const arr=segO.get(o.id);if(arr.length>1)jobs.push(tweenPath(o,arr,ms));});
    await Promise.all(jobs);
    segP=[{q:S.pos.q,r:S.pos.r}];
    S.opponents.forEach(o=>segO.set(o.id,[oppHex(o)]));
  }
  while(S.phase==="exec"){
    let acted=false;
    if(S.path.length>0&&travel>0){
      const next=S.path[0];
      const occ=occupiedBy(next);
      if(occ){
        await flush();
        const after=S.path.length>1?S.path[1]:null;
        let det=null;
        if(after){
          for(const n of neighbors(S.pos)){
            if(isRoad(n)&&!occupiedBy(n)&&hexDist(n,after)===1&&!hexEq(n,S.pos)){det=n;break;}
          }
        }else{
          for(const n of neighbors(S.pos)){
            if(isRoad(n)&&!occupiedBy(n)&&hexDist(n,next)===1&&!hexEq(n,S.pos)){det=n;break;}
          }
        }
        const choice=await askBlocked(occ,!!det);
        if(choice==="detour"&&det){
          const dd=dirBetween(S.pos,det);
          const isT=dd>=0&&S.runDir>=0&&dd!==S.runDir;
          const pend=isT?{tu:turnUnits(S.runDir,dd),approach:S.runLen+1,fricHex:{q:S.pos.q,r:S.pos.r},oldH:S.heading}:null;
          travel--;
          moveTo(det);S.path.shift();
          segP.push({q:S.pos.q,r:S.pos.r});acted=true;
          log(`繞行 ${occ.name}`);
          if(chainHas("foresee")){
            log("預判：繞行免轉向判定","gold");
            if(armedHas("foresee")){travel+=1;log("預判超載：額外前進 1 格","gold");}
          }else if(pend&&CFG.cornerModel==="limit"){
            if(await resolveTurn(pend.approach,pend.oldH,pend.tu,pend.fricHex,flush)==="slid"){travel=0;segP=[{q:S.pos.q,r:S.pos.r}];}
          }
        }else{
          log(`跟車：貼進 ${occ.name} 車尾`,"blue");
          S.stallBehind=occ.id;S.path=[];
          if(chainHas("weave"))log("車陣穿梭：慣性保住（速度不歸零）","gold");
          else{S.runLen=0;S.runDir=-1;log("急停貼車：速度歸零");}
        }
      }else{
        const nd=dirBetween(S.pos,next);
        const isT=nd>=0&&S.runDir>=0&&nd!==S.runDir;
        const approachSpd=S.runLen; // 轉向判定輸入＝直線速度（轉向前）
        const pend=isT?{tu:turnUnits(S.runDir,nd),approach:approachSpd,fricHex:{q:S.pos.q,r:S.pos.r},oldH:S.heading}:null;
        travel--;
        moveTo(next);S.path.shift();
        segP.push({q:S.pos.q,r:S.pos.r});acted=true;
        const bp=S.brakePoints.find(x=>x.key===key(S.pos.q,S.pos.r)&&!x.used);
        if(bp){
          bp.used=true;
          await flush();
          const amount=await brakeQTE();
          const tire=Math.floor(amount/CFG.brakePart.per);
          S.runLen=Math.max(0,S.runLen-amount);
          if(tire>0){S.tires=Math.max(0,S.tires-tire);if(S.tires<=0){dnf();}}
          log(`煞車：速度 −${amount}（現 ${S.runLen}）${tire?`、耗 ${tire} 胎（剩 ${S.tires}）`:""}`,"blue");
        }
        if(pend&&CFG.cornerModel==="limit"){
          if(await resolveTurn(pend.approach,pend.oldH,pend.tu,pend.fricHex,flush)==="slid"){travel=0;segP=[{q:S.pos.q,r:S.pos.r}];}
        }
      }
    }
    for(const o of S.opponents){
      if(quota.get(o.id)<=0)continue;
      const nextIdx=(o.pathIdx+1)%TRACK.len;
      const nh=TRACK.center[nextIdx];
      if(hexEq(nh,S.pos)||S.opponents.some(x=>x!==o&&hexEq(oppHex(x),nh)))continue;
      if(nextIdx===0)o.laps++;
      o.pathIdx=nextIdx;
      quota.set(o.id,quota.get(o.id)-1);
      segO.get(o.id).push(oppHex(o));acted=true;
    }
    if(!acted)break;
    if(S.phase!=="exec")return;
  }
  await flush();
  renderAll();
}
function payGrip(cost,why){
  const avail=Math.max(0,S.beatG);
  const paid=Math.min(avail,cost);
  S.beatG-=paid;
  const short=cost-paid;
  if(short>0){
    const m=Math.min(CFG.avalancheCap,short);
    lockRandom(m);
    let t=short-m;
    log(`${why}：🎯短缺 ${short} → 失誤×${m}${t>0?`、扣胎×${t}`:""}`,"warn");
    if(t>0){S.tires=Math.max(0,S.tires-t);if(S.tires<=0)dnf();}
  }else{
    log(`${why}：付 ${cost}🎯（庫剩 ${Math.max(0,S.beatG)}）`);
  }
}
function moveTo(h){
  const nd=dirBetween(S.pos,h);
  if(nd>=0){
    if(S.runDir<0||nd===S.runDir){S.runLen=(S.runDir<0)?1:S.runLen+1;}
    else{
      const u=turnUnits(S.runDir,nd);
      let dv=(u>=2)?4:2;
      if(u>=2&&chainHas("apex"))dv=armedHas("apex")?1:2; // 內線強襲：急拐÷2、超載完全不減
      S.runLen=Math.max(1,Math.floor(S.runLen/dv));
    }
    S.runDir=nd;S.heading=nd;
    S.movedThisRound++;
  }
  const np=progOf(h);
  if(np>=0){
    if(np<S.prog-TRACK.len/2){S.laps++;log(`═══ 完成第 ${S.laps} 圈 ═══`,"gold");}
    S.prog=np;
  }
  S.pos={q:h.q,r:h.r};
}
function frictionAt(h){
  if(SURROUND.grass.has(key(h.q,h.r)))return CFG.grassFriction;
  const z=zoneOf(h);
  return z?z.limit:CFG.straightFriction;
}
async function resolveTurn(approach,oldHeading,units,fricHex,flushFn){ // E＝直線速度−抓地力；抓地力＝摩擦力＋投入🎯
  const sharp=units>=2&&!chainHas("apex");
  if(units>=2&&chainHas("apex"))log("內線強襲：急拐視為緩轉","gold");
  const fricGrip=Math.max(0,frictionAt(fricHex||S.pos)-(sharp?1:0));
  if(sharp)log(`急拐：該格摩擦力貢獻 −1（計 ${fricGrip}）`,"warn");
  const need=approach-fricGrip;
  if(need<=0)return "ok";
  if(S.rfx&&S.rfx.freeturn){log(`神之領域：轉向（速度${approach}）全免`,"gold");return "ok";}
  const avail=Math.max(0,S.beatG||0);
  const g=Math.min(avail,need);
  if(g>0){S.beatG-=g;log(`投入 ${g}🎯（餘 ${Math.max(0,S.beatG)}）`);}
  const E=need-g;
  if(E<=0){log(`抓地力吃住：速度${approach} vs 摩${fricGrip}＋🎯${g}`);return "ok";}
  const p=passProb(E);
  if(p<=0){
    if(flushFn)await flushFn();
    log(`速度${approach}遠超抓地力（摩${fricGrip}＋🎯${g}）——推頭衝出！`,"warn");
    S.heading=oldHeading;
    await slideOut(E);
    return "slid";
  }
  if(flushFn)await flushFn();
  const r=await runQTE("cornerProb",S.submitted.cornerDiff,null,`基礎成功率 ${Math.round(p*100)}%`);
  const pf=Math.max(0,Math.min(1,p+(CFG.qteProbMod[r]||0)));
  if(Math.random()<pf){log(`轉向判定 ${Math.round(pf*100)}%——成功拗過！`,"gold");return "ok";}
  log(`轉向判定 ${Math.round(pf*100)}%——失敗、推頭衝出！`,"warn");
  S.heading=oldHeading;
  await slideOut(E);
  return "slid";
}
// 抓地力＝牌面🎯＋⌊SV×空力係數⌋，於 raceRun 開場一次入池
async function slideOut(E,opts){
  opts=opts||{};
  let leftRoad=false;
  for(let i=0;i<E;i++){
    const nx=hexAdd(S.pos,DIRS[S.heading]);
    if(occupiedBy(nx)){log("滑進車陣、被迫停下","warn");break;}
    if(isWall(nx)){
      S.tires=Math.max(0,S.tires-CFG.wallTire);
      log(`撞上護牆！硬停、再扣 ${CFG.wallTire} 胎（剩 ${S.tires}）`,"warn");
      if(S.tires<=0){dnf();}
      break;
    }
    if(!isRoad(nx)&&!leftRoad){
      leftRoad=true;
      S.tires=Math.max(0,S.tires-CFG.wallTire);
      log(`衝出路面！扣 ${CFG.wallTire} 胎（剩 ${S.tires}）`,"warn");
      if(S.tires<=0){dnf();}
    }
    const fromS={q:S.pos.q,r:S.pos.r};
    S.pos={q:nx.q,r:nx.r};
    const np=progOf(nx);
    if(np>=0){if(np<S.prog-TRACK.len/2)S.laps++;S.prog=np;}
    await tweenCar(S,fromS,S.pos,CFG.stepMs);
    if(S.phase==="over")return;
  }
  if(!isRoad(S.pos))log("車停在緩衝區：下回合自己開回賽道","warn");
  S.runLen=0;S.runDir=-1;
  const nm=(opts.mist===undefined)?CFG.overshootMistake:opts.mist;
  log(`失控收場：速度歸零、剩餘路線作廢`,"warn");
  lockRandom(nm);
  S.path=[];
  renderAll();
}
function endRound(){
  // 輪轉制：打出的牌標記已用；場上全部用完才一起歸隊
  S.chain.forEach(c=>{
    if(c.locked){healMistake(c);log(`【${c.name}】的失誤已排除、恢復原本效果`,"gold");}
    c.used=true;
  });
  if(S.table.every(c=>c.used)){
    S.table.forEach(c=>{c.used=false;});
    log("牌桌全部用過：全數歸隊","gold");
  }
  S.chain=[];S.beatG=0;S.feintOn=false;S.pushOn=false;S.followTarget=null;S.stallBehind=null;S.rfx=null;S.followMode=null;
  S.brakePoints=[];S.overRevCharged=false;
  S.table.forEach(c=>{c.armed=false;c.odMode=null;applyOD(c);});
  if(S.movedThisRound===0&&(S.runLen>0||S.runDir>=0)){S.runLen=0;S.runDir=-1;log("整回合未移動：速度歸零");} // 動量跨回合延續
  S.planStage="chain";S.budget=null;
  S.opponents.forEach(o=>{if(o.rage>0)o.rage--;});
  S.round++;S.phase="plan";S.submitted=null;
  log(`── 回合 ${S.round}：規劃 ──`);
  renderAll();
}
function drawN(n){
  for(let i=0;i<n;i++){
    if(S.deck.length===0){if(S.discard.length===0)break;S.deck=shuffle(S.discard);S.discard=[];log("牌庫洗回");}
    const c=S.deck.pop();
    if(S.hand.length<CFG.handMax)S.hand.push(c);
    else{S.discard.push(c);log(`手牌已滿：${c.name} 直接棄掉`);}
  }
}
function drawToFull(){
  while(S.hand.length<CFG.handMax){
    if(S.deck.length===0){if(S.discard.length===0)break;S.deck=shuffle(S.discard);S.discard=[];log("牌庫洗回");}
    S.hand.push(S.deck.pop());
  }
}
function checkFinish(){
  const pDone=S.laps>=CFG.lapsToWin;
  const oDone=S.opponents.filter(o=>o.laps>=CFG.lapsToWin);
  if(pDone||oDone.length){
    S.phase="over";
    const rank=1+S.opponents.filter(o=>oppTotalProg(o)>playerTotalProg()).length;
    showOverlay(pDone?`🏁 完賽！名次 P${rank}`:`🏁 ${oDone[0].name} 先完賽…名次 P${rank}`,true);
    return true;
  }
  return false;
}
function dnf(){S.phase="over";showOverlay("💥 輪胎歸零：DNF",true);}

/* ═══ QTE ═══ */
function runQTE(kind,diff,opp,note){
  return new Promise(res=>{
    const ov=document.getElementById("qte");
    const label=kind==="corner"||kind==="cornerProb"?"彎道":"阻擋"+(opp?`（${opp.name}）`:"");
    document.getElementById("qteLabel").textContent=`${label} QTE　難度 ${diff}${note?`｜${note}`:""}`;
    const goodW=Math.max(36,150-diff*18), perfW=Math.max(12,46-diff*6);
    const zone=document.getElementById("qteZone"), perf=document.getElementById("qtePerf");
    zone.style.width=goodW+"px"; perf.style.width=perfW+"px";
    ov.style.display="flex";
    const bar=document.getElementById("qteBar"), mk=document.getElementById("qteMark");
    const W=360; let t0=performance.now(), done=false, passes=0;
    function frame(now){
      if(done)return;
      const period=1400; // 指針一趟毫秒
      let ph=((now-t0)%period)/period;
      if(Math.floor((now-t0)/period)>=3){finish(999);return;}
      const x=ph<0.5?ph*2:(1-ph)*2;
      mk.style.left=(x*W)+"px";
      requestAnimationFrame(frame);
    }
    function finish(offPx){
      done=true;ov.style.display="none";
      document.removeEventListener("keydown",onKey);bar.removeEventListener("pointerdown",onTap);
      let r;
      if(offPx<=perfW/2)r="perfect";
      else if(offPx<=goodW/2)r="good";
      else if(offPx<=W*0.42)r="fail";
      else r="bigfail";
      if(kind==="cornerProb"){ // 賭區：QTE 只當機率修正、不另行處罰
        log(`QTE ${r}（機率修正 ${Math.round((CFG.qteProbMod[r]||0)*100)}%）`,r==="perfect"?"gold":"");
      }else if(r==="perfect")log(`QTE PERFECT！`,"gold");
      else if(r==="good")log("QTE good");
      else if(r==="fail"){log("QTE 失敗","warn");}
      else{S.tires=Math.max(0,S.tires-1);log("QTE 大失敗：扣胎×1","warn");if(S.tires<=0)dnf();}
      renderAll();res(r);
    }
    function hit(){
      const mx=parseFloat(mk.style.left)||0;
      finish(Math.abs(mx-W/2));
    }
    function onKey(e){if(e.code==="Space"){e.preventDefault();hit();}}
    function onTap(){hit();}
    document.addEventListener("keydown",onKey);
    bar.addEventListener("pointerdown",onTap);
    requestAnimationFrame(frame);
  });
}

/* ═══ 渲染 ═══ */
let HEX=26; const SQ3=Math.sqrt(3);
let ORIGIN={x:80,y:60};
function fitBoard(){
  const wrap=document.getElementById("boardWrap"),cv=document.getElementById("board");
  const W=wrap.clientWidth,H=wrap.clientHeight;
  if(!W||!H)return;
  cv.width=W;cv.height=H;
  let xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9;
  const scan=c=>{const x=SQ3*(c.q+c.r/2),y=1.5*c.r;
    if(x<xmin)xmin=x;if(x>xmax)xmax=x;if(y<ymin)ymin=y;if(y>ymax)ymax=y;};
  TRACK.road.forEach(scan);SURROUND.grass.forEach(scan);SURROUND.wall.forEach(scan);
  const pad=26;
  HEX=Math.min((W-2*pad)/(xmax-xmin+2.2),(H-2*pad)/(ymax-ymin+2.2));
  ORIGIN={
    x:pad+HEX*(1.1-xmin)+(W-2*pad-HEX*(xmax-xmin+2.2))/2,
    y:pad+HEX*(1.1-ymin)+(H-2*pad-HEX*(ymax-ymin+2.2))/2,
  };
}
function hexPix(h){return {x:ORIGIN.x+HEX*SQ3*(h.q+h.r/2), y:ORIGIN.y+HEX*1.5*h.r};}
const CAM={z:1,x:0,y:0};
function camReset(){CAM.z=1;CAM.x=0;CAM.y=0;renderBoard();}
function pixHex(px,py){
  px=(px-CAM.x)/CAM.z;py=(py-CAM.y)/CAM.z;
  const q=((px-ORIGIN.x)*(SQ3/3)-(py-ORIGIN.y)/3)/HEX, r=(py-ORIGIN.y)*(2/3)/HEX;
  let rq=Math.round(q),rr=Math.round(r),rs=Math.round(-q-r);
  const dq=Math.abs(rq-q),dr=Math.abs(rr-r),ds=Math.abs(rs+q+r);
  if(dq>dr&&dq>ds)rq=-rr-rs;else if(dr>ds)rr=-rq-rs;
  return {q:rq,r:rr};
}
function drawHex(ctx,h,fill,stroke,lw){
  const c=hexPix(h);ctx.beginPath();
  for(let i=0;i<6;i++){const a=Math.PI/180*(60*i-30);const x=c.x+HEX*Math.cos(a),y=c.y+HEX*Math.sin(a);i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
  ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw||1;ctx.stroke();}
}
function renderBoard(){
  const cv=document.getElementById("board"),ctx=cv.getContext("2d");
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.setTransform(CAM.z,0,0,CAM.z,CAM.x,CAM.y);
  const warn=S.phase==="plan"?warningHexes():warningHexes();
  SURROUND.grass.forEach(h=>{
    drawHex(ctx,h,"#0b140f","#14231a",1);

  });
  SURROUND.wall.forEach(h=>{drawHex(ctx,h,"#2a1219","#5a2230",1.5);});
  TRACK.road.forEach(cell=>{
    const isCenter=TRACK.center.some(c=>hexEq(c,cell));
    const fill=cell.prog<1?"#10254a":"#101326";
    drawHex(ctx,cell, fill, "#1e2444",1);
    if(CFG.cornerModel==="limit"){
      const p=hexPix(cell);
      ctx.textAlign="center";

    }
    if(isCenter){const p=hexPix(cell);ctx.fillStyle="#1c2140";ctx.beginPath();ctx.arc(p.x,p.y,2,0,7);ctx.fill();}
  });
  // 警戒格
  warn.forEach((o,k)=>{
    const [q,r]=k.split(",").map(Number);
    drawHex(ctx,{q,r},o.rage>0?"rgba(255,61,245,0.22)":"rgba(255,179,71,0.14)",null);
  });
  // 玩家畫線
  if(S.phase==="plan"&&(S.planStage==="line"||S.planStage==="route")&&S.path.length>0){
    const tip=S.path[S.path.length-1],tp=hexPix(tip);
    drawHex(ctx,tip,null,"#ffd166",2.4);
    ctx.fillStyle="#ffd166";ctx.font=`bold ${Math.max(11,HEX*0.4)|0}px sans-serif`;ctx.textAlign="center";
    ctx.fillText(S.planStage==="line"?"點擊＝確定路線":"設部件・按「出發！」",tp.x,tp.y+HEX*1.15);
  }
  for(const bp of S.brakePoints){
    const p=hexPix(bp);
    ctx.fillStyle="rgba(8,4,24,0.9)";ctx.strokeStyle="#ff6b6b";ctx.lineWidth=1.5;
    ctx.beginPath();ctx.roundRect(p.x-20,p.y+HEX*0.35,40,HEX*0.52,4);ctx.fill();ctx.stroke();
    ctx.fillStyle="#ff8f8f";ctx.font=`bold ${Math.max(10,HEX*0.36)|0}px sans-serif`;ctx.textAlign="center";
    ctx.fillText(bp.amount?`煞−${bp.amount}`:"煞!",p.x,p.y+HEX*0.74);
  }
  {
    let prev=S.pos,rd=S.runDir;
    S.path.forEach((h,i)=>{
      const d=dirBetween(prev,h);
      const isTurn=d>=0&&rd>=0&&d!==rd;
      const uu=(d>=0&&rd>=0)?turnUnits(rd,d):0;
      drawHex(ctx,h,isTurn?"rgba(255,157,84,0.18)":"rgba(92,242,255,0.16)",isTurn?"#ff9d54":"#5cf2ff",2);
      const p=hexPix(h);
      // 行進方向箭頭
      if(d>=0){
        const dd=DIRS[d];
        const vx=SQ3*(dd[0]+dd[1]/2),vy=1.5*dd[1];
        const L=Math.hypot(vx,vy)||1,ux=vx/L,uy=vy/L,R=HEX*0.42;
        ctx.strokeStyle=isTurn?"#ff9d54":"#5cf2ff";ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(p.x-ux*R*0.5,p.y-uy*R*0.5);ctx.lineTo(p.x+ux*R,p.y+uy*R);ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x+ux*R,p.y+uy*R);
        ctx.lineTo(p.x+ux*R*0.55-uy*R*0.3,p.y+uy*R*0.55+ux*R*0.3);
        ctx.lineTo(p.x+ux*R*0.55+uy*R*0.3,p.y+uy*R*0.55-ux*R*0.3);
        ctx.closePath();ctx.fill();
      }
      ctx.font=`${Math.max(9,HEX*0.3)|0}px monospace`;ctx.textAlign="center";
      ctx.fillStyle=isTurn?"#ff9d54":"#5cf2ff";
      ctx.fillText(isTurn?`${i+1}・轉${uu>=2?"120":"60"}°`:String(i+1),p.x,p.y-HEX*0.42);
      if(d>=0)rd=d;
      prev=h;
    });
  }
  // 對手
  const R=Math.max(10,HEX*0.42);
  for(const o of S.opponents){
    const p=o.visPix||hexPix(oppHex(o));
    ctx.fillStyle=o.color;ctx.beginPath();ctx.arc(p.x,p.y,R,0,7);ctx.fill();
    ctx.fillStyle="#080418";ctx.font=`bold ${Math.max(10,HEX*0.4)|0}px sans-serif`;ctx.textAlign="center";ctx.fillText(o.id,p.x,p.y+R*0.35);
    if(o.rage>0){ctx.strokeStyle="#ff3df5";ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,R*1.3,0,7);ctx.stroke();}
  }
  // 過彎機率徽章（畫線階段）
  if(S.phase==="plan"&&(S.planStage==="line"||S.planStage==="route")&&S.budget&&S.submitted&&S.path.length){
    const sim=simulateLine();
    if(sim&&sim.events){
      sim.events.forEach(ev=>{
        const p=hexPix({q:ev.q,r:ev.r});
        const txt=ev.pct===0?"衝出!":ev.pct+"%";
        const col=ev.pct===0?"#ff4d4d":ev.pct===100?"#5cf2ff":"#ffd166";
        ctx.font=`bold ${Math.max(11,HEX*0.42)|0}px sans-serif`;
        const m=ctx.measureText(txt);
        const w=((m&&m.width)||HEX)+10;
        ctx.fillStyle="rgba(8,4,24,0.9)";
        ctx.strokeStyle=col;ctx.lineWidth=1.5;
        const bx=p.x-w/2,by=p.y-HEX*1.05,bh=HEX*0.6;
        ctx.beginPath();ctx.roundRect(bx,by,w,bh,5);ctx.fill();ctx.stroke();
        ctx.fillStyle=col;ctx.textAlign="center";
        ctx.fillText(txt,p.x,by+bh*0.72);
      });
    }
  }
  // 玩家
  const pp=S.visPix||hexPix(S.pos),PR=Math.max(11,HEX*0.46);
  ctx.fillStyle="#5cf2ff";ctx.beginPath();ctx.arc(pp.x,pp.y,PR,0,7);ctx.fill();
  const hd=[[1,0],[0.5,0.87],[-0.5,0.87],[-1,0],[-0.5,-0.87],[0.5,-0.87]][S.heading];
  ctx.strokeStyle="#080418";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(pp.x,pp.y);ctx.lineTo(pp.x+hd[0]*PR*0.9,pp.y+hd[1]*PR*0.9);ctx.stroke();
  ctx.fillStyle="#080418";ctx.font=`bold ${Math.max(10,HEX*0.36)|0}px sans-serif`;ctx.fillText("你",pp.x,pp.y+PR*0.32);
  if(S.runLen>0){
    ctx.fillStyle="#ffd166";ctx.font=`bold ${Math.max(12,HEX*0.5)|0}px sans-serif`;
    ctx.fillText(String(S.runLen),pp.x,pp.y-PR-6);
  }
  if(S.runDir>=0){ // 目前行進方向（同方向續走＝不算轉向）
    const dd=DIRS[S.runDir];
    const vx=SQ3*(dd[0]+dd[1]/2),vy=1.5*dd[1];
    const L=Math.hypot(vx,vy)||1,ux=vx/L,uy=vy/L;
    ctx.strokeStyle="#ffd166";ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(pp.x+ux*PR*0.9,pp.y+uy*PR*0.9);ctx.lineTo(pp.x+ux*PR*1.75,pp.y+uy*PR*1.75);ctx.stroke();
    ctx.fillStyle="#ffd166";
    ctx.beginPath();
    ctx.moveTo(pp.x+ux*PR*2.05,pp.y+uy*PR*2.05);
    ctx.lineTo(pp.x+ux*PR*1.5-uy*PR*0.36,pp.y+uy*PR*1.5+ux*PR*0.36);
    ctx.lineTo(pp.x+ux*PR*1.5+uy*PR*0.36,pp.y+uy*PR*1.5-ux*PR*0.36);
    ctx.closePath();ctx.fill();
  }
  if(S.alert){
    ctx.fillStyle="#ff4d4d";ctx.font=`bold ${Math.max(18,HEX*0.8)|0}px sans-serif`;
    ctx.fillText("❗",pp.x,pp.y-PR-HEX*0.7);
  }
}

/* ═══ 面板渲染 ═══ */
const SYM_LABEL={p:"⚡",g:"🎯",f:"♒",t:"🛞"};
const COL_CLASS={red:"cRed",green:"cGreen",yellow:"cYellow",blue:"cBlue",black:"cBlack",none:"cNone"};
function pipsOf(seq){
  let s="";
  seq.forEach((el,i)=>{
    const neg=el.startsWith("-"),k=neg?el.slice(1):el;
    const pos=(i===0?" head":"")+(i===seq.length-1?" tail":"");
    s+=`<span class="pip ${neg?"neg":""}${pos}">${SYM_LABEL[k]}</span>`;
  });
  return s;
}
function cardHTML(c,eff){
  let body;
  if(c.dual){
    body=`<div class="dualHalf ${c.side==="a"?"on":"off"}" data-side="a">${pipsOf(c.dual.a)}</div>`+
         `<div class="dualHalf ${c.side==="b"?"on":"off"}" data-side="b">${pipsOf(c.dual.b)}</div>`;
  }else{
    let pips=pipsOf(c.seq);
    if(c.star)pips=`<span class="pip star">✦</span>`;
    body=`<div class="cPips">${pips||"&nbsp;"}</div>`;
  }
  let badges="";
  if(c.badge){for(const k in c.badge){badges+=`<span class="badge">${SYM_LABEL[k]}×${c.badge[k]}</span>`;}}
  let costBtn="";
  if(c.locked)costBtn=`<div class="costBtn" style="cursor:default;border-color:#ff5c5c;color:#ff8f8f">⚠ 失誤牌：打出即恢復</div>`;
  else if(c.flowReq)costBtn=`<div class="costBtn on" style="cursor:default">需 ${c.flowReq} 心流</div>`;
  else if(c.cost){
    const addable=!!(CARD_DEFS[c.id]&&CARD_DEFS[c.id].od);
    const state=c.armed?(addable?(c.odMode==="head"?"（加頭）":"（加尾）"):"（已啟動）"):"";
    costBtn=`<div class="costBtn ${c.armed?"on":""}" data-uid="${c.uid}">超載 ${c.cost} 心流${state}</div>`;
  }
  if(badges)badges=`<div class="cBadgeRow">${badges}</div>`;
  return `<div class="cName">${c.name}</div>${body}${badges}${costBtn}${c.note?`<div class="cNote">${c.note}</div>`:""}${eff&&eff.doubled?`<div class="cNote gold">×2 放大中</div>`:""}`;
}
function bindDualHalves(el,c){
  function replan(){
    if(S.planStage==="line"&&S.submitted){
      S.submitted=planStats();S.budget=computeBudget();
      let trimmed=0;
      while(S.path.length&&travelAfterPath()===0){
        const dropped=S.path.pop();
        S.brakePoints=S.brakePoints.filter(x=>x.key!==key(dropped.q,dropped.r));
        trimmed++;
      }
      if(trimmed>0)log(`速度量改變：線縮短 ${trimmed} 格`,"warn");
    }
    renderAll();
  }
  el.querySelectorAll(".dualHalf").forEach(hf=>{
    hf.onclick=ev=>{
      ev.stopPropagation();
      if(S.phase!=="plan")return;
      setCardSide(c,hf.dataset.side);replan();
    };
  });
  el.querySelectorAll(".costBtn").forEach(bt=>{
    bt.onclick=ev=>{
      ev.stopPropagation();
      if(S.phase!=="plan")return;
      if(c.flowReq)return; // 教練：強制費、無切換
      const addable=!!(CARD_DEFS[c.id]&&CARD_DEFS[c.id].od);
      if(!c.armed){
        if(flowSpend()+c.cost>S.flowPts){log(`心流不足（需 ${flowSpend()+c.cost}、現有 ${S.flowPts}）`,"warn");return;}
        c.armed=true;c.odMode="tail";
      }else if(addable&&c.odMode==="tail"){c.odMode="head";}
      else{c.armed=false;c.odMode=null;}
      applyOD(c);replan();
    };
  });
}
function renderHand(){ // 開放牌桌：12 張全攤、三態（可用／冷卻／上鎖）
  const el=document.getElementById("hand");el.innerHTML="";
  S.table.forEach(c=>{
    if(S.chain.includes(c))return; // 已入鏈的顯示在鏈區
    const d=document.createElement("div");
    d.className=`card ${COL_CLASS[c.col]}`;
    d.innerHTML=cardHTML(c);
    d.style.position="relative";
    const t=document.createElement("div");
    t.textContent=gearText(c);
    t.style.cssText="position:absolute;top:3px;right:5px;font-size:10px;color:#ffd166;border:1px solid #ffd166;border-radius:4px;padding:0 3px;";
    d.appendChild(t);
    let dead="";
    if(c.used)dead="已用（等全桌用完歸隊）";
    else if(!c.locked&&!gearOK(c))d.style.opacity="0.45";
    if(c.locked&&!c.used){d.style.borderColor="#ff5c5c";d.style.opacity="1";}
    if(dead){
      d.style.opacity="0.3";
      const ov=document.createElement("div");
      ov.textContent=dead;
      ov.style.cssText="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;color:#8f96c9;background:rgba(8,4,24,0.55);border-radius:8px;";
      d.appendChild(ov);
    }
    d.onclick=()=>{if(S.phase!=="plan"||S.planStage!=="chain")return;
      if(c.used){log(`【${c.name}】本輪已用過（等牌桌全部用完才歸隊）`,"warn");return;}
      if(!c.locked&&!gearOK(c)){log(`【${c.name}】限 ${gearText(c)}（現在 ${S.gear} 檔）`,"warn");return;}
      if(S.chain.length>=chainSize()){log(`指令槽已滿（車手智慧 ${chainSize()}）`,"warn");return;}
      if(c.flowReq&&flowSpend()+c.flowReq>S.flowPts){log(`心流不足：【${c.name}】需 ${c.flowReq}（現有 ${S.flowPts}）`,"warn");return;}
      S.chain.push(c);
      S.path=[];S.followTarget=null;
      renderAll();};
    el.appendChild(d);
    bindDualHalves(d,c);
  });
}
function renderChain(){
  const el=document.getElementById("chain");el.innerHTML="";
  const st=S.chain.length?planStats():null;
  S.chain.forEach((c,i)=>{
    const d=document.createElement("div");
    d.className=`card sm ${COL_CLASS[c.col]}`;d.id="chain"+i;
    d.innerHTML=cardHTML(c,st?st.eff[i]:null);
    d.onclick=()=>{if(S.phase!=="plan"||S.planStage!=="chain")return;
      S.chain.splice(i,1);S.path=[];S.followTarget=null;renderAll();};
    el.appendChild(d);
    bindDualHalves(d,c);
    if(i<S.chain.length-1){
      const lt=document.createElement("div");
      lt.className="light"+(st&&st.lights[i]?" on":"");
      lt.textContent=st&&st.lights[i]?"●":"○";
      el.appendChild(lt);
    }
  });
  const d=document.createElement("div");d.className="card sm empty";d.textContent="＋";el.appendChild(d);
}
function markChainActive(b){
  document.querySelectorAll("#chain .card").forEach((el,i)=>el.classList.toggle("active",i===b));
}
function renderStats(){
  const st=S.chain.length?planStats():{lit:0,stab:0,cornerDiff:"—",blockDiff:"—"};
  const mist=S.table.filter(c=>c.locked).length;
  const rank=1+S.opponents.filter(o=>oppTotalProg(o)>playerTotalProg()).length;
  const iner=Math.floor(S.runLen/CFG.inertiaDiv);
  const tireDots="●".repeat(Math.max(0,S.tires))+"○".repeat(Math.max(0,CFG.tiresStart-S.tires));
  document.getElementById("stats").innerHTML=
    `<div class="statGrid">`+
    `<div class="tile"><div class="tv">${S.round}</div><div class="tl">回合</div></div>`+
    `<div class="tile"><div class="tv">${S.laps}/${CFG.lapsToWin}</div><div class="tl">圈</div></div>`+
    `<div class="tile"><div class="tv">P${rank}</div><div class="tl">名次</div></div>`+
    `<div class="tile gold"><div class="tv">${S.runLen}</div><div class="tl">速度${iner>0?`・慣性+${iner}`:""}</div></div>`+
    `<div class="tile cyan"><div class="tv">${S.flowPts}</div><div class="tl">心流</div></div>`+
    `<div class="tile ${mist>0?"warnT":""}"><div class="tv">${mist}</div><div class="tl">失誤牌</div></div>`+
    `</div>`+
    `<div class="statRow"><span class="tireDots">${tireDots}</span> 胎｜亮燈 ${st.lit}｜♒ ${st.stab||0}｜QTE 難度 ${st.cornerDiff}${S.slipNext?`｜尾流 +${S.slipNext}⚡`:""}</div>`+
    (S.driver==="burst"?`<div class="statRow">心流門檻　${S.flowPts>=2?"✓":"✗"}尾流+1　${S.flowPts>=4?"✓":"✗"}動力+1</div>`:"")+
    (S.driver==="rhythm"?`<div class="statRow">心流＝專屬牌的燃料（入鏈後點消耗鈕）</div>`:"");
  document.getElementById("gearVal").textContent=S.gear;
  const gg=CFG.gears[S.gear-1];
  const left=S.table.filter(c=>!c.used).length;
  document.getElementById("gearHint").textContent=`上限 ${gg.max}・倍率 ×${gg.mult}・指令槽 ${chainSize()}・未用 ${left}/${S.table.length}`;
}
function renderLog(){
  const el=document.getElementById("logBox");
  el.innerHTML=S.log.map(l=>`<div class="${l.cls}">${l.msg}</div>`).join("");
  el.scrollTop=el.scrollHeight;
}
function setBeatLabel(b){document.getElementById("beatLabel").textContent=S.phase==="exec"?`執行中：第 ${b} 拍`:"";}
function renderLineInfo(){
  const el=document.getElementById("lineInfo");
  if((S.planStage!=="line"&&S.planStage!=="route")||!S.budget){el.innerHTML="";el.style.display="none";return;}
  el.style.display="block";
  const B=S.budget;
  const sim=simulateLine();
  let html=`<b>SV＝${svText(B)}</b>｜線 ${S.path.length} 格｜抓地力 ${sim?sim.poolStart:0}${sim&&sim.poolStart!==sim.poolLeft?`→剩${sim.poolLeft}`:""}<br>`;
  if(sim&&sim.stopAt>=0)html+=`<span class="warn">⚠ 行程不足：只走得到第 ${sim.stopAt} 格，之後的線走不完</span><br>`;
  if(sim&&sim.lines.length){sim.lines.forEach(l=>{html+=`<span class="${l.bad?"warn":""}">${l.t}</span><br>`;});}
  if(S.planStage==="line")html+=`<span style="color:#8f96c9">點擊＝確定路線</span>`;
  else html+=`<span style="color:#8f96c9">點路徑格＝部件動作（煞車）｜按「出發！」發車｜點其他處＝改線</span>`;
  el.innerHTML=html;
}

function renderOpps(){
  const el=document.getElementById("opps");
  if(CFG.simpleOpponents){
    el.innerHTML=S.opponents.map(o=>`<span style="color:${o.color}">●</span> ${o.name}　每拍走 1 格（純路障）`).join("<br>");
    return;
  }
  el.innerHTML=S.opponents.map(o=>{
    const flags=[o.rage>0?`<span class="warn">暴怒 ${o.rage}回合</span>`:"",o.id==="P"?"糾纏":""].filter(x=>x).join("｜");
    return `<span style="color:${o.color}">●</span> ${o.name}　節奏 <b>${o.rhythm.join("・")}</b>${flags?"　"+flags:""}`;
  }).join("<br>");
}
function renderAll(){renderBoard();renderHand();renderChain();renderStats();renderLineInfo();renderOpps();
  const sb=document.getElementById("btnSubmit");
  sb.disabled=S.phase!=="plan";
  sb.textContent=S.planStage==="chain"?"確定出牌 → 畫線":(S.planStage==="line"?"確定路線":"出發！");
  document.getElementById("btnBack").style.display=(S.phase==="plan"&&S.planStage!=="chain")?"":"none";
  document.getElementById("btnClear").disabled=!(S.phase==="plan"&&S.planStage!=="chain");
  document.querySelectorAll(".gearBtn").forEach(x=>x.disabled=!(S.phase==="plan"&&S.planStage==="chain"));
  if(S.phase==="plan")setBeatLabel(0);
}

/* ═══ 選單／覆層 ═══ */
function openPartMenu(h){
  const k=key(h.q,h.r);
  const exist=S.brakePoints.find(b=>b.key===k);
  const m=document.getElementById("intent");
  document.getElementById("intentTitle").textContent="部件動作";
  const a=document.getElementById("btnOvertake"),b=document.getElementById("btnFollow");
  if(exist){
    a.textContent=`移除煞車點（−${exist.amount}）`;a.style.display="";
    a.onclick=()=>{m.style.display="none";S.brakePoints=S.brakePoints.filter(x=>x.key!==k);renderAll();};
  }else if(S.brakePoints.length>=CFG.brakePart.max){
    a.textContent=`煞車點已達上限（${CFG.brakePart.max}／回合）`;a.style.display="";
    a.onclick=()=>{m.style.display="none";};
  }else{
    a.textContent=`煞車點（車過此格時 QTE 定減 1~3 直線速度；每 ${CFG.brakePart.per} 點減速耗 1 胎）`;a.style.display="";
    a.onclick=()=>{
      m.style.display="none";
      S.brakePoints.push({key:k,q:h.q,r:h.r,amount:null,used:false});
      log("設置煞車點：過點時演煞車 QTE","blue");
      renderAll();
    };
  }
  b.textContent="取消";
  b.onclick=()=>{m.style.display="none";};
  m.style.display="flex";
}
function brakeQTE(){
  if(typeof window==="undefined")return Promise.resolve(2);
  return new Promise(res=>{
    const ov=document.getElementById("qte"),ptr=document.getElementById("qteMark"),
          zone=document.getElementById("qteZone"),perf=document.getElementById("qtePerf"),
          segs=document.getElementById("qteSegs");
    document.getElementById("qteLabel").textContent="煞車 QTE　指標停在哪一格＝減多少速度";
    zone.style.display="none";perf.style.display="none";if(segs)segs.style.display="flex";
    ov.style.display="flex";
    const W=360;let done=false;
    const order=[1,2,3].sort(()=>Math.random()-0.5); // 段位隨機
    if(segs)[...segs.children].forEach((el,i)=>el.textContent="−"+order[i]);
    const t0=performance.now(),speedPx=0.95; // 快、只跑一個來回
    function frame(now){
      if(done)return;
      const x=(now-t0)*speedPx;
      if(x>=W*2){finish();return;} // 跑完一個來回：就地結算
      const px=x<W?x:2*W-x;
      ptr.style.left=px+"px";
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    function finish(){
      done=true;ov.style.display="none";
      if(segs)segs.style.display="none";
      zone.style.display="";perf.style.display="";
      document.removeEventListener("keydown",onKey);
      const px=parseFloat(ptr.style.left)||0;
      const seg=Math.min(2,Math.max(0,Math.floor(px/(W/3))));
      res(order[seg]);
    }
    function onKey(e){if(e.code==="Space"||e.code==="Enter"){e.preventDefault();finish();}}
    document.addEventListener("keydown",onKey);
    document.getElementById("qteBar").onpointerdown=()=>finish();
  });
}
function askBlocked(occ,canDetour){
  if(typeof window==="undefined")return Promise.resolve(canDetour?"detour":"stay");
  S.alert=true;renderBoard();
  return new Promise(res=>{
    const m=document.getElementById("intent");
    document.getElementById("intentTitle").textContent=`路線被 ${occ.name} 擋住！`;
    const a=document.getElementById("btnOvertake"),b=document.getElementById("btnFollow");
    a.textContent="繞行（側邊有空格、續走原線）";
    a.style.display=canDetour?"":"none";
    b.textContent="跟住（停在他車尾吃尾流、放棄剩餘的線）";
    m.style.display="flex";
    a.onclick=()=>{m.style.display="none";S.alert=false;res("detour");};
    b.onclick=()=>{m.style.display="none";S.alert=false;res("stay");};
  });
}
function showIntentMenu(occ,h){
  const m=document.getElementById("intent");
  document.getElementById("intentTitle").textContent=`前方：${occ.name}`;
  m.style.display="flex";
  document.getElementById("btnOvertake").onclick=()=>chooseIntent("overtake",occ,h);
  document.getElementById("btnFollow").onclick=()=>chooseIntent("follow",occ,h);
}
function hideIntentMenu(){document.getElementById("intent").style.display="none";}
function showOverlay(msg,final){
  const o=document.getElementById("banner");
  o.textContent=msg;o.style.display="block";
  if(!final)setTimeout(()=>o.style.display="none",1800);
}

/* ═══ 輸入與初始化 ═══ */
function bindUI(){
  const cv=document.getElementById("board");
  cv.addEventListener("wheel",e=>{
    e.preventDefault();
    const rc=cv.getBoundingClientRect();
    const mx=(e.clientX-rc.left)*(cv.width/rc.width),my=(e.clientY-rc.top)*(cv.height/rc.height);
    const nz=Math.min(3,Math.max(0.6,CAM.z*(e.deltaY<0?1.15:1/1.15)));
    CAM.x=mx-(mx-CAM.x)*(nz/CAM.z);
    CAM.y=my-(my-CAM.y)*(nz/CAM.z);
    CAM.z=nz;
    renderBoard();
  },{passive:false});
  cv.addEventListener("contextmenu",e=>e.preventDefault());
  let panning=null;
  cv.addEventListener("pointerdown",e=>{
    if(e.button===2||e.button===1){
      e.preventDefault();
      panning={x:e.clientX,y:e.clientY,cx:CAM.x,cy:CAM.y};
    }
  });
  window.addEventListener("pointermove",e=>{
    if(!panning)return;
    const rc=cv.getBoundingClientRect(),k=cv.width/rc.width;
    CAM.x=panning.cx+(e.clientX-panning.x)*k;
    CAM.y=panning.cy+(e.clientY-panning.y)*k;
    renderBoard();
  });
  window.addEventListener("pointerup",()=>{panning=null;});
  cv.addEventListener("dblclick",()=>camReset());
  const tip=document.getElementById("cursorTip");
  function updateCursorTip(e){
    if(S.phase!=="plan"||S.planStage!=="line"||!S.budget){tip.style.display="none";return;}
    const left=travelAfterPath();
    tip.textContent=left>0?`還可畫 ${left} 格`:"已到頭";
    tip.classList.toggle("zero",left<=0);
    tip.style.left=(e.clientX+14)+"px";
    tip.style.top=(e.clientY+16)+"px";
    tip.style.display="block";
  }
  cv.addEventListener("pointermove",e=>{
    if(panning){tip.style.display="none";return;}
    if(S.phase!=="plan"||S.planStage!=="line"){tip.style.display="none";return;}
    const rc=cv.getBoundingClientRect();
    const h=pixHex((e.clientX-rc.left)*(cv.width/rc.width),(e.clientY-rc.top)*(cv.height/rc.height));
    const k=key(h.q,h.r);
    if(S._hoverKey!==k){S._hoverKey=k;S.hoverHex=h;renderBoard();}
    hoverExtend(h);
    updateCursorTip(e);
  });
  cv.addEventListener("pointerleave",()=>{tip.style.display="none";});
  cv.addEventListener("pointerdown",e=>{
    const rc=cv.getBoundingClientRect();
    const h=pixHex((e.clientX-rc.left)*(cv.width/rc.width),(e.clientY-rc.top)*(cv.height/rc.height));
    if(S.phase==="plan"&&S.planStage==="line"){
      if(S.path.length>0){confirmRoute();return;} // 點擊＝確定路線
      tryExtendPath(h);return;
    }
    if(S.phase==="plan"&&S.planStage==="route"){
      const pi=S.path.findIndex(p=>hexEq(p,h));
      if(pi>=0){openPartMenu(h);return;} // 點路徑格＝部件選單（出發請按按鈕）
      S.planStage="line";renderAll();return; // 點其他處＝回去改線
    }
    tryExtendPath(h);
  });
  document.getElementById("btnSubmit").onclick=()=>{S.planStage==="chain"?lockChain():(S.planStage==="line"?confirmRoute():launch());};
  document.getElementById("btnBack").onclick=backToChain;
  document.getElementById("btnClear").onclick=()=>{if(S.phase!=="plan"||S.planStage==="chain")return;S.path=[];S.brakePoints=[];S.followTarget=null;S.planStage="line";renderAll();};
  document.getElementById("gearUp").onclick=()=>{if(S.phase!=="plan"||S.planStage!=="chain")return;
    if(!(S.gear<4&&S.gear<S.lastGear+1))return;
    const bad=S.chain.find(c=>S.gear+1<c.gears[0]||S.gear+1>c.gears[1]);
    if(bad){log(`【${bad.name}】限 ${gearText(bad)}：先移出鏈再升檔`,"warn");return;}
    S.gear++;renderAll();};
  document.getElementById("gearDn").onclick=()=>{if(S.phase!=="plan"||S.planStage!=="chain")return;
    if(!(S.gear>1&&S.gear>S.lastGear-1))return;
    const bad=S.chain.find(c=>S.gear-1<c.gears[0]||S.gear-1>c.gears[1]);
    if(bad){log(`【${bad.name}】限 ${gearText(bad)}：先移出鏈再降檔`,"warn");return;}
    S.gear--;renderAll();};
  document.getElementById("btnRules").onclick=()=>{document.getElementById("rules").style.display="flex";};
  document.getElementById("btnRulesClose").onclick=()=>{document.getElementById("rules").style.display="none";};
  document.getElementById("btnDrvRhythm").onclick=()=>startGame("rhythm");
  const bb=document.getElementById("btnDrvBurst");
  bb.disabled=true;bb.textContent="爆發型（施工中）";bb.style.opacity="0.4";
}
function syncChainToGear(){ // 出牌數自由：換檔只需重驗檔位需求
  S.path=[];S.followTarget=null;
  renderAll();
}
function startGame(driver){
  S.driver=driver;
  document.getElementById("drvPick").style.display="none";
  document.getElementById("drvTag").textContent=driver==="rhythm"?"節奏型（前一張尾符號＝下一張頭符號才亮）":"爆發型（相鄰同色亮燈）";
  S.table=buildTable();
  S.lastGear=1;
  log("── 回合 1：規劃 ──");
  log("點手牌組鏈、點賽道畫線、提交執行。Space 按 QTE。");
  renderAll();
}
if(typeof window!=="undefined"){
  window.addEventListener("DOMContentLoaded",()=>{
    // 檔位鎖 ±1：記上回合檔位
    const _end=endRound;
    endRound=function(){S.lastGear=S.gear;_end();};
    bindUI();fitBoard();renderBoard();
    window.addEventListener("resize",()=>{fitBoard();renderBoard();if(S.driver)renderAll();});
  });
}
/* node 自檢 */
if(typeof window==="undefined"){
  console.log("centerline",TRACK.len,"road hexes",TRACK.road.size);
  let ok=true;
  for(let i=0;i<TRACK.len;i++){const a=TRACK.center[i],b=TRACK.center[(i+1)%TRACK.len];if(hexDist(a,b)!==1){ok=false;console.log("gap at",i);}}
  console.log("loop closed:",ok);
}
