const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const finish = 1000;
const driveKeys = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  nitro: false,
  focus: false
};
const dragState = {
  active: false,
  moved: false,
  card: null,
  index: -1,
  offsetX: 0,
  offsetY: 0,
  startX: 0,
  startY: 0
};
let suppressNextCardClick = false;
const cornerZones = [
  { start: 0.18, end: 0.31, direction: "left", name: "一號左彎" },
  { start: 0.46, end: 0.58, direction: "right", name: "高速右彎" },
  { start: 0.72, end: 0.84, direction: "left", name: "髮夾左彎" }
];

const cardPool = [
  { name: "彈射起跑", cost: 2, text: "加速 +18、輪胎抓地 -8。本回合距離偏向加速。", type: "speed", changes: { acceleration: 18, grip: -8 } },
  { name: "氮氣全開", cost: 3, text: "氮氣 +32、控制力 -10、輪胎抓地 -8。爆發很強但更難穩住。", type: "speed", changes: { nitro: 32, control: -10, grip: -8 } },
  { name: "精準入彎", cost: 1, text: "控制力 +16、輪胎抓地 +8。讓速度折損變少。", type: "control", changes: { control: 16, grip: 8 } },
  { name: "晚煞車", cost: 2, text: "加速 +10、極速 +8、控制力 -12。搶時間但風險上升。", type: "tactic", changes: { acceleration: 10, topSpeed: 8, control: -12 } },
  { name: "輪胎保溫", cost: 1, text: "輪胎抓地 +18、控制力 +6。低抓地時非常關鍵。", type: "control", changes: { grip: 18, control: 6 } },
  { name: "低風阻姿態", cost: 2, text: "空阻 -16、極速 +10、控制力 -4。直線速度更漂亮。", type: "speed", changes: { drag: -16, topSpeed: 10, control: -4 } },
  { name: "高下壓設定", cost: 2, text: "控制力 +20、輪胎抓地 +10、空阻 +12。彎道穩但直線較慢。", type: "control", changes: { control: 20, grip: 10, drag: 12 } },
  { name: "渦輪增壓", cost: 3, text: "加速 +14、極速 +16、氮氣 -8。把儲備換成持續速度。", type: "speed", changes: { acceleration: 14, topSpeed: 16, nitro: -8 } },
  { name: "省胎巡航", cost: 1, text: "輪胎抓地 +14、空阻 -4、加速 -5。為後段鋪路。", type: "control", changes: { grip: 14, drag: -4, acceleration: -5 } },
  { name: "內線卡位", cost: 2, text: "控制力 +10，獲得一次防干擾。", type: "guard", changes: { control: 10 }, shield: true },
  { name: "尾流吸附", cost: 1, text: "空阻 -10、氮氣 +8。若落後，再回收 1 能量。", type: "tactic", changes: { drag: -10, nitro: 8 }, catchUpEnergy: 1 },
  { name: "極限甩尾", cost: 2, text: "控制力 +18、加速 +12、輪胎抓地 -18。很快，也很吃胎。", type: "control", changes: { control: 18, acceleration: 12, grip: -18 } },
  { name: "維修進站", cost: 2, text: "輪胎抓地 +34、控制力 +8、極速 -6，並抽 1 張牌。", type: "guard", changes: { grip: 34, control: 8, topSpeed: -6 }, draw: 1 },
  { name: "賽道掃描", cost: 1, text: "控制力 +8、空阻 -6，並抽 1 張牌。", type: "tactic", changes: { control: 8, drag: -6 }, draw: 1 },
  { name: "重油門出彎", cost: 2, text: "加速 +20、控制力 -8、輪胎抓地 -10。出彎距離很強。", type: "speed", changes: { acceleration: 20, control: -8, grip: -10 } },
  { name: "短齒比調校", cost: 2, text: "加速 +16、極速 -8。前中段追擊更快。", type: "speed", changes: { acceleration: 16, topSpeed: -8 } },
  { name: "長齒比調校", cost: 2, text: "極速 +20、加速 -8。後段衝線更有力。", type: "speed", changes: { topSpeed: 20, acceleration: -8 } },
  { name: "碎石區逼迫", cost: 3, text: "對手控制力 -14、輪胎抓地 -12；若有防守則抵銷。", type: "attack", targetChanges: { control: -14, grip: -12 } },
  { name: "假動作超車", cost: 2, text: "你的控制力 +8，對手空阻 +10；若有防守則只提升自己。", type: "attack", changes: { control: 8 }, targetChanges: { drag: 10 } },
  { name: "冷卻煞車", cost: 1, text: "控制力 +12、輪胎抓地 +10、加速 -4。穩住車身準備下一波。", type: "control", changes: { control: 12, grip: 10, acceleration: -4 } },
  { name: "招攬天才車手", cost: 3, text: "車手能力 +18、士氣 +8、董事會信任 -6。更快，但合約壓力上升。", type: "driver", teamChanges: { driverSkill: 18, morale: 8, boardTrust: -6 } },
  { name: "車手心理輔導", cost: 1, text: "車手士氣 +18、控制力 +6。低士氣時能救回節奏。", type: "driver", changes: { control: 6 }, teamChanges: { morale: 18 } },
  { name: "二號車手支援", cost: 2, text: "車手能力 +8、車隊關係 +8、氮氣 +8。團隊配合讓主車更順。", type: "driver", changes: { nitro: 8 }, teamChanges: { driverSkill: 8, paddockRelations: 8 } },
  { name: "冠名贊助談判", cost: 2, text: "贊助資源 +22、董事會信任 +6、車手士氣 -4。資金會提高能量上限。", type: "sponsor", teamChanges: { sponsorFunds: 22, boardTrust: 6, morale: -4 } },
  { name: "贊助商展示圈", cost: 1, text: "贊助資源 +12、董事會信任 +8、加速 -4。本回合保守換資源。", type: "sponsor", changes: { acceleration: -4 }, teamChanges: { sponsorFunds: 12, boardTrust: 8 } },
  { name: "董事會加碼預算", cost: 3, text: "董事會信任 +18、贊助資源 +12、極速 +8。高信任能提高能量上限。", type: "board", changes: { topSpeed: 8 }, teamChanges: { boardTrust: 18, sponsorFunds: 12 } },
  { name: "季度績效報告", cost: 1, text: "董事會信任 +12、車手士氣 -6，並抽 1 張牌。", type: "board", teamChanges: { boardTrust: 12, morale: -6 }, draw: 1 },
  { name: "與勁敵交換情報", cost: 2, text: "車隊關係 +18、控制力 +8，對手控制力 +4。關係高可削弱干擾。", type: "team", changes: { control: 8 }, targetChanges: { control: 4 }, teamChanges: { paddockRelations: 18 } },
  { name: "封鎖對手維修區", cost: 3, text: "對手輪胎抓地 -14、車隊關係 -18。強硬但會破壞圍場名聲。", type: "team", targetChanges: { grip: -14 }, teamChanges: { paddockRelations: -18 } },
  { name: "賽會安全簡報", cost: 1, text: "賽會聲望 +16、控制力 +6。聲望高會降低速度懲罰。", type: "steward", changes: { control: 6 }, teamChanges: { stewardStanding: 16 } },
  { name: "抗議對手違規", cost: 2, text: "賽會聲望 +10、對手空阻 +10；若對手防守則被駁回。", type: "steward", targetChanges: { drag: 10 }, teamChanges: { stewardStanding: 10 } }
];

