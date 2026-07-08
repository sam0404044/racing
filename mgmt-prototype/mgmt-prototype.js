/* ════ 賽季狀態（season）— 全程共用 ════ */
const season = {
  week: 1, manpower: 4, salaryCapWeekly: 100, cash: 200,
  morale: 50, kpi: 50, driverStress: 50,
  sponsors: [], standings: [], flags: {},
};

function renderHUD(){
  document.getElementById('hudWeek').textContent = `第 ${season.week} 週`;
  document.getElementById('moraleV').innerHTML = `${season.morale}<small>/100</small>`;
  document.getElementById('moraleBar').style.width = season.morale + '%';
  document.getElementById('kpiV').innerHTML = `${season.kpi}<small>/100</small>`;
  document.getElementById('kpiBar').style.width = season.kpi + '%';
  document.getElementById('cashV').textContent = season.cash;
  document.getElementById('cashV').style.color = season.cash < (season.flags.warnLine ?? 100) ? 'var(--red)' : '';
  document.getElementById('crewV').innerHTML = `${season.manpower}<small>人</small>`;
  renderSeasonCal();
  renderDeckDock();
}

/* ── 社群 feed（共用工具）── */
const AVA_COLORS = ['#62dcff','#ff9d54','#ff5a6e','#62e39a','#ffce4d','#b888ff'];
let avaSeed = 0;
function makeAva(handle){
  const seed = avaSeed++;
  const el = document.createElement('div'); el.className='ava';
  el.style.background = AVA_COLORS[seed % AVA_COLORS.length];
  el.textContent = handle.replace(/[@#]/,'').charAt(0).toUpperCase() || '?';
  return el;
}
function buildPost(handle, text, fresh){
  const p = document.createElement('div'); p.className='post' + (fresh?' fresh':'');
  p.appendChild(makeAva(handle));
  const b = document.createElement('div'); b.className='pbody';
  b.innerHTML = `<div class="handle">${handle}</div><div class="text">${text}</div>`;
  p.appendChild(b);
  return p;
}
/* 初始一批貼文（依序滑入、底部） */
function seedFeed(list){
  const feed = document.getElementById('feed'); feed.innerHTML='';
  list.forEach((p,i)=>{ const el=buildPost(p[0],p[1],false); el.style.animationDelay=(i*0.12)+'s'; feed.appendChild(el); });
}
/* 即時新貼文（插到頂部、標 NEW、逐則跳出） */
function pushPosts(list){
  const feed = document.getElementById('feed');
  // 舊的 fresh 標記清掉
  feed.querySelectorAll('.post.fresh').forEach(p=>p.classList.remove('fresh'));
  list.forEach((p,i)=>{
    setTimeout(()=>{
      const el = buildPost(p[0],p[1],true);
      feed.insertBefore(el, feed.firstChild);
    }, i*340);
  });
}

/* ── W1 內容 ── */
const W1_FEED = [
  ['@渦輪阿政','這也太瞧不起人了吧 😤'],
  ['@彎道老司機','講話難聽，但是實話'],
  ['@第13號粉','不要理他，加油 🔥🔥🔥'],
];
const W1_CHOICES = [
  { id:'clap', t:'公開回嗆', d:'請公關發聲明、上社群回擊對手。',
    delta:+8, up:true,
    apply:(s)=>{ s.flags.rivalBoost = true; },
    rt:'針鋒相對',
    rd:'輸人不輸陣，你跟對手在網路上隔空互嗆、火藥味十足，大家都在一旁看好戲。',
    carry:'下次比賽時若遇到對手的車子將會變得更難纏。',
    carryWarn:true,
    feed:[['@渦輪阿政','笑死，殺人誅心'],['@豆腐店老闆','還是先把車的問題處理好吧...'],['@路人車迷','大家都好激動喔...']] },
  { id:'endure', t:'隱忍蓄力', d:'安撫團隊、請團隊專心在真正重要的事情上，不要理會他們在網路上說甚麼。',
    delta:-6, up:false,
    apply:(s)=>{ s.flags.enduredW1 = true; },
    rt:'蓄勢待發',
    rd:'大家忍氣吞聲，默默地回去做自己的事情。',
    carry:'🎯 這次比賽贏過對手 → 團隊揚眉吐氣，士氣大爆發 +28',
    carryWarn:false,
    feed:[['@蘑菇頭','無聊，我要看到血流成河'],['@渦輪阿政','冷處理就是最好的處理 🏁'],['@豆腐店老闆','看吧，根本不敢回 😏']] },
];

const clampMorale = v => Math.max(0, Math.min(100, v));

function renderW1(){
  renderHUD();
  seedFeed(W1_FEED);
  const wrap = document.getElementById('choices'); wrap.innerHTML='';
  W1_CHOICES.forEach(c=>{
    const b = document.createElement('button'); b.className='choice';
    b.innerHTML = `<div class="ct">${c.t}</div><div class="cd">${c.d}</div>`;
    b.addEventListener('click', ()=> resolveW1(c));
    wrap.appendChild(b);
  });
}

function resolveW1(choice){
  const before = season.morale;
  season.morale = clampMorale(season.morale + choice.delta);
  season.flags.w1Response = choice.id;
  choice.apply(season);
  const real = season.morale - before;

  document.getElementById('decision').style.display = 'none';
  const r = document.getElementById('result');
  document.getElementById('resTitle').textContent = choice.rt;
  document.getElementById('resDesc').textContent = choice.rd;
  const d = document.getElementById('resDelta');
  d.className = 'amt ' + (real>=0?'up':'down');
  d.textContent = (real>=0?'+':'') + real;
  const carry = document.getElementById('resCarry');
  carry.className = 'carry' + (choice.carryWarn?' warn':'');
  carry.innerHTML = choice.carry;
  r.classList.add('show');

  renderHUD();
  pushPosts(choice.feed);            // 右欄即時跳新貼文
  r.scrollIntoView({behavior:'smooth', block:'center'});
}

document.getElementById('nextBtn').addEventListener('click', ()=>{
  season.week = 2;
  document.getElementById('week1').style.display = 'none';
  document.getElementById('week2').style.display = 'block';
  renderHUD(); renderW2();
  document.getElementById('socialDock').classList.add('collapsed');
  window.scrollTo({top:0, behavior:'smooth'});
  showWeekSplash();
});

/* ════ W2 · 董事會談判桌（逐張擲骰・總值落點）════ */
const W2_ORDER = ['rival','budget','grade'];
const W2_BASE_SLOTS = { rival:3, budget:2, grade:2 };
const W2_BANDS = { t1:40, t2:80, max:100 };   // 總值 <40 沒變 / <80 第二階 / ≥80 最鬆
const W2_GOOD = 15;                            // 單張打動值 ≥15 → 董事反應好
const W2_MOODS = ['不為所動','有所動搖','願意讓步'];   // 標記軸三段：董事態度（不劇透結果）
const W2_TIMER_SEC = 10;
const W2_TIMEUP = '董事們的耐心有限，有人開始翻看手上的文件了……';
const W2_FULL_WARN = '某些董事已經對你的咄咄逼人感到不滿了，接下來的議題可能沒有耐心再聽你高談闊論...';

const W2_DEMANDS = {
  rival: {
    name:'對手', open:'如果接下來輸給對手董事們會非常失望。',
    scale:['輸了扣分','有賞有罰','贏了才賺'],
    openNarr:()=>{
      const w1 = season.flags.w1Response==='clap' ? '激進' : '膽怯';
      return `會議一開始，各董事已經義憤填膺地討論著上週的侮辱事件。他們對你${w1}的反應並不滿意，他們想看看你有沒有什麼反擊的計畫——`;
    },
    mood:'各個董事都非常不滿，他們都希望我們車隊有方法能夠給對方好看。',
    terms:['若這一季輸給對手車隊，董事會將會十分不滿意。','若這一季輸給對手車隊，董事會將會不滿意；反之，若是勝過對手車隊，董事會會很開心。','若這一季贏過對手車隊，董事會將會非常滿意。'],
    results:{
      lv0:'董事們沒有被你說服，他們還是很強硬地要求你在這一季把打贏對手車隊做為優先考量。',
      lv1:'董事們自己也沒有一個結論，於是你決定介入並引導討論，最後你們討論出了折衷的方案。',
      lv2:'董事們被你說服了，也許現在還真的不需要這麼介意這個對手。',
      blowup:'你的逼迫踩到了董事們的底線。董事長憤怒地一掌拍在桌上，說道「雖然你是領隊但車隊還是我們的！」。不只沒有說服董事甚至你與董事們的關係降到冰點。',
    },
  },
  budget: {
    name:'預算', open:'資金警戒線 100',
    scale:['警戒線 100','警戒線 60','警戒線 60＋撥款 60'],
    openNarr:()=>'接著，董事們開始跟你討論了他們最在意的議題——財務。連續好幾年不理想的成績，團隊獲得的獎金與贊助逐年下降，他們希望你好好控制這一季的成本。',
    mood:'在商言商，董事們的態度很務實。如果需要更多錢，就要提出適當的理由。',
    terms:['資金警戒線維持在 100——賽季結束時若資金低於警戒線，低越多、董事會越不滿。','資金警戒線降到 60——董事會容忍你燒更多的錢。','資金警戒線降到 60，且董事會直接撥款 60（資金 +60）。'],
    results:{
      lv0:'董事們不為所動。他們能夠接受的預算就是這樣，你得想辦法在這樣的預算內將事情辦妥。',
      lv1:'董事們私下商量了一會，決定稍稍退讓，把預算往上挪了一些。',
      lv2:'董事們接受了你的觀點，點點頭把更多的資金讓出來。你爭取到了這季最需要的餘裕。',
      blowup:'你的逼迫讓財務董事當場翻臉。他把預算表一收，連原本能談的空間都沒了——「錢是我們的，輪不到你來指手畫腳！」不只沒有說服董事甚至你與董事們的關係降到冰點。',
    },
  },
  grade: {
    name:'成績', open:'每一場都必須前 3、而且這一季至少要有一場分站冠軍',
    scale:['前3＋冠軍','每場前3','前5（一場前3）'],
    openNarr:()=>'成績！成績是最重要的事情，關乎著我們車隊的榮耀、排名、資金跟贊助。董事們迫不及待地想要跟你討論車隊目前的狀況與預期能夠拿到的成績。',
    mood:'董事們在等你開口。車隊拿到好的成績是你這個位置存在的原因。',
    terms:['這一季每一場都必須拿下前 3，且至少要有一場分站冠軍。','這一季每一場都必須拿下前 3。','這一季每一場都必須拿下前 5，且至少要有一場前 3。'],
    results:{
      lv0:'這一季每一場都必須有前 3 且要獲得至少一場分站冠軍。董事們沒有讓步。他們下達最後通牒，沒有前 3 就沒什麼好說的了。',
      lv1:'這一季每一場都必須有前 3。一番拉鋸後，董事們把標準放鬆了一點。',
      lv2:'這一季每一場都必須前 5，至少有一場前 3。董事們最終接受了你的評估。',
      blowup:'你的施壓沒有奏效，反而點燃了導火線。董事長冷冷地看著你：「別忘記你的工作就是要做到這種事情。」名次照原案釘死，你和董事會的關係出現裂痕。',
    },
  },
};
// narr = { act: 你的動作（固定）, good: 董事反應（打動）, bad: 董事反應（沒打動）}
const W2_CARDS = [
  { id:'cost', name:'計算成本', side:'none',
    desc:'逐條列出帳目、嘗試與董事們理智的溝通。正常的選擇，在商言商、有理有據。',
    rate:{ rival:15, budget:15, grade:15 },
    narr:{
      rival:{ act:'你計算了單純要壓過對手的成本。在這麼短的時間裡要消耗的人力、經費，更重要的是會打斷目前車隊經營的計畫。',
              good:'董事聽完後態度明顯放軟了些。',
              bad:'董事們對這些數字不以為然——比起成本，他們更在意的是那口嚥不下的氣。' },
      budget:{ act:'你將你的計劃必要的階段、必要的開銷、之後預計的成長與收入攤開，一項一項算給董事看。這些花費是為了讓車隊跑得更遠的必要投資。',
               good:'幾位董事邊聽邊點頭，帳目清楚、有憑有據，這樣的說法他們聽得進去。',
               bad:'董事們各個神情凝重，你沒辦法確切地讀出每個董事的想法。也許他們心中的盤算與你的計劃不太一樣。' },
      grade:{ act:'你把衝擊名次需要的每一分資源攤開：車輛性能、人員狀態、對手強度，一項一項對照現在的位置，推算出務實可及的目標。',
              good:'董事們對照著數字沉吟了一會，你務實的評估讓他們稍稍鬆動了原本的堅持。',
              bad:'董事們聽著你的分析，不置可否。這些數字都是紙上談兵，董事們想要看到結果。' },
    } },
  { id:'empathy', name:'打感情牌', side:'decay',
    desc:'放低身段、讓步以面子換取更多的談判空間。',
    warn:'若使用的過於頻繁，有可能會使董事會覺得你很軟弱。',
    rate:{ rival:20, budget:20, grade:20 },
    narr:{
      rival:{ act:'你放低姿態，訴說車隊目前的難處，也坦言短時間內要壓過那支車隊並不容易，希望董事們能體諒。',
              good:'幾位董事的神色緩了緩——他們聽得進你的難處，只是從他們的神情來看還是有不甘心的情緒。',
              bad:'沒有人接話，會議室裡一陣尷尬的沉默... 這次董事們不吃示弱這一套。' },
      budget:{ act:'你放低姿態，把目前車隊的窘迫、車隊員工的抱怨都呈現在董事的面前：器材老舊、人手吃緊。我們真的需要更多的經費，不然車隊再好的人手也是巧婦難為無米之炊。',
               good:'董事們交換了眼神，神色軟了下來——總不能真的讓車隊餓著肚子上場。',
               bad:'董事們見多了這種苦水。「哪個部門不喊窮？」一句話就把你擋了回去。' },
      grade:{ act:'你坦白車隊的現況：大家已經在能力範圍內拚到極限，你希望董事們看見這些努力，而不是只盯著名次。',
              good:'幾位董事的神色柔和了些，他們不是不知道車隊的辛苦。',
              bad:'董事們的表情沒有變化... 光有辛苦沒有任何實質的效益。' },
    } },
  { id:'pie', name:'畫大餅', side:'expect',
    desc:'跟董事畫大餅、膨脹董事們的信心與期望，誘導他們下激進的決策。',
    warn:'若最後無法達到自己承諾的結果，可能會導致反效果。',
    rate:{ rival:30, budget:5, grade:15 },
    narr:{
      rival:{ act:'你描繪起擊敗對手的畫面：那一刻的聲勢、贊助商的目光、董事會揚眉吐氣的場面。你保證這一季會讓那支車隊長點記性、你會確保我們的車隊能夠碾壓他們。',
              good:'董事的表情鬆動了。這正是他們想聽的——他們要的就是能夠出這一口惡氣。',
              bad:'董事們互看了一眼，沒什麼反應——這種豪語他們聽過太多次了。' },
      budget:{ act:'你興致勃勃地描繪起未來的宏圖：只需要更多經費，搭配你對車隊絕妙的打算與計畫，這季的成績、聲勢都會翻上好幾番。',
               good:'有幾位董事被你的藍圖勾起了興趣，開始低聲交換意見——也許，真的值得加碼一把。',
               bad:'董事們不為所動，空口的願景換不到預算——他們要看到的是實際的改變，而不是空想與空話。' },
      grade:{ act:'你許下承諾：要董事們給車隊一點空間。這一季你會端出一個讓所有人驚豔的名次，到時候董事會在所有人前面臉上有光。',
              good:'有董事眼睛亮了起來，「臉上有光」這四個字說進了他們心裡。',
              bad:'有董事眼睛亮了一下，也有董事不動聲色。這樣的願景固然很美，但他們都是商場打滾多年的老手，只有漂亮的話術是沒辦法讓他們信服的。' },
    } },
  { id:'pressure', name:'施壓', side:'blowup', once:true,
    desc:'反過來賭上一切對董事逼壓，是一個很大膽且有時會有奇效的方法。',
    warn:'要小心反過來把董事會逼急了，與董事會的關係將會十分尷尬。',
    limit:'整場會議只能用一次。',
    rate:{ rival:35, budget:35, grade:35 },
    narr:{
      rival:{ act:'你直接跟董事明說：現在你還是車隊領隊、你說了算。現在重要的事情不是打贏那個對手。',
              good:'董事盯著你，一時沒說話。片刻後，有人先移開了視線——你的強硬奏效了。',
              bad:'董事盯著你，臉色越來越難看。你把話說得太滿，火藥味瞬間瀰漫整個會議室。' },
      budget:{ act:'你的態度很強硬，董事一開始都贊成我們的計畫，目前就是需要更多的錢，不然之前的投資就都會白費。',
               good:'董事們臉色一沉，但沒有人反駁... 沉沒成本提醒了他們已經投入了多少。',
               bad:'董事們臉色一沉，沒有立刻回話。這一逼，會議的情緒馬上升溫，張力一觸即發。' },
      grade:{ act:'名次要求訂得不切實際，到頭來還不是達不成。你要求董事們理性一點看待，讓你好好做事。',
              good:'會議室安靜了下來。片刻後，董事長緩緩靠回椅背——他們聽進去了。',
              bad:'會議室安靜了下來，董事們的表情都很繃緊。' },
    } },
];

let w2Step, w2Placed, w2Resolved, w2ResultText, w2Total, w2Log, w2Phase, w2EmpathyDone, w2Flags, w2Timer=null, w2TimeUp=false;

function prevFull(cond){
  const idx=W2_ORDER.indexOf(cond);
  if(idx===0) return false;
  const prev=W2_ORDER[idx-1];
  return w2Placed[prev].length >= W2_BASE_SLOTS[prev];
}
function effSlots(cond){ return Math.max(0, W2_BASE_SLOTS[cond] - (prevFull(cond)?1:0)); }
function cardRate(cid, cond){
  const c=W2_CARDS.find(x=>x.id===cid);
  let r=c.rate[cond];
  if(cid==='empathy') r=Math.round(r*Math.pow(0.5, w2EmpathyDone));
  return r;
}
function totalLevel(total){ return total<W2_BANDS.t1?0 : total<W2_BANDS.t2?1 : 2; }
function w2Mark(e){
  if(e.blow) return '談崩！';
  const v=e.val;
  if(v>=40) return '打動＋＋＋';
  if(v>=25) return '打動＋＋';
  if(v>=W2_GOOD) return '打動＋';
  if(v>=10) return '不為所動 −';
  if(v>=5)  return '不為所動 −−';
  return '不為所動 −−−';
}
function w2StopTimer(){ if(w2Timer){ clearInterval(w2Timer); w2Timer=null; } }
function w2StartTimer(){
  w2StopTimer(); w2TimeUp=false;
  const bar=document.getElementById('w2TimerBar');
  const wrap=document.getElementById('w2TimerWrap');
  if(!bar||!wrap) return;
  wrap.style.display='block';
  const t0=performance.now();
  w2Timer=setInterval(()=>{
    const left=Math.max(0, W2_TIMER_SEC*1000-(performance.now()-t0));
    const pct=left/(W2_TIMER_SEC*1000)*100;
    bar.style.width=pct+'%';
    bar.className='timer-fill'+(pct<=30?' danger':pct<=60?' warn':'');
    if(left<=0){
      w2StopTimer(); w2TimeUp=true;
      const note=document.getElementById('w2TimeupNote');
      if(note){ note.style.display='block'; note.scrollIntoView({behavior:'smooth', block:'nearest'}); }
      wrap.style.display='none';
      setTimeout(()=>{ if(w2Phase==='talk') w2Lock(W2_ORDER[w2Step]); }, 900);   // 董事會逕行拍板
    }
  },100);
}

function renderW2(){
  const root=document.getElementById('week2');
  root.innerHTML = `
    <div class="eyebrow">第 2 週 · 董事會</div>
    <h1 class="title">董事會</h1>
    <p class="lede">這一季的董事會如期召開。你將這一季的營運情況如實報告給董事。</p>
    <div class="table-h">逐項議論</div>
    <p class="table-sub">董事與你逐項討論車隊接下來的目標。每個議題你都可以跟董事討價還價，將底下的<b>談判方式</b>放進「議價空間」，可以軟化董事會訂定的目標。<b style="color:var(--orange)">但要注意凹越多，後面的議題董事就會踩得更死。</b></p>
    <div class="steps" id="w2Steps"></div>
    <div id="w2Current"></div>
    <div class="hand-h">點選論點、直接向董事提出，看董事反應後可再追加（議價空間內）；不加了就按「結束議論」請董事會拍板</div>
    <div class="hand" id="w2Hand"></div>
    <div class="table-actions" id="w2Actions"></div>
    <div class="w2-result" id="w2Result"></div>
  `;
  w2Step=0; w2Placed={rival:[],budget:[],grade:[]}; w2Resolved={}; w2ResultText={};
  w2Total={rival:0,budget:0,grade:0}; w2Log={rival:[],budget:[],grade:[]};
  w2Phase='talk'; w2EmpathyDone=0; w2Flags={expect:{},blowup:false};
  w2StopTimer(); w2TimeUp=false;
  paintW2();
}

function trackHTML(cur){
  const pending=w2Log[cur].filter(e=>!e.revealed && !e.blow).reduce((a,e)=>a+e.val,0);
  const total=w2Total[cur]-pending;   // 未揭曉的先不反映
  const lvl=totalLevel(total);
  const pos=Math.min(98.5, total/W2_BANDS.max*100);
  return `
    <div class="roll-track">
      <div class="roll-seg s0" style="flex:${W2_BANDS.t1}">${W2_MOODS[0]}</div><div class="roll-seg s1" style="flex:${W2_BANDS.t2-W2_BANDS.t1}">${W2_MOODS[1]}</div><div class="roll-seg s2" style="flex:${W2_BANDS.max-W2_BANDS.t2}">${W2_MOODS[2]}</div>
      <div class="roll-needle" id="w2Needle" style="left:${pos}%"></div>
    </div>
    <div class="roll-out">董事們目前的態度：<b class="lv${lvl}">${W2_MOODS[lvl]}</b></div>`;
}

function paintW2(justPlayed){
  const cur=W2_ORDER[w2Step];
  const d=W2_DEMANDS[cur];
  const eff=effSlots(cur);
  document.getElementById('w2Steps').innerHTML = W2_ORDER.slice(0,w2Step+1).map((id,i)=>{
    const st=i<w2Step?'done':'active';
    return `<div class="step ${st}"><span class="sn">${i+1}</span>${W2_DEMANDS[id].name}</div>`;
  }).join('<span class="arr" style="color:var(--cyan-dim)">›</span>');

  const filled=w2Placed[cur];
  const lost = W2_BASE_SLOTS[cur]-eff;
  const squeezed = lost>0;
  let slots='';
  for(let i=0;i<eff;i++) slots += i<filled.length ? `<span class="slot full"><span class="mini committed">${W2_CARDS.find(x=>x.id===filled[i]).name}</span></span>` : '<span class="slot empty">＋</span>';
  for(let i=0;i<lost;i++) slots += '<span class="slot lost" title="因為上一個議題的討價還價而失去">✕</span>';

  const fullWarn = (w2Phase!=='rolled' && filled.length>=W2_BASE_SLOTS[cur] && w2Step<W2_ORDER.length-1)
    ? `<div class="concession-note">${W2_FULL_WARN}</div>` : '';

  // 來往敘事（依 log：動作 + 好/壞反應 + 這張的打動值）
  const exchanges = w2Log[cur].map(e=>{
    const c=W2_CARDS.find(x=>x.id===e.cid);
    const reactTxt = e.blow ? c.narr[cur].bad : (e.val>=W2_GOOD ? c.narr[cur].good : c.narr[cur].bad);
    const shown = e.revealed;   // 反應是否已揭曉
    return `<div class="exchange ${e.cid===justPlayed?'fresh':''}">
      <span class="ex-tag">${c.name}</span>
      ${shown?`<span class="ex-rate ${e.blow?'neg':(e.val>=W2_GOOD?'pos':'neg')}">${w2Mark(e)}</span>`:''}
      <p class="ex-act">${c.narr[cur].act}</p>
      ${shown?`<p class="ex-react">${reactTxt}</p>`:'<p class="ex-wait">……</p>'}
    </div>`;
  }).join('');

  document.getElementById('w2Current').innerHTML = `
    <div class="panel cyan tilt-l" style="margin-bottom:14px">
      <span class="ptag">議題 ${w2Step+1} · ${d.name}</span>
      <p style="font-size:15px; margin:2px 0 0">${d.openNarr()}</p>
    </div>
    ${squeezed?`<div class="concession-note">⚠ 因為上一個議題的討價還價，這個議題減少議價空間（${W2_BASE_SLOTS[cur]} → ${eff} 格）。</div>`:''}
    <div class="bargain" data-cond="${cur}">
      <div class="bgn-head"><span class="bgn-name">${d.name}</span><span class="bgn-open">董事開：${d.open}</span></div>
      <div class="mood">${d.mood}</div>
      <div class="slots">${slots}</div>
      <div class="exchanges" id="w2Ex">${exchanges}</div>
      <div id="w2TimerWrap" style="display:none"><div class="timer-track"><div class="timer-fill" id="w2TimerBar"></div></div><div class="timer-label">董事們在等你的下一步……</div></div>
      <div class="concession-note" id="w2TimeupNote" style="display:${w2TimeUp?'block':'none'}">${W2_TIMEUP}</div>
      ${fullWarn}
      <div id="w2TrackZone">${ (w2Log[cur].length>0 || w2Phase==='rolled') ? trackHTML(cur) : '' }</div>
      <div id="w2ResultZone"></div>
    </div>`;

  const hand=document.getElementById('w2Hand');
  hand.innerHTML = W2_CARDS.map(c=>{
    const usedHere = filled.includes(c.id);
    const spentAll = c.once && W2_ORDER.some(k=>w2Placed[k].includes(c.id));   // 整場限用一次
    const noSlot = filled.length>=eff;
    const dis = w2Phase!=='talk' || usedHere || spentAll || noSlot;
    return `<div class="card ${dis?'disabled':''}" data-id="${c.id}">
      <div class="cname">${c.name}${(usedHere||spentAll)?' <span class="used-tag">已用</span>':''}</div>
      <div class="cdesc">${c.desc}</div>
      ${c.warn?`<div class="cwarn">❗ ${c.warn}</div>`:''}
      ${c.limit?`<div class="climit">${c.limit}</div>`:''}
    </div>`;
  }).join('');

  const act=document.getElementById('w2Actions');
  if(w2Phase==='talk'){
    act.innerHTML = `<button class="btn-propose" id="w2LockBtn">結束議論（定案）</button>`;
    document.getElementById('w2LockBtn').addEventListener('click', ()=>w2Lock(cur));
    hand.querySelectorAll('.card:not(.disabled)').forEach(el=>el.addEventListener('click',()=>w2Play(cur, el.dataset.id)));
  } else if(w2Phase==='rolled'){
    act.innerHTML = `<button class="btn-propose" id="w2Adv">${w2Step<W2_ORDER.length-1?'下一條 →':'定案'}</button>`;
    document.getElementById('w2Adv').addEventListener('click', w2Advance);
  } else {
    act.innerHTML = '';
  }
}

function w2Play(cur, cid){
  if(w2Phase!=='talk') return;
  if(w2Placed[cur].includes(cid) || w2Placed[cur].length>=effSlots(cur)) return;
  const cdef=W2_CARDS.find(x=>x.id===cid);
  if(cdef.once && W2_ORDER.some(k=>w2Placed[k].includes(cid))) return;
  w2StopTimer(); w2TimeUp=false;
  const rate=cardRate(cid,cur);
  const roll=Math.floor(Math.random()*20)+1;   // D20：實力為主、骰子為波動
  const val=roll+rate;
  const blow = (cid==='pressure' && roll<=3);    // 施壓踩雷：當場談崩
  w2Placed[cur].push(cid);
  const entry={cid,roll,rate,val,blow,revealed:false};
  w2Log[cur].push(entry);
  if(!blow) w2Total[cur]+=val;
  if(cid==='empathy') w2EmpathyDone++;
  if(cid==='pie' && val>=W2_GOOD) w2Flags.expect[cur]=true;   // 董事買了你的餅 → 期望抬高

  // 第一拍：只出你的動作（董事還沒回話）
  w2Phase='anim';
  paintW2(cid);
  const fresh=document.querySelector('#w2Ex .exchange.fresh');
  if(fresh) fresh.scrollIntoView({behavior:'smooth', block:'nearest'});
  // 第二拍：0.9 秒後董事反應揭曉（標記＋指針同時）
  setTimeout(()=>{
    entry.revealed=true;
    if(entry.blow){ w2Blowup(cur); return; }
    paintW2(cid);
    const ex=document.querySelector('#w2Ex .exchange.fresh .ex-react');
    if(ex) ex.scrollIntoView({behavior:'smooth', block:'nearest'});
    setTimeout(()=>{ w2Phase='talk'; paintW2(); w2StartTimer(); }, 500);
  }, 900);
}

function w2Blowup(cur){
  const d=W2_DEMANDS[cur];
  w2Resolved[cur]=0;
  w2ResultText[cur]=d.results.blowup;
  w2Flags.blowup=true;
  w2Phase='rolled';
  paintW2();
  const rz=document.getElementById('w2ResultZone');
  rz.innerHTML=`<div class="result-narr angry"><p>${d.results.blowup}</p><div class="result-term">結論：<b>${d.terms[0]}</b>　<span style="color:var(--red)">KPI −15</span></div></div>`;
  rz.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function w2Lock(cur){
  if(w2Phase!=='talk') return;
  w2StopTimer(); w2TimeUp=false;
  const d=W2_DEMANDS[cur];
  const level=totalLevel(w2Total[cur]);
  w2Resolved[cur]=level;
  w2ResultText[cur]=d.results['lv'+level];
  w2Phase='rolled';
  paintW2();
  const rz=document.getElementById('w2ResultZone');
  rz.innerHTML=`<div class="result-narr"><p>${w2ResultText[cur]}</p><div class="result-term">結論：<b>${d.terms[level]}</b></div></div>`;
  rz.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function w2Advance(){
  if(w2Step<W2_ORDER.length-1){ w2Step++; w2Phase='talk'; w2StopTimer(); w2TimeUp=false; paintW2(); window.scrollTo({top:0,behavior:'smooth'}); }
  else w2Finalize();
}

function w2Finalize(){
  season.flags.kpiRules={ rival:w2Resolved.rival, budget:w2Resolved.budget, grade:w2Resolved.grade };
  season.flags.warnLine=[100,60,60][w2Resolved.budget];
  if(w2Resolved.budget===2){ season.cash+=60; }   // 談到頂：董事直接撥款
  season.flags.expectation=w2Flags.expect;
  // 目標速記存進 season：race 端的「本季目標」浮窗直接讀這包
  season.flags.goalLines=W2_ORDER.map(id=>({ n:W2_DEMANDS[id].name, s:W2_DEMANDS[id].scale[w2Resolved[id]], exp:!!w2Flags.expect[id] }));
  season.flags.negotiation={ slots:JSON.parse(JSON.stringify(w2Placed)), totals:{...w2Total} };
  if(w2Flags.blowup){ season.kpi=Math.max(0,season.kpi-15); season.flags.boardAngry=true; }
  renderHUD();
  const gd=document.getElementById('goalsDock');
  gd.style.display='block';
  gd.querySelector('.dock-body').innerHTML = W2_ORDER.map(id=>{
    const tag=w2Flags.expect[id]?' <span style="color:var(--gold)">· 期望已抬高</span>':'';
    return `<div class="goal-line"><b>${W2_DEMANDS[id].name}</b>${W2_DEMANDS[id].scale[w2Resolved[id]]}${tag}</div>`;
  }).join('');
  const notes=W2_ORDER.map((id,i)=>{
    const tag = w2Flags.expect[id] ? ' <span style="color:var(--gold)">· 期望已抬高：這條達標的獎勵加倍、未達標的懲罰也加倍</span>' : '';
    return `<div class="ar"><b style="color:var(--cyan)">${i+1}. ${W2_DEMANDS[id].name}</b>　${w2ResultText[id]}${tag}</div>`;
  });
  if(w2Flags.blowup) notes.push('<div class="ar" style="border-left-color:var(--red)"><b style="color:var(--red)">與董事會撕破臉</b>　KPI −15</div>');
  const r=document.getElementById('w2Result');
  r.className='w2-result show';
  r.innerHTML=`<div class="rk">定案</div><div class="rt">這季的經營目標確定</div>
    <div class="applied">${notes.join('')}</div>
    <button class="next" id="w2Next">進入第 3 週 →</button>
    <div class="stub">第 3 週 · 賽前準備 — 施工中</div>`;
  document.getElementById('w2Next').addEventListener('click',()=>{
    season.week=3;
    document.getElementById('week2').style.display='none';
    document.getElementById('week3').style.display='block';
    renderHUD(); renderW3();
    window.scrollTo({top:0,behavior:'smooth'});
    showWeekSplash();
  });
  r.scrollIntoView({behavior:'smooth', block:'center'});
}


/* ════ W3/W4 · 賽前準備（事件 → 人力排程 → 結算）════ */
const W34_EVENTS = [
  { id:'driverMood', title:'車手鬧情緒', type:'multi',
    narr:'連日的輿論風波讓車手的情緒瀕臨臨界點。今天的模擬訓練他直接提前離開，把安全帽摔在了維修區。工程師們面面相覷都不知道該怎麼辦。',
    hint:'處理方式可以複選（也可以都不做）。',
    options:[
      { id:'talk', t:'找HR、車手經理與車手深談', d:'花時間好好聊聊，把心結打開。', fx:'本週可用人力 −1、車手壓力 −15',
        apply:(s)=>{ w3EventMp+=1; s.driverStress=Math.max(0,s.driverStress-15); } },
      { id:'back', t:'公開力挺', d:'對外發聲，車隊跟車手站在一起。', fx:'士氣 +6',
        apply:(s)=>{ s.morale=Math.min(100,s.morale+6); } },
      { id:'push', t:'積極加練', d:'用高強度訓練讓他沒空胡思亂想。', fx:'車手壓力 +10、失誤牌 −1',
        apply:(s)=>{ s.driverStress=Math.min(100,s.driverStress+10); s.flags.mistakeMod=(s.flags.mistakeMod||0)-1; } },
    ],
    noneFx:'置之不理：車手壓力 +10',
    noneApply:(s)=>{ s.driverStress=Math.min(100,s.driverStress+10); } },
  { id:'greyOffer', title:'灰色機會', type:'single',
    narr:'一個熟面孔的中間人在飯店大廳攔住了你。他壓低聲音：有一批「規則邊緣」的改裝件，能讓賽車快上一截，檢測站的朋友也都打點好了。「這行大家都這麼玩，你不用就是輸在起跑點上。」',
    hint:'只能選一個。',
    options:[
      { id:'take', t:'接受', d:'成王敗寇，先贏了再說。', fx:'資金 −10、W5 賽車性能提升',
        apply:(s)=>{ s.flags.greyBoost=true; s.cash-=10; } },
      { id:'deny', t:'拒絕', d:'把人打發走，車隊不碰這種東西。', fx:'無事發生',
        apply:(s)=>{} },
    ] },
];
const W34_PROJECTS = [
  { id:'rnd',   name:'研發', need:4, cost:50, once:true,  desc:'累積 4 人力/週完成：W5 賽車性能提升（每周平均支付）' },
  { id:'train', name:'操練', need:2, cost:25, once:false, desc:'累積 2 人力/週完成：失誤牌 −2、車手壓力 +15；直到下一場比賽，每 10+2 車手壓力才 +1 張失誤牌' },
  { id:'rest',  name:'休整', need:1, cost:10, once:false, desc:'1 人力/週完成：車手壓力 −20' },
  { id:'hire',  name:'招人', need:1, cost:30, once:true,  desc:'1 人力/週完成：人力 +1（下週報到）、之後每週薪資 +5' },
];

let w3Phase, w3Event, w3Picked, w3Alloc, w3EventMp, w3EventNote, w3SettleLines;

function w3AvailMp(){ return Math.max(0, season.manpower - w3EventMp); }
function w3AllocTotal(){ return W34_PROJECTS.reduce((a,p)=>a+(w3Alloc[p.id]||0),0); }
function w3WeeklySpend(){
  let c=season.manpower*5;
  W34_PROJECTS.forEach(p=>{ c += (w3Alloc[p.id]||0)*p.cost/p.need; });
  return Math.round(c*10)/10;
}

function renderW3(){
  w3Phase='event'; w3Picked=new Set(); w3Alloc={}; W34_PROJECTS.forEach(p=>w3Alloc[p.id]=0);
  w3EventMp=0; w3EventNote=''; w3SettleLines=[];
  if(!season.flags.projProgress) season.flags.projProgress={rnd:0,train:0,rest:0,hire:0};
  if(season.flags.pendingHire){ season.manpower+=1; season.flags.pendingHire=false; }
  renderHUD();
  season.flags.w34Drawn = season.flags.w34Drawn || [];
  const pool = W34_EVENTS.filter(e=>!season.flags.w34Drawn.includes(e.id));
  w3Event = pool[Math.floor(Math.random()*pool.length)] || null;
  if(w3Event) season.flags.w34Drawn.push(w3Event.id);
  paintW3();
}

function paintW3(){
  const root=document.getElementById('week3');
  const wk=season.week;
  let html = `
    <div class="eyebrow">第 ${wk} 週 · 賽前準備</div>
    <h1 class="title">賽前準備</h1>
    <p class="lede">距離比賽越來越近。這週的每一分人力、每一筆錢，都要花在刀口上。</p>`;

  // ── 事件 ──
  if(w3Event){
    html += `
    <div class="panel cyan tilt-l" style="margin-bottom:14px">
      <span class="ptag">事件 · ${w3Event.title}</span>
      <p style="font-size:15px; margin:2px 0 0">${w3Event.narr}</p>
    </div>`;
    if(w3Phase==='event'){
      html += `<div class="choices-h">你的處理</div>
        <p class="table-sub" style="margin-top:-6px">${w3Event.hint||''}</p>
        <div class="choices" id="w3Choices">${
          w3Event.options.map(o=>`
            <button class="choice ${w3Picked.has(o.id)?'picked':''}" data-id="${o.id}">
              <div class="ct">${o.t}</div><div class="cd">${o.d}</div>
              <div class="stake">${o.fx}</div>
            </button>`).join('')
        }</div>
        ${w3Event.type==='multi' ? `<div class="table-actions"><button class="btn-propose" id="w3EvConfirm">確認處理方式</button></div>
          <p class="table-sub" style="margin-top:8px">${w3Event.noneFx?('什麼都不選 → '+w3Event.noneFx):''}</p>` : ''}`;
    } else {
      html += `<div class="carry" style="margin-bottom:22px">${w3EventNote}</div>`;
    }
  }

  // ── 人力排程 ──
  if(w3Phase!=='event'){
    const avail=w3AvailMp(), used=w3AllocTotal();
    html += `
    <div class="table-h">人力排程</div>
    <p class="table-sub">把這週的人力分配到項目上。項目以「人力/週」累積進度。<b style="color:var(--orange)">固定薪資（每人每週 5）與項目費用都直接從資金支出。資金不能見底；賽季結束時資金若低於警戒線，低越多、董事會越不滿。</b></p>
    <div class="mp-pool">本週可用人力：<b>${used}</b> / ${avail} 已分配${w3EventMp?`（事件佔用 ${w3EventMp} 人）`:''}</div>
    <div class="allocs" id="w3Allocs">${
      W34_PROJECTS.map(p=>{
        const prog=season.flags.projProgress[p.id]||0;
        const done=p.once && ((p.id==='rnd'&&season.flags.carUpgrade)||(p.id==='hire'&&season.flags.hired));
        return `<div class="alloc-row ${done?'done':''}">
          <div class="ar-main"><b>${p.name}</b><span class="ar-desc">${p.desc}</span></div>
          <div class="ar-meta">進度 ${prog}/${p.need} ・ 費用 ${p.cost}</div>
          <div class="ar-ctrl">${done?'<span class="ar-done">已完成</span>':`
            <button class="mp-btn" data-id="${p.id}" data-d="-1">−</button>
            <span class="ar-n">${w3Alloc[p.id]||0}</span>
            <button class="mp-btn" data-id="${p.id}" data-d="1">＋</button>`}
          </div>
        </div>`;
      }).join('')
    }</div>
    <div class="mp-pool" style="margin-top:12px">車手壓力：<b style="color:${season.driverStress>=60?'var(--red)':season.driverStress>=30?'var(--gold)':'var(--green)'}">${season.driverStress}</b>/100　・　本週預計支出：<b style="color:var(--orange)">${w3WeeklySpend()}</b>　・　資金：<b style="color:${season.cash<(season.flags.warnLine??100)?'var(--red)':'var(--green)'}">${season.cash}</b>（警戒線 ${season.flags.warnLine??100}）</div>
    <div class="cash-bar"><i style="width:${Math.max(0,Math.min(100,season.cash/300*100))}%"></i><span class="wl-mark" style="left:${(season.flags.warnLine??100)/300*100}%"></span></div>
    ${w3Phase==='alloc'?`<div class="table-actions"><button class="btn-propose" id="w3Confirm">確認排程 · 本週結算</button></div>`:''}`;
  }

  // ── 結算 ──
  if(w3Phase==='settle'){
    html += `
    <div class="w2-result show" style="margin-top:22px">
      <div class="rk">本週結算</div>
      <div class="rt">第 ${wk} 週結束</div>
      <div class="applied">${w3SettleLines.map(l=>`<div class="ar">${l}</div>`).join('')}</div>
      <button class="next" id="w3Next">${wk===3?'進入第 4 週 →':'進入第 5 週 →'}</button>
      <div class="stub">${wk===3?'第 4 週 · 賽前準備':'第 5 週 · 比賽 — 接入 race demo（施工中）'}</div>
    </div>`;
  }

  root.innerHTML=html;

  // ── 綁定 ──
  if(w3Phase==='event' && w3Event){
    root.querySelectorAll('#w3Choices .choice').forEach(el=>el.addEventListener('click',()=>{
      const id=el.dataset.id;
      if(w3Event.type==='single'){ w3ResolveEvent([id]); return; }
      if(w3Picked.has(id)) w3Picked.delete(id); else w3Picked.add(id);
      paintW3();
    }));
    const c=document.getElementById('w3EvConfirm');
    if(c) c.addEventListener('click',()=>w3ResolveEvent([...w3Picked]));
  }
  if(w3Phase==='alloc'){
    root.querySelectorAll('.mp-btn').forEach(el=>el.addEventListener('click',()=>{
      const id=el.dataset.id, d=parseInt(el.dataset.d);
      const cur=w3Alloc[id]||0;
      if(d>0){
        if(w3AllocTotal()>=w3AvailMp()) return;
        const pp=W34_PROJECTS.find(x=>x.id===id);
        if(w3WeeklySpend() + pp.cost/pp.need > season.cash) return;   // 硬底線：資金不能見底
      }
      w3Alloc[id]=Math.max(0,cur+d);
      paintW3();
    }));
    const c=document.getElementById('w3Confirm');
    if(c) c.addEventListener('click', w3Settle);
  }
  if(w3Phase==='settle'){
    document.getElementById('w3Next').addEventListener('click',()=>{
      if(season.week===3){ season.week=4; renderW3(); window.scrollTo({top:0,behavior:'smooth'}); showWeekSplash(); }
      else {
        season.week=5;
        try{ localStorage.setItem('fdSeason', JSON.stringify(season)); }catch(e){}
        window.location.href='race/index.html';   // 進入霓虹大獎賽週末
      }
    });
  }
}

function w3ResolveEvent(pickedIds){
  const notes=[];
  if(pickedIds.length===0 && w3Event.noneApply){
    w3Event.noneApply(season); notes.push(w3Event.noneFx);
  } else {
    pickedIds.forEach(id=>{
      const o=w3Event.options.find(x=>x.id===id);
      o.apply(season); notes.push(`<b>${o.t}</b>：${o.fx}`);
    });
  }
  season.flags['event_'+w3Event.id]=pickedIds;
  w3EventNote = notes.join('<br>') || '（未處理）';
  w3Phase='alloc';
  renderHUD(); paintW3();
}

function w3Settle(){
  const lines=[];
  const P=season.flags.projProgress;
  // 固定薪資
  const salary=season.manpower*5;
  season.cash-=salary;
  lines.push(`固定薪資（${season.manpower} 人 × 5）　<b style="color:var(--red)">−${salary}</b>`);
  // 項目進度
  const fmt=v=>Math.round(v*10)/10;
  W34_PROJECTS.forEach(p=>{
    const n=w3Alloc[p.id]||0;
    if(n<=0) return;
    P[p.id]=(P[p.id]||0)+n;
    const charge=fmt(p.cost*n/p.need);   // 每周平均支付：按投入比例逐週扣
    season.cash=fmt(season.cash-charge);
    lines.push(`${p.name}：投入 ${n} 人力/週（進度 ${P[p.id]}/${p.need}）　<b style="color:var(--red)">−${charge}</b>`);
  });
  // 完成判定
  if(P.rnd>=4 && !season.flags.carUpgrade){
    season.flags.carUpgrade=true;
    lines.push(`<b style="color:var(--green)">研發完成！</b>W5 賽車性能提升`);
  }
  while(P.train>=2){
    P.train-=2;
    season.flags.mistakeMod=(season.flags.mistakeMod||0)-2;
    season.flags.trainCount=(season.flags.trainCount||0)+1;
    season.driverStress=Math.min(100,season.driverStress+15);
    lines.push(`<b style="color:var(--green)">操練完成！</b>失誤牌 −2、車手壓力 +15、抗壓提升（每 ${10+2*season.flags.trainCount} 車手壓力才 +1 張失誤牌）`);
  }
  while(P.rest>=1){
    P.rest-=1;
    season.driverStress=Math.max(0,season.driverStress-20);
    lines.push(`<b style="color:var(--green)">休整完成！</b>車手壓力 −20`);
  }
  if(P.hire>=1 && !season.flags.hired){
    season.flags.hired=true; season.flags.pendingHire=true;
    lines.push(`<b style="color:var(--green)">招人成功！</b>新人下週報到（人力 +1、每週薪資 +5）`);
  }
  const wl=season.flags.warnLine??100;
  if(season.cash<wl){
    lines.push(`<b style="color:var(--red)">⚠ 資金已低於警戒線 ${wl}（目前 ${season.cash}）</b>——收在線下越多，董事會越不滿。`);
  } else {
    lines.push(`資金：<b style="color:var(--green)">${season.cash}</b>（警戒線 ${wl} 之上）`);
  }
  w3SettleLines=lines;
  w3Phase='settle';
  renderHUD(); paintW3();
  const res=document.querySelector('#week3 .w2-result');
  if(res) res.scrollIntoView({behavior:'smooth', block:'center'});
}


/* ── 週開場過場（自動淡出、點擊可跳過）── */
const WEEK_SPLASH = {1:'董事會前準備',2:'董事會',3:'賽前準備',4:'賽前準備',5:'比賽'};
function showWeekSplash(){
  const wk=season.week;
  const el=document.createElement('div');
  el.className='week-splash';
  el.innerHTML=`<div class="ws-eyebrow">WEEK ${wk}</div>
    <div class="ws-title">第 ${wk} 週</div>
    <div class="ws-sub">${WEEK_SPLASH[wk]||''}</div>`;
  document.body.appendChild(el);
  let done=false;
  const close=()=>{ if(done) return; done=true; el.classList.add('out'); setTimeout(()=>el.remove(),450); };
  el.addEventListener('click', close);
  setTimeout(close, 1700);
}

/* ── 車隊牌組 dock（W1–W4 隨時查看）──────────────────────────────
   卡牌資料動態讀 race/config.js（單一資料源）。
   ★ 注入規則必須跟 race/run.js applyMgmtFlags 同步（改那邊記得改這邊）：
     carUpgrade→turbo、greyBoost→nitro、每 (10＋操練次數×2) 點壓力→1 張失誤、＋mistakeMod（操練一次 −2）、下限0 */
let RACECFG=null;
let postRaceDeckTypes=null;   // 賽後：比賽帶回的實際牌組（含賽中獲得）
import('./race/config.js')
  .then(m=>{ RACECFG=m; renderDeckDock(); })
  .catch(()=>{ /* race 資料夾不在（單獨跑經營層）→ 不顯示牌組 dock */ });

function mgmtInjectedCards(){
  const f=season.flags||{};
  const inj=[];
  if(f.carUpgrade) inj.push({type:'turbo', src:'研發完成'});
  if(f.greyBoost)  inj.push({type:'nitro', src:'灰色改裝'});
  const stress=season.driverStress??50;
  const div=10+2*(f.trainCount||0);    // 操練提升抗壓：門檻每次 +2
  const base=Math.floor(stress/div);   // 每 div 點壓力 = 1 張失誤
  const mist=Math.max(0, base+(f.mistakeMod||0));
  for(let i=0;i<mist;i++) inj.push({type:'mistake', src:'壓力／操練'});
  return { inj, stress, mist, div };
}
function renderDeckDock(){
  if(!RACECFG) return;
  const el=document.getElementById('deckDock');
  if(!el) return;
  el.style.display='block';
  const { BASE_DECK_TYPES, STAGE2_ALL_CARDS }=RACECFG;
  // 顏色沿用引擎 COLOR_THEMES（卡牌資料的 color 欄位）；失誤牌刻意用紅暗＋⚠ 突顯
  const chip=(t,mode='')=>{   // mode: '' 基礎｜'inj' 經營層帶入｜'race' 比賽中獲得
    const d=STAGE2_ALL_CARDS[t]||{name:t,speedValue:0,color:'basic'};
    const isM = t==='mistake';
    let cls = isM ? 'bad' : `c-${d.color||'basic'}`;
    let suf = '';
    if(mode==='inj'){
      if(!isM){ cls+=' inj'; suf=' ★'; }
      else if(!postRaceDeckTypes){ cls+=' dash'; }   // 賽前＝還沒生成 → 虛線；賽後＝成真 → 實線
    }
    if(mode==='race'){ cls+=' rnew'; if(!isM) suf=' ✦'; }
    return `<span class="dk-chip ${cls}">${isM?'⚠ ':''}${d.name} +${d.speedValue||0}${suf}</span>`;
  };
  const baseChips=BASE_DECK_TYPES.map(t=>chip(t)).join('');
  const info=mgmtInjectedCards();
  let injChips;
  if(postRaceDeckTypes){
    // 賽後：以比賽帶回的實際牌組為準；對得上「經營層帶入」的標 ★、其餘＝比賽中獲得 ✦
    const expected=info.inj.map(c=>c.type);
    injChips=postRaceDeckTypes.map(t=>{
      const i=expected.indexOf(t);
      if(i>=0){ expected.splice(i,1); return chip(t,'inj'); }
      return chip(t,'race');
    }).join('');
  } else {
    injChips=info.inj.map(c=>chip(c.type,'inj')).join('');
  }
  const rival=season.flags.rivalBoost
    ? `<div class="dk-rival">⚠ 對手車隊（禿鷹）狀態拉滿：整個週末速度提升</div>` : '';
  el.querySelector('.dock-body').innerHTML=`
    <div class="dk-sub">比賽時的牌組（隨經營決策即時更新）</div>
    <div class="dk-chips">${baseChips}${injChips}</div>
    <div class="dk-note">${postRaceDeckTypes ? '★＝經營層帶入 ・ ✦＝比賽中獲得' : `車手壓力 ${info.stress} ・ 比賽開始時：每 ${info.div} 車手壓力 ＋ 1 張失誤牌`}</div>
    ${rival}`;
}

/* ── 賽季日曆（事件預告）── */
function renderSeasonCal(){
  const el=document.getElementById('seasonCal'); if(!el) return;
  el.innerHTML=[1,2,3,4,5].map(w=>{
    const st = w<season.week?'past':(w===season.week?'now':'');
    return `<span class="cal-chip ${st}"><b>W${w}</b>${WEEK_SPLASH[w]||''}</span>`;
  }).join('<span class="cal-arr">›</span>');
}
/* ── dock 收合 ── */
document.querySelectorAll('.dock-head').forEach(h=>h.addEventListener('click',()=>h.parentElement.classList.toggle('collapsed')));

/* ── 賽後回流：race 寫回 fdRaceResult 後跳回來 ── */
function renderPostRace(rr){
  document.getElementById('week1').style.display='none';
  document.getElementById('week2').style.display='none';
  const root=document.getElementById('week3');
  root.style.display='block';
  const f=season.flags||{};
  const clamp=(v)=>Math.max(0,Math.min(100,v));
  const L=[];
  let kpiD=0, morD=0;

  // ── 灰色改裝：被抓判定（30%；擲一次存起來，重整不重擲）──
  let caught=false;
  if(f.greyBoost){
    let saved=null; try{ saved=JSON.parse(localStorage.getItem('fdGrey')||'null'); }catch(e){}
    if(saved===null){ caught=Math.random()<0.3; try{ localStorage.setItem('fdGrey', JSON.stringify(caught)); }catch(e){} }
    else caught=saved;
  }
  const beatRival = caught ? false : !!rr.beatRival;          // 被抓＝成績作廢、對手判輸
  const effRank   = (rr.dnf||caught) ? rr.rankTotal : rr.rank; // DNF／作廢＝以墊底計

  // ── ① 對手條款（佔位數值：lv0 贏0/輸−12、lv1 +10/−10、lv2 +12/輸0）──
  const RIV=[{win:0,lose:-12},{win:10,lose:-10},{win:12,lose:0}][f.kpiRules?.rival??0];
  let rivD = beatRival ? RIV.win : RIV.lose;
  let rivNote='';
  if(f.expectation?.rival && rivD!==0){ rivD*=2; rivNote='期望已抬高：加倍'; }
  kpiD+=rivD;
  L.push({t:'對手條款', d:`${beatRival?'贏過':'輸給'}對手車隊（禿鷹）${caught?'——灰色改裝被抓、成績作廢':''}`, v:rivD, note:rivNote});

  // ── ② 成績條款（基準線＋梯度：每差 1 名 ±4、上下限 ±20；離散條件 ±6）──
  const gl=f.kpiRules?.grade??0;
  const BASE=[3,3,5][gl];
  const grBase = Math.max(-20, Math.min(20, (BASE-effRank)*4));
  let ms=0, msTxt='';
  if(gl===0){ ms=(effRank===1)?6:-6; msTxt=`分站冠軍${effRank===1?'達成':'未達成'}（${ms>0?'+':''}${ms}）`; }
  if(gl===2){ ms=(effRank<=3)?6:-6; msTxt=`一場前3${effRank<=3?'達成':'未達成'}（${ms>0?'+':''}${ms}）`; }
  let grTotal=grBase+ms, grNote='';
  if(f.expectation?.grade){ grTotal*=2; grNote='期望已抬高：加倍'; }
  kpiD+=grTotal;
  L.push({t:'成績條款', d:`${rr.dnf?'DNF':(caught?'成績作廢':`第 ${rr.rank} 名`)}、基準第 ${BASE} 名${msTxt?('；'+msTxt):''}`, v:grTotal, note:grNote});

  // ── ③ 資金警戒線（低於警戒線：每差 5 扣 1、無條件進位）──
  const wl=f.warnLine??100;
  const deficit=Math.max(0, wl-season.cash);
  let budD = deficit>0 ? -Math.ceil(deficit/5) : 0;
  let budNote='';
  if(f.expectation?.budget && budD!==0){ budD*=2; budNote='期望已抬高：加倍'; }
  kpiD+=budD;
  L.push({t:'資金警戒線', d: deficit>0?`資金 ${season.cash}、低於警戒線 ${wl}（差 ${deficit}）`:`資金 ${season.cash}、守在警戒線 ${wl} 之上`, v:budD, note:budNote});

  // ── ④ 灰色改裝抽查 ──
  if(f.greyBoost){
    if(caught){ kpiD+=-20; morD+=-25; L.push({t:'灰色改裝', d:'賽後檢測站抽查——被抓了。醜聞見報、車隊聲譽重挫', v:-20, note:'士氣 −25'}); }
    else L.push({t:'灰色改裝', d:'賽後檢測站抽查——神不知鬼不覺、沒被發現', v:0, note:''});
  }

  // ── ⑤ 隱忍蓄力（W1 吞下的那口氣）──
  if(f.enduredW1 && beatRival){ morD+=28; L.push({t:'隱忍蓄力', d:'上個月吞下的那口氣，今天在賽道上討回來了', v:0, note:'士氣 +28'}); }

  const kpi0=season.kpi, mor0=season.morale;
  season.kpi=clamp(season.kpi+kpiD);
  season.morale=clamp(season.morale+morD);
  postRaceDeckTypes = rr.deckTypes || null;
  renderHUD();

  const rows=L.map(x=>`<div class="ar"><b style="color:var(--cyan)">${x.t}</b>　${x.d}　<b style="color:${x.v>0?'var(--green)':(x.v<0?'var(--red)':'var(--muted)')}">${x.v>0?('KPI +'+x.v):(x.v<0?('KPI −'+(-x.v)):'—')}</b>${x.note?` <span style="color:var(--gold)">· ${x.note}</span>`:''}</div>`).join('');

  root.innerHTML=`
    <div class="eyebrow">第 5 週 · 賽後結算</div>
    <h1 class="title">賽後結算</h1>
    <p class="lede">${rr.dnf?'DNF——輪胎報銷，車沒能撐到終點。':`正賽名次：第 ${rr.rank} 名（共 ${rr.rankTotal} 台）、起跑格 P${rr.gridPos}。`}董事會的考核，現在一條一條兌現。</p>
    <div class="w2-result show" style="margin-top:8px">
      <div class="rk">結算</div><div class="rt">董事會考核</div>
      <div class="applied">
        ${rows}
        <div class="ar" style="border-left-color:var(--cyan)"><b>KPI</b>　${kpi0} → <b style="color:${season.kpi>=kpi0?'var(--green)':'var(--red)'}">${season.kpi}</b>（${kpiD>=0?'+':''}${kpiD}）　・　<b>士氣</b>　${mor0} → ${season.morale}${morD?`（${morD>0?'+':''}${morD}）`:''}</div>
      </div>
      <button class="next" id="prRestart">重新開始（清除賽季進度）</button>
      <div class="stub">牌組已更新——左下「車隊牌組」：★＝經營層帶入、✦＝比賽中獲得</div>
    </div>`;
  document.getElementById('prRestart').addEventListener('click',()=>{
    try{ localStorage.removeItem('fdSeason'); localStorage.removeItem('fdRaceResult'); localStorage.removeItem('fdGrey'); }catch(e){}
    window.location.reload();
  });
  // 目標 dock 從 season 重建
  if(season.flags.kpiRules){
    const gd=document.getElementById('goalsDock');
    gd.style.display='block';
    gd.querySelector('.dock-body').innerHTML = W2_ORDER.map(id=>{
      const tag=season.flags.expectation?.[id]?' <span style="color:var(--gold)">· 期望已抬高</span>':'';
      return `<div class="goal-line"><b>${W2_DEMANDS[id].name}</b>${W2_DEMANDS[id].scale[season.flags.kpiRules[id]]}${tag}</div>`;
    }).join('');
  }
  document.getElementById('socialDock').classList.add('collapsed');
}

const _postRace=(()=>{ try{ return JSON.parse(localStorage.getItem('fdRaceResult')||'null'); }catch(e){ return null; } })();
const _savedSeason=(()=>{ try{ return JSON.parse(localStorage.getItem('fdSeason')||'null'); }catch(e){ return null; } })();
if(_postRace && _savedSeason){
  Object.assign(season, _savedSeason);
  season.week=5;
  renderHUD();
  renderPostRace(_postRace);
} else {
  renderW1();
  showWeekSplash();
}
