(function () {
  "use strict";
  const ROOT = document.getElementById("digistracts-root");
  if (!ROOT || ROOT.dataset.booted) return;
  ROOT.dataset.booted = "1";

  const EMBED = /(?:\?|&)embed=1(?:&|$)/.test(location.search || "");
  if (EMBED) {
    document.documentElement.classList.add("dg-embed");
    document.body && document.body.classList.add("dg-embed");
  }
  function postParent(data) {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(data, "*");
    } catch (err) {}
  }

  const W = 800, H = 450;
  let GROUND = 390;
  const PREACHER_SRC = window.DG_PREACHER;
  const ROBOT_SRCS = window.DG_ROBOTS || [];
  const BACKGROUND_SRCS = window.DG_BACKGROUNDS || (window.DG_BACKGROUND ? [window.DG_BACKGROUND] : []);

  const canvas = ROOT.querySelector("#dg-canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const hud = {
    score: ROOT.querySelector("#dg-score"),
    lives: ROOT.querySelector("#dg-lives"),
    level: ROOT.querySelector("#dg-level"),
    time: ROOT.querySelector("#dg-time"),
    superJumps: ROOT.querySelector("#dg-super"),
    staff: ROOT.querySelector("#dg-gun"),
    msg: ROOT.querySelector("#dg-msg"),
    overlay: ROOT.querySelector("#dg-overlay"),
    title: ROOT.querySelector("#dg-title"),
    sub: ROOT.querySelector("#dg-sub"),
    startBtn: ROOT.querySelector("#dg-start"),
    vol: ROOT.querySelector("#dg-vol"),
    mute: ROOT.querySelector("#dg-mute"),
    fs: ROOT.querySelector("#dg-fs")
  };

  function loadImg(src) {
    const im = new Image();
    if (src && src.indexOf("data:") !== 0) im.crossOrigin = "anonymous";
    im.src = src || "";
    return im;
  }

  const imgs = { preacher: loadImg(PREACHER_SRC), backgrounds: [], robots: [] };
  BACKGROUND_SRCS.forEach(function (src) { imgs.backgrounds.push(loadImg(src)); });
  ROBOT_SRCS.forEach(function (src) { imgs.robots.push(loadImg(src)); });

  const keys = Object.create(null);
  const touch = { left: false, right: false, up: false, down: false, jump: false, shoot: false, jx: 0, jy: 0 };

  const MUSIC_URL = "https://opengameart.org/sites/default/files/technocade_0.mp3";
  const musicTrack = new Audio(MUSIC_URL);
  musicTrack.loop = true;
  musicTrack.preload = "auto";
  let audioCtx = null, masterGain = null, muted = false, volume = 0.35, musicOn = false;
  let lastSpaceTap = 0;

  function ensureAudio() {
    if (audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    masterGain.connect(audioCtx.destination);
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
    musicTrack.volume = muted ? 0 : volume;
  }

  function setMuted(m) {
    muted = m;
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
    musicTrack.muted = muted;
    musicTrack.volume = muted ? 0 : volume;
    hud.mute.textContent = muted ? "UNMUTE" : "MUTE";
    hud.mute.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  function beep(freq, dur, type, gain, when) {
    if (!audioCtx || muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(masterGain);
    const t = audioCtx.currentTime + (when || 0);
    g.gain.setValueAtTime(gain || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function deathBeep() {
    beep(220, 0.1, "sawtooth", 0.12, 0);
    beep(120, 0.2, "square", 0.11, 0.1);
    beep(55, 0.35, "triangle", 0.12, 0.24);
  }

  function stopMusic() {
    musicTrack.pause();
    musicOn = false;
  }

  function startTechno() {
    ensureAudio();
    stopMusic();
    musicOn = true;
    musicTrack.currentTime = 0;
    musicTrack.volume = muted ? 0 : volume;
    const trackPromise = musicTrack.play();
    if (trackPromise) {
      trackPromise.catch(function () {
        musicOn = false;
      });
    }
  }

  const LEVELS = [
    { name: "NEON DOCKS", ground: 425, len: 14500, enemyRate: 0.36, enemySpeed: 1.85, qrCount: 14, platforms: 44 },
    { name: "DATA TUNNEL", ground: 415, len: 15200, enemyRate: 0.28, enemySpeed: 2.35, qrCount: 16, platforms: 48 },
    { name: "MEGA SPIRE", ground: 418, len: 15800, enemyRate: 0.24, enemySpeed: 2.85, qrCount: 18, platforms: 52 },
    { name: "CIRCUIT SLUMS", ground: 395, len: 16400, enemyRate: 0.18, enemySpeed: 3.35, qrCount: 20, platforms: 56 },
    { name: "CORE SEWERS", ground: 438, len: 17000, enemyRate: 0.14, enemySpeed: 3.9, qrCount: 22, platforms: 60 }
  ];
  const TALES = [
    [{ who: "YOU", line: "New Eden rains neon lies." }, { who: "YOU", line: "Jonah is gone. Keep Ember lit." }],
    [{ who: "YOU", line: "Tunnels hide quiet arrests." }, { who: "YOU", line: "Trust the Flame's map." }],
    [{ who: "YOU", line: "Spire of Unity Core ahead." }, { who: "YOU", line: "Ember needs three gates." }],
    [{ who: "YOU", line: "Override sells false freedom." }, { who: "YOU", line: "Refuse the single throat." }],
    [{ who: "YOU", line: "Faith and code—walk both." }, { who: "YOU", line: "Or the Core owns us." }]
  ];
  const BOSS_GROUND = 424;

  const GUNP = ["#070d18", "#334155", "#7c8ea3", "#c3d0dd", "#2a1a10", "#7c4a21", "#c9a227", "#1c2636", "#0b8de0", "#e8b88a"];
  const GUN = [
    0, -14, -5, 12, 11, 5, -13, -4, 10, 9, 4, -13, 0, 10, 5, 6, -13, -4, 10, 1,
    2, -14, -5, 2, 11, 3, -14, -5, 2, 1,
    0, -6, 2, 8, 11, 1, -5, 3, 6, 9, 7, -5, 3, 6, 2, 3, -4, 4, 1, 3,
    0, -5, -8, 20, 16, 1, -4, -7, 18, 14, 2, -4, -7, 18, 2, 3, -4, -7, 18, 1,
    7, -4, 4, 18, 3, 7, -1, -3, 11, 6, 2, -1, -3, 11, 1, 8, 0, -1, 9, 2,
    3, -3, -5, 1, 1, 3, -3, 1, 1, 1, 3, 12, -5, 1, 1, 3, 12, 1, 1, 1,
    0, 1, -6, 2, 3, 0, 4, -6, 2, 3, 0, 7, -6, 2, 3,
    0, -2, -10, 12, 3, 2, -2, -10, 12, 1, 0, 3, -13, 4, 4, 3, 4, -13, 2, 3,
    0, 0, 6, 12, 8, 1, 1, 7, 10, 6, 10, 2, 8, 8, 4, 2, 0, 12, 12, 2, 3, 0, 12, 12, 1,
    0, 14, -6, 12, 12, 1, 14, -5, 11, 10, 3, 14, -5, 11, 2, 7, 14, 3, 11, 2,
    0, 17, -6, 1, 12, 0, 21, -6, 1, 12, 8, 15, -1, 9, 2,
    0, 25, -9, 6, 18, 1, 25, -8, 5, 5, 3, 25, -8, 5, 1, 1, 25, 3, 5, 5,
    2, 25, 7, 5, 1, 7, 25, -3, 5, 6, 10, 25, -2, 6, 4
  ];

  const PAL = [
    ["#07091a", "#00e5ff", "#ff2bd6"],
    ["#050d14", "#39ff14", "#00c2ff"],
    ["#100818", "#ffd400", "#ff4ecd"],
    ["#0a0a12", "#67e8f9", "#fb7185"],
    ["#0c0610", "#fbbf24", "#22d3ee"]
  ];

  let state = {
    mode: "title",
    level: 0,
    score: 0,
    lives: 3,
    camX: 0,
    player: null,
    bullets: [],
    enemies: [],
    qrs: [],
    staffs: [],
    holes: [],
    platforms: [],
    particles: [],
    spawnTimer: 0,
    endX: 3000,
    invuln: 0,
    flash: 0,
    messageTimer: 0,
    banner: "",
    antiCampCD: 0,
    levelTime: 120000,
    levelTick: 0,
    droneTimer: 0,
    bossMode: false,
    boss: null,
    bossPickups: [],
    playerHP: 0,
    failRespawnX: null,
    creditY: 0,
    creditDone: false,
    grace: 0,
    talkQ: null,
    talkI: 0,
    talkT: 0,
    failAt: 0
  };

  const CREDIT_LINES = ["DIGISTRACTS","by 8bitcrypto_44","","THANKS WEB3 COMMUNITY","OpenSea · Amazon","Technocade / Soundimage.org","","THANK YOU FOR PLAYING"];

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function isHoleAt(x) {
    return state.holes.some(function (h) { return x > h.x && x < h.x + h.w; });
  }

  function makePlayer() {
    return {
      x: 80, y: GROUND - 64, w: 32, h: 64,
      vx: 0, vy: 0, facing: 1, onGround: false,
      shootCD: 0, run: 0, crouch: false, platformCamp: 0,
      airSupers: 0, weapon: 0, beamFuel: 0, beamTick: 0, beaming: false, beamAim: 0, fireHeld: false,
      safeX: 80, speedT: 0, goldT: 0
    };
  }

  function addPlatform(x, y, w) {
    state.platforms.push({ x: x, y: y, w: w, h: 14 });
  }

  function endTalk() {
    state.talkQ = null;
    if (state.bossMode && state.boss) {
      state.boss.vulnerable = true;
      state.boss.timer = 40;
      state.invuln = 135;
      state.banner = "FIGHT! LOOT CACHE!";
      state.messageTimer = 110;
      beep(520, 0.1, "square", 0.08);
      beep(780, 0.12, "triangle", 0.07, 0.08);
    } else {
      state.banner = "GO! JUMP×2=SUPER";
      state.messageTimer = 90;
      state.invuln = 135;
      beep(660, 0.1, "square", 0.07);
    }
  }

  function tickTalk() {
    if (!state.talkQ) return false;
    state.levelTick = performance.now();
    state.talkT++;
    if (state.talkT >= 90) {
      state.talkT = 0;
      state.talkI++;
      if (state.talkI >= state.talkQ.length) endTalk();
    }
    return true;
  }

  function buildLevel(idx, skipTalk) {
    const L = LEVELS[idx];
    state.level = idx;
    GROUND = L.ground;
    state.endX = L.len;
    state.camX = 0;
    state.bullets = [];
    state.enemies = [];
    state.qrs = [];
    state.staffs = [];
    state.holes = [];
    state.bossMode = false;
    state.boss = null;
    state.bossPickups = [];
    state.playerHP = 0;
    state.platforms = [];
    state.particles = [];
    state.spawnTimer = 220;
    state.grace = skipTalk ? 120 : 0;
    state.invuln = 135;
    state.player = makePlayer();
    state.messageTimer = 100;
    state.banner = L.name + (skipTalk ? " · JUMP×2=SUPER" : "");
    state.antiCampCD = 0;
    state.levelTime = 135000;
    state.levelTick = performance.now();
    state.droneTimer = 280 + Math.random() * 80;
    state.flash = 0;
    if (skipTalk) {
      state.talkQ = null;
    } else {
      state.talkQ = TALES[idx];
      state.talkI = 0;
      state.talkT = 0;
    }

    const holeCount = 11 + idx * 4;
    for (let i = 0; i < holeCount; i++) {
      state.holes.push({
        x: 780 + i * ((L.len - 1600) / holeCount) + (i % 3) * 55,
        w: 105 + (i % 3) * 30
      });
    }
    const elevated = [];
    for (let i = 0; i < L.platforms; i++) {
      const x = 220 + i * ((L.len - 400) / L.platforms) + (i % 3) * 30;
      const y = GROUND - (70 + (i % 4) * 36 + ((i * 17) % 40));
      const w = 70 + (i % 3) * 28;
      addPlatform(x, y, w);
      elevated.push({ x: x, y: y, w: w });
    }
    const qrPlats = [], staffPlats = [];
    for (let i = 0; i < elevated.length; i++) {
      if (i % 3 === 0) qrPlats.push(elevated[i]);
      else if (i % 3 === 1) staffPlats.push(elevated[i]);
    }
    for (let i = 0; i < L.qrCount; i++) {
      const plat = qrPlats[i % qrPlats.length];
      state.qrs.push({
        x: plat.x + plat.w / 2 - 12, y: plat.y - 34,
        w: 24, h: 24, bob: i * 0.8, taken: false, power: 0
      });
    }
    const blueN = 1 + (idx % 2);
    for (let i = 0; i < blueN + 1; i++) {
      const plat = qrPlats[(qrPlats.length - 1 - i * 2 + qrPlats.length) % qrPlats.length];
      state.qrs.push({
        x: plat.x + plat.w / 2 - 12, y: plat.y - 36,
        w: 24, h: 24, bob: i + 2, taken: false, power: i === blueN ? "gold" : "speed"
      });
    }
    ["RIFLE", "SPREAD", "MAXI"].forEach(function (type, i) {
      const plat = staffPlats[i % staffPlats.length];
      state.staffs.push({
        x: plat.x + plat.w / 2 - 7, y: plat.y - 28,
        w: 14, h: 20, type: type, bob: i, taken: false
      });
    });
    for (let i = 0; i < 18 + idx * 7; i++) {
      spawnEnemy(1400 + i * 175 + Math.random() * 90, i % 4 === 0 || i % 6 === 0);
    }
  }

  // Distinct robot classes — sprite pools map into window.DG_ROBOTS order
  const ROLE_DEFS = {
    walker: { sprites: [0, 3, 6, 12], h: 58, spd: 1.05, hp: 2, score: 100, kind: 0 },
    gunner: { sprites: [4, 8, 10, 13], h: 62, spd: 0.58, hp: 3, score: 180, kind: 1, shoot: true },
    tank: { sprites: [2, 5, 11], h: 72, spd: 0.36, hp: 8, score: 320, kind: 2, shoot: true, heavy: true },
    dasher: { sprites: [1, 7], h: 56, spd: 0.92, hp: 2, score: 240, kind: 3, dash: true },
    flyer: { sprites: [0, 3, 9, 12], h: 54, spd: 1.2, hp: 3, score: 260, kind: 4, flying: true, shoot: true }
  };
  const ROLE_WEIGHTS = [
    { walker: 52, gunner: 28, tank: 5, dasher: 10, flyer: 5 },
    { walker: 38, gunner: 30, tank: 12, dasher: 12, flyer: 8 },
    { walker: 28, gunner: 30, tank: 16, dasher: 14, flyer: 12 },
    { walker: 20, gunner: 28, tank: 22, dasher: 16, flyer: 14 },
    { walker: 14, gunner: 26, tank: 26, dasher: 16, flyer: 18 }
  ];

  function pickRole(forceFlying) {
    if (forceFlying) return "flyer";
    const w = ROLE_WEIGHTS[Math.min(state.level, ROLE_WEIGHTS.length - 1)];
    let roll = Math.random() * (w.walker + w.gunner + w.tank + w.dasher + w.flyer);
    if ((roll -= w.walker) < 0) return "walker";
    if ((roll -= w.gunner) < 0) return "gunner";
    if ((roll -= w.tank) < 0) return "tank";
    if ((roll -= w.dasher) < 0) return "dasher";
    return "flyer";
  }

  function pickSprite(role) {
    const pool = ROLE_DEFS[role].sprites.filter(function (i) { return i < imgs.robots.length; });
    if (!pool.length) return Math.min(imgs.robots.length - 1, 0);
    return pool[(Math.random() * pool.length) | 0];
  }

  function spawnEnemy(x, forceFlying) {
    const L = LEVELS[state.level];
    const role = pickRole(forceFlying);
    const def = ROLE_DEFS[role];
    const type = pickSprite(role);
    const im = imgs.robots[type];
    const h = def.h;
    const w = im && im.complete && im.naturalWidth
      ? Math.max(24, Math.round(im.naturalWidth * (h / im.naturalHeight)))
      : Math.round(h * 0.55);
    const flying = !!def.flying;
    const baseY = 95 + Math.random() * 160;
    const hp = def.hp + Math.floor(state.level / 2) + (def.heavy ? Math.floor(state.level / 2) : 0);
    state.enemies.push({
      x: x, y: flying ? baseY : GROUND - h, w: w, h: h, type: type, kind: def.kind,
      role: role, vx: -L.enemySpeed * def.spd, baseSpd: L.enemySpeed * def.spd,
      vy: 0, hp: hp, maxHp: hp, scoreValue: def.score + state.level * 25,
      shootCD: 36 + Math.random() * 40, flash: 0, charge: 0, dashCD: 40 + Math.random() * 50,
      mode: "patrol", facing: -1, alive: true, bob: Math.random() * 20,
      walk: Math.random() * 6, flying: flying, baseY: baseY,
      heavy: !!def.heavy, canShoot: !!def.shoot, canDash: !!def.dash
    });
  }

  function spawnDrone() {
    const fromRight = Math.random() > 0.5;
    const spd = 1.7 + state.level * 0.25;
    state.enemies.push({
      x: state.camX + (fromRight ? W + 45 : 30), y: 38, w: 54, h: 30,
      vx: fromRight ? -spd : spd, vy: 0, hp: 2 + Math.floor(state.level / 2), maxHp: 2,
      shootCD: 28, facing: fromRight ? -1 : 1, alive: true, flash: 0,
      bob: Math.random() * 20, walk: 0, flying: true, drone: true,
      role: "drone", kind: 5, type: 0, baseY: 38, scoreValue: 150 + state.level * 20
    });
  }

  function enemyFire(e, p, opts) {
    opts = opts || {};
    const dir = p.x < e.x ? -1 : 1;
    const muzzle = { x: e.x + (dir < 0 ? 2 : e.w - 10), y: e.y + (opts.heavy ? 28 : 22) };
    const aimY = e.flying ? Math.max(-3.4, Math.min(3.4, (p.y + 25 - muzzle.y) / 50)) : (opts.arc || 0);
    const spd = opts.heavy ? 2.6 + state.level * 0.2 : 3.6 + state.level * 0.35;
    state.bullets.push({
      x: muzzle.x, y: muzzle.y, w: opts.heavy ? 14 : 9, h: opts.heavy ? 10 : 6,
      vx: dir * spd, vy: aimY, life: opts.heavy ? 110 : 90, from: "enemy",
      fire: !!opts.heavy, lime: opts.lime || 0
    });
    e.flash = 8;
    e.facing = dir;
    beep(opts.heavy ? 160 : 240, 0.05, "sawtooth", 0.045);
  }

  function gunPose(p, aim) {
    const a = aim < 0 ? -Math.PI / 2 : aim > 0 ? Math.PI / 2 : p.facing > 0 ? 0 : Math.PI;
    const shoulder = { x: p.x + p.w / 2 + (aim ? p.facing * 11 : 0), y: p.y + 21 };
    const reach = aim ? 6 : 11;
    const grip = { x: shoulder.x + Math.cos(a) * reach, y: shoulder.y + Math.sin(a) * reach };
    const len = aim > 0 ? 20 : 30;
    return { a: a, shoulder: shoulder, grip: grip, x: grip.x + Math.cos(a) * len, y: grip.y + Math.sin(a) * len };
  }

  function bossHand(b) {
    const p = state.player;
    const sx = b.x + (b.facing < 0 ? 14 : b.w - 14), sy = b.y + 48;
    const locked = b.mode === "laser" || b.mode === "laserCharge";
    const tx = locked ? b.laserAimX : (p ? p.x + p.w / 2 : (b.facing < 0 ? 0 : W));
    const ty = locked ? b.laserAimY : (p ? p.y + p.h / 2 : 280);
    const a = Math.atan2(ty - sy, tx - sx);
    return { sx: sx, sy: sy, a: a, x: sx + Math.cos(a) * 52, y: sy + Math.sin(a) * 52 };
  }

  function bossEye(b) {
    const p = state.player;
    const sx = b.x + (b.facing < 0 ? 10 : b.w - 10), sy = b.y + 24;
    const tx = p ? p.x + p.w / 2 : sx + b.facing * 80;
    const ty = p ? p.y + 22 : sy;
    const a = Math.atan2(ty - sy, tx - sx);
    return { x: sx + Math.cos(a) * 6, y: sy + Math.sin(a) * 5, a: a };
  }

  function bossFireEye(b) {
    const p = state.player;
    if (!p) return;
    const e = bossEye(b), spd = b.phase === 2 ? 5.2 : 3.8;
    const dx = p.x + p.w / 2 - e.x, dy = p.y + p.h / 2 - e.y;
    const len = Math.hypot(dx, dy) || 1;
    state.bullets.push({
      x: e.x - 8, y: e.y - 5, w: 16, h: 10,
      vx: dx / len * spd, vy: dy / len * spd,
      life: 100, from: "enemy", fire: true
    });
    beep(640, 0.08, "sawtooth", 0.07);
  }

  function shootGun(aim) {
    const p = state.player;
    if (!p || p.shootCD > 0) return;
    const tip = gunPose(p, aim);
    const rows = p.weapon === "MAXI" ? 8 : p.weapon === "SPREAD" ? 4 : p.weapon === "RIFLE" ? 1 : 0;
    if (rows) {
      p.shootCD = rows === 8 ? 12 : rows === 4 ? 10 : 8;
      const vertical = aim !== 0;
      const ox = tip.x, oy = tip.y;
      const targets = state.bossMode && state.boss ? state.enemies.concat([state.boss]) : state.enemies;
      for (let i = 0; i < targets.length; i++) {
        const e = targets[i];
        const dx = e.x + e.w / 2 - ox;
        const dy = e.y + e.h / 2 - oy;
        const ahead = vertical ? dy * aim >= 0 : dx * p.facing >= 0;
        const visible = e.x + e.w > state.camX - 20 && e.x < state.camX + W + 20;
        let hit = false;
        for (let r = 0; r < rows; r++) {
          const angle = (r - (rows - 1) / 2) * 0.085;
          if (vertical) {
            const rayX = ox + Math.abs(dy) * Math.tan(angle);
            if (rayX >= e.x - 3 && rayX <= e.x + e.w + 3) hit = true;
          } else {
            const rayY = oy + Math.abs(dx) * Math.tan(angle);
            if (rayY >= e.y - 3 && rayY <= e.y + e.h + 3) hit = true;
          }
        }
        if (e.alive && visible && ahead && hit) damageEnemy(e, rows === 8 ? 3 : 2, p.facing);
      }
      beep(rows === 8 ? 1500 : rows === 4 ? 1250 : 1050, 0.08, "sawtooth", 0.055);
      return;
    }
    p.shootCD = 10;
    for (let i = -1; i <= 1; i++) {
      if (aim) {
        state.bullets.push({ x: tip.x - 4 + i * 6, y: tip.y - 4, w: 6, h: 10, vx: i * 1.1, vy: aim * 11, life: 55, from: "player", slug: true });
      } else {
        state.bullets.push({ x: tip.x - (p.facing < 0 ? 10 : 0), y: tip.y - 2 + i * 5, w: 10, h: 4, vx: p.facing * 11, vy: i * 0.9, life: 80, from: "player", slug: true });
      }
    }
    beep(420, 0.05, "square", 0.07);
    beep(780, 0.04, "triangle", 0.04);
  }

  function explode(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      state.particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 1,
        life: 20 + Math.random() * 20,
        color: color
      });
    }
  }

  function damageEnemy(e, damage, dir) {
    if (e.boss) {
      if (!e.vulnerable || e.hitCD > 0) return;
      e.hitCD = 4;
      e.hp -= Math.max(1, damage | 0);
      state.score += 25;
      explode(e.x + e.w / 2, e.y + 35, "#39ff14", 5);
      beep(190, 0.05, "square", 0.06);
      if (e.hp <= 0) {
        e.alive = false;
        state.score += 5000;
        explode(e.x + e.w / 2, e.y + e.h / 2, "#00e5ff", 50);
        startCredits();
      }
      return;
    }
    e.hp -= damage;
    e.x += dir * (e.heavy ? 8 : 18);
    e.flash = 6;
    explode(e.x + e.w / 2, e.y + e.h / 2, e.heavy ? "#67e8f9" : "#00e5ff", e.heavy ? 8 : 6);
    beep(300, 0.05, "square", 0.05);
    if (e.hp <= 0) {
      e.alive = false;
      state.score += e.scoreValue || (100 + e.kind * 50);
      explode(e.x + e.w / 2, e.y + e.h / 2, "#ff2bd6", e.heavy ? 22 : 14);
      beep(180, 0.12, "triangle", 0.07);
    }
  }

  function startBoss() {
    const p = state.player;
    state.bossMode = true;
    GROUND = BOSS_GROUND;
    state.camX = 0;
    state.endX = W;
    state.levelTime = 135000;
    state.levelTick = performance.now();
    state.enemies = [];
    state.bullets = [];
    state.qrs = [];
    state.staffs = [];
    state.holes = [];
    state.platforms = [];
    addPlatform(130, GROUND - 290, 120);
    addPlatform(500, GROUND - 340, 120);
    state.playerHP = 3;
    state.grace = 0;
    p.x = 55; p.y = GROUND - p.h; p.vx = 0; p.vy = 0; p.safeX = 55;
    p.weapon = 0; p.beamFuel = 0; p.speedT = 0; p.goldT = 0;
    state.boss = {
      boss: true, alive: true, vulnerable: false, x: 620, y: GROUND - 112, w: 78, h: 112,
      hp: 120, maxHp: 120, hitCD: 0, mode: "idle", timer: 9999, vx: 0, vy: 0,
      facing: -1, laserAimX: 200, laserAimY: 280, slamX: 400, phase: 1, walk: 0, eyeCD: 0
    };
    state.bossPickups = [
      { x: 160, y: GROUND - 336, w: 32, h: 36, type: "health", taken: false, respawn: 0 },
      { x: 520, y: GROUND - 386, w: 36, h: 34, type: "weapon", taken: false, respawn: 0 }
    ];
    state.talkQ = [
      { who: "YOU", line: "Blue Sentinel—stand down!" },
      { who: "BOSS", line: "THE CORE IS OURS." },
      { who: "YOU", line: "Faith and code will free it." },
      { who: "BOSS", line: "THEN BE ERASED." }
    ];
    state.talkI = 0;
    state.talkT = 0;
    state.banner = "WAREHOUSE CORE";
    state.messageTimer = 100;
    state.invuln = 9999;
  }

  function hurtPlayer(respawnX) {
    if (state.invuln > 0 || state.mode !== "play") return;
    if (state.player && state.player.goldT > 0) return;
    const p = state.player;
    p.weapon = 0;
    p.beamFuel = 0;
    if (state.bossMode && state.playerHP > 1) {
      state.playerHP--;
      state.invuln = 100;
      state.flash = 14;
      p.vx = -p.facing * 4;
      beep(110, 0.2, "sawtooth", 0.1);
      explode(p.x + 14, p.y + 28, "#ffd400", 10);
      return;
    }
    const deathX = p.x;
    const deathY = p.y;
    state.lives = Math.max(0, state.lives - 1);
    state.flash = 18;
    deathBeep();
    explode(p.x + 14, p.y + 28, "#ffd400", 10);
    if (state.lives <= 0) {
      state.failRespawnX = respawnX != null ? respawnX : deathX;
      failTeam();
      return;
    }
    // Still have lives — instant respawn at death spot (pit falls use last safe X)
    if (respawnX != null && respawnX !== "time") {
      p.x = Math.max(40, respawnX);
      p.y = GROUND - p.h;
    } else {
      p.x = Math.max(40, deathX);
      p.y = deathY;
      if (p.y + p.h > GROUND) p.y = GROUND - p.h;
      if (p.y < 8) p.y = 8;
    }
    p.vx = 0;
    p.vy = 0;
    p.speedT = 0;
    p.goldT = 0;
    p.safeX = p.x;
    p.onGround = false;
    if (state.bossMode) state.playerHP = 3;
    state.invuln = 135; // brief i-frames
    state.banner = "RESPAWN — " + state.lives + " LEFT";
    state.messageTimer = 70;
    updateHUD();
  }

  function failTeam() {
    state.mode = "failed";
    state.failAt = performance.now() + 5000;
    showOverlay(
      "YOUR TEAM HAS FAILED",
      "No lives left.\nScore: " + state.score,
      "RETRY"
    );
    hud.startBtn.style.display = "none";
    stopMusic();
    updateHUD();
  }

  function continueAfterFail() {
    startGame();
  }

  function onTimeUp() {
    state.lives = Math.max(0, state.lives - 1);
    deathBeep();
    if (state.lives <= 0) {
      state.failRespawnX = "time";
      failTeam();
      return;
    }
    buildLevel(state.level, true);
    state.invuln = 135;
    state.banner = "TIME UP — " + state.lives + " LEFT";
    state.messageTimer = 90;
    updateHUD();
  }

  function startCredits() {
    state.mode = "credits";
    state.creditY = H + 24;
    state.creditDone = false;
    stopMusic();
    hideOverlay();
  }

  function missionDoneOverlay() {
    showOverlay("MISSION COMPLETE", "Warehouse core secure!\nFinal Score: " + state.score + "\nby 8bitcrypto_44", "PLAY AGAIN");
  }

  function updateCredits() {
    if (state.creditDone) return;
    state.creditY -= 0.7;
    if (state.creditY + CREDIT_LINES.length * 26 < 36) {
      state.creditDone = true;
      missionDoneOverlay();
    }
  }

  function drawCredits() {
    drawCity();
    ctx.fillStyle = "rgba(4,8,18,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    for (let i = 0; i < CREDIT_LINES.length; i++) {
      const line = CREDIT_LINES[i];
      const y = state.creditY + i * 26;
      if (!line || y < -24 || y > H + 24) continue;
      if (i === 0) { ctx.fillStyle = "#00e5ff"; ctx.font = "bold 28px monospace"; }
      else if (line.indexOf("THANKS") === 0) { ctx.fillStyle = "#ffd400"; ctx.font = "bold 15px monospace"; }
      else if (line.indexOf("THANK YOU") === 0) { ctx.fillStyle = "#39ff14"; ctx.font = "bold 18px monospace"; }
      else { ctx.fillStyle = "#dbe4f0"; ctx.font = "14px monospace"; }
      ctx.fillText(line, W / 2, y);
    }
      ctx.textAlign = "left";
  }

  function showOverlay(title, sub, btn) {
    hud.overlay.style.display = "flex";
    hud.title.textContent = title;
    hud.sub.textContent = sub;
    hud.startBtn.textContent = btn || "START";
    hud.startBtn.style.display = "";
    ROOT.classList.add("dg-menu");
    postParent({ type: "dg-chrome", inGame: false });
  }

  function hideOverlay() {
    hud.overlay.style.display = "none";
    ROOT.classList.remove("dg-menu");
    fit();
  }

  function startGame() {
    ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    state.score = 0;
    state.lives = 3;
    state.level = 0;
    hideOverlay();
    state.mode = "play";
    buildLevel(state.level);
    startTechno();
    updateHUD();
    postParent({ type: "dg-chrome", inGame: true });
    // Mobile: jump into fullscreen as soon as play starts
    if (wantsTouchUI()) {
      enterFullscreen();
      setTimeout(fit, 100);
      setTimeout(fit, 300);
    }
  }

  function advanceFromClear() {
    if (state.level >= LEVELS.length - 1) {
      startCredits();
      return;
    }
    state.level += 1;
    hideOverlay();
    state.mode = "play";
    buildLevel(state.level);
    if (!musicOn) startTechno();
    updateHUD();
  }

  function onLevelComplete() {
    const leftover = state.qrs.filter(function (q) { return !q.taken; }).length;
    state.score += Math.max(0, 500 - leftover * 20) + Math.ceil(state.levelTime / 1000) * 10;
    if (state.level >= LEVELS.length - 1) {
      startCredits();
    } else {
      state.mode = "clear";
      showOverlay("SECTOR CLEAR", LEVELS[state.level].name + " complete!\nScore: " + state.score + "\nPress START for next sector", "NEXT LEVEL");
    }
  }

  function updateBoss() {
    const b = state.boss, p = state.player;
    if (!b || !b.alive || !p) return;
    b.phase = b.hp <= b.maxHp / 2 ? 2 : 1;
    if (b.hitCD > 0) b.hitCD--;
    if (b.eyeCD > 0) b.eyeCD--;
    b.facing = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
    b.walk += b.mode === "jump" || b.mode === "skySlam" ? 0.28 : 0.2;

    if (tickTalk()) return;

    for (let i = 0; i < state.bossPickups.length; i++) {
      const q = state.bossPickups[i];
      if (q.taken) {
        if (q.respawn > 0) q.respawn--;
        if (q.respawn <= 0) q.taken = false;
        continue;
      }
      if (!rectsOverlap(p, q)) continue;
      q.taken = true;
      q.respawn = 600;
      if (q.type === "health") {
        state.playerHP = 4;
        state.banner = "ENERGY SHIELD: 4 HITS!";
      } else {
        p.weapon = "MAXI";
        p.beamFuel = 12000;
        p.beamTick = 0;
        state.banner = "MAXI GUN: 12 SECONDS!";
      }
      state.messageTimer = 80;
      beep(q.type === "health" ? 760 : 1400, 0.18, "square", 0.08);
    }
    const busy = b.mode === "jump" || b.mode === "jumpCharge" || b.mode === "laser" || b.mode === "laserCharge"
      || b.mode === "skyRise" || b.mode === "skyHold" || b.mode === "skySlam";
    if (!busy) {
      const spd = b.phase === 2 ? 2.6 : 1.9;
      const pc = p.x + p.w / 2, bc = b.x + b.w / 2;
      const side = bc >= pc ? 1 : -1;
      if (Math.abs(bc - pc) < 150) b.x += side * spd * 1.5;
      else {
        const want = pc + side * 220;
        if (Math.abs(b.x + b.w / 2 - want) > 12) b.x += Math.sign(want - (b.x + b.w / 2)) * spd;
        else b.x += Math.sin(b.walk * 0.75) * spd * 0.55;
      }
      b.x = Math.max(36, Math.min(W - b.w - 16, b.x));
    }
    if ((b.mode === "idle" || b.mode === "laser") && b.eyeCD <= 0) {
      bossFireEye(b);
      b.eyeCD = b.phase === 2 ? 42 : 64;
    }
    b.timer--;
    if (b.mode === "idle" && b.timer <= 0) {
      b.vulnerable = false;
      const roll = Math.random();
      if (roll < 0.3) {
        b.mode = "laserCharge";
        b.laserAimX = p.x + p.w / 2;
        b.laserAimY = p.y + p.h / 2;
        b.timer = b.phase === 2 ? 26 : 38;
        beep(420, 0.3, "sawtooth", 0.05);
      } else if (roll < 0.52) {
        b.mode = "eyeCharge";
        b.timer = b.phase === 2 ? 20 : 30;
        beep(700, 0.16, "square", 0.06);
      } else if (roll < 0.82) {
        b.mode = "skyRise";
        b.timer = 50;
        b.vx = 0;
        b.vy = -8.5;
        beep(180, 0.14, "square", 0.07);
      } else {
        b.mode = "jumpCharge";
        b.timer = b.phase === 2 ? 18 : 28;
      }
    } else if (b.mode === "laserCharge" && b.timer <= 0) {
      b.mode = "laser";
      b.timer = b.phase === 2 ? 34 : 26;
      beep(980, 0.35, "sawtooth", 0.09);
    } else if (b.mode === "laser") {
      const h = bossHand(b), dx = Math.cos(h.a) * 900, dy = Math.sin(h.a) * 900;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const t = Math.max(0, Math.min(1, ((cx - h.x) * dx + (cy - h.y) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(cx - h.x - t * dx, cy - h.y - t * dy) < 24) hurtPlayer();
      if (b.timer <= 0) {
        b.mode = "recover"; b.timer = b.phase === 2 ? 28 : 44; b.vulnerable = true;
      }
    } else if (b.mode === "eyeCharge" && b.timer <= 0) {
      b.mode = "eyeFire";
      b.timer = b.phase === 2 ? 36 : 28;
      b.eyeCD = 0;
    } else if (b.mode === "eyeFire") {
      if (b.eyeCD <= 0) {
        bossFireEye(b);
        b.eyeCD = b.phase === 2 ? 14 : 18;
      }
      if (b.timer <= 0) {
        b.mode = "recover"; b.timer = b.phase === 2 ? 26 : 40; b.vulnerable = true;
      }
    } else if (b.mode === "skyRise") {
      b.y += b.vy;
      if (b.y <= 10) {
        b.y = 10;
        b.vy = 0;
        b.mode = "skyHold";
        b.timer = b.phase === 2 ? 32 : 44;
        b.slamX = Math.max(30, Math.min(W - b.w - 30, p.x + p.w / 2 - b.w / 2));
        beep(520, 0.12, "triangle", 0.06);
      }
    } else if (b.mode === "skyHold" && b.timer <= 0) {
      b.mode = "skySlam";
      b.timer = 50;
      beep(140, 0.16, "sawtooth", 0.08);
    } else if (b.mode === "skySlam") {
      b.x += (b.slamX - b.x) * 0.42;
      b.vy = 16;
      b.y += b.vy;
      if (b.y + b.h >= GROUND) {
        b.y = GROUND - b.h;
        b.x = b.slamX;
        b.vx = 0;
        b.vy = 0;
        if (Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 58) hurtPlayer();
        state.flash = 10;
        explode(b.x + b.w / 2, GROUND - 4, "#ff7a12", 22);
        beep(70, 0.22, "square", 0.1);
        b.mode = "recover";
        b.timer = b.phase === 2 ? 26 : 40;
        b.vulnerable = true;
      }
    } else if (b.mode === "jumpCharge" && b.timer <= 0) {
      b.mode = "jump";
      b.vy = b.phase === 2 ? -10.4 : -9.2;
      b.vx = b.facing * (b.phase === 2 ? 6.2 : 4.8);
      beep(150, 0.12, "square", 0.08);
    } else if (b.mode === "jump") {
      b.x += b.vx; b.y += b.vy; b.vy += 0.5;
      b.x = Math.max(36, Math.min(W - b.w - 16, b.x));
      if (b.eyeCD <= 0) { bossFireEye(b); b.eyeCD = b.phase === 2 ? 18 : 26; }
      if (b.y + b.h >= GROUND) {
        b.y = GROUND - b.h; b.vx = 0; b.vy = 0;
        b.mode = "recover"; b.timer = b.phase === 2 ? 26 : 42; b.vulnerable = true;
        state.flash = 6;
        beep(80, 0.18, "square", 0.09);
      }
    } else if (b.mode === "recover" && b.timer <= 0) {
      b.mode = "idle";
      b.timer = b.phase === 2 ? 24 : 40;
      b.vulnerable = true;
    }
    if (rectsOverlap({ x: p.x + 5, y: p.y + 5, w: p.w - 10, h: p.h - 5 }, b) && !state.talkQ) hurtPlayer();
  }

  function updateHUD() {
    hud.score.textContent = String(state.score).padStart(6, "0");
    hud.lives.textContent = "♥".repeat(Math.max(0, state.lives)) || "—";
    hud.level.textContent = "LV " + (state.level + 1);
    hud.time.textContent = Math.max(0, Math.ceil(state.levelTime / 1000));
    hud.superJumps.textContent = state.player ? Math.max(0, 2 - state.player.airSupers) : 2;
    hud.staff.textContent = !state.player ? "PISTOL"
      : state.player.goldT > 0 ? "GOLD " + Math.ceil(state.player.goldT / 60) + "s"
      : state.player.speedT > 0 ? "SPD " + Math.ceil(state.player.speedT / 60) + "s"
      : state.player.weapon ? state.player.weapon + " " + Math.ceil(state.player.beamFuel / 1000) + "s" : "PISTOL";
    if (state.messageTimer > 0) {
      hud.msg.textContent = state.banner || LEVELS[state.level].name;
      hud.msg.style.opacity = "1";
    } else {
      hud.msg.style.opacity = "0";
    }
  }

  function inputX() {
    if (Math.abs(touch.jx) > 0.22) return touch.jx > 0 ? 1 : -1;
    let x = 0;
    if (keys.ArrowLeft || keys.a || keys.A || touch.left) x -= 1;
    if (keys.ArrowRight || keys.d || keys.D || touch.right) x += 1;
    return x;
  }
  function inputJump() {
    return !!(keys[" "] || touch.jump);
  }
  function inputUp() {
    return !!(keys.ArrowUp || keys.w || keys.W || touch.up || touch.jy < -0.45);
  }
  function inputDown() {
    return !!(keys.ArrowDown || keys.s || keys.S || touch.down || touch.jy > 0.45);
  }
  function inputShoot() {
    return !!(keys.z || keys.Z || keys.x || keys.X || keys.Control || keys.Enter || keys.j || keys.J || touch.shoot);
  }

  function superJump() {
    if (!state.player || state.mode !== "play") return;
    if (state.player.airSupers >= 2) {
      state.banner = "NO SUPER JUMPS";
      state.messageTimer = 35;
      beep(110, 0.1, "square", 0.05);
      return;
    }
    state.player.airSupers++;
    state.player.vy = -13.5;
    state.player.onGround = false;
    state.invuln = Math.max(state.invuln, 20);
    explode(state.player.x + state.player.w / 2, state.player.y + state.player.h, "#00e5ff", 18);
    beep(760, 0.08, "square", 0.07);
    beep(1140, 0.15, "triangle", 0.06);
    state.banner = "SUPER JUMP!";
    state.messageTimer = 35;
  }

  function landOnPlatform(p, prevBottom) {
    // One-way platforms: land only when falling onto the top edge.
    for (let i = 0; i < state.platforms.length; i++) {
      const plat = state.platforms[i];
      const overX = p.x + p.w > plat.x + 2 && p.x < plat.x + plat.w - 2;
      if (!overX) continue;
      const onTop = prevBottom <= plat.y + 2 && p.y + p.h >= plat.y;
      if (onTop) {
        p.y = plat.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p.airSupers = 0;
        return true;
      }
    }
    return false;
  }

  function updatePlay() {
    const p = state.player;
    const L = LEVELS[state.level];
    const levelNow = performance.now();
    if (!state.bossMode) tickTalk();
    const calm = state.grace > 0 || !!state.talkQ;
    if (calm) {
      state.levelTick = levelNow;
      if (state.grace > 0) {
        state.grace--;
        if (state.grace === 0 && !state.talkQ) {
          state.banner = "GO! JUMP×2=SUPER";
          state.messageTimer = 90;
          beep(660, 0.1, "square", 0.07);
        }
      }
    } else {
      state.levelTime -= Math.min(100, levelNow - state.levelTick);
      state.levelTick = levelNow;
      if (state.levelTime <= 0) {
        state.levelTime = 0;
        onTimeUp();
        updateHUD();
        return;
      }
    }
    const ix = inputX();
    p.vx = ix * (p.speedT > 0 ? 6.6 : 3.2);
    if (p.speedT > 0) p.speedT--;
    if (p.goldT > 0) p.goldT--;
    p.aimUp = inputUp();
    p.crouch = inputDown();
    if (ix) p.facing = ix > 0 ? 1 : -1;
    if (ix) p.run += 0.25; else p.run = 0;

    if (inputJump() && p.onGround && !state.talkQ) {
      p.vy = -8.6;
      p.onGround = false;
      beep(520, 0.06, "triangle", 0.05);
    }

    p.vy += 0.42;
    if (p.vy > 12) p.vy = 12;

    p.x += p.vx;
    if (p.x < 0) p.x = 0;
    if (p.x > state.endX - 40) p.x = state.endX - 40;

    const prevBottom = p.y + p.h;
    p.y += p.vy;
    p.onGround = false;
    if (p.vy >= 0) {
      landOnPlatform(p, prevBottom);
    }
    // Hard floor safety
    if (p.y + p.h > GROUND && !isHoleAt(p.x + p.w / 2)) {
      p.y = GROUND - p.h;
      p.vy = 0;
      p.onGround = true;
      p.airSupers = 0;
    }
    if (p.onGround && !isHoleAt(p.x + p.w / 2)) p.safeX = p.x;
    const campingHigh = p.onGround && p.y + p.h < GROUND - 2;
    p.platformCamp = campingHigh ? p.platformCamp + 1 : 0;
    if (state.antiCampCD > 0) state.antiCampCD--;
    if (!calm && p.platformCamp > 75 && state.antiCampCD <= 0) {
      const hunters = state.enemies.filter(function (e) { return e.alive && e.hunter; }).length;
      if (hunters < 2) {
        const groundBots = state.enemies.filter(function (e) { return e.alive && !e.flying; });
        groundBots.sort(function (a, b) { return Math.abs(a.x - p.x) - Math.abs(b.x - p.x); });
        if (groundBots.length) {
          const hunter = groundBots[0];
          hunter.flying = true;
          hunter.hunter = true;
          hunter.role = "flyer";
          hunter.canShoot = true;
          hunter.baseY = hunter.y;
          hunter.hp += 1;
          hunter.shootCD = 22;
          state.antiCampCD = 200;
          explode(hunter.x + hunter.w / 2, hunter.y + hunter.h, "#00e5ff", 12);
        }
      }
    }

    if (p.y > H + 80) hurtPlayer(p.safeX);

    const firing = inputShoot();
    const firePressed = firing && !p.fireHeld;
    p.fireHeld = firing;
    p.beamAim = p.aimUp ? -1 : p.crouch ? 1 : 0;
    p.beaming = !state.talkQ && !!p.weapon && firing && p.beamFuel > 0;
    if (p.beaming) {
      const now = performance.now();
      p.beamFuel -= p.beamTick ? Math.min(50, now - p.beamTick) : 0;
      p.beamTick = now;
      shootGun(p.beamAim);
      if (p.beamFuel <= 0) {
        p.weapon = 0;
        p.beaming = false;
        state.banner = "SPECIAL GUN EMPTY!";
        state.messageTimer = 55;
      }
    } else if (!state.talkQ && !p.weapon && firePressed) {
      p.beamTick = 0;
      shootGun(p.beamAim);
    } else {
      p.beamTick = 0;
    }
    if (state.talkQ && (firePressed || inputJump())) state.talkT = 89;
    if (p.shootCD > 0) p.shootCD--;
    if (state.invuln > 0) state.invuln--;
    if (state.flash > 0) state.flash--;
    if (state.messageTimer > 0) state.messageTimer--;

    state.camX = Math.max(0, Math.min(state.endX - W, p.x - 180));

    if (state.bossMode) {
      updateBoss();
    } else if (!calm) {
      state.spawnTimer--;
      if (state.spawnTimer <= 0) {
        state.spawnTimer = 62 * L.enemyRate + Math.random() * 36;
        const x = state.camX + W + 40 + Math.random() * 120;
        if (x < state.endX - 120) spawnEnemy(x);
      }
      state.droneTimer--;
      if (state.droneTimer <= 0) {
        spawnDrone();
        state.droneTimer = Math.max(90, 240 - state.level * 40) + Math.random() * 80;
      }
    }

    for (let i = 0; i < state.bullets.length; i++) {
      const b = state.bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
    }
    state.bullets = state.bullets.filter(function (b) {
      return b.life > 0 && b.x > state.camX - 40 && b.x < state.camX + W + 40;
    });

    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.alive) continue;
      e.bob += 0.1;
      if (e.flash > 0) e.flash--;
      if (calm) continue;
      e.walk += Math.abs(e.vx || e.baseSpd || 1) * (e.flying ? 0.18 : 0.32);
      const dx = p.x - e.x;
      const dist = Math.abs(dx);

      if (e.drone) {
        e.vx = (p.x < e.x ? -1 : 1) * (1.8 + state.level * 0.25);
      } else if (e.hunter) {
        e.vx = (p.x < e.x ? -1 : 1) * (1.3 + state.level * 0.14);
      } else if (e.role === "dasher" && !e.flying) {
        if (e.dashCD > 0) e.dashCD--;
        if (e.mode === "patrol") {
          e.vx = -e.baseSpd;
          if (dist < 220 && dist > 40 && e.dashCD <= 0 && p.y + p.h > GROUND - 20) {
            e.mode = "telegraph";
            e.charge = 22;
            e.vx = 0;
            e.facing = dx < 0 ? -1 : 1;
            beep(520, 0.08, "square", 0.05);
          }
        } else if (e.mode === "telegraph") {
          e.vx = 0;
          e.charge--;
          e.flash = 4;
          if (e.charge <= 0) {
            e.mode = "dash";
            e.charge = 28;
            e.vx = e.facing * (6.2 + state.level * 0.35);
            beep(180, 0.1, "sawtooth", 0.06);
          }
        } else if (e.mode === "dash") {
          e.charge--;
          if (e.charge <= 0) {
            e.mode = "recover";
            e.charge = 36;
            e.vx = 0;
            e.dashCD = 90;
          }
        } else if (e.mode === "recover") {
          e.vx = 0;
          e.charge--;
          if (e.charge <= 0) e.mode = "patrol";
        }
      } else if (e.role === "gunner" && !e.flying) {
        e.facing = dx < 0 ? -1 : 1;
        if (dist < 90) e.vx = (dx < 0 ? 1 : -1) * e.baseSpd * 0.85;
        else if (dist < 280) e.vx = 0;
        else e.vx = -e.baseSpd;
      } else if (e.role === "tank" && !e.flying) {
        e.facing = dx < 0 ? -1 : 1;
        e.vx = (dx < 0 ? -1 : 1) * e.baseSpd * 0.7;
      } else if (e.role === "flyer" || e.flying) {
        e.vx = (dx < 0 ? -1 : 1) * e.baseSpd;
      }

      e.x += e.vx;
      if (e.flying) {
        if (e.drone) {
          const dive = (p.y - 95 - e.y) * 0.025;
          const droneDive = 1.6 + state.level * 0.15;
          e.y += Math.max(-droneDive, Math.min(droneDive, dive)) + Math.sin(e.bob) * 0.4;
        } else if (e.hunter) {
          const rise = (p.y + 8 - e.y) * 0.06;
          e.y += Math.max(-2.2, Math.min(2.2, rise));
        } else {
          const target = Math.max(70, Math.min(GROUND - 120, e.baseY + Math.sin(e.bob) * 22));
          const chaseY = p.y + 10;
          e.y += Math.max(-1.8, Math.min(1.8, (chaseY * 0.35 + target * 0.65 - e.y) * 0.05));
        }
      } else {
        if (e.falling || isHoleAt(e.x + e.w / 2)) {
          e.falling = true;
          e.vy += 0.4;
          e.y += e.vy;
          if (e.y > H + 40) e.alive = false;
        } else {
          if (e.role === "dasher" && e.mode === "patrol" && e.vy === 0 && Math.random() < 0.008) e.vy = -6.5;
          if (e.vy !== 0) {
            e.vy += 0.4;
            e.y += e.vy;
            if (e.y >= GROUND - e.h) { e.y = GROUND - e.h; e.vy = 0; }
          } else {
            e.y = GROUND - e.h;
          }
        }
      }
      if (!(e.role === "dasher" && (e.mode === "telegraph" || e.mode === "dash" || e.mode === "recover"))) {
        if (e.vx) e.facing = e.vx < 0 ? -1 : 1;
      }

      if (e.drone) {
        e.shootCD--;
        if (e.shootCD <= 0 && dist < 420) {
          e.shootCD = Math.max(26, 48 - state.level * 4);
          const cx = e.x + e.w / 2, cy = e.y + e.h - 2;
          [[0, 7.2, cx - 2, cy, 5, 16], [-7.4, 0, e.x - 12, e.y + 11, 16, 5], [7.4, 0, e.x + e.w - 4, e.y + 11, 16, 5]].forEach(function (d) {
            state.bullets.push({ x: d[2], y: d[3], w: d[4], h: d[5], vx: d[0], vy: d[1], life: 80, from: "enemy", lime: 1 });
          });
          e.flash = 6;
          beep(980, 0.04, "square", 0.045);
        }
      } else if (e.canShoot || e.hunter) {
        e.shootCD--;
        const range = e.role === "tank" ? 400 : e.flying ? 380 : 320;
        const ready = e.role === "gunner" ? (e.vx === 0 || dist < 280) : true;
        if (e.shootCD <= 0 && dist < range && ready) {
          e.shootCD = e.role === "tank"
            ? Math.max(40, 78 - state.level * 5)
            : e.role === "gunner"
              ? Math.max(22, 42 - state.level * 4)
              : Math.max(24, 50 - state.level * 5);
          enemyFire(e, p, { heavy: e.role === "tank", arc: e.role === "tank" ? -0.4 : 0 });
        }
      }
      if (rectsOverlap({ x: p.x + 6, y: p.y + 8, w: p.w - 12, h: p.h - 10 }, e) && state.invuln <= 0) hurtPlayer();
    }

    for (let i = 0; i < state.bullets.length; i++) {
      const b = state.bullets[i];
      if (b.from === "player") {
        for (let j = 0; j < state.enemies.length; j++) {
          const e = state.enemies[j];
          if (!e.alive) continue;
          if (rectsOverlap({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, e)) {
            b.life = 0;
            damageEnemy(e, 1, Math.sign(b.vx));
          }
        }
        if (state.bossMode && state.boss && state.boss.alive && rectsOverlap({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, state.boss)) {
          b.life = 0;
          damageEnemy(state.boss, 1, Math.sign(b.vx));
        }
      } else if (b.from === "enemy" && rectsOverlap(b, p)) {
        b.life = 0;
        hurtPlayer();
      }
    }
    state.enemies = state.enemies.filter(function (e) { return e.alive && e.x > state.camX - 100; });

    for (let i = 0; i < state.qrs.length; i++) {
      const q = state.qrs[i];
      if (q.taken) continue;
      q.bob += 0.12;
      const hit = { x: q.x, y: q.y + Math.sin(q.bob) * 5, w: q.w, h: q.h };
      if (rectsOverlap(p, hit)) {
        q.taken = true;
        state.score += q.power === "gold" ? 500 : q.power === "speed" ? 400 : 250;
        if (q.power === "speed") {
          p.speedT = 300;
          state.banner = "SPEED BOOST 5s!";
          state.messageTimer = 70;
          beep(1200, 0.1, "square", 0.07);
        } else if (q.power === "gold") {
          p.goldT = 300;
          state.banner = "INVINCIBLE 5s!";
          state.messageTimer = 70;
          beep(700, 0.12, "triangle", 0.08);
        } else {
          beep(990, 0.08, "square", 0.06);
        }
        explode(q.x + 8, q.y + 8, q.power === "gold" ? "#ffd400" : q.power === "speed" ? "#3b82f6" : "#39ff14", 12);
      }
    }
    for (let i = 0; i < state.staffs.length; i++) {
      const s = state.staffs[i];
      if (s.taken) continue;
      s.bob += 0.1;
      const hit = { x: s.x, y: s.y + Math.sin(s.bob) * 3, w: s.w, h: s.h };
      if (rectsOverlap(p, hit)) {
        s.taken = true;
        p.weapon = s.type;
        p.beamFuel = 5000;
        p.beamTick = 0;
        state.score += 100;
        state.banner = s.type + " GUN!";
        state.messageTimer = 55;
        beep(s.type === "MAXI" ? 1400 : s.type === "SPREAD" ? 1100 : 900, 0.15, "square", 0.07);
      }
    }

    for (let i = 0; i < state.particles.length; i++) {
      const pt = state.particles[i];
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.15; pt.life--;
    }
    state.particles = state.particles.filter(function (pt) { return pt.life > 0; });

    if (!state.bossMode && p.x + p.w >= state.endX - 65) {
      if (state.level === LEVELS.length - 1) startBoss(); else onLevelComplete();
      updateHUD();
      return;
    }
    updateHUD();
  }

  function drawCity() {
    const pal = PAL[Math.min(state.level, 4)];
    const bi = state.bossMode ? Math.min(5, imgs.backgrounds.length - 1) : Math.min(state.level, imgs.backgrounds.length - 1);
    const bg = imgs.backgrounds[bi];
    if (bg && bg.complete && bg.naturalWidth) {
      const iw = bg.naturalWidth, ih = bg.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = pal[2];
      ctx.globalAlpha = 0.02 + state.level * 0.01;
      ctx.fillRect(0, 0, W, GROUND);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = pal[0];
      ctx.fillRect(0, 0, W, H);
    }
    // Keep BG street visible — light tint only below feet line
    ctx.fillStyle = "#020617";
    ctx.globalAlpha = 0.28;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal[1];
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, GROUND, W, 3);
    ctx.globalAlpha = 1;
  }

  function drawPlatforms() {
    for (let i = 0; i < state.platforms.length; i++) {
      const p = state.platforms[i];
      if (p.y >= GROUND) continue;
      const x = p.x - state.camX;
      if (x + p.w < 0 || x > W) continue;
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(x, p.y, p.w, p.h);
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(x, p.y, p.w, 3);
      ctx.fillStyle = "#f472b6";
      ctx.fillRect(x, p.y + p.h - 2, p.w, 2);
    }
    const start = Math.floor(state.camX / 32) * 32;
    for (let x = start; x < state.camX + W + 32; x += 32) {
      const sx = x - state.camX;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = (Math.floor(x / 32) % 2) ? "#111827" : "#0f172a";
      ctx.fillRect(sx, GROUND, 32, H - GROUND);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#67e8f9";
      ctx.fillRect(sx, GROUND, 32, 2);
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < state.holes.length; i++) {
      const h = state.holes[i];
      const left = h.x - state.camX;
      const right = h.x + h.w - state.camX;
      if (right < -20 || left > W + 20) continue;
      ctx.fillStyle = "#02040c";
      ctx.fillRect(left, GROUND, h.w, H - GROUND);
      ctx.fillStyle = "#475569";
      ctx.fillRect(left - 7, GROUND, 7, H - GROUND);
      ctx.fillRect(right, GROUND, 7, H - GROUND);
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(left - 3, GROUND, 3, 34);
      ctx.fillRect(right, GROUND, 3, 34);
    }
  }

  function drawSprite(img, x, y, flip, scaleH) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const h = scaleH || img.height;
    const w = Math.round(img.width * (h / img.height));
    ctx.save();
    if (flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.restore();
  }

  function drawRobot(e, x) {
    const img = imgs.robots[e.type];
    if (!img || !img.complete || !img.naturalWidth) return;
    const w = e.w, h = e.h;
    const bob = e.flying ? Math.sin(e.walk) * 2.5 : Math.abs(Math.sin(e.walk)) * 1.8;
    const lean = e.mode === "dash" ? e.facing * 0.14 : e.mode === "telegraph" ? -e.facing * 0.08 : 0;
    ctx.save();
    ctx.translate(x + w / 2, e.y + bob + h / 2);
    ctx.rotate(lean);
    ctx.scale(e.facing > 0 ? -1 : 1, 1);

    if (e.mode === "telegraph" || e.mode === "dash") {
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = e.mode === "dash" ? "#ff2b2b" : "#ffd400";
      ctx.fillRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8);
      ctx.globalAlpha = 1;
    }
    if (e.heavy) {
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 12;
    }
    if (e.flash > 0) ctx.globalAlpha = 0.55 + (e.flash % 2) * 0.35;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (e.flying) {
      ctx.fillStyle = "#67e8f9";
      ctx.fillRect(-w * 0.26, h / 2 - 2, 4, 8 + Math.sin(e.walk) * 3);
      ctx.fillRect(w * 0.16, h / 2 - 2, 4, 8 - Math.sin(e.walk) * 3);
      ctx.fillStyle = "#ff2bd6";
      ctx.fillRect(-w * 0.23, h / 2 + 5, 2, 5);
      ctx.fillRect(w * 0.19, h / 2 + 5, 2, 5);
    }
    if (e.flash > 0 && e.canShoot) {
      ctx.fillStyle = "#fff7ad";
      ctx.fillRect(w / 2 - 12, -8, 12, 7);
      ctx.fillStyle = "#ff7a12";
      ctx.fillRect(w / 2 - 10, -6, 8, 4);
    }
    if (e.heavy && e.maxHp) {
      const pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = "#03101e";
      ctx.fillRect(-w / 2 + 4, -h / 2 - 10, w - 8, 5);
      ctx.fillStyle = pct > 0.45 ? "#00e5ff" : "#ff2bd6";
      ctx.fillRect(-w / 2 + 4, -h / 2 - 10, (w - 8) * pct, 5);
    }
    ctx.restore();
  }

  function drawDrone(e, x) {
    const spin = Math.sin(e.walk * 3) * 6;
    ctx.save();
    ctx.translate(x, e.y);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(3 - spin, 1, 20 + spin * 2, 4);
    ctx.fillRect(31 - spin, 1, 20 + spin * 2, 4);
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(6 - spin, 2, 14 + spin * 2, 2);
    ctx.fillRect(34 - spin, 2, 14 + spin * 2, 2);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(7, 5, 40, 6);
    ctx.fillRect(16, 10, 22, 12);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(10, 7, 34, 3);
    ctx.fillStyle = "#0891b2";
    ctx.fillRect(19, 11, 16, 9);
    ctx.fillStyle = "#05070f";
    ctx.fillRect(22, 18, 10, 10);
    ctx.fillStyle = "#67e8f9";
    ctx.fillRect(25, 21, 4, 4);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(10, 18, 4, 10);
    ctx.fillRect(40, 18, 4, 10);
    ctx.restore();
  }

  function drawBoss(b) {
    const sx = b.x - state.camX, sy = b.y, f = b.facing < 0 ? -1 : 1;
    const active = b.mode === "laser" || b.mode === "laserCharge";
    const eyeOn = b.mode === "eyeFire" || b.mode === "eyeCharge";
    const step = Math.sin(b.walk) * 0.3, jump = b.mode === "jump" || b.mode === "skySlam" ? 0.55 : b.mode === "jumpCharge" || b.mode === "skyHold" || b.mode === "skyRise" ? 0.32 : 0;
    const core = b.phase === 2 ? "#39ff14" : "#00e5ff";
    const pulse = 0.5 + Math.sin(performance.now() / (b.phase === 2 ? 80 : 140)) * 0.32;
    const p = state.player;
    const aimTx = active ? b.laserAimX : (p ? p.x + 14 : b.x);
    const aimTy = active ? b.laserAimY : (p ? p.y + 22 : sy + 46);
    const aimA = Math.atan2(aimTy - (sy + 46), Math.abs(aimTx - (b.x + 39)));
    function box(c, x0, y0, w, h) { ctx.fillStyle = c; ctx.fillRect(x0, y0, w, h); }
    function lit(c, x0, y0, w, h, a) { ctx.globalAlpha = a; box(c, x0, y0, w, h); ctx.globalAlpha = 1; }
    function limb(lx, ly, len, wide, a, c, dark) {
      const hw = wide / 2;
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(a);
      box("#03101e", -3, -hw - 2, len + 6, wide + 4);
      box(c, 0, -hw, len, wide);
      box(dark, 0, hw - 3, len, 3);
      box("#2ea8f0", 1, -hw + 1, len - 2, 2);
      box("#0a1b2e", 4, -2, len - 8, 4);
      lit(core, len - 7, -hw + 2, 3, wide - 4, pulse);
      ctx.restore();
      return { x: lx + Math.cos(a) * len, y: ly + Math.sin(a) * len };
    }
    ctx.save();
    ctx.translate(sx + 39, sy);
    ctx.scale(f, 1);
    let k = limb(-5, 78, 23, 12, Math.PI / 2 + step + jump, "#0a4a86", "#04203f");
    let s = limb(k.x, k.y, 23, 10, Math.PI / 2 - step - jump * 1.4, "#052f68", "#03182f");
    box("#03101e", s.x - 4, s.y - 5, 20, 10); box("#0a3262", s.x - 3, s.y - 4, 18, 8);
    k = limb(7, 78, 23, 12, Math.PI / 2 - step - jump, "#0757a6", "#052445");
    s = limb(k.x, k.y, 23, 10, Math.PI / 2 + step + jump * 1.4, "#0a3262", "#04203f");
    box("#03101e", s.x - 4, s.y - 5, 22, 10); box("#0757a6", s.x - 3, s.y - 4, 20, 8);
    box("#2ea8f0", s.x - 3, s.y - 4, 20, 2);
    let elbow = limb(-9, 42, 16, 10, Math.PI / 2 - Math.sin(b.walk) * 0.2, "#0757a6", "#052445");
    let hand = limb(elbow.x, elbow.y, 14, 8, Math.PI / 2 - 0.2, "#052f68", "#03182f");
    box("#5b7fa6", hand.x - 3, hand.y - 3, 7, 7);
    box("#03101e", -15, 26, 36, 56);
    box("#061225", -12, 28, 30, 52);
    box("#0757a6", -14, 28, 34, 30);
    box("#2ea8f0", -14, 28, 34, 3);
    box("#0a4a86", -14, 50, 34, 8);
    box("#0b8de0", -3, 34, 18, 14);
    for (let i = 0; i < 3; i++) {
      box("#03101e", 7, 36 + i * 4, 7, 3); box(core, 8, 37 + i * 4, 5, 1);
    }
    lit(core, 0, 36, 12, 12, pulse * 0.55);
    box("#03101e", 2, 38, 8, 8); box(core, 3, 39, 6, 6); box("#dffcff", 4, 40, 3, 3);
    box("#0a3262", -11, 56, 26, 22); box("#04203f", -11, 72, 26, 6);
    for (let i = 0; i < 3; i++) box("#03101e", -9, 58 + i * 5, 22, 2);
    box("#03101e", -21, 30, 9, 24); box("#0a3262", -20, 31, 7, 22);
    lit(core, -19, 33, 5, 4, pulse); lit(core, -19, 40, 5, 3, pulse * 0.7);
    box("#03101e", -21, 24, 16, 18); box("#0757a6", -20, 25, 14, 16);
    box("#2ea8f0", -20, 25, 14, 2); lit(core, -17, 30, 8, 4, pulse);
    ctx.save();
    ctx.translate(13, 20);
    ctx.rotate(aimA * 0.7);
    box("#03101e", -8, -14, 32, 28);
    box("#0757a6", -6, -12, 28, 24);
    box("#2ea8f0", -6, -12, 28, 3);
    box("#04203f", -6, 6, 28, 6);
    box("#03101e", 16, -6, 12, 14);
    box("#061225", 18, -4, 10, 10);
    lit(eyeOn ? "#ff7a12" : core, 20, -2, 8, 6, eyeOn ? 1 : pulse);
    box(eyeOn ? "#fff27a" : "#dffcff", 21, -1, 6, 4);
    box("#03101e", 0, 4, 12, 6);
    for (let i = 0; i < 3; i++) box("#5b7fa6", 2 + i * 3, 5, 2, 4);
    box("#8fb6d6", 4, -18, 2, 6); lit(core, 2, -22, 6, 4, pulse);
    if (eyeOn) lit("#ff7a12", 14, -4, 16, 10, 0.5);
    ctx.restore();
    const gunA = active ? aimA : aimA * 0.85 + Math.sin(b.walk) * 0.1;
    elbow = limb(11, 46, 26, 12, gunA, "#0757a6", "#052445");
    hand = limb(elbow.x, elbow.y, 24, 11, gunA, "#052f68", "#03182f");
    box("#03101e", hand.x - 6, hand.y - 6, 12, 12);
    box(active ? "#39ff14" : "#5b7fa6", hand.x - 4, hand.y - 4, 8, 8);
    if (active) lit("#39ff14", hand.x - 8, hand.y - 8, 16, 16, pulse);
    ctx.restore();
    if (!b.vulnerable) drawGlobeShield(sx + 39, sy + 54, 76);
  }

  function drawBullet(b, bx) {
    const ang = Math.atan2(b.vy, b.vx || 1);
    ctx.save();
    ctx.translate(bx + b.w / 2, b.y + b.h / 2);
    ctx.rotate(ang);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(-8, -1, 8, 2);
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(-2, -2, 10, 4);
    ctx.fillStyle = "#fff8c8";
    ctx.fillRect(5, -1, 4, 2);
    ctx.restore();
  }

  function drawFireball(b, bx) {
    const ang = Math.atan2(b.vy, b.vx || (b.facing || 1));
    ctx.save();
    ctx.translate(bx + b.w / 2, b.y + b.h / 2);
    ctx.rotate(ang);
    ctx.fillStyle = "#ef2b12";
    ctx.fillRect(-14, -3, 10, 6);
    ctx.fillStyle = "#ff7a12";
    ctx.fillRect(-5, -5, 13, 10);
    ctx.fillStyle = "#fff27a";
    ctx.fillRect(2, -3, 7, 6);
    ctx.restore();
  }

  function drawGlobeShield(cx, cy, r) {
    const t = performance.now() / 420;
    ctx.globalAlpha = 0.35 + Math.sin(t) * 0.1;
    ctx.fillStyle = "#39ff14";
    ctx.beginPath(); ctx.arc(cx, cy, r + Math.sin(t * 2) * 2, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlayerGun(p) {
    const s = gunPose(p, p.beamAim);
    const glow = p.weapon === "MAXI" ? "#ff2bd6" : p.weapon === "SPREAD" ? "#ffd400" : p.weapon === "RIFLE" ? "#00e5ff" : "#cbd5e1";
    const heat = p.beaming ? 1 : Math.min(1, p.shootCD / 8);
    const t = performance.now() / 110;
    ctx.save();
    ctx.translate(s.grip.x - state.camX, s.grip.y);
    ctx.rotate(s.a);
    ctx.scale((p.beamAim > 0 ? 20 : 30) / 30, p.facing < 0 ? -1 : 1);
    // hand
    ctx.fillStyle = "#e8b88a";
    ctx.fillRect(-4, -3, 8, 7);
    // body / receiver
    for (let i = 0; i < GUN.length; i += 5) {
      ctx.fillStyle = GUN[i] === 10 ? glow : GUNP[GUN[i]];
      ctx.fillRect(GUN[i + 1], GUN[i + 2], GUN[i + 3], GUN[i + 4]);
    }
    // muzzle flash
    ctx.globalAlpha = 0.45 + Math.sin(t) * 0.15 + heat * 0.35;
    ctx.fillStyle = glow;
    ctx.fillRect(28, -3, 6 + heat * 8, 6);
    if (heat > 0.35) {
      ctx.fillStyle = "#fff6c2";
      ctx.fillRect(32, -5, 8, 10);
      ctx.fillStyle = glow;
      ctx.fillRect(36, -7, 5, 14);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPickupQR(qx, qy, power) {
    const accent = power === "gold" ? "#ffd400" : power === "speed" ? "#3b82f6" : "#39ff14";
    ctx.globalAlpha = 0.22 + Math.sin(performance.now() / 180 + qx) * 0.1;
    ctx.fillStyle = accent; ctx.fillRect(qx - 3, qy - 3, 32, 32); ctx.globalAlpha = 1;
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(qx, qy, 26, 26);
    ctx.fillStyle = "#020617";
    ctx.fillRect(qx, qy, 26, 2); ctx.fillRect(qx, qy + 24, 26, 2);
    ctx.fillRect(qx, qy, 2, 26); ctx.fillRect(qx + 24, qy, 2, 26);
    function eye(ex, ey) {
      ctx.fillStyle = "#020617"; ctx.fillRect(ex, ey, 8, 8);
      ctx.fillStyle = "#f8fafc"; ctx.fillRect(ex + 1, ey + 1, 6, 6);
      ctx.fillStyle = "#020617"; ctx.fillRect(ex + 2, ey + 2, 4, 4);
      ctx.fillStyle = accent; ctx.fillRect(ex + 3, ey + 3, 2, 2);
    }
    eye(qx + 2, qy + 2); eye(qx + 16, qy + 2); eye(qx + 2, qy + 16);
    const bits = [0x5b, 0x2e, 0x74, 0x1d, 0x6a, 0x37, 0x4c];
    ctx.fillStyle = "#020617";
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if ((bits[r] >> c) & 1) ctx.fillRect(qx + 9 + c * 2, qy + 9 + r * 2, 2, 2);
    ctx.fillStyle = accent; ctx.fillRect(qx + 19, qy + 19, 5, 5);
    ctx.fillStyle = "#020617"; ctx.fillRect(qx + 20, qy + 20, 3, 3);
  }

  function drawPickupGun(sx, sy, type) {
    const color = type === "MAXI" ? "#ff2bd6" : type === "SPREAD" ? "#ffd400" : "#00e5ff";
    ctx.globalAlpha = 0.28; ctx.fillStyle = color; ctx.fillRect(sx - 4, sy + 24, 30, 4); ctx.globalAlpha = 1;
    ctx.fillStyle = "#334155"; ctx.fillRect(sx - 3, sy + 7, 6, 5); ctx.fillRect(sx - 4, sy + 10, 4, 5);
    ctx.fillStyle = "#0f172a"; ctx.fillRect(sx + 2, sy + 6, 14, 8);
    ctx.fillStyle = color; ctx.fillRect(sx + 4, sy + 8, 10, 2);
    ctx.fillStyle = "#111827";
    if (type === "SPREAD") {
      ctx.fillRect(sx + 15, sy + 5, 12, 3); ctx.fillRect(sx + 15, sy + 11, 12, 3);
      ctx.fillStyle = color; ctx.fillRect(sx + 26, sy + 5, 3, 9);
    } else if (type === "MAXI") {
      ctx.fillRect(sx + 14, sy + 4, 14, 9); ctx.fillStyle = color; ctx.fillRect(sx + 26, sy + 5, 4, 7);
    } else {
      ctx.fillRect(sx + 15, sy + 7, 13, 4);
      ctx.fillStyle = "#475569"; ctx.fillRect(sx + 6, sy + 3, 7, 3);
      ctx.fillStyle = color; ctx.fillRect(sx + 8, sy + 3, 3, 3); ctx.fillRect(sx + 27, sy + 7, 3, 4);
    }
    ctx.fillStyle = "#7c4a21"; ctx.fillRect(sx + 5, sy + 14, 5, 10);
    ctx.fillStyle = "#1f2937"; ctx.fillRect(sx + 6, sy + 15, 3, 8);
    ctx.fillStyle = "#334155"; ctx.fillRect(sx + 11, sy + 13, 4, 8);
    ctx.fillStyle = "#020617"; ctx.fillRect(sx, sy - 9, 20, 9);
    ctx.strokeStyle = color; ctx.strokeRect(sx, sy - 9, 20, 9);
    ctx.fillStyle = color; ctx.font = "bold 7px monospace"; ctx.fillText(type.slice(0, 3), sx + 2, sy - 2);
  }

  function drawBossHealth(x, y) {
    const g = 0.28 + Math.sin(performance.now() / 160) * 0.12;
    ctx.globalAlpha = g; ctx.fillStyle = "#39ff14"; ctx.fillRect(x - 3, y - 3, 38, 42); ctx.globalAlpha = 1;
    ctx.fillStyle = "#14532d"; ctx.fillRect(x, y, 32, 34);
    ctx.fillStyle = "#22c55e"; ctx.fillRect(x + 1, y + 1, 30, 7);
    ctx.fillStyle = "#166534"; ctx.fillRect(x + 1, y + 9, 30, 23);
    ctx.fillStyle = "#f0fdf4"; ctx.fillRect(x + 6, y + 13, 20, 14);
    ctx.fillStyle = "#ef4444"; ctx.fillRect(x + 14, y + 14, 4, 12); ctx.fillRect(x + 10, y + 18, 12, 4);
    ctx.fillStyle = "#39ff14"; ctx.fillRect(x + 15, y + 15, 2, 10); ctx.fillRect(x + 11, y + 19, 10, 2);
    ctx.fillStyle = "#020617"; ctx.fillRect(x - 1, y - 10, 34, 9);
    ctx.fillStyle = "#39ff14"; ctx.font = "bold 7px monospace"; ctx.fillText("SHIELD+", x + 1, y - 3);
  }

  function drawBossGun(x, y) {
    const g = 0.3 + Math.sin(performance.now() / 140) * 0.12;
    ctx.globalAlpha = g; ctx.fillStyle = "#ffd400"; ctx.fillRect(x - 4, y - 3, 44, 40); ctx.globalAlpha = 1;
    ctx.fillStyle = "#1e293b"; ctx.fillRect(x, y + 28, 36, 5);
    ctx.fillStyle = "#ffd400"; ctx.fillRect(x + 2, y + 29, 32, 2);
    ctx.fillStyle = "#334155"; ctx.fillRect(x - 2, y + 10, 8, 6);
    ctx.fillStyle = "#0f172a"; ctx.fillRect(x + 4, y + 8, 18, 10);
    ctx.fillStyle = "#ffd400"; ctx.fillRect(x + 6, y + 10, 14, 3);
    ctx.fillStyle = "#111827"; ctx.fillRect(x + 20, y + 6, 16, 12);
    ctx.fillStyle = "#ff2bd6"; ctx.fillRect(x + 34, y + 7, 5, 10);
    ctx.fillStyle = "#7c4a21"; ctx.fillRect(x + 8, y + 18, 6, 10);
    ctx.fillStyle = "#334155"; ctx.fillRect(x + 14, y + 17, 5, 9);
    ctx.fillStyle = "#020617"; ctx.fillRect(x, y - 10, 36, 9);
    ctx.fillStyle = "#ffd400"; ctx.font = "bold 7px monospace"; ctx.fillText("MAXI++", x + 2, y - 3);
  }

  function drawPlay() {
    drawCity();
    drawPlatforms();

    const gx = state.endX - 70 - state.camX;
    if (!state.bossMode && gx > -55 && gx < W) {
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(gx - 5, GROUND - 84, 52, 84);
      ctx.fillStyle = "#101828";
      ctx.fillRect(gx, GROUND - 78, 42, 78);
      ctx.fillStyle = "#334155";
      ctx.fillRect(gx + 6, GROUND - 70, 30, 70);
      ctx.fillStyle = "#ffd400";
      ctx.fillRect(gx + 30, GROUND - 38, 4, 4);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.fillText("EXIT", gx + 8, GROUND - 88);
    }

    for (let i = 0; i < state.qrs.length; i++) {
      const q = state.qrs[i];
      if (q.taken) continue;
      const qx = q.x - state.camX;
      const qy = q.y + Math.sin(q.bob) * 5;
      if (qx < -20 || qx > W + 20) continue;
      drawPickupQR(qx, qy, q.power);
    }
    for (let i = 0; i < state.staffs.length; i++) {
      const s = state.staffs[i];
      if (s.taken) continue;
      const sx = s.x - state.camX;
      const sy = s.y + Math.sin(s.bob) * 3;
      if (sx < -20 || sx > W + 20) continue;
      drawPickupGun(sx, sy, s.type);
    }
    for (let i = 0; i < state.bossPickups.length; i++) {
      const q = state.bossPickups[i];
      if (q.taken) continue;
      const by = q.y + Math.sin(performance.now() / 220 + q.x) * 2;
      if (q.type === "health") drawBossHealth(q.x, by);
      else drawBossGun(q.x, by);
    }

    const p = state.player;
    if (p && p.beaming && p.weapon) {
      const rows = p.weapon === "MAXI" ? 8 : p.weapon === "SPREAD" ? 4 : 1;
      const tip = gunPose(p, p.beamAim), muzzle = tip.x - state.camX, muzzleY = tip.y;
      const col = p.weapon === "MAXI" ? "#ff2bd6" : p.weapon === "SPREAD" ? "#ffd400" : "#00e5ff";
      for (let i = 0; i < rows; i++) {
        const angle = (i - (rows - 1) / 2) * 0.085;
        ctx.save();
        ctx.translate(muzzle, muzzleY);
        ctx.rotate(p.beamAim < 0 ? -Math.PI / 2 + angle : p.beamAim > 0 ? Math.PI / 2 - angle : p.facing > 0 ? angle : Math.PI - angle);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = col;
        ctx.fillRect(0, -4, W + 160, 8);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, -1, W + 160, 2);
        ctx.restore();
      }
    }

    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      const ex = e.x - state.camX;
      if (ex < -40 || ex > W + 40) continue;
      if (e.drone) drawDrone(e, ex); else drawRobot(e, ex);
    }
    if (state.bossMode && state.boss && state.boss.alive) {
      const b = state.boss;
      if (b.mode === "laserCharge" || b.mode === "laser") {
        const h = bossHand(b), len = 920;
        ctx.save(); ctx.translate(h.x - state.camX, h.y); ctx.rotate(h.a);
        ctx.fillStyle = b.mode === "laser" ? "rgba(57,255,20,.35)" : "rgba(57,255,20,.18)";
        ctx.fillRect(0, b.mode === "laser" ? -8 : -1, len, b.mode === "laser" ? 16 : 2);
        if (b.mode === "laser") {
          ctx.fillStyle = "#39ff14"; ctx.fillRect(0, -4, len, 8);
          ctx.fillStyle = "#eaffea"; ctx.fillRect(0, -1, len, 2);
        }
        ctx.restore();
      }
      drawBoss(b);
      if (b.mode === "skyHold" || b.mode === "skySlam") {
        const wx = b.slamX + b.w / 2 - state.camX;
        const blink = Math.floor(performance.now() / 110) % 2;
        ctx.fillStyle = blink ? "rgba(255,45,45,.55)" : "rgba(255,210,0,.45)";
        ctx.fillRect(wx - 42, GROUND - 10, 84, 10);
        ctx.fillStyle = blink ? "#ff2bd6" : "#ff7a12";
        ctx.fillRect(wx - 3, 20, 6, GROUND - 36);
        ctx.fillRect(wx - 10, GROUND - 26, 20, 8);
      }
      ctx.fillStyle = "rgba(0,0,0,.78)"; ctx.fillRect(174, 14, 452, 31);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px monospace"; ctx.fillText("BLUE SENTINEL", 180, 26);
      ctx.fillStyle = "#24283b"; ctx.fillRect(180, 31, 440, 9);
      ctx.fillStyle = b.phase === 2 ? "#39ff14" : "#00e5ff"; ctx.fillRect(180, 31, 440 * Math.max(0, b.hp) / b.maxHp, 9);
      ctx.fillStyle = "#ffffff"; ctx.fillText("SHIELD " + "■".repeat(state.playerHP), 14, 26);
    }

    if (p && !(state.invuln > 0 && Math.floor(state.invuln / 3) % 2 === 0 && p.goldT <= 0)) {
      const py = p.y + (p.onGround ? Math.sin(p.run) * 1.5 : 0) + (p.crouch ? 10 : 0);
      const px = p.x - state.camX;
      const ph = p.crouch ? p.h - 10 : p.h;
      const blink = Math.floor(performance.now() / 100) % 2;
      if ((p.goldT > 0 || p.speedT > 0) && blink) {
        ctx.filter = p.goldT > 0 ? "sepia(1) saturate(6) hue-rotate(5deg) brightness(1.25)" : "sepia(1) saturate(5) hue-rotate(180deg) brightness(1.2)";
      }
      drawSprite(imgs.preacher, px, py, p.facing < 0, ph);
      ctx.filter = "none";
      drawPlayerGun(p);
    }

    for (let i = 0; i < state.bullets.length; i++) {
      const b = state.bullets[i];
      const bx = b.x - state.camX;
      if (b.from === "player") drawBullet(b, bx);
      else if (b.fire) drawFireball(b, bx);
      else if (b.lime) {
        const g = Math.floor(performance.now() / 70) % 2;
        ctx.fillStyle = g ? "#39ff14" : "#b8ff4a";
        for (let s = 0; s < 4; s++) {
          if ((s + g) % 2) {
            if (Math.abs(b.vx) >= Math.abs(b.vy)) ctx.fillRect(bx + s * 4, b.y + (s % 2), 3, 4);
            else ctx.fillRect(bx + (s % 2), b.y + s * 4, 4, 3);
          }
        }
      } else {
        ctx.fillStyle = "#fb7185";
        ctx.fillRect(bx, b.y, b.w, b.h);
      }
    }

    for (let i = 0; i < state.particles.length; i++) {
      const pt = state.particles[i];
      ctx.globalAlpha = Math.max(0, pt.life / 30);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - state.camX, pt.y, 3, 3);
    }
    ctx.globalAlpha = 1;

    if (state.flash > 0) {
      ctx.fillStyle = "rgba(255,255,255," + (state.flash / 30) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    if (state.talkQ && state.talkI < state.talkQ.length) {
      const line = state.talkQ[state.talkI];
      const you = line.who === "YOU";
      const bx = you ? 40 : W - 340;
      ctx.fillStyle = "rgba(2,8,20,.9)";
      ctx.fillRect(bx, 58, 300, 52);
      ctx.strokeStyle = you ? "#ffd400" : "#00e5ff";
      ctx.strokeRect(bx, 58, 300, 52);
      ctx.fillStyle = you ? "#ffd400" : "#00e5ff";
      ctx.font = "bold 11px monospace";
      ctx.fillText(you ? "FATHER ELIAS" : "BLUE SENTINEL", bx + 10, 76);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "13px monospace";
      ctx.fillText(line.line, bx + 10, 98);
    }
  }

  function loop() {
    if (state.mode === "play") updatePlay();
    if (state.mode === "credits") updateCredits();
    if (state.mode === "failed" && state.failAt && performance.now() >= state.failAt) {
      state.failAt = 0;
      hud.startBtn.style.display = "";
    }
    if (state.mode === "credits") {
      drawCredits();
    } else if (state.mode === "play" || state.mode === "clear" || state.mode === "failed" || state.mode === "dead" || state.mode === "win") {
      if (state.player) drawPlay();
      else drawCity();
    } else {
      drawCity();
      const t = performance.now() / 200;
      for (let i = 0; i < 6; i++) {
        const im = imgs.robots[i % Math.max(1, imgs.robots.length)];
        drawSprite(im, 80 + i * 110, GROUND - 48 + Math.sin(t + i) * 3, false, 48);
      }
      drawSprite(imgs.preacher, 360, GROUND - 70 + Math.sin(t * 0.7) * 2, false, 64);
    }
    requestAnimationFrame(loop);
  }

  function handleStartAction() {
    if (state.mode === "clear") advanceFromClear();
    else if (state.mode === "failed") {
      if (state.failAt) return;
      continueAfterFail();
    } else if (state.mode === "credits") {
      if (!state.creditDone) {
        state.creditDone = true;
        state.creditY = 40 - CREDIT_LINES.length * 26;
        missionDoneOverlay();
      } else startGame();
    } else startGame();
  }

  window.addEventListener("keydown", function (e) {
    keys[e.key] = true;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].indexOf(e.key) >= 0) e.preventDefault();
    if (e.key === " " && !e.repeat && state.mode === "play") {
      const now = performance.now();
      if (now - lastSpaceTap < 420) superJump();
      lastSpaceTap = now;
    }
    if ((e.key === "Enter" || e.key === " ") && state.mode !== "play") handleStartAction();
  });
  window.addEventListener("keyup", function (e) { keys[e.key] = false; });

  hud.startBtn.addEventListener("click", handleStartAction);
  hud.vol.addEventListener("input", function () {
    ensureAudio();
    setVolume(Number(hud.vol.value));
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  });
  hud.mute.addEventListener("click", function () {
    ensureAudio();
    setMuted(!muted);
    if (!muted && !musicOn && state.mode === "play") startTechno();
  });

  function bindTouch(id, prop) {
    const el = ROOT.querySelector(id);
    if (!el) return;
    let lastTap = 0;
    function down(ev) {
      ev.preventDefault();
      touch[prop] = true;
      el.classList.add("is-held");
      ensureAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      if (prop === "jump" && state.mode === "play") {
        const now = performance.now();
        if (now - lastTap < 420) superJump();
        lastTap = now;
      }
    }
    function up(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      touch[prop] = false;
      el.classList.remove("is-held");
    }
    el.addEventListener("touchstart", down, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", down);
    el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
    el.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  }

  function bindJoystick() {
    const stick = ROOT.querySelector("#dg-stick");
    const knob = ROOT.querySelector("#dg-knob");
    if (!stick || !knob) return;
    let active = false, pid = null;
    function travel() {
      return Math.max(22, stick.clientWidth * 0.28);
    }
    function setKnob(nx, ny) {
      touch.jx = nx; touch.jy = ny;
      const t = travel();
      knob.style.transform = "translate(calc(-50% + " + (nx * t) + "px), calc(-50% + " + (ny * t) + "px))";
    }
    function read(clientX, clientY) {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (clientX - cx) / (r.width * 0.42), dy = (clientY - cy) / (r.height * 0.42);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      setKnob(dx, dy);
    }
    function start(ev) {
      ev.preventDefault();
      active = true;
      ensureAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      const t = ev.changedTouches ? ev.changedTouches[0] : ev;
      if (t.identifier != null) pid = t.identifier;
      read(t.clientX, t.clientY);
    }
    function move(ev) {
      if (!active) return;
      ev.preventDefault();
      let t = ev;
      if (ev.changedTouches) {
        t = null;
        for (let i = 0; i < ev.changedTouches.length; i++) {
          if (ev.changedTouches[i].identifier === pid) { t = ev.changedTouches[i]; break; }
        }
        if (!t) return;
      }
      read(t.clientX, t.clientY);
    }
    function end(ev) {
      if (ev.changedTouches) {
        let hit = false;
        for (let i = 0; i < ev.changedTouches.length; i++) {
          if (ev.changedTouches[i].identifier === pid) hit = true;
        }
        if (!hit) return;
      }
      active = false; pid = null; setKnob(0, 0);
    }
    stick.addEventListener("touchstart", start, { passive: false });
    stick.addEventListener("touchmove", move, { passive: false });
    stick.addEventListener("touchend", end, { passive: false });
    stick.addEventListener("touchcancel", end, { passive: false });
    stick.addEventListener("mousedown", start);
    stick.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  }
  bindJoystick();
  bindTouch("#dg-jump", "jump");
  bindTouch("#dg-shoot", "shoot");

  let parentFs = false;
  let fsWanted = false;

  function wantsTouchUI() {
    // PC with mouse: keep desktop chrome even if a touchscreen / narrow iframe exists
    try {
      if (window.matchMedia("(pointer: fine)").matches &&
          !window.matchMedia("(pointer: coarse)").matches) {
        return false;
      }
    } catch (e) {}
    const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const hover = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches);
    if (coarse && !hover) return true;
    try {
      if (coarse && !window.matchMedia("(pointer: fine)").matches) return true;
    } catch (e2) {}
    return coarse && ("ontouchstart" in window);
  }

  function isNativeFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function isFullscreen() {
    return fsWanted || parentFs || (!EMBED && isNativeFullscreen());
  }

  function askParentFullscreen(exit) {
    postParent({ type: exit ? "dg-fs-exit" : "dg-fs" });
  }

  function enterFullscreen() {
    if (EMBED) {
      fsWanted = true;
      parentFs = true;
      askParentFullscreen(false);
      syncFsBtn();
      fit();
      return;
    }
    const req = ROOT.requestFullscreen || ROOT.webkitRequestFullscreen ||
      document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!req) return;
    try {
      const el = (ROOT.requestFullscreen || ROOT.webkitRequestFullscreen) ? ROOT : document.documentElement;
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function exitFullscreen() {
    if (EMBED) {
      fsWanted = false;
      parentFs = false;
      askParentFullscreen(true);
      syncFsBtn();
      fit();
      setTimeout(fit, 80);
      setTimeout(fit, 250);
      return;
    }
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit && isNativeFullscreen()) {
      try {
        const p = exit.call(document);
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
  }

  function syncFsBtn() {
    if (!hud.fs) return;
    const fs = isFullscreen();
    hud.fs.setAttribute("aria-pressed", fs ? "true" : "false");
    hud.fs.textContent = fs ? "EXIT" : "FULL";
    ROOT.classList.toggle("dg-fs", fs);
    document.documentElement.classList.toggle("dg-fs", fs);
  }

  function fit() {
    const phone = wantsTouchUI();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    const land = window.matchMedia("(orientation: landscape)").matches || vw > vh;
    const fs = isFullscreen();
    ROOT.classList.toggle("dg-phone", phone);
    const phoneLand = phone && land;
    ROOT.classList.toggle("dg-land", phoneLand);
    ROOT.classList.toggle("dg-fs", fs);

    const top = ROOT.querySelector(".dg-top");
    const help = ROOT.querySelector(".dg-help");
    const stage = ROOT.querySelector(".dg-stage");

    // Mobile in-game: canvas CSS fills the whole stage (see .dg-phone canvas).
    // Still set explicit px so some WebViews honor the stretch.
    if (phone && !ROOT.classList.contains("dg-menu") && stage) {
      const sw = Math.max(1, stage.clientWidth || vw);
      const sh = Math.max(1, stage.clientHeight || vh);
      canvas.style.width = Math.floor(sw) + "px";
      canvas.style.height = Math.floor(sh) + "px";
      syncFsBtn();
      return;
    }

    const pad = phone ? 8 : 20;
    let chrome = (top && top.offsetParent !== null ? top.offsetHeight : 0) + pad;
    if (!phone && help && help.offsetParent !== null && !ROOT.classList.contains("dg-menu")) {
      chrome += help.offsetHeight;
    }

    const needFit = EMBED || fs || phone || vh < 620;
    if (needFit) {
      const availH = Math.max(120, vh - chrome);
      const availW = Math.max(160, (ROOT.clientWidth || vw) - (phone ? 4 : 16));
      let cw = availW, ch = cw * H / W;
      if (ch > availH) { ch = availH; cw = ch * W / H; }
      canvas.style.width = Math.floor(cw) + "px";
      canvas.style.height = Math.floor(ch) + "px";
    } else {
      canvas.style.width = "";
      canvas.style.height = "";
    }
    syncFsBtn();
  }

  window.addEventListener("message", function (e) {
    if (!e.data || typeof e.data !== "object" || e.data.type !== "dg-fs-state") return;
    // Ignore false while user still wants FULL — browser cancels native fullscreen on iframe clicks
    // and used to clear parentFs, flash-resize the canvas, and look like an exit.
    if (e.data.active) parentFs = true;
    else if (!fsWanted) parentFs = false;
    syncFsBtn();
    fit();
  });
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", function () { setTimeout(fit, 150); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
  document.addEventListener("fullscreenchange", function () { syncFsBtn(); fit(); });
  document.addEventListener("webkitfullscreenchange", function () { syncFsBtn(); fit(); });
  if (hud.fs) {
    hud.fs.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ensureAudio();
      if (isFullscreen()) exitFullscreen();
      else enterFullscreen();
      setTimeout(function () { syncFsBtn(); fit(); }, 120);
    });
  }
  ROOT.addEventListener("touchstart", function () {
    if (!ROOT.classList.contains("dg-phone")) return;
    if (isFullscreen()) return;
    // Nudge into fullscreen on first touch while playing
    if (state.mode === "play") enterFullscreen();
  }, { passive: true });
  fit();

  const bootSub = wantsTouchUI()
    ? "by 8bitcrypto_44\nHard mode · clear before 2:15\nRotate landscape · stick + JUMP / FIRE\nJump×2 = Super"
    : "by 8bitcrypto_44\nHard mode: clear before 2:15\nBlast bots · Jump pits · 3 lives\nJump×2 = Super";
  showOverlay("DIGISTRACTS", bootSub, "PRESS START");
  updateHUD();
  fit();
  loop();
})();