const rivalDeck = [
  { name: "紅車彈射起跑", changes: { acceleration: 14, grip: -6 } },
  { name: "紅車直線低趴", changes: { topSpeed: 12, drag: -12, control: -5 } },
  { name: "紅車保守巡航", changes: { grip: 14, control: 8 } },
  { name: "紅車內線卡位", changes: { control: 10 }, shield: true },
  { name: "紅車氮氣推進", changes: { nitro: 24, grip: -8, control: -6 } },
  { name: "紅車干擾路線", changes: { acceleration: 6 }, attack: { control: -10, grip: -8 } }
];

const game = {
  turn: 1,
  energy: 3,
  maxEnergy: 3,
  over: false,
  hand: [],
  player: makeCarState(),
  rival: makeCarState(),
  team: makeTeamState(),
  rivalTeam: makeTeamState(),
  drive: makeDriveState(),
  log: [],
  message(text) {
    this.log.unshift(text);
    this.log = this.log.slice(0, 7);
  }
};

const els = {
  turn: document.querySelector("#turn"),
  energy: document.querySelector("#energy"),
  status: document.querySelector("#status"),
  cards: document.querySelector("#cards"),
  playZone: document.querySelector("#playZone"),
  nextRoundButton: document.querySelector("#nextRoundButton"),
  log: document.querySelector("#log"),
  drawButton: document.querySelector("#drawButton"),
  resetButton: document.querySelector("#resetButton"),
  driveButtons: document.querySelectorAll("[data-drive]"),
  playerDistance: document.querySelector("#playerDistance"),
  rivalDistance: document.querySelector("#rivalDistance"),
  gripText: document.querySelector("#gripText"),
  playerBar: document.querySelector("#playerBar"),
  rivalBar: document.querySelector("#rivalBar"),
  gripBar: document.querySelector("#gripBar"),
  accelText: document.querySelector("#accelText"),
  accelBar: document.querySelector("#accelBar"),
  controlText: document.querySelector("#controlText"),
  controlBar: document.querySelector("#controlBar"),
  topSpeedText: document.querySelector("#topSpeedText"),
  topSpeedBar: document.querySelector("#topSpeedBar"),
  nitroText: document.querySelector("#nitroText"),
  nitroBar: document.querySelector("#nitroBar"),
  driverText: document.querySelector("#driverText"),
  driverBar: document.querySelector("#driverBar"),
  sponsorText: document.querySelector("#sponsorText"),
  sponsorBar: document.querySelector("#sponsorBar"),
  boardText: document.querySelector("#boardText"),
  boardBar: document.querySelector("#boardBar"),
  paddockText: document.querySelector("#paddockText"),
  paddockBar: document.querySelector("#paddockBar"),
  stewardText: document.querySelector("#stewardText"),
  stewardBar: document.querySelector("#stewardBar")
};

function drawCard() {
  return cardPool[Math.floor(Math.random() * cardPool.length)];
}

function makeCarState() {
  return {
    distance: 0,
    acceleration: 50,
    control: 55,
    topSpeed: 50,
    grip: 100,
    nitro: 20,
    drag: 28,
    shield: false,
    slow: 0
  };
}

function makeTeamState() {
  return {
    driverSkill: 50,
    morale: 55,
    sponsorFunds: 50,
    boardTrust: 50,
    paddockRelations: 50,
    stewardStanding: 50
  };
}

function makeDriveState() {
  return {
    active: false,
    startDistance: 0,
    baseGain: 0,
    bonus: 0,
    penalty: 0,
    startTime: 0,
    duration: 3600,
    checkedCorners: [],
    lastFrame: 0,
    currentHint: "等待出牌"
  };
}

function clampStats(car) {
  car.acceleration = clamp(car.acceleration, 10, 100);
  car.control = clamp(car.control, 10, 100);
  car.topSpeed = clamp(car.topSpeed, 10, 100);
  car.grip = clamp(car.grip, 0, 100);
  car.nitro = clamp(car.nitro, 0, 100);
  car.drag = clamp(car.drag, 0, 80);
}

function clampTeam(team) {
  team.driverSkill = clamp(team.driverSkill, 0, 100);
  team.morale = clamp(team.morale, 0, 100);
  team.sponsorFunds = clamp(team.sponsorFunds, 0, 100);
  team.boardTrust = clamp(team.boardTrust, 0, 100);
  team.paddockRelations = clamp(team.paddockRelations, 0, 100);
  team.stewardStanding = clamp(team.stewardStanding, 0, 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyChanges(car, changes = {}) {
  if (!changes) return;
  Object.entries(changes).forEach(([stat, amount]) => {
    car[stat] += amount;
  });
  clampStats(car);
}

function applyTeamChanges(team, changes = {}) {
  if (!changes) return;
  Object.entries(changes).forEach(([stat, amount]) => {
    team[stat] += amount;
  });
  clampTeam(team);
}

function describeChanges(changes = {}) {
  const labels = {
    acceleration: "加速",
    control: "控制",
    topSpeed: "極速",
    grip: "抓地",
    nitro: "氮氣",
    drag: "空阻"
  };
  return Object.entries(changes).map(([stat, amount]) => {
    const sign = amount > 0 ? "+" : "";
    return `${labels[stat]} ${sign}${amount}`;
  }).join("、");
}

function describeTeamChanges(changes = {}) {
  const labels = {
    driverSkill: "車手能力",
    morale: "士氣",
    sponsorFunds: "贊助",
    boardTrust: "董事會",
    paddockRelations: "車隊關係",
    stewardStanding: "賽會聲望"
  };
  return Object.entries(changes).map(([stat, amount]) => {
    const sign = amount > 0 ? "+" : "";
    return `${labels[stat]} ${sign}${amount}`;
  }).join("、");
}

function calculateMove(car, team) {
  const skillBoost = team.driverSkill * 0.16;
  const moraleBoost = team.morale * 0.12;
  const resourceBoost = (team.sponsorFunds + team.boardTrust) * 0.04;
  const power = 22 + car.acceleration * 0.42 + car.topSpeed * 0.34 + car.nitro * 0.28 + skillBoost + moraleBoost + resourceBoost;
  const stability = 0.66 + (car.control + car.grip + team.driverSkill * 0.45 + team.stewardStanding * 0.22) / 430;
  const dragPenalty = car.drag * 0.28;
  const lowGripPenalty = car.grip < 35 ? (35 - car.grip) * 0.65 : 0;
  const lowControlPenalty = car.control < 35 ? (35 - car.control) * 0.55 : 0;
  const stewardRelief = team.stewardStanding > 65 ? 5 : 0;
  return Math.max(18, Math.round(power * stability - dragPenalty - lowGripPenalty - lowControlPenalty + stewardRelief));
}

function consumeWear(car) {
  car.nitro = Math.max(0, car.nitro - 7);
  car.grip = Math.max(0, car.grip - 3);
  clampStats(car);
}

function applyCard(card) {
  applyChanges(game.player, card.changes);
  applyTeamChanges(game.team, card.teamChanges);

  if (card.targetChanges) {
    if (game.rival.shield) {
      game.rival.shield = false;
      game.message("對手的防守車線擋下了干擾效果。");
    } else {
      const relationScale = game.team.paddockRelations < 30 ? 1.25 : 1;
      const scaledChanges = scaleChanges(card.targetChanges, relationScale);
      applyChanges(game.rival, scaledChanges);
      game.message(`對手受到影響：${describeChanges(scaledChanges)}。`);
    }
  }

  if (card.shield) game.player.shield = true;
  if (card.draw) {
    for (let i = 0; i < card.draw; i += 1) game.hand.push(drawCard());
  }
  if (card.catchUpEnergy && game.player.distance < game.rival.distance) {
    game.energy = Math.min(game.maxEnergy, game.energy + card.catchUpEnergy);
    game.message("你利用尾流追擊，回收 1 能量。");
  }

  const gain = calculateMove(game.player, game.team);

  const changed = describeChanges(card.changes);
  const teamChanged = describeTeamChanges(card.teamChanges);
  const suffix = [changed, teamChanged].filter(Boolean).join("；");
  game.message(`你打出「${card.name}」${suffix ? `（${suffix}）` : ""}，準備衝刺 ${gain}m。`);
  return gain;
}

function scaleChanges(changes, scale) {
  return Object.fromEntries(Object.entries(changes).map(([stat, amount]) => [stat, Math.round(amount * scale)]));
}

function refillHand() {
  while (game.hand.length < 3) {
    game.hand.push(drawCard());
  }
  game.message("進入下一輪策略，手牌補到 3 張。");
  render();
}

function playCard(index) {
  if (game.over || game.drive.active) return;
  const card = game.hand[index];
  if (!card || card.cost > game.energy) {
    game.message("能量不足，這張牌還不能打。");
    render();
    return;
  }

  game.energy -= card.cost;
  game.hand.splice(index, 1);
  const before = game.player.distance;
  const gain = applyCard(card);
  startDriveStint(gain, before);
  render();
}

function startDriveStint(gain, originalDistance) {
  game.drive = makeDriveState();
  game.drive.active = true;
  game.drive.startDistance = game.player.distance;
  game.drive.baseGain = gain;
  game.drive.originalDistance = originalDistance;
  game.drive.startTime = performance.now();
  game.drive.lastFrame = game.drive.startTime;
  game.drive.currentHint = "短衝刺開始：直線補油，看到彎道提示就轉向控車。";
  requestAnimationFrame(updateDriveStint);
}

function updateDriveStint(now) {
  if (!game.drive.active) return;

  const elapsed = now - game.drive.startTime;
  const progress = clamp(elapsed / game.drive.duration, 0, 1);
  const currentGain = Math.max(0, game.drive.baseGain + game.drive.bonus - game.drive.penalty);
  game.player.distance = game.drive.startDistance + currentGain * progress;

  evaluateLiveDriving(progress);
  clampRace();
  renderHud();
  renderTrack();

  if (progress >= 1) {
    finishDriveStint();
    return;
  }

  requestAnimationFrame(updateDriveStint);
}

function evaluateLiveDriving() {
  const raceProgress = game.player.distance / finish;
  const corner = cornerZones.find((zone) => raceProgress >= zone.start && raceProgress <= zone.end);

  if (!corner) {
    game.drive.currentHint = driveKeys.throttle ? "直線油門漂亮，速度維持中。" : "直線區：按 W 或油門保持速度。";
    if (driveKeys.throttle && performance.now() - game.drive.lastFrame > 480) {
      game.drive.bonus += 2;
      game.drive.lastFrame = performance.now();
    }
    if (driveKeys.nitro && game.player.nitro > 0 && performance.now() - game.drive.lastFrame > 360) {
      game.drive.bonus += 4;
      game.player.nitro = Math.max(0, game.player.nitro - 2);
      game.drive.lastFrame = performance.now();
    }
    return;
  }

  const key = `${corner.name}-${game.turn}`;
  game.drive.currentHint = `${corner.name}：${corner.direction === "left" ? "按 A 左轉" : "按 D 右轉"}，用 S 或 Shift 控速。`;
  if (game.drive.checkedCorners.includes(key)) return;

  const steeringOk = corner.direction === "left" ? driveKeys.left : driveKeys.right;
  const controlled = driveKeys.brake || driveKeys.focus || game.player.control >= 70;
  const greedyThrottle = driveKeys.throttle && !controlled;
  const stability = game.player.control + game.player.grip + game.team.driverSkill * 0.45;

  if (steeringOk && controlled) {
    const bonus = stability >= 135 ? 24 : 14;
    game.drive.bonus += bonus;
    game.player.grip = Math.max(0, game.player.grip - 2);
    game.message(`${corner.name}切線成功，出彎加速 +${bonus}m。`);
  } else if (steeringOk && !greedyThrottle) {
    game.drive.bonus += 8;
    game.player.grip = Math.max(0, game.player.grip - 5);
    game.message(`${corner.name}安全通過，微幅加速 +8m。`);
  } else {
    const penalty = stability < 110 ? 30 : 18;
    game.drive.penalty += penalty;
    game.player.grip = Math.max(0, game.player.grip - 12);
    game.player.control = Math.max(10, game.player.control - 5);
    game.message(`${corner.name}控制失誤，打滑損失 ${penalty}m。`);
  }

  clampStats(game.player);
  game.drive.checkedCorners.push(key);
}

function finishDriveStint() {
  applyPlayerSlow(game.drive.originalDistance);
  consumeWear(game.player);
  clampRace();
  game.drive.active = false;
  game.drive.currentHint = "衝刺完成";

  if (!checkWinner()) {
    rivalTurn();
    if (!checkWinner()) nextTurn();
  }
  render();
}

function rivalTurn() {
  const move = rivalDeck[Math.floor(Math.random() * rivalDeck.length)];
  applyChanges(game.rival, move.changes);
  let gain = calculateMove(game.rival, game.rivalTeam);
  if (game.rival.slow > 0) {
    gain = Math.max(0, gain - game.rival.slow);
    game.rival.slow = 0;
  }

  game.rival.distance += gain;
  consumeWear(game.rival);
  if (move.shield) game.rival.shield = true;

  if (move.attack) {
    if (game.player.shield) {
      game.player.shield = false;
      game.message("你的防守車線擋下了紅車干擾。");
    } else {
      const relationScale = game.team.paddockRelations > 70 ? 0.65 : 1;
      const scaledAttack = scaleChanges(move.attack, relationScale);
      applyChanges(game.player, scaledAttack);
      game.message(`紅車打出干擾：${describeChanges(scaledAttack)}。`);
    }
  }

  if (game.player.slow > 0) {
    game.message(`紅車完成 ${move.name}，推進 ${gain}m。`);
  } else {
    game.message(`${move.name}，推進 ${gain}m。`);
  }
}

function nextTurn() {
  game.turn += 1;
  const sponsorBonus = game.team.sponsorFunds >= 70 ? 1 : 0;
  const boardBonus = game.team.boardTrust >= 75 ? 1 : 0;
  const pressurePenalty = game.team.boardTrust <= 25 ? 1 : 0;
  game.maxEnergy = Math.min(10, Math.max(3, game.maxEnergy + 1 + sponsorBonus + boardBonus - pressurePenalty));
  game.energy = game.maxEnergy;
  if (game.player.slow > 0) {
    game.message(`你的賽車受到干擾，下一張前進牌會少 ${game.player.slow}m。`);
  }
  if (sponsorBonus || boardBonus) {
    game.message("贊助或董事會資源到位，下回合能量上限提高。");
  }
}

function applyPlayerSlow(originalDistance) {
  if (game.player.slow <= 0) return;
  const gained = game.player.distance - originalDistance;
  const penalty = Math.min(gained, game.player.slow);
  game.player.distance -= penalty;
  game.player.slow = 0;
  game.message(`干擾生效，你少前進 ${penalty}m。`);
}

function clampRace() {
  game.player.distance = Math.max(0, Math.min(finish, Math.round(game.player.distance)));
  game.rival.distance = Math.max(0, Math.min(finish, Math.round(game.rival.distance)));
}

function checkWinner() {
  if (game.player.distance >= finish && game.rival.distance >= finish) {
    game.over = true;
    els.status.textContent = "平手衝線";
    game.message("兩台車同時壓線，這場是平手。");
    return true;
  }
  if (game.player.distance >= finish) {
    game.over = true;
    els.status.textContent = "你贏了";
    game.message("你率先衝過終點。");
    return true;
  }
  if (game.rival.distance >= finish) {
    game.over = true;
    els.status.textContent = "紅車獲勝";
    game.message("紅車先抵達終點，下次把它追回來。");
    return true;
  }
  return false;
}

function resetGame() {
  game.turn = 1;
  game.energy = 3;
  game.maxEnergy = 3;
  game.over = false;
  game.hand = [drawCard(), drawCard(), drawCard()];
  game.player = makeCarState();
  game.rival = makeCarState();
  game.team = makeTeamState();
  game.rivalTeam = makeTeamState();
  game.drive = makeDriveState();
  game.log = ["綠車與紅車在起跑線待命。"];
  render();
}

function renderCards() {
  els.cards.innerHTML = "";
  game.hand.forEach((card, index) => {
    const button = document.createElement("button");
    button.className = "card";
    button.type = "button";
    button.draggable = !game.over && !game.drive.active;
    button.dataset.cardIndex = index;
    button.disabled = game.over || game.drive.active;
    button.innerHTML = `
      <span class="cost">${card.cost}</span>
      <span>
        <span class="type">${getCardTypeName(card.type)}</span>
        <strong>${card.name}</strong>
        <small>${card.text}</small>
      </span>
      <span class="play-hint">拖到上方打出</span>
    `;
    button.addEventListener("click", () => {
      if (suppressNextCardClick) {
        suppressNextCardClick = false;
        return;
      }
      playCard(index);
    });
    button.addEventListener("pointerdown", (event) => {
      startPointerCardDrag(event, button, index);
    });
    button.addEventListener("dragstart", (event) => {
      if (button.disabled) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      button.classList.add("is-dragging");
      els.playZone.classList.add("is-ready");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      els.playZone.classList.remove("is-ready");
    });
    els.cards.appendChild(button);
  });
}

function getCardTypeName(type) {
  const names = {
    speed: "速度",
    control: "操控",
    tactic: "戰術",
    guard: "防守",
    attack: "干擾",
    driver: "車手",
    sponsor: "贊助",
    board: "董事會",
    team: "車隊",
    steward: "賽會"
  };
  return names[type] || "策略";
}

function startPointerCardDrag(event, cardElement, index) {
  if (event.button !== undefined && event.button !== 0) return;
  if (game.over || game.drive.active || cardElement.disabled) return;

  const rect = cardElement.getBoundingClientRect();
  dragState.active = true;
  dragState.moved = false;
  dragState.card = cardElement;
  dragState.index = index;
  dragState.offsetX = event.clientX - rect.left;
  dragState.offsetY = event.clientY - rect.top;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;

  cardElement.setPointerCapture(event.pointerId);
  cardElement.addEventListener("pointermove", movePointerCardDrag);
  cardElement.addEventListener("pointerup", endPointerCardDrag);
  cardElement.addEventListener("pointercancel", cancelPointerCardDrag);
}

function movePointerCardDrag(event) {
  if (!dragState.active || !dragState.card) return;

  const movedEnough = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 8;
  if (!dragState.moved && movedEnough) {
    const rect = dragState.card.getBoundingClientRect();
    dragState.moved = true;
    suppressNextCardClick = true;
    dragState.card.classList.add("is-pointer-dragging");
    dragState.card.style.width = `${rect.width}px`;
    dragState.card.style.left = `${rect.left}px`;
    dragState.card.style.top = `${rect.top}px`;
    els.playZone.classList.add("is-ready");
  }

  if (!dragState.moved) return;
  event.preventDefault();
  dragState.card.style.left = `${event.clientX - dragState.offsetX}px`;
  dragState.card.style.top = `${event.clientY - dragState.offsetY}px`;

  const overZone = isPointInPlayZone(event.clientX, event.clientY);
  els.playZone.classList.toggle("is-ready", overZone);
}

function endPointerCardDrag(event) {
  if (!dragState.active) return;
  const shouldPlay = dragState.moved && isPointInPlayZone(event.clientX, event.clientY);
  const index = dragState.index;
  resetPointerCardDrag();
  if (shouldPlay) playCard(index);
}

function cancelPointerCardDrag() {
  resetPointerCardDrag();
}

function resetPointerCardDrag() {
  if (dragState.card) {
    dragState.card.classList.remove("is-pointer-dragging");
    dragState.card.style.removeProperty("width");
    dragState.card.style.removeProperty("left");
    dragState.card.style.removeProperty("top");
    dragState.card.removeEventListener("pointermove", movePointerCardDrag);
    dragState.card.removeEventListener("pointerup", endPointerCardDrag);
    dragState.card.removeEventListener("pointercancel", cancelPointerCardDrag);
  }

  els.playZone.classList.remove("is-ready");
  dragState.active = false;
  dragState.moved = false;
  dragState.card = null;
  dragState.index = -1;
}

function isPointInPlayZone(x, y) {
  const rect = els.playZone.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function renderHud() {
  els.turn.textContent = game.turn;
  els.energy.textContent = `${game.energy} / ${game.maxEnergy}`;
  if (game.drive.active) {
    els.status.textContent = game.drive.currentHint;
  } else if (!game.over) {
    els.status.textContent = game.player.distance >= game.rival.distance ? "領先中" : "追趕中";
  }

  els.playerDistance.textContent = `${game.player.distance}m`;
  els.rivalDistance.textContent = `${game.rival.distance}m`;
  els.gripText.textContent = `${game.player.grip}%`;
  els.accelText.textContent = game.player.acceleration;
  els.controlText.textContent = game.player.control;
  els.topSpeedText.textContent = game.player.topSpeed;
  els.nitroText.textContent = game.player.nitro;
  els.driverText.textContent = `${game.team.driverSkill} / ${game.team.morale}`;
  els.sponsorText.textContent = game.team.sponsorFunds;
  els.boardText.textContent = game.team.boardTrust;
  els.paddockText.textContent = game.team.paddockRelations;
  els.stewardText.textContent = game.team.stewardStanding;
  els.playerBar.style.width = `${game.player.distance / finish * 100}%`;
  els.rivalBar.style.width = `${game.rival.distance / finish * 100}%`;
  els.gripBar.style.width = `${game.player.grip}%`;
  els.gripBar.style.background = game.player.grip < 35 ? "var(--danger)" : "var(--accent)";
  els.accelBar.style.width = `${game.player.acceleration}%`;
  els.controlBar.style.width = `${game.player.control}%`;
  els.topSpeedBar.style.width = `${game.player.topSpeed}%`;
  els.nitroBar.style.width = `${game.player.nitro}%`;
  els.controlBar.style.background = game.player.control < 35 ? "var(--danger)" : "var(--accent)";
  els.nitroBar.style.background = game.player.nitro < 15 ? "var(--warn)" : "var(--accent)";
  els.driverBar.style.width = `${(game.team.driverSkill + game.team.morale) / 2}%`;
  els.sponsorBar.style.width = `${game.team.sponsorFunds}%`;
  els.boardBar.style.width = `${game.team.boardTrust}%`;
  els.paddockBar.style.width = `${game.team.paddockRelations}%`;
  els.stewardBar.style.width = `${game.team.stewardStanding}%`;
  els.boardBar.style.background = game.team.boardTrust < 30 ? "var(--danger)" : "var(--accent)";
  els.paddockBar.style.background = game.team.paddockRelations < 30 ? "var(--danger)" : "var(--accent)";
  els.stewardBar.style.background = game.team.stewardStanding < 30 ? "var(--warn)" : "var(--accent)";
  els.log.innerHTML = game.log.map((entry) => `<div>${entry}</div>`).join("");
  const canGoNextRound = game.hand.length === 0 && !game.over && !game.drive.active;
  els.drawButton.textContent = "補滿手牌";
  els.drawButton.disabled = game.over || game.drive.active || game.hand.length >= 3;
  els.nextRoundButton.hidden = !canGoNextRound;
  els.nextRoundButton.disabled = !canGoNextRound;
  els.playZone.classList.toggle("is-locked", game.over || game.drive.active);
  if (game.drive.active) {
    els.playZone.textContent = "衝刺中，暫時不能出牌";
  } else if (game.hand.length === 0 && !game.over) {
    els.playZone.textContent = "手牌已打完";
  } else {
    els.playZone.textContent = "拖曳卡牌到這裡打出";
  }
}

function renderTrack() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#236943";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#1f8aa1";
  ctx.beginPath();
  ctx.ellipse(w * 0.16, h * 0.18, w * 0.22, h * 0.1, -0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#30363a";
  roundedRect(70, h * 0.2, w - 140, h * 0.56, 48);
  ctx.fill();

  ctx.strokeStyle = "#e7e178";
  ctx.lineWidth = 8;
  ctx.setLineDash([28, 28]);
  ctx.beginPath();
  ctx.moveTo(115, h * 0.48);
  ctx.lineTo(w - 115, h * 0.48);
  ctx.stroke();
  ctx.setLineDash([]);

  drawCornerZones();

  ctx.strokeStyle = "#eef3ef";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w - 130, h * 0.2);
  ctx.lineTo(w - 130, h * 0.76);
  ctx.stroke();

  drawTrackMarkers();
  drawCar(game.rival.distance / finish, h * 0.38, "#f05d5e", game.rival.shield);
  drawCar(game.player.distance / finish, h * 0.59, "#25d17f", game.player.shield);
  drawDriveOverlay();
}

function drawDriveOverlay() {
  if (!game.drive.active) return;

  ctx.fillStyle = "rgba(13, 16, 14, 0.76)";
  roundedRect(38, 28, Math.min(640, canvas.width - 76), 78, 8);
  ctx.fill();
  ctx.fillStyle = "#ffcf4d";
  ctx.font = "800 24px Segoe UI, sans-serif";
  ctx.fillText("即時駕駛", 60, 60);
  ctx.fillStyle = "#f7faf7";
  ctx.font = "700 22px Segoe UI, sans-serif";
  const hint = game.drive.currentHint.length > 32 ? `${game.drive.currentHint.slice(0, 32)}...` : game.drive.currentHint;
  ctx.fillText(hint, 60, 92);
}

function drawCornerZones() {
  const startX = 120;
  const endX = canvas.width - 150;
  const roadTop = canvas.height * 0.2;
  const roadHeight = canvas.height * 0.56;

  cornerZones.forEach((zone) => {
    const x = startX + (endX - startX) * zone.start;
    const width = (endX - startX) * (zone.end - zone.start);
    const active = game.player.distance / finish >= zone.start && game.player.distance / finish <= zone.end;
    ctx.fillStyle = active ? "rgba(255, 207, 77, 0.28)" : "rgba(255, 207, 77, 0.13)";
    ctx.fillRect(x, roadTop, width, roadHeight);
    ctx.fillStyle = active ? "#ffffff" : "#ffcf4d";
    ctx.font = "700 18px Segoe UI, sans-serif";
    ctx.fillText(zone.direction === "left" ? "A 左彎" : "D 右彎", x + 12, roadTop + 32);
  });
}

function drawTrackMarkers() {
  const startX = 120;
  const endX = canvas.width - 150;
  ctx.fillStyle = "#f7faf7";
  ctx.font = "700 20px Segoe UI, sans-serif";
  ctx.fillText("START", startX - 40, canvas.height * 0.79);
  ctx.fillText("FINISH", endX - 32, canvas.height * 0.18);

  for (let i = 0; i <= 5; i += 1) {
    const x = startX + (endX - startX) * (i / 5);
    ctx.fillStyle = "rgba(247, 250, 247, 0.2)";
    ctx.fillRect(x, canvas.height * 0.23, 2, canvas.height * 0.5);
  }
}

function drawCar(progress, y, color, shield) {
  const startX = 120;
  const endX = canvas.width - 150;
  const x = startX + (endX - startX) * progress;

  ctx.save();
  ctx.translate(x, y);

  if (shield) {
    ctx.strokeStyle = "#ffcf4d";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 62, 38, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.beginPath();
  ctx.ellipse(-4, 25, 58, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  roundedRect(-50, -22, 100, 44, 8);
  ctx.fill();

  ctx.fillStyle = "#101312";
  roundedRect(-18, -18, 34, 24, 6);
  ctx.fill();

  ctx.fillStyle = "#f7faf7";
  ctx.fillRect(34, -14, 16, 8);
  ctx.fillRect(34, 6, 16, 8);

  ctx.fillStyle = "#0a0d0b";
  ctx.beginPath();
  ctx.arc(-32, 25, 12, 0, Math.PI * 2);
  ctx.arc(32, 25, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e7e178";
  ctx.beginPath();
  ctx.moveTo(-58, -12);
  ctx.lineTo(-84, -4);
  ctx.lineTo(-58, 4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function render() {
  renderHud();
  renderCards();
  renderTrack();
}

els.drawButton.addEventListener("click", refillHand);
els.nextRoundButton.addEventListener("click", refillHand);
els.resetButton.addEventListener("click", resetGame);
els.playZone.addEventListener("dragover", (event) => {
  if (game.over || game.drive.active) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  els.playZone.classList.add("is-ready");
});
els.playZone.addEventListener("dragleave", () => {
  els.playZone.classList.remove("is-ready");
});
els.playZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.playZone.classList.remove("is-ready");
  const index = Number(event.dataTransfer.getData("text/plain"));
  if (Number.isInteger(index)) playCard(index);
});
els.driveButtons.forEach((button) => {
  const action = button.dataset.drive;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    driveKeys[action] = true;
    button.classList.add("is-active");
  });
  button.addEventListener("pointerup", () => {
    driveKeys[action] = false;
    button.classList.remove("is-active");
  });
  button.addEventListener("pointerleave", () => {
    driveKeys[action] = false;
    button.classList.remove("is-active");
  });
  button.addEventListener("pointercancel", () => {
    driveKeys[action] = false;
    button.classList.remove("is-active");
  });
});

window.addEventListener("keydown", (event) => {
  const action = keyToDriveAction(event);
  if (!action) return;
  event.preventDefault();
  driveKeys[action] = true;
  syncDriveButtons();
});

window.addEventListener("keyup", (event) => {
  const action = keyToDriveAction(event);
  if (!action) return;
  event.preventDefault();
  driveKeys[action] = false;
  syncDriveButtons();
});

function keyToDriveAction(event) {
  const key = event.key.toLowerCase();
  if (key === "w" || key === "arrowup") return "throttle";
  if (key === "s" || key === "arrowdown") return "brake";
  if (key === "a" || key === "arrowleft") return "left";
  if (key === "d" || key === "arrowright") return "right";
  if (key === " ") return "nitro";
  if (key === "shift") return "focus";
  return "";
}

function syncDriveButtons() {
  els.driveButtons.forEach((button) => {
    button.classList.toggle("is-active", driveKeys[button.dataset.drive]);
  });
}

resetGame();

