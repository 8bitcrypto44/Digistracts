(function () {
  "use strict";
  const ROOT = document.getElementById("digistracts-root");
  if (!ROOT || ROOT.dataset.booted) return;
  ROOT.dataset.booted = "1";

  const EMBED = /(?:\?|&)embed=1(?:&|$)/.test(location.search || "");
  // Dev/test chrome (GOD toggle + level select) only with ?god=1 or ?test=1
  const GOD_QS = /(?:\?|&)(?:god|test)=1(?:&|$)/.test(location.search || "");
  // Headless playthrough / layout audit — never enables god mode
  const QA_QS = /(?:\?|&)qa=1(?:&|$)/.test(location.search || "");
  if (EMBED) {
    document.documentElement.classList.add("dg-embed");
    document.body && document.body.classList.add("dg-embed");
  }
  if (GOD_QS) ROOT.classList.add("dg-test");
  if (QA_QS) ROOT.classList.add("dg-qa");
  function postParent(data) {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(data, "*");
    } catch (err) {}
  }

  const W = 800, H = 450;
  let GROUND = 390;
  const PREACHER_SRC = window.DG_PREACHER;
  const ROBOT_SRCS = window.DG_ROBOTS || [];
  const PLATFORM_SRCS = window.DG_PLATFORMS || [];
  const BOSS_SRC = window.DG_BOSS || "";
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
    hi: ROOT.querySelector("#dg-hi"),
    combo: ROOT.querySelector("#dg-combo"),
    msg: ROOT.querySelector("#dg-msg"),
    overlay: ROOT.querySelector("#dg-overlay"),
    title: ROOT.querySelector("#dg-title"),
    sub: ROOT.querySelector("#dg-sub"),
    startBtn: ROOT.querySelector("#dg-start"),
    vol: ROOT.querySelector("#dg-vol"),
    mute: ROOT.querySelector("#dg-mute"),
    fxBtn: ROOT.querySelector("#dg-fx"),
    pauseBtn: ROOT.querySelector("#dg-pause"),
    assistBtn: ROOT.querySelector("#dg-assist"),
    ngBtn: ROOT.querySelector("#dg-ng"),
    diffBtn: ROOT.querySelector("#dg-diff"),
    dailyBtn: ROOT.querySelector("#dg-daily"),
    shareBtn: ROOT.querySelector("#dg-share"),
    medalsEl: ROOT.querySelector("#dg-medals"),
    godBtn: ROOT.querySelector("#dg-god"),
    levels: ROOT.querySelector("#dg-levels"),
    fs: ROOT.querySelector("#dg-fs"),
    swapBtn: ROOT.querySelector("#dg-swap")
  };

  function loadImg(src) {
    const im = new Image();
    if (src && src.indexOf("data:") !== 0) im.crossOrigin = "anonymous";
    im.src = src || "";
    return im;
  }

  const imgs = { preacher: loadImg(PREACHER_SRC), backgrounds: [], robots: [], platforms: [], boss: loadImg(BOSS_SRC) };
  BACKGROUND_SRCS.forEach(function (src) { imgs.backgrounds.push(loadImg(src)); });
  ROBOT_SRCS.forEach(function (src) { imgs.robots.push(loadImg(src)); });
  PLATFORM_SRCS.forEach(function (src) { imgs.platforms.push(loadImg(src)); });

  const keys = Object.create(null);
  const touch = { left: false, right: false, up: false, down: false, jump: false, shoot: false, jx: 0, jy: 0 };

  const MUSIC_URL = "https://opengameart.org/sites/default/files/technocade_0.mp3";
  const musicTrack = new Audio();
  musicTrack.crossOrigin = "anonymous";
  musicTrack.loop = true;
  musicTrack.preload = "auto";
  musicTrack.src = MUSIC_URL;
  let audioCtx = null, masterGain = null, sfxGain = null, musicGain = null;
  let muted = false, volume = 0.35, musicOn = false, musicFallback = false;
  let fxOn = true;
  try {
    const fxSaved = localStorage.getItem("dg-fx");
    if (fxSaved === "0") fxOn = false;
  } catch (e) {}
  let assistOn = true;
  try {
    const aSaved = localStorage.getItem("dg-assist");
    if (aSaved === "0") assistOn = false;
    else if (aSaved === "1") assistOn = true;
  } catch (e) {}
  let musicTimer = null, musicStep = 0, noiseBuf = null;
  let lastSpaceTap = 0;
  let titleIdleAt = performance.now();
  let musicUrgent = false;
  const demoAI = { x: 1, jump: false, shoot: false, up: false, down: false, think: 0 };
  const qaBot = {
    on: false, think: 0, stuck: 0, lastX: 0, deaths: 0, startedAt: 0,
    maxX: 0, label: "", done: false, result: "", frames: 0, maxFrames: 150000,
    airCommit: 0, airDir: 1, traversal: false, causes: {}
  };
  const GUN_BAG_MAX = 2;
  const ATTRACT_IDLE_MS = 9000;

  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    musicGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    sfxGain.gain.value = 1;
    musicGain.gain.value = 0.55;
    sfxGain.connect(masterGain);
    musicGain.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    // Shared noise buffer for punchier impacts
    const n = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.25, audioCtx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = n;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
    musicTrack.volume = muted ? 0 : volume * 0.7;
  }

  function setMuted(m) {
    muted = m;
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
    musicTrack.muted = muted;
    musicTrack.volume = muted ? 0 : volume * 0.7;
    hud.mute.textContent = muted ? "UNMUTE" : "MUTE";
    hud.mute.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  function setFx(on) {
    fxOn = !!on;
    try { localStorage.setItem("dg-fx", fxOn ? "1" : "0"); } catch (e) {}
    syncFxBtn();
    if (!fxOn) {
      state.shake = 0;
      state.hitStop = 0;
    }
  }

  function syncFxBtn() {
    if (!hud.fxBtn) return;
    hud.fxBtn.textContent = fxOn ? "FX: ON" : "FX: OFF";
    hud.fxBtn.setAttribute("aria-pressed", fxOn ? "true" : "false");
  }

  function setAssist(on) {
    assistOn = !!on;
    try { localStorage.setItem("dg-assist", assistOn ? "1" : "0"); } catch (e) {}
    syncAssistBtn();
  }

  function syncAssistBtn() {
    if (!hud.assistBtn) return;
    hud.assistBtn.textContent = assistOn ? "AIM: ON" : "AIM: OFF";
    hud.assistBtn.setAttribute("aria-pressed", assistOn ? "true" : "false");
  }

  function bumpTitleIdle() {
    titleIdleAt = performance.now();
  }

  function syncMusicUrgency() {
    const urgent = state.mode === "play" && !state.demo &&
      ((state.levelTime > 0 && state.levelTime < 30000) || (state.lives <= 1 && !state.bossMode));
    if (urgent === musicUrgent) {
      if (urgent && musicOn && !musicFallback) {
        try { musicTrack.playbackRate = 1.12; } catch (e) {}
      }
      return;
    }
    musicUrgent = urgent;
    if (!musicOn || musicFallback) return;
    try {
      musicTrack.playbackRate = urgent ? 1.12 : 1;
      musicTrack.volume = muted ? 0 : volume * (urgent ? 0.85 : 0.7);
    } catch (e) {}
  }

  function beep(freq, dur, type, gain, when, dest) {
    if (!audioCtx || muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, audioCtx.currentTime + (when || 0));
    o.connect(g);
    g.connect(dest || sfxGain || masterGain);
    const t = audioCtx.currentTime + (when || 0);
    const amp = gain || 0.08;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.02, dur));
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noiseBurst(dur, gain, when, filterFreq) {
    if (!audioCtx || muted || !noiseBuf) return;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const g = audioCtx.createGain();
    const f = audioCtx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = filterFreq || 1200;
    f.Q.value = 0.8;
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain || masterGain);
    const t = audioCtx.currentTime + (when || 0);
    g.gain.setValueAtTime(gain || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function slideBeep(f0, f1, dur, type, gain, when) {
    if (!audioCtx || muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || "square";
    const t = audioCtx.currentTime + (when || 0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    o.connect(g);
    g.connect(sfxGain || masterGain);
    g.gain.setValueAtTime(gain || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // —— Named arcade SFX ——
  function sfxJump() {
    slideBeep(320, 720, 0.1, "square", 0.07);
    beep(880, 0.05, "triangle", 0.04, 0.05);
  }
  function sfxSuperJump() {
    slideBeep(280, 980, 0.16, "sawtooth", 0.08);
    beep(1200, 0.1, "triangle", 0.06, 0.08);
    noiseBurst(0.06, 0.04, 0.02, 1800);
  }
  function sfxShoot() {
    noiseBurst(0.045, 0.06, 0, 2200);
    slideBeep(880, 220, 0.07, "square", 0.05);
  }
  function sfxBeam(kind) {
    const hi = kind === "MAXI" ? 1600 : kind === "SPREAD" ? 1300 : kind === "HOMING" ? 1500 : 1100;
    noiseBurst(0.05, 0.05, 0, hi);
    beep(hi, 0.07, "sawtooth", 0.055);
    beep(hi * 0.5, 0.05, "square", 0.03, 0.02);
  }
  function sfxHit() {
    noiseBurst(0.05, 0.05, 0, 900);
    beep(260, 0.05, "square", 0.05);
  }
  function sfxKill() {
    noiseBurst(0.08, 0.07, 0, 700);
    slideBeep(480, 120, 0.14, "sawtooth", 0.07);
    beep(180, 0.1, "triangle", 0.05, 0.06);
  }
  function sfxHurt() {
    noiseBurst(0.1, 0.08, 0, 400);
    slideBeep(240, 80, 0.18, "sawtooth", 0.1);
  }
  function deathBeep() {
    noiseBurst(0.16, 0.1, 0, 350);
    slideBeep(220, 55, 0.28, "sawtooth", 0.11);
    beep(90, 0.25, "square", 0.08, 0.12);
    beep(45, 0.35, "triangle", 0.1, 0.22);
  }
  function sfxPickup(kind) {
    if (kind === "life") {
      beep(880, 0.08, "square", 0.07);
      beep(1175, 0.1, "triangle", 0.07, 0.07);
      beep(1568, 0.14, "square", 0.06, 0.14);
    } else if (kind === "gold") {
      beep(700, 0.08, "triangle", 0.07);
      beep(1050, 0.12, "square", 0.06, 0.07);
    } else if (kind === "speed") {
      slideBeep(600, 1400, 0.12, "square", 0.07);
    } else if (kind === "weapon") {
      beep(900, 0.08, "square", 0.07);
      beep(1200, 0.1, "triangle", 0.06, 0.07);
      noiseBurst(0.06, 0.04, 0.05, 2000);
    } else {
      beep(990, 0.07, "square", 0.06);
      beep(1320, 0.08, "triangle", 0.05, 0.05);
    }
  }
  function sfxOneUp() {
    beep(784, 0.07, "square", 0.07);
    beep(988, 0.07, "square", 0.07, 0.07);
    beep(1175, 0.07, "square", 0.07, 0.14);
    beep(1568, 0.16, "triangle", 0.08, 0.21);
  }
  function sfxOverclock() {
    noiseBurst(0.08, 0.06, 0, 2400);
    slideBeep(400, 1600, 0.2, "sawtooth", 0.09);
    beep(1320, 0.1, "square", 0.07, 0.08);
    beep(1760, 0.12, "triangle", 0.06, 0.14);
  }
  function sfxMedal() {
    beep(880, 0.06, "square", 0.06);
    beep(1175, 0.07, "triangle", 0.06, 0.06);
    beep(1568, 0.08, "square", 0.07, 0.12);
    beep(2093, 0.14, "triangle", 0.08, 0.18);
  }
  function sfxGraze() {
    beep(1400, 0.03, "triangle", 0.035);
    beep(1900, 0.04, "square", 0.03, 0.02);
  }
  function sfxPhase2() {
    noiseBurst(0.14, 0.1, 0, 600);
    slideBeep(180, 720, 0.28, "sawtooth", 0.11);
    beep(90, 0.2, "square", 0.09, 0.12);
    beep(1200, 0.12, "triangle", 0.06, 0.2);
  }
  function sfxClear() {
    beep(659, 0.07, "square", 0.06);
    beep(880, 0.07, "triangle", 0.06, 0.07);
    beep(1175, 0.08, "square", 0.07, 0.14);
    beep(1568, 0.16, "triangle", 0.08, 0.22);
  }
  function sfxComboBreak() {
    noiseBurst(0.08, 0.07, 0, 500);
    slideBeep(420, 90, 0.18, "sawtooth", 0.08);
    beep(110, 0.14, "square", 0.06, 0.08);
  }
  function sfxCheckpoint() {
    beep(660, 0.04, "square", 0.035);
    beep(990, 0.05, "triangle", 0.03, 0.04);
  }
  function sfxArenaLock() {
    noiseBurst(0.12, 0.08, 0, 500);
    slideBeep(200, 420, 0.16, "sawtooth", 0.08);
    beep(160, 0.12, "square", 0.06, 0.1);
  }
  function sfxArenaClear() {
    beep(784, 0.08, "square", 0.07);
    beep(988, 0.08, "triangle", 0.06, 0.07);
    beep(1319, 0.14, "square", 0.07, 0.14);
  }
  function sfxBossHit() {
    noiseBurst(0.06, 0.06, 0, 800);
    beep(200, 0.05, "square", 0.06);
  }
  function sfxBossLaser() {
    noiseBurst(0.2, 0.07, 0, 1500);
    slideBeep(1400, 400, 0.25, "sawtooth", 0.07);
  }
  function sfxUi() {
    beep(720, 0.05, "square", 0.045);
  }
  function sfxCrumble() {
    noiseBurst(0.1, 0.07, 0, 500);
    beep(120, 0.1, "sawtooth", 0.05);
  }
  function sfxBounce() {
    slideBeep(400, 900, 0.1, "triangle", 0.06);
    beep(1100, 0.05, "square", 0.04, 0.05);
  }

  function stopFallbackMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function stopMusic() {
    try { musicTrack.pause(); musicTrack.playbackRate = 1; } catch (e) {}
    stopFallbackMusic();
    musicOn = false;
    musicUrgent = false;
  }

  function startFallbackMusic() {
    ensureAudio();
    stopFallbackMusic();
    if (!audioCtx || muted) { musicOn = false; return; }
    musicFallback = true;
    musicOn = true;
    musicStep = 0;
    // Simple techno-ish loop: kick + bass + arp (no external file needed)
    const bass = [98, 98, 110, 98, 87, 87, 110, 130];
    const arp = [392, 0, 494, 0, 587, 494, 392, 330];
    musicTimer = setInterval(function () {
      if (!musicOn || muted || !audioCtx) return;
      if (audioCtx.state === "suspended") audioCtx.resume();
      const i = musicStep % 8;
      const t = 0;
      // kick
      slideBeep(140, 45, 0.09, "sine", 0.09, t);
      noiseBurst(0.04, 0.05, 0, 200);
      // bass
      beep(bass[i], 0.12, "triangle", 0.05, 0.01, musicGain);
      // arp
      if (arp[i]) beep(arp[i], 0.08, "square", 0.035, 0.02, musicGain);
      // hi-hat every other
      if (i % 2 === 1) noiseBurst(0.03, 0.03, 0, 6000);
      musicStep++;
    }, 165);
  }

  function startTechno() {
    ensureAudio();
    stopMusic();
    musicOn = true;
    musicUrgent = false;
    if (musicFallback) {
      startFallbackMusic();
      return;
    }
    try { musicTrack.playbackRate = 1; } catch (e) {}
    musicTrack.currentTime = 0;
    musicTrack.volume = muted ? 0 : volume * 0.7;
    const trackPromise = musicTrack.play();
    if (trackPromise) {
      trackPromise.catch(function () {
        startFallbackMusic();
      });
    }
    musicTrack.onerror = function () {
      startFallbackMusic();
    };
  }

  const HS_KEY = "dg-hiscore";
  const DAILY_BEST_KEY = "dg-daily-best";
  const SECTOR_PB_KEY = "dg-sector-pb";
  const LIFE_EVERY = 5000;
  const MAX_LIVES = 9;

  function loadHiScore() {
    try {
      return Math.max(0, parseInt(localStorage.getItem(HS_KEY) || "0", 10) || 0);
    } catch (e) {
      return 0;
    }
  }

  function saveHiScore(score) {
    if (state.demo) return false;
    if (score <= state.hiScore) return false;
    state.hiScore = score;
    try { localStorage.setItem(HS_KEY, String(score)); } catch (e) {}
    return true;
  }

  function loadDailyBest() {
    try {
      const raw = JSON.parse(localStorage.getItem(DAILY_BEST_KEY) || "null");
      if (!raw || !raw.date) return { date: null, score: 0 };
      return { date: raw.date, score: Math.max(0, raw.score | 0) };
    } catch (e) {
      return { date: null, score: 0 };
    }
  }

  function saveDailyBest(score) {
    if (!state.daily || state.demo) return false;
    const id = state.dailyKey || dailyId();
    const cur = loadDailyBest();
    if (cur.date === id && score <= cur.score) return false;
    try {
      localStorage.setItem(DAILY_BEST_KEY, JSON.stringify({ date: id, score: score | 0 }));
    } catch (e) {}
    return true;
  }

  function dailyBestLine() {
    const cur = loadDailyBest();
    const today = dailyId();
    if (cur.date === today && cur.score > 0) return "Daily best " + cur.score;
    return "Daily best —";
  }

  function loadSectorPBs() {
    try {
      return JSON.parse(localStorage.getItem(SECTOR_PB_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function saveSectorPB(levelIdx, remainSec) {
    if (state.demo) return { best: false, prev: 0, now: remainSec };
    const key = state.inSecret ? ("sec:" + (state.activeSecret || state.secretKind || "x")) : String(levelIdx);
    const book = loadSectorPBs();
    const prev = book[key] | 0;
    // Higher leftover time = faster clear
    if (remainSec <= prev) return { best: false, prev: prev, now: remainSec };
    book[key] = remainSec;
    try { localStorage.setItem(SECTOR_PB_KEY, JSON.stringify(book)); } catch (e) {}
    return { best: true, prev: prev, now: remainSec };
  }

  function sectorPbLine(levelIdx) {
    const key = state.inSecret ? ("sec:" + (state.activeSecret || state.secretKind || "x")) : String(levelIdx);
    const book = loadSectorPBs();
    const best = book[key] | 0;
    if (!best) return "Sector PB —";
    return "Sector PB " + best + "s left";
  }

  function addScore(n) {
    if (!n) return;
    if (state.ngPlus && !state.demo) n = Math.round(n * 1.5);
    state.score += n;
    while (state.score >= state.nextLifeAt && state.lives < MAX_LIVES) {
      state.nextLifeAt += LIFE_EVERY;
      state.lives++;
      state.banner = "1-UP! ♥×" + state.lives;
      state.messageTimer = 80;
      sfxOneUp();
    }
    if (state.score > state.hiScore) saveHiScore(state.score);
  }

  function pushScorePop(x, y, text, color) {
    if (!state.scorePops) state.scorePops = [];
    state.scorePops.push({
      x: x, y: y, text: String(text),
      color: color || "#ffd400",
      life: 48, vy: -1.2
    });
    if (state.scorePops.length > 24) state.scorePops.shift();
  }

  function noteKill(opts) {
    opts = opts || {};
    state.combo += 1;
    state.comboTimer = 145;
    state.kills++;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    if (opts.points && opts.x != null) {
      pushScorePop(opts.x, opts.y, "+" + opts.points, opts.color || "#ffd400");
    }
    if (state.combo >= 3) {
      const bonus = Math.min(8, state.combo - 2) * 30;
      addScore(bonus);
      state.bonusScore += bonus;
      if (opts.x != null) {
        pushScorePop(opts.x, (opts.y || 0) - 16, "×" + state.combo + " +" + bonus, "#ff2bd6");
      }
    }
    if (state.combo === 5) {
      state.banner = "GOOD! ×5";
      state.messageTimer = 40;
      addJuice({ shake: 2, flash: 3 });
    } else if (state.combo === 10) {
      state.banner = "GREAT! ×10";
      state.messageTimer = 50;
      addJuice({ shake: 4, flash: 5, flashColor: "rgba(255,43,214,0.25)" });
    } else if (state.combo === 15 || (state.combo > 15 && state.combo % 5 === 0)) {
      state.banner = "DIGI! ×" + state.combo;
      state.messageTimer = 55;
      addJuice({ shake: 6, hitStop: 2, flash: 8, flashColor: "rgba(0,229,255,0.3)" });
    } else if (state.combo === 3 || state.combo % 5 === 0) {
      state.banner = "COMBO ×" + state.combo + "!";
      state.messageTimer = 45;
    }
  }

  function resetRunStats() {
    state.kills = 0;
    state.maxCombo = 0;
    state.bonusScore = 0;
    state.noHitClears = 0;
    state.sectorsCleared = 0;
    state.scorePops = [];
    state.lastClear = null;
    state.tipQ = [];
    state.onboardDone = false;
    state.runMedals = [];
    state.lastMedals = [];
    state.grazeCount = 0;
    state.grazeScore = 0;
    state.deathCause = null;
    state.overclockUsed = false;
  }

  function formatRunSummary() {
    const secrets = state.secretsDone || {};
    const secN = (secrets.ember ? 1 : 0) + (secrets.storm ? 1 : 0) + (secrets.signal ? 1 : 0);
    return "Kills " + state.kills + " · Max Combo ×" + state.maxCombo +
      "\nNo-Hit Clears " + state.noHitClears + " · Bonus " + state.bonusScore +
      "\nSecrets " + secN + "/3 · Graze " + (state.grazeCount || 0) +
      "\nDIFF " + currentDiff().label +
      (state.ngPlus ? " · NG+" : "") +
      (state.daily ? (" · DAILY " + (state.dailyKey || "")) : "");
  }

  function formatClearBreakdown(detail) {
    if (!detail) return "";
    const lines = [];
    if (detail.clear) lines.push("CLEAR +" + detail.clear);
    if (detail.time) lines.push("TIME +" + detail.time);
    if (detail.noHit) lines.push("NO-HIT +" + detail.noHit);
    if (detail.combo) lines.push("COMBO +" + detail.combo);
    if (detail.arena) lines.push("ARENA +" + detail.arena);
    if (detail.graze) lines.push("GRAZE +" + detail.graze);
    return lines.join(" · ");
  }

  // --- Fun systems: share / medals / daily seed / death tips ---
  const PAGES_SHARE = "https://8bitcrypto44.github.io/Digistracts/";
  const MEDAL_DEFS = [
    { id: "nohit", label: "NO-HIT", hot: true },
    { id: "speed", label: "SPEED" },
    { id: "combo", label: "COMBO" },
    { id: "secret", label: "SECRET", hot: true },
    { id: "graze", label: "GRAZER" },
    { id: "daily", label: "DAILY" },
    { id: "clear", label: "CLEAR" },
    { id: "boss", label: "BOSS" },
    { id: "ng", label: "NG+", hot: true }
  ];
  const CLEARED_KEY = "dg-cleared";

  function hasClearedOnce() {
    if (GOD_QS) return true;
    try { return localStorage.getItem(CLEARED_KEY) === "1"; } catch (e) { return false; }
  }

  function markGameCleared() {
    try { localStorage.setItem(CLEARED_KEY, "1"); } catch (e) {}
  }

  function styleRank(n) {
    if (n >= 20) return { label: "LEGENDARY", color: "#ff2bd6" };
    if (n >= 12) return { label: "STYLISH", color: "#a78bfa" };
    if (n >= 6) return { label: "NICE", color: "#67e8f9" };
    if (n >= 3) return { label: "COOL", color: "#39ff14" };
    return { label: "GRAZE", color: "#67e8f9" };
  }
  const DEATH_TIPS = {
    bullet: "Enemy shots — jump or weave the gaps",
    enemy: "Don't body-check hunters — shoot first",
    spike: "Spikes blink — wait for the safe window",
    acid: "Acid rises — climb and keep moving",
    laser: "Lasers pulse — cross on the off-beat",
    crusher: "Crushers telegraph — wait for UP",
    fall: "Pits kill — Super Jump is jump×2 in air",
    boss: "Bosses flash WEAK after big attacks",
    time: "Clock ran out — grab QR and push the exit",
    gate: "Arena gates lock — clear every hunter",
    default: "Checkpoint keeps progress — press CONTINUE"
  };
  let _seedRng = null;

  function blankSecretsDone() {
    return { ember: false, storm: false, signal: false };
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function dailyId() {
    const d = new Date();
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }

  function setRunSeed(seed) {
    let a = (seed >>> 0) || 1;
    _seedRng = function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clearRunSeed() {
    _seedRng = null;
  }

  function rnd() {
    return _seedRng ? _seedRng() : Math.random();
  }

  function loadMedalBook() {
    try {
      return JSON.parse(localStorage.getItem("dg-medals") || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function saveMedalBook(book) {
    try { localStorage.setItem("dg-medals", JSON.stringify(book || {})); } catch (e) {}
  }

  function awardMedal(id, quiet) {
    if (!id || state.demo) return false;
    if (!state.runMedals) state.runMedals = [];
    if (state.runMedals.indexOf(id) < 0) state.runMedals.push(id);
    const book = loadMedalBook();
    if (!book[id]) {
      book[id] = 1;
      saveMedalBook(book);
      if (!quiet) {
        sfxMedal();
        const label = (MEDAL_DEFS.filter(function (m) { return m.id === id; })[0] || { label: id }).label;
        state.banner = "★ MEDAL: " + label + " ★";
        state.messageTimer = Math.max(state.messageTimer, 70);
      }
      return true;
    }
    book[id] = (book[id] | 0) + 1;
    saveMedalBook(book);
    return false;
  }

  function formatMedalsLine(list) {
    const ids = list && list.length ? list : (state.runMedals || []);
    if (!ids.length) return "Medals —";
    return "Medals " + ids.map(function (id) {
      const d = MEDAL_DEFS.filter(function (m) { return m.id === id; })[0];
      return d ? d.label : id.toUpperCase();
    }).join(" · ");
  }

  function renderMedalsUI(show, highlight, useBook) {
    if (!hud.medalsEl) return;
    if (!show) {
      hud.medalsEl.classList.remove("is-on");
      hud.medalsEl.innerHTML = "";
      return;
    }
    const got = {};
    if (useBook) {
      const book = loadMedalBook();
      Object.keys(book).forEach(function (id) { if (book[id]) got[id] = true; });
    } else {
      (highlight || state.runMedals || []).forEach(function (id) { got[id] = true; });
    }
    hud.medalsEl.innerHTML = "";
    MEDAL_DEFS.forEach(function (m) {
      const s = document.createElement("span");
      s.textContent = m.label;
      if (got[m.id]) {
        s.classList.add("is-on");
        if (m.hot) s.classList.add("is-hot");
      }
      hud.medalsEl.appendChild(s);
    });
    hud.medalsEl.classList.add("is-on");
  }

  function evaluateSectorMedals(opts) {
    opts = opts || {};
    const earned = [];
    const fresh = [];
    function take(id) {
      if (awardMedal(id, true)) fresh.push(id);
      earned.push(id);
    }
    take("clear");
    if (!state.hitThisLevel) take("nohit");
    const budget = sectorTimeBudget();
    if (state.levelTime > budget * 0.45) take("speed");
    if (state.combo >= 8 || state.maxCombo >= 10) take("combo");
    if (opts.secret) take("secret");
    if ((state.grazeCount || 0) >= 8) take("graze");
    if (state.daily) take("daily");
    if (opts.boss) take("boss");
    if (state.ngPlus) take("ng");
    if (fresh.length) {
      sfxMedal();
      const labels = fresh.map(function (id) {
        const d = MEDAL_DEFS.filter(function (m) { return m.id === id; })[0];
        return d ? d.label : id.toUpperCase();
      });
      state.banner = "★ NEW MEDAL" + (fresh.length > 1 ? "S" : "") + ": " + labels.join(" · ") + " ★";
      state.messageTimer = Math.max(state.messageTimer, 90);
    }
    state.lastMedals = earned;
    return earned;
  }

  function deathTipText(cause) {
    return DEATH_TIPS[cause] || DEATH_TIPS.default;
  }

  function buildShareText(kind) {
    const lines = [
      "DIGISTRACTS by 8bitcrypto_44",
      (kind === "fail" ? "FAILED" : kind === "clear" ? "SECTOR CLEAR" : "MISSION COMPLETE") +
        " · Score " + state.score + " · HI " + state.hiScore,
      formatRunSummary(),
      formatMedalsLine(state.runMedals),
      (state.daily ? ("Daily " + (state.dailyKey || dailyId()) + " · " + dailyBestLine() + "\n") : "") +
        "DIFF " + currentDiff().label + (state.ngPlus ? " · NG+" : ""),
      PAGES_SHARE + "?v=34"
    ];
    return lines.join("\n");
  }

  function setShareVisible(on) {
    if (!hud.shareBtn) return;
    hud.shareBtn.style.display = on ? "" : "none";
    hud.shareBtn.classList.remove("is-copied");
    hud.shareBtn.textContent = "COPY SCORE";
  }

  function copyShareCard() {
    const kind = state.mode === "failed" ? "fail" : (state.mode === "clear" ? "clear" : "win");
    const text = buildShareText(kind);
    function ok() {
      if (hud.shareBtn) {
        hud.shareBtn.textContent = "COPIED!";
        hud.shareBtn.classList.add("is-copied");
        setTimeout(function () {
          if (hud.shareBtn) {
            hud.shareBtn.textContent = "COPY SCORE";
            hud.shareBtn.classList.remove("is-copied");
          }
        }, 1400);
      }
      state.banner = "SCORE COPIED!";
      state.messageTimer = 50;
      sfxUi();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () {
        fallbackCopy(text); ok();
      });
    } else {
      fallbackCopy(text);
      ok();
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) {}
  }

  function activateOverclock(secs) {
    const p = state.player;
    if (!p) return;
    const t = Math.floor((secs || 8) * 60);
    p.overclockT = Math.max(p.overclockT || 0, t);
    p.goldT = Math.max(p.goldT || 0, Math.floor(t * 0.35));
    p.speedT = Math.max(p.speedT || 0, Math.floor(t * 0.5));
    if (p.weapon) p.beamFuel = Math.max(p.beamFuel, 80);
    else grantWeapon("MAXI", 0.55);
    addJuice({ shake: 6, flash: 10, flashColor: "rgba(255,212,0,0.35)" });
    state.banner = "⚡ OVERCLOCK " + (secs || 8) + "s!";
    state.messageTimer = 90;
    sfxOverclock();
  }

  const DIFFS = {
    easy: {
      id: "easy", label: "EASY", lives: 5, timeMult: 1.3, spawnMult: 1.55,
      hpMult: 0.8, bulletSpd: 0.85, invuln: 170, hitPad: 8
    },
    normal: {
      id: "normal", label: "NORMAL", lives: 3, timeMult: 1.05, spawnMult: 1.12,
      hpMult: 0.92, bulletSpd: 0.92, invuln: 150, hitPad: 6
    },
    hard: {
      id: "hard", label: "HARD", lives: 2, timeMult: 0.75, spawnMult: 0.65,
      hpMult: 1.12, bulletSpd: 1.1, invuln: 100, hitPad: 3
    }
  };
  const DIFF_ORDER = ["easy", "normal", "hard"];
  const MID_BOSS_LEVEL = 2; // after MEGA SPIRE

  const LEVELS = [
    { name: "NEON DOCKS", theme: "docks", ground: 425, len: 14500, enemyRate: 0.48, enemySpeed: 1.65, qrCount: 14, platforms: 40 },
    { name: "DATA TUNNEL", theme: "tunnel", ground: 415, len: 15200, enemyRate: 0.28, enemySpeed: 2.35, qrCount: 16, platforms: 46 },
    { name: "MEGA SPIRE", theme: "spire", ground: 418, len: 15800, enemyRate: 0.24, enemySpeed: 2.85, qrCount: 18, platforms: 54 },
    { name: "CIRCUIT SLUMS", theme: "slums", ground: 395, len: 16400, enemyRate: 0.18, enemySpeed: 3.35, qrCount: 20, platforms: 58 },
    { name: "SKY RAIL", theme: "skyrail", ground: 420, len: 16800, enemyRate: 0.16, enemySpeed: 3.55, qrCount: 20, platforms: 56 },
    { name: "VOID MARKET", theme: "voidmarket", ground: 410, len: 17200, enemyRate: 0.15, enemySpeed: 3.7, qrCount: 22, platforms: 54 },
    { name: "CORE SEWERS", theme: "sewers", ground: 438, len: 17600, enemyRate: 0.12, enemySpeed: 4.0, qrCount: 24, platforms: 52 }
  ];
  const SECRETS = {
    ember: {
      id: "ember",
      hostLevel: 5,
      hostTheme: "voidmarket",
      keyPower: "ember",
      lsKey: "dg-secret",
      level: {
        name: "EMBER VAULT", theme: "secret", ground: 405, len: 9800,
        enemyRate: 0.14, enemySpeed: 4.2, qrCount: 18, platforms: 48, secret: true
      },
      tale: [
        { who: "YOU", line: "The Ember Vault opens…" },
        { who: "YOU", line: "Old code. Older faith. Survive it." }
      ],
      tip: "EMBER VAULT · CLAIM THE RELIC",
      hostTip: "FIND EMBER KEY · OPEN THE VAULT",
      keyBanner: "EMBER KEY! FIND THE VAULT GATE",
      enterBanner: "EMBER VAULT UNLOCKED!",
      clearTitle: "VAULT CLEARED",
      clearBody: "EMBER RELIC SECURED!",
      exitLabel: "ENTER SEWERS",
      exitHint: "MAXI armed · warp to CORE SEWERS",
      exitTo: 6,
      rewardWeapon: "MAXI",
      rewardAmmo: 1.4,
      rewardGold: 240,
      gateLabel: "VAULT",
      relicLabel: "RELIC",
      color: "#fb7185",
      color2: "#fbbf24",
      palIndex: 7
    },
    storm: {
      id: "storm",
      hostLevel: 4,
      hostTheme: "skyrail",
      keyPower: "storm",
      lsKey: "dg-secret-storm",
      level: {
        name: "STORM SPIRE", theme: "storm", ground: 400, len: 9200,
        enemyRate: 0.13, enemySpeed: 4.35, qrCount: 16, platforms: 46, secret: true
      },
      tale: [
        { who: "YOU", line: "Storm Spire answers the rail…" },
        { who: "YOU", line: "Ride the thunder. Don't look down." }
      ],
      tip: "STORM SPIRE · RIDE THE THUNDER",
      hostTip: "FIND STORM KEY · OPEN THE SPIRE",
      keyBanner: "STORM KEY! FIND THE SPIRE GATE",
      enterBanner: "STORM SPIRE UNLOCKED!",
      clearTitle: "SPIRE CLEARED",
      clearBody: "STORM CORE CLAIMED!",
      exitLabel: "ENTER MARKET",
      exitHint: "HOMING armed · warp to VOID MARKET",
      exitTo: 5,
      rewardWeapon: "HOMING",
      rewardAmmo: 1.55,
      rewardGold: 200,
      gateLabel: "SPIRE",
      relicLabel: "CORE",
      color: "#67e8f9",
      color2: "#a78bfa",
      palIndex: 8
    },
    signal: {
      id: "signal",
      hostLevel: 3,
      hostTheme: "slums",
      keyPower: "signal",
      lsKey: "dg-secret-signal",
      level: {
        name: "SIGNAL CRYPT", theme: "signal", ground: 400, len: 9000,
        enemyRate: 0.135, enemySpeed: 4.15, qrCount: 16, platforms: 44, secret: true
      },
      tale: [
        { who: "YOU", line: "A pirate signal under the slums…" },
        { who: "YOU", line: "Decode the crypt. Don't get tagged." }
      ],
      tip: "SIGNAL CRYPT · DECODE THE RELAY",
      hostTip: "FIND SIGNAL KEY · OPEN THE CRYPT",
      keyBanner: "SIGNAL KEY! FIND THE CRYPT GATE",
      enterBanner: "SIGNAL CRYPT UNLOCKED!",
      clearTitle: "CRYPT CLEARED",
      clearBody: "PIRATE RELAY CLAIMED!",
      exitLabel: "ENTER RAIL",
      exitHint: "RICO armed · warp to SKY RAIL",
      exitTo: 4,
      rewardWeapon: "RICOCHET",
      rewardAmmo: 1.6,
      rewardGold: 220,
      gateLabel: "CRYPT",
      relicLabel: "RELAY",
      color: "#34d399",
      color2: "#fbbf24",
      palIndex: 9
    }
  };
  const SECRET_FROM_LEVEL = SECRETS.ember.hostLevel;
  const TALES = [
    [{ who: "YOU", line: "New Eden rains neon lies." }, { who: "YOU", line: "Ride the dock cranes. Keep Ember lit." }],
    [{ who: "YOU", line: "Tunnels hide quiet arrests." }, { who: "YOU", line: "Time the laser gates. Trust the map." }],
    [{ who: "YOU", line: "Spire of Unity Core ahead." }, { who: "YOU", line: "Climb high. Crushers don't forgive." }],
    [{ who: "YOU", line: "Override sells false freedom." }, { who: "YOU", line: "Spike alleys. Don't linger." }],
    [{ who: "YOU", line: "Rails over black sky." }, { who: "YOU", line: "Wind will throw you. Hold the line." }],
    [{ who: "YOU", line: "Void Market sells lies." }, { who: "YOU", line: "Fake floors. Real bullets." }],
    [{ who: "YOU", line: "Faith and code—walk both." }, { who: "YOU", line: "Acid rises. Clear the Core." }]
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
    ["#06101c", "#7dd3fc", "#c084fc"],
    ["#12061a", "#e879f9", "#22d3ee"],
    ["#0c0610", "#fbbf24", "#22d3ee"],
    ["#1a0614", "#fb7185", "#fbbf24"], // Ember Vault
    ["#06141f", "#67e8f9", "#a78bfa"], // Storm Spire
    ["#061a12", "#34d399", "#fbbf24"]  // Signal Crypt
  ];

  // Locked ~32-color neon palette for world/weapon drawing
  const NEON = {
    void: "#05070f", ink: "#0b1220", metal: "#1f2937", metal2: "#334155",
    steel: "#475569", silver: "#94a3b8", white: "#e2e8f0",
    cyan: "#00e5ff", cyan2: "#67e8f9", cyanDim: "#0e7490",
    pink: "#ff2bd6", pink2: "#fb7185", pinkDim: "#831843",
    gold: "#ffd400", gold2: "#fbbf24", orange: "#f97316",
    green: "#39ff14", green2: "#4ade80", greenDim: "#14532d",
    purple: "#a78bfa", purple2: "#c084fc", purpleDim: "#4c1d95",
    red: "#ef4444", redHot: "#ff2b2b", blue: "#38bdf8",
    wood: "#7c4a21", wood2: "#a16207", black: "#020617"
  };
  function N(k) { return NEON[k] || NEON.cyan; }
  function pxFill(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function pxOutline(c, x, y, w, h) {
    ctx.strokeStyle = c; ctx.lineWidth = 1;
    ctx.strokeRect((x | 0) + 0.5, (y | 0) + 0.5, (w | 0) - 1, (h | 0) - 1);
  }
  function pxBevel(x, y, w, h, top, bot, body) {
    pxFill(body || N("metal"), x, y, w, h);
    pxFill(top || N("cyan"), x, y, w, 3);
    pxFill(bot || N("pink"), x, y + h - 2, w, 2);
    pxOutline(N("black"), x, y, w, h);
  }

  function secretDef(id) {
    return (id && SECRETS[id]) || null;
  }

  function activeSecretDef() {
    return secretDef(state.activeSecret) || secretDef(state.secretKind);
  }

  function secretForHostTheme(theme) {
    for (const id in SECRETS) {
      if (SECRETS[id].hostTheme === theme) return SECRETS[id];
    }
    return null;
  }

  function isSecretDone(id) {
    return !!(state.secretsDone && state.secretsDone[id]);
  }

  function currentLevel() {
    if (state.inSecret) {
      const d = activeSecretDef();
      if (d) return d.level;
    }
    return LEVELS[state.level];
  }

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
    props: [],
    holes: [],
    platforms: [],
    particles: [],
    spawnTimer: 0,
    endX: 3000,
    invuln: 0,
    flash: 0,
    flashColor: null,
    shake: 0,
    hitStop: 0,
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
    failAt: 0,
    hiScore: loadHiScore(),
    nextLifeAt: LIFE_EVERY,
    checkpointX: 80,
    hitThisLevel: false,
    combo: 0,
    comboTimer: 0,
    kills: 0,
    maxCombo: 0,
    bonusScore: 0,
    noHitClears: 0,
    sectorsCleared: 0,
    scorePops: [],
    lastClear: null,
    pauseMusicWasOn: false,
    hazards: [],
    arena: null,
    diff: "normal",
    inSecret: false,
    secretKey: false,
    secretKind: null,
    secretCleared: false,
    secretsDone: blankSecretsDone(),
    activeSecret: null,
    secretPortal: null,
    returnLevel: 0,
    godMode: GOD_QS,
    tipQ: [],
    onboardDone: false,
    daily: false,
    dailyKey: null,
    runMedals: [],
    lastMedals: [],
    grazeCount: 0,
    grazeScore: 0,
    deathCause: null,
    overclockUsed: false,
    shareKind: null,
    demo: false,
    demoAt: 0,
    ngPlus: false,
    lastStand: false
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
      gunBag: [], maxiCharge: 0, maxiPending: 0,
      safeX: 80, speedT: 0, goldT: 0, charge: 0, overclockT: 0,
      coyote: 0, jumpWasDown: false
    };
  }

  const WEAPON_DEFS = {
    RIFLE: {
      kind: "beam", rows: 1, cd: 7, color: N("cyan"), ammo: 240, dmg: 2, knock: 10,
      pierce: true, shake: 0.8, label: "RIFLE", hint: "PIERCE BEAM · HOLD FIRE", tag: "RFL"
    },
    SPREAD: {
      kind: "pellets", pellets: 5, cd: 16, color: N("gold"), ammo: 56, dmg: 1, knock: 14,
      spread: 0.28, shake: 2.2, label: "SPREAD", hint: "SHOTGUN BURST", tag: "SPR"
    },
    MAXI: {
      kind: "charge", cd: 22, color: N("pink"), ammo: 18, dmg: 5, knock: 22,
      shake: 8, label: "MAXI", hint: "HOLD CHARGE · RELEASE", tag: "MAX"
    },
    HOMING: {
      kind: "proj", color: N("purple"), ammo: 40, cd: 12, dmg: 2, knock: 8,
      shake: 1.2, label: "HOMING", hint: "AUTO-TRACK BOLTS", tag: "HOM", homing: true
    },
    RICOCHET: {
      kind: "proj", color: N("green2"), ammo: 36, cd: 10, dmg: 2, knock: 10,
      shake: 1.4, label: "RICO", hint: "BOUNCE SHOTS", tag: "RIC", rico: true, bounces: 6
    },
    WAVE: {
      kind: "wave", cd: 20, color: N("cyan2"), ammo: 28, dmg: 3, knock: 20,
      shake: 3.5, range: 150, label: "WAVE", hint: "SHOCK CONE · CROWDS", tag: "WAV", antiShield: 2
    },
    PULSE: {
      kind: "pulse", cd: 26, color: N("orange"), ammo: 16, dmg: 4, knock: 16,
      shake: 6, label: "PULSE", hint: "LOB ORB · AOE BLAST", tag: "PLS", antiShield: 3
    }
  };
  const WEAPON_ORDER = ["RIFLE", "SPREAD", "MAXI", "HOMING", "RICOCHET", "WAVE", "PULSE"];

  function weaponDef(type) {
    return WEAPON_DEFS[type] || null;
  }

  function weaponColor(type) {
    const d = weaponDef(type);
    return d ? d.color : N("silver");
  }

  function dropWeaponPickup(type, ammo, x, y) {
    if (!type || !weaponDef(type)) return;
    state.staffs.push({
      x: x, y: y, w: 40, h: 34, type: type, bob: Math.random() * 6,
      taken: false, ammo: ammo | 0, dropped: true
    });
  }

  function grantWeapon(type, ammoScale) {
    const p = state.player;
    const d = weaponDef(type);
    if (!p || !d) return;
    let ammo = Math.floor(d.ammo * (ammoScale || 1));
    if (!p.gunBag) p.gunBag = [];
    if (p.weapon === type) {
      p.beamFuel = Math.max(p.beamFuel || 0, ammo);
    } else {
      for (let i = p.gunBag.length - 1; i >= 0; i--) {
        if (p.gunBag[i].type === type) {
          ammo = Math.max(ammo, p.gunBag[i].ammo | 0);
          p.gunBag.splice(i, 1);
        }
      }
      if (p.weapon && p.beamFuel > 0) {
        if (p.gunBag.length >= GUN_BAG_MAX) {
          const kicked = p.gunBag.pop();
          if (kicked) dropWeaponPickup(kicked.type, kicked.ammo, p.x, p.y - 10);
        }
        p.gunBag = p.gunBag.filter(function (g) { return g.type !== p.weapon; });
        p.gunBag.unshift({ type: p.weapon, ammo: p.beamFuel });
        while (p.gunBag.length > GUN_BAG_MAX) {
          const overflow = p.gunBag.pop();
          if (overflow) dropWeaponPickup(overflow.type, overflow.ammo, p.x + 20, p.y - 8);
        }
      }
      p.weapon = type;
      p.beamFuel = ammo;
    }
    p.beamTick = 0;
    p.charge = 0;
    p.maxiCharge = 0;
    p.beaming = false;
  }

  function announceWeapon(type) {
    const d = weaponDef(type);
    if (!d) return;
    state.banner = "★ " + d.label + " · " + (d.hint || "ARMED") + " ★";
    state.messageTimer = 95;
    state.flash = Math.max(state.flash, 10);
  }

  function queueTips(lines) {
    state.tipQ = (lines || []).slice();
  }

  function tickTips() {
    if (state.talkQ || state.messageTimer > 0 || !state.tipQ || !state.tipQ.length) return;
    state.banner = state.tipQ.shift();
    state.messageTimer = 95;
    sfxUi();
  }

  function hitInvuln() {
    return (currentDiff().invuln || 135);
  }

  function clearWeapon() {
    const p = state.player;
    if (!p) return;
    p.weapon = 0;
    p.beamFuel = 0;
    p.beaming = false;
    p.charge = 0;
    p.maxiCharge = 0;
    p.maxiPending = 0;
    if (p.gunBag && p.gunBag.length) {
      const next = p.gunBag.shift();
      p.weapon = next.type;
      p.beamFuel = next.ammo | 0;
      const d = weaponDef(next.type);
      state.banner = "AUTO → " + (d ? d.label : next.type);
      state.messageTimer = 50;
    }
  }

  function swapWeapon() {
    const p = state.player;
    if (!p || state.mode !== "play" || state.demo) return;
    if (!p.gunBag || !p.gunBag.length) {
      state.banner = "NO BACKUP GUN";
      state.messageTimer = 40;
      beep(140, 0.06, "square", 0.04);
      return;
    }
    if (p.weapon && p.beamFuel > 0) {
      p.gunBag.push({ type: p.weapon, ammo: p.beamFuel });
    }
    const next = p.gunBag.shift();
    p.weapon = next.type;
    p.beamFuel = next.ammo | 0;
    p.beaming = false;
    p.charge = 0;
    p.maxiCharge = 0;
    p.maxiPending = 0;
    p.beamTick = 0;
    const d = weaponDef(next.type);
    state.banner = "SWAP → " + (d ? d.label : next.type) + " ×" + p.beamFuel;
    state.messageTimer = 55;
    sfxUi();
    beep(520, 0.05, "square", 0.05);
    beep(780, 0.05, "triangle", 0.04, 0.04);
    updateHUD();
  }


  function hotbarSlots(p) {
    const slots = [{ type: 0, label: "PST", ammo: null, active: !p.weapon }];
    if (p.weapon && p.beamFuel > 0) {
      const d = weaponDef(p.weapon);
      slots.push({ type: p.weapon, label: (d && d.tag) || String(p.weapon).slice(0, 3), ammo: p.beamFuel, active: true, hand: true });
    }
    (p.gunBag || []).forEach(function (g, i) {
      const d = weaponDef(g.type);
      slots.push({ type: g.type, label: (d && d.tag) || String(g.type).slice(0, 3), ammo: g.ammo | 0, bagIndex: i });
    });
    return slots.slice(0, GUN_BAG_MAX + 2);
  }

  function selectWeaponSlot(slot) {
    const p = state.player;
    if (!p || state.mode !== "play" || state.demo) return;
    const slots = hotbarSlots(p);
    const s = slots[slot];
    if (!s) {
      beep(140, 0.05, "square", 0.03);
      return;
    }
    if (s.active) return;
    if (s.type === 0) {
      if (!p.weapon) return;
      if (!p.gunBag) p.gunBag = [];
      if (p.beamFuel > 0) {
        p.gunBag.unshift({ type: p.weapon, ammo: p.beamFuel });
        while (p.gunBag.length > GUN_BAG_MAX) {
          const overflow = p.gunBag.pop();
          if (overflow) dropWeaponPickup(overflow.type, overflow.ammo, p.x + 16, p.y - 8);
        }
      }
      p.weapon = 0;
      p.beamFuel = 0;
      p.beaming = false;
      p.maxiCharge = 0;
      state.banner = "SWAP → PISTOL";
      state.messageTimer = 45;
      sfxUi();
      updateHUD();
      return;
    }
    if (s.hand) return;
    if (typeof s.bagIndex !== "number" || !p.gunBag || !p.gunBag[s.bagIndex]) return;
    const g = p.gunBag.splice(s.bagIndex, 1)[0];
    if (p.weapon && p.beamFuel > 0) {
      p.gunBag.splice(Math.min(s.bagIndex, p.gunBag.length), 0, { type: p.weapon, ammo: p.beamFuel });
      while (p.gunBag.length > GUN_BAG_MAX) {
        const overflow = p.gunBag.pop();
        if (overflow) dropWeaponPickup(overflow.type, overflow.ammo, p.x + 16, p.y - 8);
      }
    }
    p.weapon = g.type;
    p.beamFuel = g.ammo | 0;
    p.beaming = false;
    p.charge = 0;
    p.maxiCharge = 0;
    p.beamTick = 0;
    const d = weaponDef(g.type);
    state.banner = "SWAP → " + (d ? d.label : g.type) + " ×" + p.beamFuel;
    state.messageTimer = 55;
    sfxUi();
    beep(520, 0.05, "square", 0.05);
    updateHUD();
  }

  function assistSoftAim(p, aim) {
    if (!assistOn || !p || aim !== 0) return aim;
    if (p.aimUp || p.crouch) return aim;
    const tip = gunPose(p, 0);
    const e = nearestEnemy(tip.x, tip.y, 0);
    if (!e) return aim;
    const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
    const dx = ex - tip.x, dy = ey - tip.y;
    if (Math.abs(dx) < 28) return aim;
    const slope = dy / Math.abs(dx);
    if (slope < -0.42) return -1;
    if (slope > 0.55) return 1;
    return aim;
  }

  function assistFacing(p) {
    if (!assistOn || !p) return;
    if (inputX()) return;
    const tip = gunPose(p, 0);
    const e = nearestEnemy(tip.x, tip.y, 0);
    if (!e) return;
    const dx = (e.x + e.w / 2) - tip.x;
    if (Math.abs(dx) > 48) p.facing = dx > 0 ? 1 : -1;
  }

  function muzzleSparks(tip, color) {
    for (let i = 0; i < 6; i++) {
      state.particles.push({
        x: tip.x, y: tip.y,
        vx: (Math.random() - 0.5) * 4 + (state.player ? state.player.facing * 2 : 0),
        vy: (Math.random() - 0.5) * 4,
        life: 8 + Math.random() * 10,
        color: color || "#fff6c2"
      });
    }
  }

  function nearestEnemy(ox, oy, facing) {
    let best = null, bestD = 1e9;
    const list = state.enemies.slice();
    if (state.bossMode && state.boss && state.boss.alive) list.push(state.boss);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive === false) continue;
      const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
      if (facing && (ex - ox) * facing < -40) continue;
      const d = Math.hypot(ex - ox, ey - oy);
      if (d < bestD && d < 560) { bestD = d; best = e; }
    }
    return best;
  }

  function defaultPlatSkin(idx) {
    const theme = (currentLevel() && currentLevel().theme) || "docks";
    const preferB = theme === "slums" || theme === "voidmarket" || theme === "secret"
      || theme === "signal" || theme === "storm";
    if (preferB) return (idx % 3 === 0) ? 0 : 1;
    return (idx % 3 === 0) ? 1 : 0;
  }

  function platLen(i, base) {
    const table = [base, base + 36, base + 80, base + 130, base + 24, base + 100, base + 160];
    return table[i % table.length];
  }

  const PLAT_GAP_X = 48;
  const PLAT_GAP_Y = 34;
  const SPIKE_HOLE_PAD = 100;

  function holeClearance(x, w, pad) {
    pad = pad == null ? SPIKE_HOLE_PAD : pad;
    for (let i = 0; i < state.holes.length; i++) {
      const h = state.holes[i];
      if (x + w + pad > h.x && x - pad < h.x + h.w) return false;
    }
    return true;
  }

  // Movers sweep away from their origin, so spacing has to clear the whole path.
  function platBounds(p) {
    const ax = p.mover ? Math.abs(p.ampX || 0) : 0;
    const ay = p.mover ? Math.abs(p.ampY || 0) : 0;
    return {
      x: p.x - ax, y: p.y - ay,
      w: p.w + ax * 2, h: (p.h || 14) + ay * 2
    };
  }

  function platformsTooClose(pa, pb, gapX, gapY) {
    gapX = gapX == null ? PLAT_GAP_X : gapX;
    gapY = gapY == null ? PLAT_GAP_Y : gapY;
    const a = platBounds(pa);
    const b = platBounds(pb);
    return !(a.x + a.w + gapX <= b.x || b.x + b.w + gapX <= a.x
      || a.y + a.h + gapY <= b.y || b.y + b.h + gapY <= a.y);
  }

  function findClearPlatSpot(x, y, w, others, gapX, gapY) {
    gapX = gapX == null ? PLAT_GAP_X : gapX;
    gapY = gapY == null ? PLAT_GAP_Y : gapY;
    let nx = x, ny = y;
    for (let t = 0; t < 16; t++) {
      const cand = { x: nx, y: ny, w: w, h: 14 };
      let ok = true;
      for (let i = 0; i < others.length; i++) {
        if (platformsTooClose(cand, others[i], gapX, gapY)) { ok = false; break; }
      }
      if (ok) return { x: nx, y: ny };
      const dir = (t % 2 === 0) ? 1 : -1;
      nx = x + dir * (56 + t * 32);
      if (t % 3 === 2) ny = Math.max(70, Math.min(GROUND - 48, y - 36 - t * 6));
    }
    return null;
  }

  function addSpikeSafe(h) {
    let x = h.x;
    const w = h.w || 64;
    if (!holeClearance(x, w, SPIKE_HOLE_PAD)) {
      let placed = null;
      for (let d = 60; d <= 520; d += 40) {
        if (holeClearance(x + d, w, SPIKE_HOLE_PAD)) { placed = x + d; break; }
        if (holeClearance(x - d, w, SPIKE_HOLE_PAD)) { placed = x - d; break; }
      }
      if (placed == null) return null;
      h.x = placed;
    }
    return addHazard(h);
  }

  function movePlat(p, x, y) {
    p.x = x;
    p.y = y;
    if (p.mover) {
      p.ox = x;
      p.oy = y;
      p.prevX = x;
      p.prevY = y;
    }
  }

  function elevatedPlats() {
    return state.platforms.filter(function (p) {
      return p && !p.gone && p.y < GROUND - 8;
    });
  }

  // Only static ledges count: a mover may be at the far end of its sweep when
  // the player reaches the pit.
  function pitHasBridge(hole) {
    const mid = hole.x + hole.w / 2;
    return state.platforms.some(function (p) {
      if (!p || p.gone || p.mover || p.crumble || p.y >= GROUND - 20) return false;
      return p.y <= GROUND - 48 && p.x < mid + 40 && p.x + p.w > mid - 40;
    });
  }

  function addBridgeOverPit(hole, i) {
    const mid = hole.x + hole.w / 2;
    const bw = Math.min(140, Math.max(70, hole.w + 20));
    const by = GROUND - (70 + (i % 3) * 36);
    const spot = findClearPlatSpot(Math.round(mid - bw / 2), by, bw, elevatedPlats());
    if (spot) addPlatform(spot.x, spot.y, bw, { skin: i % 2, bridge: true });
  }

  function sanitizeLayout() {
    // Drop any spikes that still sit on / beside pits
    const kept = [];
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      if (h.kind === "spike" && !holeClearance(h.x, h.w || 64, SPIKE_HOLE_PAD)) continue;
      kept.push(h);
    }
    state.hazards = kept;

    // Bridge pits first so the separation solver can account for the new ledges
    for (let i = 0; i < state.holes.length; i++) {
      if (!pitHasBridge(state.holes[i])) addBridgeOverPit(state.holes[i], i);
    }

    // Separate elevated platforms; repeat until stable because moving one can
    // create a fresh overlap with a pair that was already resolved.
    const minX = 40;
    const maxX = Math.max(minX + 120, (state.endX || 4000) - 60);
    for (let pass = 0; pass < 10; pass++) {
      const plats = elevatedPlats();
      let moved = false;
      for (let i = 0; i < plats.length; i++) {
        const a = plats[i];
        for (let j = 0; j < i; j++) {
          const b = plats[j];
          if (!platformsTooClose(a, b)) continue;
          const dir = a.x + a.w / 2 >= b.x + b.w / 2 ? 1 : -1;
          const nx = dir > 0
            ? b.x + b.w + PLAT_GAP_X + 2
            : b.x - a.w - PLAT_GAP_X - 2;
          const clamped = Math.max(minX, Math.min(maxX - a.w, nx));
          if (Math.abs(clamped - nx) < 1) {
            movePlat(a, clamped, a.y);
          } else {
            movePlat(a, clamped, Math.max(70, a.y - (b.h + PLAT_GAP_Y + 2)));
          }
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Anything still overlapping after the solver is dropped, preferring to keep
    // pit bridges since those are required for traversal.
    let plats = elevatedPlats();
    for (let i = plats.length - 1; i >= 0; i--) {
      const a = plats[i];
      if (a.gone) continue;
      for (let j = 0; j < i; j++) {
        const b = plats[j];
        if (b.gone || !platformsTooClose(a, b)) continue;
        const drop = a.bridge && !b.bridge ? b : a;
        drop.gone = true;
        if (drop === a) break;
      }
    }
    state.platforms = state.platforms.filter(function (p) { return p && !p.gone; });

    // Re-bridge any pit whose ledge was moved or removed above
    for (let i = 0; i < state.holes.length; i++) {
      if (!pitHasBridge(state.holes[i])) addBridgeOverPit(state.holes[i], i);
    }
  }

  function addPlatform(x, y, w, extra) {
    const plat = { x: x, y: y, w: w, h: 14, dx: 0 };
    if (extra) {
      for (const k in extra) plat[k] = extra[k];
    }
    if (plat.skin == null) plat.skin = defaultPlatSkin(state.platforms.length);
    if (plat.mover) {
      plat.ox = x;
      plat.oy = y;
      plat.prevX = x;
      plat.prevY = y;
      plat.phase = plat.phase || 0;
    }
    state.platforms.push(plat);
    return plat;
  }

  function addHazard(h) {
    state.hazards.push(h);
    return h;
  }

  function addHole(x, w) {
    state.holes.push({ x: x, w: w });
  }

  function endTalk() {
    state.talkQ = null;
    if (state.bossMode && state.boss) {
      state.boss.vulnerable = true;
      state.boss.timer = 40;
      state.invuln = hitInvuln();
      state.banner = "FIGHT! LOOT CACHE!";
      state.messageTimer = 110;
      sfxArenaClear();
    } else if (state.level === 0 && !state.inSecret && !state.onboardDone) {
      state.onboardDone = true;
      state.invuln = hitInvuln();
      queueTips([
        "JUMP ×2 = SUPER JUMP",
        "HOLD FIRE TO CHARGE · MAXI CHARGES TOO",
        "GUNS: Q/SWAP · 1/2/3 HOTBAR · DROP WHEN FULL",
        "WAVE/PULSE CRACK ELITE SHIELDS · FLANK THEM"
      ]);
      state.banner = "GO! LEARN THE CONTROLS";
      state.messageTimer = 90;
      sfxUi();
    } else {
      state.banner = "GO! JUMP×2=SUPER";
      state.messageTimer = 90;
      state.invuln = hitInvuln();
      sfxUi();
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

  function placePickups(elevated, L) {
    const qrPlats = [], staffPlats = [];
    for (let i = 0; i < elevated.length; i++) {
      if (i % 3 === 0) qrPlats.push(elevated[i]);
      else if (i % 3 === 1) staffPlats.push(elevated[i]);
    }
    if (!qrPlats.length && elevated.length) qrPlats.push(elevated[0]);
    if (!staffPlats.length && elevated.length) staffPlats.push(elevated[Math.min(1, elevated.length - 1)]);
    for (let i = 0; i < L.qrCount && qrPlats.length; i++) {
      const plat = qrPlats[i % qrPlats.length];
      state.qrs.push({
        x: plat.x + plat.w / 2 - 12, y: plat.y - 34,
        w: 24, h: 24, bob: i * 0.8, taken: false, power: 0
      });
    }
    const blueN = 1 + (state.level % 2);
    for (let i = 0; i < blueN + 1 && qrPlats.length; i++) {
      const plat = qrPlats[(qrPlats.length - 1 - i * 2 + qrPlats.length) % qrPlats.length];
      state.qrs.push({
        x: plat.x + plat.w / 2 - 12, y: plat.y - 36,
        w: 24, h: 24, bob: i + 2, taken: false, power: i === blueN ? "gold" : "speed"
      });
    }
    if (qrPlats.length) {
      const lifePlat = qrPlats[Math.min(qrPlats.length - 1, Math.floor(qrPlats.length * 0.55))];
      state.qrs.push({
        x: lifePlat.x + lifePlat.w / 2 - 12, y: lifePlat.y - 38,
        w: 24, h: 24, bob: 4.2, taken: false, power: "life"
      });
    }
    if (qrPlats.length && !state.inSecret) {
      const clockPlat = qrPlats[Math.min(qrPlats.length - 1, Math.floor(qrPlats.length * 0.32))];
      state.qrs.push({
        x: clockPlat.x + clockPlat.w / 2 - 12, y: clockPlat.y - 40,
        w: 24, h: 24, bob: 5.1, taken: false, power: "overclock"
      });
    }
    WEAPON_ORDER.forEach(function (type, i) {
      if (!staffPlats.length) return;
      const plat = staffPlats[i % staffPlats.length];
      const spread = Math.floor(i / staffPlats.length);
      const slot = (i * 3 + spread * 2) % staffPlats.length;
      const p2 = staffPlats[slot] || plat;
      state.staffs.push({
        x: p2.x + p2.w / 2 - 9 + (spread % 2) * 16, y: p2.y - 32 - (i % 3) * 5,
        w: 40, h: 34, type: type, bob: i, taken: false
      });
    });
  }

  function removeHolesInRange(x0, x1) {
    if (!state.holes || !state.holes.length) return;
    const next = [];
    for (let i = 0; i < state.holes.length; i++) {
      const h = state.holes[i];
      const hx0 = h.x, hx1 = h.x + h.w;
      if (hx1 <= x0 || hx0 >= x1) {
        next.push(h);
        continue;
      }
      // Keep leftover pit segments outside the sealed range
      if (hx0 < x0) next.push({ x: hx0, w: x0 - hx0 });
      if (hx1 > x1) next.push({ x: x1, w: hx1 - x1 });
    }
    state.holes = next;
  }

  function solidifyPortalX(x, w) {
    w = w || 48;
    removeHolesInRange(x - 24, x + w + 24);
    return x;
  }

  function buildArena(atX) {
    // Seal pits under the arena so waves can't fall / auto-clear
    removeHolesInRange(atX - 60, atX + 560);
    state.arena = {
      x: atX,
      w: 520,
      active: false,
      cleared: false,
      triggered: false,
      spawnLeft: 8 + state.level * 2,
      timer: 0,
      lockL: atX - 40,
      lockR: atX + 480
    };
    // Gate walls (visual blockers that activate when arena starts)
    addHazard({ kind: "gate", x: atX - 30, y: GROUND - 160, w: 18, h: 160, open: true, arena: true });
    addHazard({ kind: "gate", x: atX + 500, y: GROUND - 160, w: 18, h: 160, open: true, arena: true });
    addPlatform(atX + 40, GROUND - 110, 140, { skin: 0 });
    addPlatform(atX + 320, GROUND - 160, 100, { skin: 1 });
    addPlatform(atX + 140, GROUND - 230, 160, { skin: 0 });
  }

  function buildSectorLayout(idx, L) {
    const elevated = [];
    const theme = L.theme || "docks";
    const len = L.len;

    function plat(x, y, w, extra, gaps) {
      const gx = gaps && gaps.gapX != null ? gaps.gapX : PLAT_GAP_X;
      const gy = gaps && gaps.gapY != null ? gaps.gapY : PLAT_GAP_Y;
      const spot = findClearPlatSpot(x, y, w, elevated, gx, gy);
      if (!spot) return null;
      const p = addPlatform(spot.x, spot.y, w, extra);
      elevated.push(p);
      return p;
    }

    if (theme === "docks") {
      // Wide cargo docks: movers + bounce + breakable neon + sparse pits
      for (let i = 0; i < 9; i++) addHole(900 + i * 1450, 120 + (i % 2) * 40);
      for (let i = 0; i < L.platforms; i++) {
        const x = 240 + i * ((len - 500) / L.platforms);
        const y = GROUND - (70 + (i % 3) * 52);
        const w = platLen(i, 88);
        if (i % 5 === 2) {
          plat(x, y, w, { mover: true, ampX: 70, ampY: 0, spd: 0.03, phase: i });
        } else if (i % 8 === 4) {
          plat(x, y, w, { bounce: true });
        } else if (i % 8 === 6) {
          plat(x, y, Math.min(80, w), { breakable: true, hp: 2 });
        } else {
          plat(x, y, w);
        }
      }
      for (let i = 0; i < 10; i++) {
        addSpikeSafe({
          kind: "spike", x: 1100 + i * 1200, y: GROUND - 16, w: 64, h: 16,
          on: 70, off: 50, t: i * 11, hurt: true
        });
      }
      buildArena(Math.floor(len * 0.48));
    } else if (theme === "tunnel") {
      // Laser corridor: dense low platforms + vertical lasers
      for (let i = 0; i < 14; i++) addHole(700 + i * 1000, 70 + (i % 3) * 20);
      for (let i = 0; i < L.platforms; i++) {
        const x = 200 + i * ((len - 400) / L.platforms);
        const row = i % 3;
        const y = GROUND - (60 + row * 56);
        plat(x, y, platLen(i, 64));
      }
      for (let i = 0; i < 16; i++) {
        const x = 850 + i * 880;
        addHazard({
          kind: "laser", x: x, y: 40, w: 10, h: GROUND - 50,
          on: 55, off: 70, t: i * 17, axis: "v"
        });
      }
      for (let i = 0; i < 6; i++) {
        addHazard({
          kind: "laser", x: 1200 + i * 2200, y: GROUND - 120, w: 160, h: 8,
          on: 40, off: 80, t: i * 23, axis: "h"
        });
      }
      buildArena(Math.floor(len * 0.52));
    } else if (theme === "spire") {
      // Vertical climb towers + crushers
      for (let i = 0; i < 7; i++) addHole(1400 + i * 2000, 90);
      let x = 220;
      for (let tower = 0; tower < 12; tower++) {
        const base = 280 + tower * ((len - 800) / 12);
        for (let step = 0; step < 5; step++) {
          plat(
            base + (step % 2) * 100,
            GROUND - (70 + step * 50),
            Math.min(96, platLen(tower * 5 + step, 64)),
            null,
            { gapX: 24, gapY: 22 }
          );
        }
        addHazard({
          kind: "crusher",
          x: base + 30, yTop: 20, yBot: GROUND - 90, w: 70, h: 28,
          t: tower * 19, down: 40, hold: 18, up: 50, phase: "up"
        });
        x = base;
      }
      while (elevated.length < L.platforms) {
        const i = elevated.length;
        const filler = plat(
          300 + i * ((len - 600) / Math.max(8, L.platforms)),
          GROUND - (80 + (i % 5) * 44),
          platLen(i, 78)
        );
        // plat() returns null when no clear gap remains — do not spin forever
        if (!filler) break;
      }
      buildArena(Math.floor(len * 0.55));
    } else if (theme === "slums") {
      // Spike alleys + crumbling ledges + bounce toys + Signal Crypt key
      for (let i = 0; i < 16; i++) addHole(650 + i * 950, 85 + (i % 2) * 25);
      for (let i = 0; i < L.platforms; i++) {
        const x = 210 + i * ((len - 450) / L.platforms);
        const y = GROUND - (60 + (i % 5) * 48);
        const crumbling = i % 7 === 3;
        const bounce = i % 7 === 5;
        const brk = i % 9 === 1;
        plat(x, y, platLen(i, 58), crumbling
          ? { crumble: true, life: 45, maxLife: 45, gone: false }
          : bounce ? { bounce: true }
          : brk ? { breakable: true, hp: 2 }
          : null);
      }
      for (let i = 0; i < 18; i++) {
        addSpikeSafe({
          kind: "spike", x: 780 + i * 850, y: GROUND - 14, w: 90, h: 14,
          on: 1, off: 0, t: 0, hurt: true, always: true
        });
      }
      for (let i = 0; i < 8; i++) {
        addHazard({
          kind: "laser", x: 1600 + i * 1700, y: 30, w: 8, h: GROUND - 40,
          on: 35, off: 90, t: i * 13, axis: "v"
        });
      }
      buildArena(Math.floor(len * 0.5));
      if (!isSecretDone("signal") && elevated.length > 8) {
        const keyPlat = elevated[Math.min(elevated.length - 1, Math.floor(elevated.length * 0.38))];
        state.qrs.push({
          x: keyPlat.x + keyPlat.w / 2 - 12, y: keyPlat.y - 42,
          w: 24, h: 24, bob: 6.4, taken: false, power: "signal"
        });
      }
      if (!isSecretDone("signal")) {
        state.secretPortal = {
          x: solidifyPortalX(Math.floor(len * 0.62)), y: GROUND - 96, w: 48, h: 96, open: false, secretId: "signal"
        };
      }
    } else if (theme === "skyrail") {
      // High rails + wind gusts + long movers
      for (let i = 0; i < 8; i++) addHole(1000 + i * 1900, 160 + (i % 2) * 30);
      for (let i = 0; i < L.platforms; i++) {
        const x = 200 + i * ((len - 500) / L.platforms);
        const high = i % 3 !== 2;
        const y = GROUND - (high ? 140 + (i % 4) * 48 : 70);
        if (i % 4 === 0) {
          plat(x, y, platLen(i, 100), { mover: true, ampX: 90, ampY: 12, spd: 0.028, phase: i, fy: 1.1 });
        } else {
          plat(x, y, platLen(i, 72));
        }
      }
      for (let i = 0; i < 12; i++) {
        addHazard({
          kind: "wind", x: 900 + i * 1300, y: GROUND - 200, w: 140, h: 200,
          push: (i % 2 === 0 ? 1 : -1) * 0.55, t: i * 15, on: 80, off: 50
        });
      }
      for (let i = 0; i < 6; i++) {
        addHazard({
          kind: "laser", x: 1500 + i * 2400, y: 40, w: 8, h: GROUND - 160,
          on: 45, off: 85, t: i * 19, axis: "v"
        });
      }
      buildArena(Math.floor(len * 0.52));
      // Storm Key (high rail) + dormant spire gate
      if (!isSecretDone("storm") && elevated.length > 8) {
        const keyPlat = elevated[Math.min(elevated.length - 1, Math.floor(elevated.length * 0.4))];
        state.qrs.push({
          x: keyPlat.x + keyPlat.w / 2 - 12, y: keyPlat.y - 42,
          w: 24, h: 24, bob: 6.2, taken: false, power: "storm"
        });
      }
      if (!isSecretDone("storm")) {
        state.secretPortal = {
          x: solidifyPortalX(Math.floor(len * 0.58)), y: GROUND - 96, w: 48, h: 96, open: false, secretId: "storm"
        };
      }
    } else if (theme === "voidmarket") {
      // Fake floors, bounce pads, dark lasers
      for (let i = 0; i < 14; i++) addHole(700 + i * 1100, 100 + (i % 3) * 20);
      for (let i = 0; i < L.platforms; i++) {
        const x = 220 + i * ((len - 450) / L.platforms);
        const y = GROUND - (70 + (i % 5) * 48);
        const fake = i % 6 === 2;
        const bounce = i % 6 === 4;
        plat(x, y, platLen(i, 66), fake
          ? { crumble: true, life: 18, maxLife: 18, gone: false, voidFake: true }
          : bounce ? { bounce: true } : null);
      }
      for (let i = 0; i < 14; i++) {
        addHazard({
          kind: "laser", x: 950 + i * 1150, y: 20, w: 12, h: GROUND - 30,
          on: 30, off: 70, t: i * 11, axis: "v"
        });
      }
      for (let i = 0; i < 8; i++) {
        addSpikeSafe({
          kind: "spike", x: 1200 + i * 1900, y: GROUND - 14, w: 70, h: 14,
          on: 50, off: 40, t: i * 7, hurt: true
        });
      }
      buildArena(Math.floor(len * 0.54));
      // Ember Key (high hard-to-reach) + dormant portal mid-market
      if (!isSecretDone("ember") && elevated.length > 8) {
        const keyPlat = elevated[Math.min(elevated.length - 1, Math.floor(elevated.length * 0.35))];
        state.qrs.push({
          x: keyPlat.x + keyPlat.w / 2 - 12, y: keyPlat.y - 42,
          w: 24, h: 24, bob: 6.6, taken: false, power: "ember"
        });
      }
      if (!isSecretDone("ember")) {
        state.secretPortal = {
          x: solidifyPortalX(Math.floor(len * 0.42)), y: GROUND - 96, w: 48, h: 96, open: false, secretId: "ember"
        };
      }
    } else if (theme === "secret") {
      // Ember Vault: dense climb, purple lasers, bounce + crumble, tight arena
      for (let i = 0; i < 16; i++) addHole(500 + i * 580, 70 + (i % 3) * 25);
      for (let i = 0; i < L.platforms; i++) {
        const x = 160 + i * ((len - 360) / L.platforms);
        const row = i % 5;
        const y = GROUND - (60 + row * 48);
        const bounce = i % 7 === 2;
        const crumble = i % 7 === 5;
        plat(x, y, platLen(i, 56), bounce
          ? { bounce: true }
          : crumble ? { crumble: true, life: 14, maxLife: 14, gone: false } : null);
      }
      for (let i = 0; i < 18; i++) {
        addHazard({
          kind: "laser", x: 420 + i * 500, y: 16, w: 10, h: GROUND - 90,
          on: 24, off: 40, t: i * 9, axis: "v"
        });
      }
      for (let i = 0; i < 10; i++) {
        addSpikeSafe({
          kind: "spike", x: 700 + i * 900, y: GROUND - 14, w: 56, h: 14,
          on: 40, off: 35, t: i * 13, hurt: true
        });
      }
      for (let i = 0; i < 6; i++) {
        addHazard({
          kind: "crusher",
          x: 1100 + i * 1400, yTop: 8, yBot: GROUND - 80, w: 70, h: 28,
          t: i * 17, down: 28, hold: 14, up: 40, phase: "up"
        });
      }
      buildArena(Math.floor(len * 0.55));
    } else if (theme === "storm") {
      // Storm Spire: wind tunnels, movers, vertical lasers, thin rails
      for (let i = 0; i < 14; i++) addHole(480 + i * 620, 80 + (i % 3) * 30);
      for (let i = 0; i < L.platforms; i++) {
        const x = 140 + i * ((len - 320) / L.platforms);
        const row = i % 6;
        const y = GROUND - (55 + row * 48);
        const mover = i % 5 === 0;
        const bounce = i % 5 === 2;
        plat(x, y, platLen(i, 54), mover
          ? { mover: true, ampX: 70, ampY: 28, spd: 0.034, phase: i * 0.7, fy: 1.2 }
          : bounce ? { bounce: true } : null);
      }
      for (let i = 0; i < 16; i++) {
        addHazard({
          kind: "wind", x: 360 + i * 540, y: GROUND - 220, w: 120, h: 220,
          push: (i % 2 === 0 ? 1 : -1) * 0.72, t: i * 11, on: 70, off: 40
        });
      }
      for (let i = 0; i < 14; i++) {
        addHazard({
          kind: "laser", x: 500 + i * 580, y: 12, w: 8, h: GROUND - 100,
          on: 22, off: 48, t: i * 10, axis: "v"
        });
      }
      for (let i = 0; i < 8; i++) {
        addHazard({
          kind: "crusher",
          x: 900 + i * 1000, yTop: 6, yBot: GROUND - 90, w: 64, h: 26,
          t: i * 15, down: 24, hold: 12, up: 36, phase: "up"
        });
      }
      buildArena(Math.floor(len * 0.56));
    } else if (theme === "signal") {
      // Signal Crypt: neon bounce rails, blink lasers, breakable relays
      for (let i = 0; i < 12; i++) addHole(420 + i * 680, 70 + (i % 3) * 28);
      for (let i = 0; i < L.platforms; i++) {
        const x = 130 + i * ((len - 280) / L.platforms);
        const row = i % 5;
        const y = GROUND - (55 + row * 48);
        const bounce = i % 4 === 1;
        const brk = i % 5 === 3;
        plat(x, y, platLen(i, 52), bounce
          ? { bounce: true }
          : brk ? { breakable: true, hp: 3 }
          : (i % 6 === 0 ? { mover: true, ampX: 50, ampY: 16, spd: 0.036, phase: i * 0.8, fy: 1.25 } : null));
      }
      for (let i = 0; i < 14; i++) {
        addHazard({
          kind: "laser", x: 380 + i * 560, y: 16, w: 8, h: GROUND - 90,
          on: 20, off: 44, t: i * 9, axis: "v"
        });
      }
      for (let i = 0; i < 10; i++) {
        addSpikeSafe({
          kind: "spike", x: 600 + i * 780, y: GROUND - 14, w: 70, h: 14,
          on: 50, off: 40, t: i * 12, hurt: true
        });
      }
      buildArena(Math.floor(len * 0.54));
    } else if (theme === "sewers") {
      // Sewers: acid pools + drip hazards + movers over acid
      for (let i = 0; i < 12; i++) {
        const hx = 800 + i * 1300;
        addHole(hx, 140);
        addHazard({
          kind: "acid", x: hx + 10, y: GROUND, w: 120, h: H - GROUND + 20,
          drip: true, t: i * 9
        });
      }
      for (let i = 0; i < L.platforms; i++) {
        const x = 230 + i * ((len - 500) / L.platforms);
        const y = GROUND - (80 + (i % 4) * 48);
        if (i % 4 === 1) {
          plat(x, y, platLen(i, 96), { mover: true, ampX: 55, ampY: 18, spd: 0.035, phase: i * 0.7, fy: 1.3 });
        } else {
          plat(x, y, platLen(i, 78));
        }
      }
      for (let i = 0; i < 14; i++) {
        addHazard({
          kind: "drip", x: 1000 + i * 1100, y: 0, w: 12, h: 16,
          t: i * 21, period: 90, fallY: 0, active: false
        });
      }
      for (let i = 0; i < 5; i++) {
        addHazard({
          kind: "crusher",
          x: 2000 + i * 2800, yTop: 10, yBot: GROUND - 70, w: 80, h: 30,
          t: i * 29, down: 35, hold: 22, up: 55, phase: "up"
        });
      }
      buildArena(Math.floor(len * 0.58));
    } else {
      // Fallback generic
      for (let i = 0; i < 10; i++) addHole(800 + i * 1400, 110);
      for (let i = 0; i < L.platforms; i++) {
        plat(220 + i * ((len - 400) / L.platforms), GROUND - (70 + (i % 4) * 48), platLen(i, 76));
      }
      buildArena(Math.floor(len * 0.5));
    }

    sanitizeLayout();
    placeProps(theme, len);
    placePickups(elevated, L);
    return elevated;
  }

  function buildLevel(idx, skipTalk, keepGun) {
    let secretId = null;
    if (idx === "secret") secretId = state.activeSecret || state.secretKind || "ember";
    else if (typeof idx === "string" && idx.indexOf("secret:") === 0) secretId = idx.slice(7);
    const goingSecret = !!secretId;
    const sDef = goingSecret ? secretDef(secretId) : null;
    const L = goingSecret ? sDef.level : LEVELS[idx];
    if (!goingSecret) {
      state.level = idx;
      state.inSecret = false;
      state.activeSecret = null;
      const hostSecret = secretForHostTheme(L.theme);
      if (!hostSecret) state.secretPortal = null;
    } else {
      state.inSecret = true;
      state.activeSecret = secretId;
    }
    GROUND = L.ground;
    state.endX = L.len;
    state.camX = 0;
    state.bullets = [];
    state.enemies = [];
    state.qrs = [];
    state.staffs = [];
    state.holes = [];
    state.hazards = [];
    state.arena = null;
    state.bossMode = false;
    state.boss = null;
    state.bossPickups = [];
    state.playerHP = 0;
    state.platforms = [];
    state.props = [];
    state.particles = [];
    state.spawnTimer = goingSecret ? 160 : (idx === 0 ? 300 : 220);
    state.grace = skipTalk ? 120 : (idx === 0 && !goingSecret ? 40 : 0);
    state.invuln = hitInvuln();
    const prevGun = keepGun && state.player && (
      (state.player.weapon && state.player.beamFuel > 0) ||
      (state.player.gunBag && state.player.gunBag.length)
    )
      ? {
          weapon: state.player.weapon,
          ammo: state.player.beamFuel,
          bag: (state.player.gunBag || []).slice()
        } : null;
    state.player = makePlayer();
    if (prevGun) {
      state.player.weapon = prevGun.weapon || 0;
      state.player.beamFuel = prevGun.ammo || 0;
      state.player.gunBag = prevGun.bag || [];
    }
    state.messageTimer = 100;
    const tips = {
      docks: "DOCK CRANES · RIDE THE MOVERS",
      tunnel: "LASER GATES · TIME YOUR RUN",
      spire: "CLIMB THE SPIRE · WATCH CRUSHERS",
      slums: "SPIKE ALLEYS · CRUMBLE LEDGES",
      skyrail: "FIND STORM KEY · OPEN THE SPIRE",
      voidmarket: "FIND EMBER KEY · OPEN THE VAULT",
      sewers: "ACID POOLS · CLEAR THE ARENA",
      secret: "EMBER VAULT · CLAIM THE RELIC",
      storm: "STORM SPIRE · RIDE THE THUNDER"
    };
    if (sDef) {
      tips[sDef.level.theme] = sDef.tip;
      if (sDef.hostTheme) tips[sDef.hostTheme] = sDef.hostTip;
    }
    state.banner = L.name + " · " + (tips[L.theme] || "GO!");
    state.tipQ = [];
    state.antiCampCD = 0;
    state.levelTime = Math.floor(sectorTimeBudget() * (goingSecret ? 0.85 : 1));
    state.levelTick = performance.now();
    state.droneTimer = goingSecret ? 120 : 280 + Math.random() * 80;
    state.flash = 0;
    state.flashColor = null;
    state.shake = 0;
    state.hitStop = 0;
    state.grazeCount = 0;
    state.overclockUsed = false;
    state.checkpointX = 80;
    state.hitThisLevel = false;
    state.combo = 0;
    state.comboTimer = 0;
    if (skipTalk) {
      state.talkQ = null;
    } else if (goingSecret && sDef) {
      state.talkQ = sDef.tale;
      state.talkI = 0;
      state.talkT = 0;
    } else {
      state.talkQ = TALES[idx];
      state.talkI = 0;
      state.talkT = 0;
    }

    buildSectorLayout(goingSecret ? 7 : idx, L);

    const waves = goingSecret ? 30 : (idx === 0 ? 10 : 14 + idx * 5);
    for (let i = 0; i < waves; i++) {
      spawnEnemy((goingSecret ? 700 : 1500) + i * (goingSecret ? 150 : 210) + Math.random() * 80, i % 4 === 0 || i % 6 === 0);
    }
  }

  function enterSecretStage() {
    const id = (state.secretPortal && state.secretPortal.secretId) || state.secretKind || "ember";
    const def = secretDef(id);
    if (!def || state.inSecret || isSecretDone(id) || !state.secretKey) return;
    if (state.secretKind && state.secretKind !== id) return;
    state.returnLevel = state.level;
    state.activeSecret = id;
    state.secretKind = id;
    state.secretPortal = null;
    hideOverlay();
    state.mode = "play";
    buildLevel("secret:" + id, false, true);
    sfxArenaClear();
    state.banner = def.enterBanner;
    state.messageTimer = 100;
    state.flash = 14;
    updateHUD();
  }

  function onSecretComplete() {
    const def = activeSecretDef() || SECRETS.ember;
    const leftover = state.qrs.filter(function (q) { return !q.taken; }).length;
    const clearPts = 2000 + Math.max(0, 800 - leftover * 30);
    const timePts = Math.ceil(state.levelTime / 1000) * 20;
    const noHitPts = !state.hitThisLevel ? 2500 : 0;
    const bonus = clearPts + timePts + noHitPts;
    addScore(bonus);
    state.bonusScore += bonus;
    state.secretsDone[def.id] = true;
    state.secretCleared = true;
    state.inSecret = false;
    state.secretKey = false;
    grantWeapon(def.rewardWeapon, def.rewardAmmo);
    if (state.player) state.player.goldT = Math.max(state.player.goldT, def.rewardGold);
    const medals = evaluateSectorMedals({ secret: true });
    saveHiScore(state.score);
    try { localStorage.setItem(def.lsKey, "1"); } catch (e) {}
    state.mode = "clear";
    showOverlay(
      def.clearTitle,
      def.clearBody + "\nBonus +" + bonus +
        (noHitPts ? "\nNO-HIT SECRET +2500" : "") +
        "\n" + def.exitHint +
        "\nScore " + String(state.score).padStart(6, "0") +
        "\n" + formatMedalsLine(medals),
      def.exitLabel,
      { share: true, medals: medals }
    );
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
    { walker: 16, gunner: 26, tank: 20, dasher: 18, flyer: 20 },
    { walker: 12, gunner: 24, tank: 24, dasher: 18, flyer: 22 },
    { walker: 10, gunner: 22, tank: 28, dasher: 16, flyer: 24 }
  ];

  function currentDiff() {
    const base = DIFFS[state.diff] || DIFFS.normal;
    if (!state.ngPlus) return base;
    return {
      id: base.id,
      label: base.label + "+",
      lives: base.lives,
      timeMult: base.timeMult * 0.9,
      spawnMult: base.spawnMult * 0.8,
      hpMult: base.hpMult * 1.3,
      bulletSpd: base.bulletSpd * 1.12,
      invuln: Math.max(85, Math.floor(base.invuln * 0.88)),
      hitPad: Math.max(2, (base.hitPad || 4) - 1)
    };
  }

  function sectorTimeBudget() {
    return Math.floor(135000 * currentDiff().timeMult);
  }

  function syncDiffBtn() {
    if (!hud.diffBtn) return;
    const d = currentDiff();
    hud.diffBtn.textContent = "DIFF: " + d.label;
    hud.diffBtn.setAttribute("data-diff", d.id);
  }

  function cycleDiff() {
    const i = DIFF_ORDER.indexOf(state.diff);
    state.diff = DIFF_ORDER[(i + 1) % DIFF_ORDER.length];
    syncDiffBtn();
    sfxUi();
  }

  function pickRole(forceFlying) {
    if (forceFlying) return "flyer";
    const wi = state.inSecret ? ROLE_WEIGHTS.length - 1 : Math.min(state.level, ROLE_WEIGHTS.length - 1);
    const w = ROLE_WEIGHTS[wi];
    let roll = rnd() * (w.walker + w.gunner + w.tank + w.dasher + w.flyer);
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
    const L = currentLevel();
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
    const eliteChance = (state.inSecret ? 0.16 : (0.07 + state.level * 0.012)) * (state.ngPlus ? 1.55 : 1);
    const elite = !forceFlying && rnd() < eliteChance;
    const rawHp = def.hp + Math.floor(state.level / 2) + (def.heavy ? Math.floor(state.level / 2) : 0);
    const hp = Math.max(1, Math.round(rawHp * (currentDiff().hpMult || 1) * (elite ? 2.2 : 1)));
    const scoreValue = Math.floor((def.score + state.level * 25) * (elite ? 2.6 : 1));
    state.enemies.push({
      x: x, y: flying ? baseY : GROUND - h, w: w, h: h, type: type, kind: def.kind,
      role: role, vx: -L.enemySpeed * def.spd * (elite ? 1.25 : 1), baseSpd: L.enemySpeed * def.spd * (elite ? 1.25 : 1),
      vy: 0, hp: hp, maxHp: hp, scoreValue: scoreValue,
      shootCD: 36 + Math.random() * 40, flash: 0, charge: 0, dashCD: 40 + Math.random() * 50,
      mode: "patrol", facing: -1, alive: true, bob: Math.random() * 20,
      walk: Math.random() * 6, flying: flying, baseY: baseY,
      heavy: !!def.heavy, canShoot: !!def.shoot, canDash: !!def.dash,
      elite: elite,
      shieldUp: elite, shieldHits: 0, shieldCD: 0
    });
    if (elite && state.mode === "play" && state.messageTimer < 20) {
      state.banner = "ELITE · FRONT SHIELD!";
      state.messageTimer = 40;
      beep(220, 0.08, "sawtooth", 0.06);
      beep(440, 0.1, "square", 0.05, 0.06);
    }
  }

  function spawnDrone() {
    const fromRight = Math.random() > 0.5;
    const spd = 1.7 + state.level * 0.25;
    const hp = Math.max(1, Math.round((2 + Math.floor(state.level / 2)) * (currentDiff().hpMult || 1)));
    state.enemies.push({
      x: state.camX + (fromRight ? W + 45 : 30), y: 38, w: 54, h: 30,
      vx: fromRight ? -spd : spd, vy: 0, hp: hp, maxHp: hp,
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
    const spdMul = currentDiff().bulletSpd || 1;
    const spd = (opts.heavy ? 2.6 + state.level * 0.2 : 3.6 + state.level * 0.35) * spdMul;
    state.bullets.push({
      x: muzzle.x, y: muzzle.y, w: opts.heavy ? 16 : 12, h: opts.heavy ? 12 : 8,
      vx: dir * spd, vy: aimY, life: opts.heavy ? 110 : 90, from: "enemy",
      fire: !!opts.heavy, lime: opts.lime || 0, shot: opts.heavy ? "fire" : (opts.lime ? "lime" : "enemy")
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

  function shootGun(aim, opts) {
    opts = opts || {};
    const p = state.player;
    if (!p || p.shootCD > 0) return false;
    assistFacing(p);
    aim = assistSoftAim(p, aim);
    const tip = gunPose(p, aim);
    const def = weaponDef(p.weapon);
    const clock = p.overclockT > 0;
    const spend = function () {
      if (clock) {
        if (p.beamFuel < 6) p.beamFuel = 6;
      } else {
        p.beamFuel -= 1;
      }
    };

    // Pierce / thin beam (RIFLE)
    if (def && def.kind === "beam") {
      if (p.beamFuel <= 0) return false;
      p.shootCD = Math.max(3, Math.floor(def.cd * (clock ? 0.55 : 1)));
      spend();
      const vertical = aim !== 0;
      const ox = tip.x, oy = tip.y;
      const targets = state.bossMode && state.boss ? state.enemies.concat([state.boss]) : state.enemies;
      let hitAny = false;
      for (let i = 0; i < targets.length; i++) {
        const e = targets[i];
        const dx = e.x + e.w / 2 - ox;
        const dy = e.y + e.h / 2 - oy;
        const ahead = vertical ? dy * aim >= 0 : dx * p.facing >= 0;
        const visible = e.x + e.w > state.camX - 20 && e.x < state.camX + W + 20;
        const rayY = vertical ? true : (oy >= e.y - 6 && oy <= e.y + e.h + 6);
        const rayX = vertical ? (ox >= e.x - 6 && ox <= e.x + e.w + 6) : true;
        if (e.alive && visible && ahead && rayX && rayY) {
          damageEnemy(e, def.dmg, p.facing, { knock: def.knock, antiShield: def.antiShield || 0 });
          hitAny = true;
          if (!def.pierce && !e.elite) break;
        }
      }
      muzzleSparks(tip, def.color);
      sfxBeam(p.weapon);
      if (def.shake) addJuice({ shake: def.shake * (hitAny ? 1.2 : 0.6) });
      return true;
    }

    // Shotgun pellets (SPREAD)
    if (def && def.kind === "pellets") {
      if (p.beamFuel <= 0) return false;
      p.shootCD = Math.max(4, Math.floor(def.cd * (clock ? 0.55 : 1)));
      spend();
      const n = def.pellets || 5;
      const base = tip.a != null ? tip.a : (aim ? (aim < 0 ? -Math.PI / 2 : Math.PI / 2) : (p.facing > 0 ? 0 : Math.PI));
      const cone = def.spread || 0.42;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
        const ang = base + t * cone + (Math.random() - 0.5) * 0.06;
        const spd = 10.2 + Math.random() * 2.2;
        state.bullets.push({
          x: tip.x - 4, y: tip.y - 3, w: 10, h: 6,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: 26 + (Math.random() * 10) | 0, from: "player",
          slug: true, shot: "spread", dmg: def.dmg, color: def.color, knock: def.knock
        });
      }
      muzzleSparks(tip, def.color);
      explode(tip.x, tip.y, def.color, 6);
      noiseBurst(0.06, 0.07, 0, 1400);
      beep(220, 0.06, "sawtooth", 0.06);
      addJuice({ shake: def.shake || 2 });
      return true;
    }

    // MAXI charge release
    if (def && def.kind === "charge") {
      if (p.beamFuel <= 0) return false;
      const power = Math.max(1, Math.min(3, opts.power || Math.floor((p.maxiCharge || 0) / 18) || 1));
      p.shootCD = Math.max(8, Math.floor(def.cd * (clock ? 0.55 : 1)));
      spend();
      const dmg = def.dmg + power;
      state.bullets.push({
        x: tip.x - 8, y: tip.y - 8, w: 12 + power * 4, h: 12 + power * 3,
        vx: aim ? 0 : p.facing * (11 + power), vy: aim ? aim * (10 + power) : 0,
        life: 55, from: "player", charged: true, shot: "maxi", dmg: dmg, color: def.color,
        knock: def.knock, antiShield: 2
      });
      muzzleSparks(tip, def.color);
      explode(tip.x, tip.y, def.color, 8 + power * 4);
      slideBeep(180, 1100, 0.14, "sawtooth", 0.09);
      addJuice({ shake: (def.shake || 6) * (0.5 + power * 0.35), flash: 6 + power * 2, flashColor: "rgba(255,43,214,0.35)" });
      p.maxiCharge = 0;
      return true;
    }

    // Homing / Rico projectiles
    if (def && def.kind === "proj") {
      if (p.beamFuel <= 0) return false;
      p.shootCD = Math.max(4, Math.floor(def.cd * (clock ? 0.55 : 1)));
      spend();
      if (def.homing) {
        const spd = clock ? 8.6 : 7.4;
        state.bullets.push({
          x: tip.x - 4, y: tip.y - 4, w: 10, h: 10,
          vx: p.facing * spd, vy: aim ? aim * spd * 0.85 : 0,
          life: 120, from: "player",
          homing: true, shot: "homing", dmg: def.dmg, color: def.color, knock: def.knock
        });
        muzzleSparks(tip, def.color);
        slideBeep(900, 1400, 0.08, "square", 0.05);
      } else {
        const bounces = def.bounces || 5;
        if (aim) {
          state.bullets.push({
            x: tip.x - 4, y: tip.y - 4, w: 8, h: 8,
            vx: p.facing * 3.4, vy: aim * 9.8, life: 150, from: "player",
            rico: true, shot: "rico", bounces: bounces, dmg: def.dmg, color: def.color, knock: def.knock
          });
        } else {
          state.bullets.push({
            x: tip.x - (p.facing < 0 ? 8 : 0), y: tip.y - 3, w: 10, h: 6,
            vx: p.facing * 11, vy: -2.4, life: 150, from: "player",
            rico: true, shot: "rico", bounces: bounces, dmg: def.dmg, color: def.color, knock: def.knock
          });
        }
        muzzleSparks(tip, def.color);
        beep(520, 0.05, "triangle", 0.06);
        beep(780, 0.04, "square", 0.04, 0.03);
      }
      if (def.shake) addJuice({ shake: def.shake });
      return true;
    }

    // Shock wave cone
    if (def && def.kind === "wave") {
      if (p.beamFuel <= 0) return false;
      p.shootCD = Math.max(6, Math.floor(def.cd * (clock ? 0.55 : 1)));
      spend();
      const range = def.range || 150;
      const targets = state.bossMode && state.boss ? state.enemies.concat([state.boss]) : state.enemies;
      for (let i = 0; i < targets.length; i++) {
        const e = targets[i];
        if (!e.alive) continue;
        const dx = (e.x + e.w / 2) - tip.x;
        const dy = (e.y + e.h / 2) - tip.y;
        const dist = Math.hypot(dx, dy);
        if (dist > range) continue;
        const ahead = dx * p.facing >= -20;
        const cone = Math.abs(dy) < 70 + dist * 0.35;
        if (ahead && cone) {
          damageEnemy(e, def.dmg, p.facing, { knock: def.knock, antiShield: def.antiShield || 2 });
        }
      }
      state.particles.push({
        x: tip.x, y: tip.y, vx: p.facing * 2, vy: 0, life: 18,
        color: def.color, wave: true, facing: p.facing, range: range, noGrav: true
      });
      for (let k = 0; k < 14; k++) {
        state.particles.push({
          x: tip.x, y: tip.y + (Math.random() - 0.5) * 50,
          vx: p.facing * (4 + Math.random() * 6), vy: (Math.random() - 0.5) * 2.5,
          life: 14 + Math.random() * 12, color: def.color, noGrav: true
        });
      }
      beep(300, 0.08, "sawtooth", 0.07);
      beep(160, 0.1, "square", 0.05, 0.04);
      addJuice({ shake: def.shake || 3, flash: 5, flashColor: "rgba(103,232,249,0.25)" });
      return true;
    }

    // Lobbed pulse orb
    if (def && def.kind === "pulse") {
      if (p.beamFuel <= 0) return false;
      p.shootCD = Math.max(8, Math.floor(def.cd * (clock ? 0.55 : 1)));
      spend();
      state.bullets.push({
        x: tip.x - 6, y: tip.y - 6, w: 14, h: 14,
        vx: p.facing * 6.2, vy: aim ? aim * 7 : -5.5,
        life: 90, from: "player", pulse: true, shot: "pulse", dmg: def.dmg, color: def.color,
        knock: def.knock, antiShield: def.antiShield || 3, grav: 0.28
      });
      muzzleSparks(tip, def.color);
      beep(180, 0.07, "triangle", 0.06);
      beep(420, 0.05, "square", 0.04, 0.05);
      addJuice({ shake: 2 });
      return true;
    }

    // Charged pistol blast
    if (!def && p.charge >= 28) {
      p.shootCD = clock ? 10 : 16;
      const power = Math.min(3, 1 + Math.floor(p.charge / 20));
      state.bullets.push({
        x: tip.x - 6, y: tip.y - 6, w: 14, h: 12,
        vx: (aim ? 0 : p.facing * 13), vy: aim ? aim * 12 : 0,
        life: 70, from: "player", charged: true, shot: "maxi", dmg: power, color: N("gold"), knock: 14
      });
      muzzleSparks(tip, N("gold"));
      explode(tip.x, tip.y, N("gold"), 10);
      slideBeep(200, 900, 0.12, "sawtooth", 0.08);
      addJuice({ shake: 3 + power });
      p.charge = 0;
      return true;
    }

    // Default pistol burst
    p.shootCD = clock ? 5 : 10;
    let assistVy = 0;
    if (assistOn && !aim) {
      const e = nearestEnemy(tip.x, tip.y, p.facing);
      if (e) {
        const dy = (e.y + e.h / 2) - tip.y;
        const dx = Math.abs((e.x + e.w / 2) - tip.x) || 1;
        assistVy = Math.max(-2.4, Math.min(2.4, dy / dx * 2.2));
      }
    }
    for (let i = -1; i <= 1; i++) {
      if (aim) {
        state.bullets.push({
          x: tip.x - 5 + i * 6, y: tip.y - 5, w: 8, h: 12,
          vx: i * 1.1, vy: aim * 11, life: 55, from: "player",
          slug: true, shot: "pistol", dmg: 1, knock: 6, color: N("gold")
        });
      } else {
        state.bullets.push({
          x: tip.x - (p.facing < 0 ? 12 : 0), y: tip.y - 3 + i * 5, w: 14, h: 6,
          vx: p.facing * 11, vy: i * 0.9 + assistVy, life: 80, from: "player",
          slug: true, shot: "pistol", dmg: 1, knock: 6, color: N("gold")
        });
      }
    }
    muzzleSparks(tip, N("silver"));
    sfxShoot();
    return true;
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

  function pulseExplode(b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    explode(cx, cy, b.color || N("orange"), 28);
    addJuice({ shake: 7, hitStop: 3, flash: 8, flashColor: "rgba(249,115,22,0.35)" });
    beep(90, 0.12, "sawtooth", 0.08);
    const targets = state.bossMode && state.boss ? state.enemies.concat([state.boss]) : state.enemies;
    for (let i = 0; i < targets.length; i++) {
      const e = targets[i];
      if (e.alive === false) continue;
      const d = Math.hypot(e.x + e.w / 2 - cx, e.y + e.h / 2 - cy);
      if (d < 78) {
        damageEnemy(e, b.dmg || 4, Math.sign((e.x + e.w / 2) - cx) || 1, {
          knock: 18, antiShield: b.antiShield || 3
        });
      }
    }
  }

  function addJuice(opts) {
    opts = opts || {};
    if (fxOn) {
      if (opts.shake) state.shake = Math.min(24, Math.max(state.shake || 0, opts.shake));
      if (opts.hitStop) state.hitStop = Math.max(state.hitStop || 0, opts.hitStop | 0);
    }
    if (opts.flash) state.flash = Math.max(state.flash || 0, opts.flash);
    if (opts.flashColor) state.flashColor = opts.flashColor;
  }

  function tickJuice() {
    if (state.shake > 0) state.shake = Math.max(0, state.shake - 0.9);
    if (state.flash > 0) {
      state.flash--;
      if (state.flash <= 0) state.flashColor = null;
    }
  }

  function damageEnemy(e, damage, dir, opts) {
    opts = opts || {};
    if (e.boss) {
      if (!e.vulnerable || e.hitCD > 0) return;
      e.hitCD = 4;
      e.hp -= Math.max(1, damage | 0);
      addScore(25);
      explode(e.x + e.w / 2, e.y + 35, "#39ff14", 5);
      sfxBossHit();
      addJuice({ shake: 2.5, hitStop: 1 });
      if (e.hp <= 0) {
        e.alive = false;
        const mid = !!e.midBoss;
        addScore(mid ? 3000 : 5000);
        noteKill({
          points: mid ? 3000 : 5000,
          x: e.x + e.w / 2,
          y: e.y + 20,
          color: mid ? "#e879f9" : "#ef4444"
        });
        explode(e.x + e.w / 2, e.y + e.h / 2, mid ? "#e879f9" : "#ef4444", 50);
        addJuice({ shake: 18, hitStop: 12, flash: 22, flashColor: mid ? "rgba(232,121,249,0.45)" : "rgba(239,68,68,0.45)" });
        saveHiScore(state.score);
        state.bossMode = false;
        state.boss = null;
        state.hazards = [];
        state.arena = null;
        if (mid) {
          state.banner = "PULSE WARDEN DOWN!";
          state.messageTimer = 90;
          state._bossClear = true;
          onLevelComplete();
        } else {
          startCredits();
        }
      }
      return;
    }
    // Elite frontal shield
    if (e.elite && e.shieldUp) {
      const hitDir = (dir || 0) !== 0 ? dir : ((state.player && state.player.facing) || 1);
      const fromFront = (e.facing || -1) * hitDir < 0;
      const crack = (opts && opts.antiShield) || 0;
      if (fromFront && crack < 2) {
        e.shieldHits = (e.shieldHits || 0) + 1 + crack;
        e.flash = 5;
        beep(880, 0.04, "square", 0.05);
        beep(440, 0.05, "triangle", 0.03, 0.03);
        pushScorePop(e.x + e.w / 2, e.y, "BLOCK", N("gold"));
        if (e.shieldHits >= 6) {
          e.shieldUp = false;
          e.shieldCD = 90;
          e.shieldHits = 0;
          state.banner = "SHIELD OPEN — FLANK!";
          state.messageTimer = 45;
          explode(e.x + e.w / 2, e.y + 20, N("gold"), 12);
        }
        return;
      }
      if (fromFront && crack >= 2) {
        e.shieldUp = false;
        e.shieldCD = 70;
        e.shieldHits = 0;
        pushScorePop(e.x + e.w / 2, e.y, "SHIELD BREAK", N("orange"));
        addJuice({ shake: 4, flash: 5, flashColor: "rgba(249,115,22,0.35)" });
      }
    }
    const knock = (opts && opts.knock != null) ? opts.knock : (e.heavy ? 8 : 18);
    e.hp -= damage;
    e.x += (dir || 1) * (e.heavy ? Math.min(10, knock * 0.45) : knock * 0.7);
    e.flash = 6;
    explode(e.x + e.w / 2, e.y + e.h / 2, e.heavy ? N("cyan2") : N("cyan"), e.heavy ? 8 : 6);
    sfxHit();
    addJuice({ shake: e.heavy ? 2 : 1.2, hitStop: e.heavy ? 1 : 0 });
    if (e.hp <= 0) {
      e.alive = false;
      const pts = e.scoreValue || (100 + e.kind * 50);
      addScore(pts);
      noteKill({
        points: pts,
        x: e.x + e.w / 2,
        y: e.y + e.h / 2,
        color: e.elite ? N("gold2") : undefined
      });
      explode(e.x + e.w / 2, e.y + e.h / 2, e.elite ? N("gold2") : N("pink"), e.elite ? 28 : (e.heavy ? 22 : 14));
      sfxKill();
      if (e.elite) {
        state.banner = "ELITE DOWN! +" + pts;
        state.messageTimer = 50;
        addJuice({ shake: 8, hitStop: 3, flash: 8, flashColor: "rgba(251,191,36,0.35)" });
        if (rnd() < 0.55) {
          const drop = WEAPON_ORDER[(Math.random() * WEAPON_ORDER.length) | 0];
          dropWeaponPickup(drop, Math.floor(weaponDef(drop).ammo * 0.45), e.x, e.y);
          pushScorePop(e.x, e.y - 16, "GUN DROP", weaponColor(drop));
        }
      } else {
        addJuice({
          shake: e.heavy ? 7 : (e.drone ? 4 : 3.5),
          hitStop: e.heavy ? 3 : 2,
          flash: e.heavy ? 6 : 0
        });
      }
    }
  }

  function startBossFight(kind) {
    const mid = kind === "mid";
    const p = state.player;
    state.bossMode = true;
    GROUND = BOSS_GROUND;
    state.camX = 0;
    state.endX = W;
    state.levelTime = sectorTimeBudget();
    state.levelTick = performance.now();
    state.enemies = [];
    state.bullets = [];
    state.qrs = [];
    state.staffs = [];
    state.holes = [];
    state.hazards = [];
    state.arena = null;
    state.platforms = [];
    addPlatform(80, GROUND - 290, 180, { skin: 0 });
    addPlatform(480, GROUND - 340, 220, { skin: 1 });
    if (mid) {
      addPlatform(280, GROUND - 160, 140, { skin: 0 });
      addHazard({
        kind: "laser", x: 380, y: 40, w: 10, h: GROUND - 180,
        on: 40, off: 70, t: 0, axis: "v"
      });
    }
    state.playerHP = mid ? 2 : 3;
    state.grace = 0;
    p.x = 55; p.y = GROUND - p.h; p.vx = 0; p.vy = 0; p.safeX = 55;
    p.weapon = 0; p.beamFuel = 0; p.gunBag = []; p.speedT = 0; p.goldT = 0; p.charge = 0;
    const hp = mid ? Math.floor(58 * (state.diff === "easy" ? 0.85 : state.diff === "hard" ? 1.2 : 1))
      : Math.floor(120 * (state.diff === "easy" ? 0.85 : state.diff === "hard" ? 1.15 : 1));
    state.boss = {
      boss: true, midBoss: mid, alive: true, vulnerable: false, x: mid ? 580 : 620, y: GROUND - (mid ? 96 : 112),
      w: mid ? 68 : 78, h: mid ? 96 : 112,
      hp: hp, maxHp: hp, hitCD: 0, mode: "idle", timer: 9999, vx: 0, vy: 0,
      facing: -1, laserAimX: 200, laserAimY: 280, slamX: 400, phase: 1, walk: 0, eyeCD: 0,
      title: mid ? "PULSE WARDEN" : "REDCORE SENTINEL",
      aggro: mid ? 1.4 : 1,
      accent: mid ? "#e879f9" : "#ef4444",
      accentHot: mid ? "#ff2bd6" : "#ff7a12",
      phaseFlash: 0,
      pulseR: 0,
      dashDir: -1,
      pillars: [],
      warnedPhase2: false
    };
    state.bossPickups = [
      { x: 160, y: GROUND - 336, w: 32, h: 36, type: "health", taken: false, respawn: 0 },
      { x: 520, y: GROUND - 386, w: 36, h: 34, type: "weapon", taken: false, respawn: 0 }
    ];
    state.talkQ = mid
      ? [
        { who: "YOU", line: "Pulse Warden—stand aside!" },
        { who: "BOSS", line: "SPIRE SIGNAL LOCKED." },
        { who: "YOU", line: "Then I'll break the lock." },
        { who: "BOSS", line: "PULSE… OVERLOAD." }
      ]
      : [
        { who: "YOU", line: "Redcore Sentinel—stand down!" },
        { who: "BOSS", line: "THE CORE IS OURS." },
        { who: "YOU", line: "Faith and code will free it." },
        { who: "BOSS", line: "THEN BE ERASED." }
      ];
    state.talkI = 0;
    state.talkT = 0;
    state.banner = mid
      ? "PULSE WARDEN — \"HEARTBEAT LOCKED\""
      : "REDCORE SENTINEL — \"WAREHOUSE OWNS YOU\"";
    state.messageTimer = 110;
    state.invuln = 9999;
    addJuice({ shake: 5, flash: 8, flashColor: mid ? "rgba(232,121,249,0.3)" : "rgba(239,68,68,0.32)" });
  }

  function startBoss() {
    startBossFight("final");
  }

  function startMidBoss() {
    startBossFight("mid");
  }

  function setGodMode(on) {
    state.godMode = !!on;
    if (state.godMode && state.player) {
      state.invuln = 9999;
      state.player.goldT = Math.max(state.player.goldT || 0, 9999);
      if (state.player.weapon) state.player.beamFuel = Math.max(state.player.beamFuel, 999);
      else grantWeapon("MAXI", 2);
    } else {
      state.invuln = 0;
      if (state.player) {
        state.player.goldT = 0;
      }
    }
    if (hud.godBtn) {
      hud.godBtn.textContent = state.godMode ? "GOD: ON" : "GOD: OFF";
      hud.godBtn.setAttribute("aria-pressed", state.godMode ? "true" : "false");
      hud.godBtn.classList.toggle("is-on", state.godMode);
    }
    if (state.godMode) {
      state.banner = "GOD MODE ON";
      state.messageTimer = 60;
    } else {
      state.banner = "GOD MODE OFF";
      state.messageTimer = 45;
    }
    updateHUD();
  }

  function toggleGodMode() {
    setGodMode(!state.godMode);
    sfxUi();
  }

  function hurtPlayer(respawnX, cause) {
    if (state.godMode) return;
    if (state.mode !== "play") return;
    // Traversal audit: combat skill is not what we're measuring, so only
    // environmental deaths (pits, spikes, lasers, crushers, acid) count.
    if (qaBot.on && qaBot.traversal) {
      const c = cause || "default";
      qaBot.causes[c] = (qaBot.causes[c] || 0) + 1;
      if (c === "enemy" || c === "bullet" || c === "boss") return;
    }
    if (state.invuln > 0) return;
    if (state.player && state.player.goldT > 0) return;
    const p = state.player;
    state.hitThisLevel = true;
    state.combo = 0;
    state.comboTimer = 0;
    state.deathCause = cause || state.deathCause || "default";
    if (p.weapon && p.beamFuel > 0) {
      if (!p.gunBag) p.gunBag = [];
      p.gunBag.unshift({ type: p.weapon, ammo: p.beamFuel });
      while (p.gunBag.length > GUN_BAG_MAX) {
        const overflow = p.gunBag.pop();
        if (overflow) dropWeaponPickup(overflow.type, overflow.ammo, p.x + 16, p.y - 8);
      }
    }
    p.weapon = 0;
    p.beamFuel = 0;
    p.charge = 0;
    p.maxiCharge = 0;
    p.maxiPending = 0;
    p.overclockT = 0;
    if (state.bossMode && state.playerHP > 1) {
      state.playerHP--;
      state.invuln = hitInvuln();
      state.flash = 14;
      p.vx = -p.facing * 4;
      sfxHurt();
      explode(p.x + 14, p.y + 28, "#ffd400", 10);
      addJuice({ shake: 8, hitStop: 4, flash: 14, flashColor: "rgba(255,43,214,0.35)" });
      state.banner = "SHIELD HIT — " + state.playerHP + " LEFT";
      state.messageTimer = 45;
      return;
    }
    const deathX = p.x;
    const wasLastLife = state.lives === 1;
    state.lives = Math.max(0, state.lives - 1);
    state.flash = 18;
    deathBeep();
    explode(p.x + 14, p.y + 28, "#ffd400", 10);
    addJuice({ shake: 14, hitStop: wasLastLife ? 14 : 8, flash: 20, flashColor: "rgba(255,60,60,0.4)" });
    if (state.lives <= 0) {
      state.failRespawnX = respawnX != null ? respawnX : deathX;
      state.lastStand = false;
      failTeam();
      return;
    }
    if (state.lives === 1 && !state.lastStand) {
      state.lastStand = true;
      addJuice({ shake: 10, hitStop: 18, flash: 16, flashColor: "rgba(255,43,214,0.45)" });
      state.banner = "⚠ LAST STAND — ONE LIFE LEFT";
      state.messageTimer = 90;
      beep(180, 0.18, "sawtooth", 0.09);
      beep(90, 0.22, "square", 0.07, 0.08);
    }
    // Still have lives — respawn at furthest checkpoint / safe ground
    let rx = state.checkpointX || 80;
    if (respawnX != null && respawnX !== "time") rx = Math.max(rx, respawnX);
    p.x = Math.max(40, rx);
    p.y = GROUND - p.h;
    p.vx = 0;
    p.vy = 0;
    p.speedT = 0;
    p.goldT = 0;
    p.safeX = p.x;
    p.onGround = false;
    state.camX = Math.max(0, Math.min(p.x - 180, state.endX - W));
    if (state.bossMode) state.playerHP = state.boss && state.boss.midBoss ? 2 : 3;
    state.invuln = hitInvuln();
    state.banner = "DOWN! " + deathTipText(state.deathCause);
    state.messageTimer = 95;
    updateHUD();
  }

  function failTeam() {
    if (state.demo) {
      stopAttract();
      return;
    }
    state.mode = "failed";
    state.failAt = performance.now() + 4200;
    addJuice({ shake: 16, flash: 24, flashColor: "rgba(255,40,40,0.5)" });
    const record = saveHiScore(state.score);
    const dailyRec = saveDailyBest(state.score);
    const tip = deathTipText(state.failRespawnX === "time" ? "time" : (state.deathCause || "default"));
    showOverlay(
      "YOUR TEAM HAS FAILED",
      "Score: " + state.score + (record ? " ★ NEW HI!" : "") +
        (dailyRec ? "\n★ NEW DAILY BEST!" : (state.daily ? "\n" + dailyBestLine() : "")) +
        "\nHI: " + state.hiScore +
        "\n" + formatRunSummary() +
        "\nTip: " + tip +
        "\nSector " + (state.level + 1) + " · Continue keeps score",
      "CONTINUE",
      { share: true, medals: state.runMedals }
    );
    hud.startBtn.style.display = "none";
    stopMusic();
    updateHUD();
  }

  function continueAfterFail() {
    // Continue from current sector checkpoint — keep score, refill lives
    const lvl = state.level;
    const sc = state.score;
    const nextLife = state.nextLifeAt;
    const ck = state.checkpointX || 80;
    const resumeSecret = !!state.inSecret;
    const hadKey = state.secretKey;
    const sid = state.activeSecret || state.secretKind || "ember";
    hideOverlay();
    state.mode = "play";
    state.lives = currentDiff().lives;
    state.lastStand = false;
    state.score = sc;
    state.nextLifeAt = nextLife;
    state.failAt = 0;
    buildLevel(resumeSecret ? ("secret:" + sid) : lvl, true, true);
    if (resumeSecret) {
      state.secretKey = hadKey;
      state.secretKind = sid;
      state.activeSecret = sid;
      state.inSecret = true;
    }
    if (state.player) {
      state.player.x = Math.max(80, ck);
      state.player.safeX = state.player.x;
      state.player.y = GROUND - state.player.h;
      state.camX = Math.max(0, Math.min(state.player.x - 180, state.endX - W));
      state.checkpointX = state.player.x;
    }
    startTechno();
    const sName = resumeSecret && secretDef(sid) ? secretDef(sid).level.name : null;
    state.banner = resumeSecret ? ("CONTINUE — " + sName) : ("CONTINUE — SECTOR " + (lvl + 1));
    state.messageTimer = 90;
    updateHUD();
    postParent({ type: "dg-chrome", inGame: true });
    if (wantsTouchUI()) {
      enterFullscreen();
      setTimeout(fit, 100);
    }
  }

  function retrySector() {
    if (state.mode !== "play" && state.mode !== "paused") return;
    hideOverlay();
    state.mode = "play";
    state.pauseMusicWasOn = false;
    const sc = state.score;
    const lives = Math.max(1, state.lives);
    const nextLife = state.nextLifeAt;
    const wasSecret = !!state.inSecret;
    const hadKey = state.secretKey;
    const sid = state.activeSecret || state.secretKind || "ember";
    buildLevel(wasSecret ? ("secret:" + sid) : state.level, true, true);
    if (wasSecret) {
      state.secretKey = hadKey;
      state.secretKind = sid;
      state.activeSecret = sid;
      state.inSecret = true;
    }
    state.score = sc;
    state.lives = lives;
    state.nextLifeAt = nextLife;
    startTechno();
    state.banner = wasSecret ? "SECRET RETRY" : "SECTOR RETRY";
    state.messageTimer = 70;
    updateHUD();
    postParent({ type: "dg-chrome", inGame: true });
  }

  function pauseGame() {
    if (state.mode !== "play" || state.demo) return;
    state.mode = "paused";
    state.pauseMusicWasOn = musicOn;
    if (musicOn) {
      try { musicTrack.pause(); } catch (e) {}
      musicOn = false;
    }
    if (hud.pauseBtn) {
      hud.pauseBtn.setAttribute("aria-pressed", "true");
      hud.pauseBtn.textContent = "RESUME";
    }
    showOverlay(
      "PAUSED",
      "Score " + state.score + " · HI " + state.hiScore +
        "\nCombo ×" + state.combo + " · Max ×" + state.maxCombo +
        "\nLives ♥×" + state.lives + " · Time " + Math.max(0, Math.ceil(state.levelTime / 1000)) + "s" +
        "\nGoals: " + (!state.hitThisLevel ? "NO-HIT" : "hit") +
        " · " + ((state.combo >= 8 || state.maxCombo >= 8) ? "COMBO" : "combo…") +
        " · " + (state.levelTime > sectorTimeBudget() * 0.45 ? "SPEED" : "speed…") +
        "\n" + sectorPbLine(state.level) +
        "\nQ / SWAP backup gun · P resume · R retry",
      "RESUME",
      { keepPlaying: true }
    );
  }

  function resumeGame() {
    if (state.mode !== "paused") return;
    hideOverlay();
    state.mode = "play";
    if (state.pauseMusicWasOn && !muted) startTechno();
    state.pauseMusicWasOn = false;
    if (hud.pauseBtn) {
      hud.pauseBtn.setAttribute("aria-pressed", "false");
      hud.pauseBtn.textContent = "PAUSE";
    }
    postParent({ type: "dg-chrome", inGame: true });
    fit();
  }

  function onTimeUp() {
    state.lives = Math.max(0, state.lives - 1);
    state.hitThisLevel = true;
    state.combo = 0;
    state.deathCause = "time";
    deathBeep();
    if (state.lives <= 0) {
      state.failRespawnX = "time";
      failTeam();
      return;
    }
    const ck = state.checkpointX || 80;
    const sc = state.score;
    const nextLife = state.nextLifeAt;
    const resumeSecret = !!state.inSecret;
    const hadKey = state.secretKey;
    const sid = state.activeSecret || state.secretKind || "ember";
    buildLevel(resumeSecret ? ("secret:" + sid) : state.level, true, true);
    if (resumeSecret) {
      state.secretKey = hadKey;
      state.secretKind = sid;
      state.activeSecret = sid;
      state.inSecret = true;
    }
    state.score = sc;
    state.nextLifeAt = nextLife;
    if (state.player) {
      state.player.x = Math.max(80, ck);
      state.player.safeX = state.player.x;
      state.player.y = GROUND - state.player.h;
      state.camX = Math.max(0, Math.min(state.player.x - 180, state.endX - W));
      state.checkpointX = state.player.x;
    }
    state.invuln = hitInvuln();
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
    markGameCleared();
    const record = saveHiScore(state.score);
    const dailyRec = saveDailyBest(state.score);
    evaluateSectorMedals({ boss: true });
    const medals = formatMedalsLine(state.runMedals);
    sfxClear();
    showOverlay(
      state.ngPlus ? "NG+ COMPLETE" : "MISSION COMPLETE",
      "Warehouse core secure!\nFinal Score: " + state.score +
        (record ? "\n★ NEW HIGH SCORE!" : "\nHI: " + state.hiScore) +
        (dailyRec ? "\n★ NEW DAILY BEST!" : (state.daily ? "\n" + dailyBestLine() : "")) +
        (state.ngPlus ? "\n★ NEW GAME+ · 1.5× SCORE" : (hasClearedOnce() ? "\n★ NG+ unlocked on title" : "")) +
        "\n" + formatRunSummary() +
        "\n" + medals +
        "\nby 8bitcrypto_44",
      "PLAY AGAIN",
      { share: true, medals: state.runMedals }
    );
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

  function showOverlay(title, sub, btn, opts) {
    opts = opts || {};
    hud.overlay.style.display = "flex";
    hud.title.textContent = title;
    hud.sub.textContent = sub;
    hud.startBtn.textContent = btn || "START";
    hud.startBtn.style.display = "";
    const onTitle = state.mode === "title" || title === "DIGISTRACTS";
    const shareable = !!(opts.share || state.mode === "clear" || state.mode === "failed" || title === "MISSION COMPLETE");
    setShareVisible(shareable && !onTitle);
    if (onTitle) renderMedalsUI(true, null, true);
    else renderMedalsUI(shareable, opts.medals || state.lastMedals || state.runMedals, false);
    if (hud.dailyBtn) hud.dailyBtn.style.display = onTitle ? "" : "none";
    if (hud.ngBtn) {
      const showNg = onTitle && hasClearedOnce();
      hud.ngBtn.style.display = showNg ? "" : "none";
      if (showNg) {
        hud.ngBtn.classList.remove("is-on");
        hud.ngBtn.setAttribute("aria-pressed", "false");
        hud.ngBtn.textContent = "NG+";
      }
    }
    if (hud.assistBtn) {
      hud.assistBtn.style.display = onTitle ? "" : "none";
      if (onTitle) syncAssistBtn();
    }
    if (hud.diffBtn) {
      hud.diffBtn.style.display = onTitle ? "" : "none";
      if (onTitle) syncDiffBtn();
    }
    if (hud.godBtn) {
      const showGod = GOD_QS && onTitle;
      hud.godBtn.style.display = showGod ? "" : "none";
      if (showGod) {
        hud.godBtn.textContent = state.godMode ? "GOD: ON" : "GOD: OFF";
        hud.godBtn.setAttribute("aria-pressed", state.godMode ? "true" : "false");
        hud.godBtn.classList.toggle("is-on", state.godMode);
      }
    }
    if (hud.levels) {
      const showLevels = GOD_QS && onTitle;
      hud.levels.classList.toggle("is-on", showLevels);
      hud.levels.style.display = showLevels ? "" : "none";
    }
    ROOT.classList.add("dg-menu");
    if (!opts.keepPlaying) {
      postParent({ type: "dg-chrome", inGame: false });
    }
  }

  function hideOverlay() {
    hud.overlay.style.display = "none";
    if (hud.levels) {
      hud.levels.classList.remove("is-on");
      hud.levels.style.display = "none";
    }
    setShareVisible(false);
    renderMedalsUI(false);
    ROOT.classList.remove("dg-menu");
    fit();
  }

  function titleBootSub() {
    let bootHint = "";
    try {
      if (localStorage.getItem("dg-secret") === "1") bootHint += "\n★ Ember Vault discovered";
      if (localStorage.getItem("dg-secret-storm") === "1") bootHint += "\n★ Storm Spire discovered";
      if (localStorage.getItem("dg-secret-signal") === "1") bootHint += "\n★ Signal Crypt discovered";
    } catch (e) {}
    if (GOD_QS) {
      if (state.godMode) bootHint += "\nGOD MODE ready · press G anytime";
      return wantsTouchUI()
        ? "by 8bitcrypto_44 · TEST BUILD\nHI " + state.hiScore + bootHint +
          "\nGOD + level buttons · stick + JUMP / FIRE"
        : "by 8bitcrypto_44 · TEST / GOD MODE\nHI " + state.hiScore + bootHint +
          "\nToggle GOD · pick a level · G key in-game";
    }
    return wantsTouchUI()
      ? "by 8bitcrypto_44\nHI " + state.hiScore + " · " + dailyBestLine() + bootHint +
        "\nDAILY · AIM assist · stick + JUMP / FIRE / SWAP"
      : "by 8bitcrypto_44\nHI " + state.hiScore + " · " + dailyBestLine() + bootHint +
        "\nPRESS START or DAILY · Q swap guns · idle = demo" +
        (hasClearedOnce() ? " · NG+ ready" : "");
  }

  function startAttract() {
    if (state.mode !== "title" || GOD_QS) return;
    ensureAudio();
    hideOverlay();
    state.demo = true;
    state.demoAt = performance.now();
    state.score = 0;
    state.lives = 5;
    state.level = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.checkpointX = 80;
    state.inSecret = false;
    state.secretKey = false;
    state.daily = false;
    resetRunStats();
    state.mode = "play";
    buildLevel(0, true, false);
    if (state.player) {
      grantWeapon("SPREAD", 0.7);
      grantWeapon("RIFLE", 0.5);
    }
    demoAI.x = 1;
    demoAI.jump = false;
    demoAI.shoot = true;
    demoAI.up = false;
    demoAI.down = false;
    demoAI.think = 0;
    state.banner = "DEMO · PRESS START";
    state.messageTimer = 99999;
    startTechno();
    updateHUD();
    postParent({ type: "dg-chrome", inGame: false });
  }

  function stopAttract() {
    if (!state.demo) return;
    state.demo = false;
    stopMusic();
    state.mode = "title";
    state.player = null;
    state.enemies = [];
    state.bullets = [];
    state.bossMode = false;
    state.boss = null;
    state.messageTimer = 0;
    demoAI.x = 0;
    demoAI.jump = false;
    demoAI.shoot = false;
    bumpTitleIdle();
    showOverlay("DIGISTRACTS", titleBootSub(), "PRESS START");
    updateHUD();
    postParent({ type: "dg-chrome", inGame: false });
  }

  function tickDemoAI() {
    if (!state.demo || !state.player) return;
    const p = state.player;
    demoAI.think++;
    demoAI.x = 1;
    demoAI.shoot = true;
    demoAI.up = false;
    demoAI.down = false;
    const ahead = p.x + p.facing * 50;
    const hole = isHoleAt(ahead) || isHoleAt(p.x + p.w / 2 + 28);
    demoAI.jump = !!(hole || (demoAI.think % 95 < 8) || (!p.onGround && p.vy > 2));
    const foe = nearestEnemy(p.x + p.w / 2, p.y + 20, 0);
    if (foe) {
      const dx = (foe.x + foe.w / 2) - (p.x + p.w / 2);
      if (Math.abs(dx) < 220) demoAI.x = dx >= 0 ? 1 : -1;
      if (foe.y + foe.h < p.y + 10) demoAI.up = true;
    }
    if (p.x > 2200 || performance.now() - state.demoAt > 42000) stopAttract();
  }

  function validateCurrentLayout() {
    const issues = [];
    const pads = SPIKE_HOLE_PAD;
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      if (h.kind !== "spike") continue;
      if (!holeClearance(h.x, h.w || 64, pads)) {
        issues.push({ type: "spike_near_hole", x: Math.round(h.x), w: h.w });
      }
    }
    const plats = state.platforms.filter(function (p) { return p && !p.gone && p.y < GROUND - 8; });
    for (let i = 0; i < plats.length; i++) {
      for (let j = i + 1; j < plats.length; j++) {
        if (platformsTooClose(plats[i], plats[j])) {
          issues.push({
            type: "platform_overlap",
            a: { x: Math.round(plats[i].x), y: Math.round(plats[i].y), w: plats[i].w },
            b: { x: Math.round(plats[j].x), y: Math.round(plats[j].y), w: plats[j].w }
          });
          if (issues.length > 40) return issues;
        }
      }
    }
    return issues;
  }

  function tickQaBot() {
    if (!qaBot.on || !state.player || state.mode !== "play") return;
    const p = state.player;
    qaBot.think++;
    qaBot.frames++;
    if (state.talkQ) {
      state.talkI = state.talkQ.length;
      endTalk();
    }
    if (state.godMode) setGodMode(false);
    // QA measures real hazard contact — strip iframes each think tick.
    // Traversal still ignores combat inside hurtPlayer; invuln=24 there only
    // collapses multi-hit spam within a single updatePlay.
    state.invuln = Math.min(state.invuln, 0);

    demoAI.x = 1;
    demoAI.shoot = true;
    demoAI.up = false;
    demoAI.down = false;
    demoAI.jump = false;

    const cx = p.x + p.w / 2;
    const look = [20, 40, 64, 88, 112, 140, 170];
    let holeSoon = false;
    const holeUnder = isHoleAt(cx);
    for (let li = 0; li < look.length; li++) {
      if (isHoleAt(cx + look[li])) { holeSoon = true; break; }
    }
    const spikeAhead = state.hazards.some(function (h) {
      if (h.kind !== "spike") return false;
      const on = h.always || hazardActive(h);
      if (!on) return false;
      return h.x < cx + 130 && h.x + h.w > cx - 4 && h.y + h.h >= GROUND - 24;
    });
    const laserAhead = state.hazards.some(function (h) {
      if (h.kind !== "laser" || h.axis !== "v") return false;
      if (!hazardActive(h)) return false;
      return h.x > cx && h.x < cx + 100;
    });
    if (holeSoon || holeUnder || spikeAhead || laserAhead) {
      demoAI.jump = true;
      if ((holeSoon || spikeAhead) && p.onGround && qaBot.think % 10 === 0) superJump();
      // Back up from active laser instead of eating it
      if (laserAhead && !holeUnder) demoAI.x = -1;
    }

    // Prefer elevated path when ground is spiked/pitted — or always approach holes via bridge
    let upPlat = null;
    let bestDist = 9999;
    for (let pi = 0; pi < state.platforms.length; pi++) {
      const pl = state.platforms[pi];
      if (!pl || pl.gone || pl.y >= GROUND - 20) continue;
      if (pl.y >= p.y - 4) continue;
      if (pl.x > cx + 160 || pl.x + pl.w < cx - 40) continue;
      const d = Math.abs((pl.x + pl.w / 2) - (cx + 40)) + (p.y - pl.y) * 0.35;
      if (d < bestDist) { bestDist = d; upPlat = pl; }
    }
    const groundSpikes = state.hazards.some(function (h) {
      if (h.kind !== "spike") return false;
      if (!(h.always || hazardActive(h))) return false;
      return h.y + h.h >= GROUND - 24 && h.x < cx + 200 && h.x + h.w > cx - 20;
    });
    if (upPlat && (holeSoon || spikeAhead || groundSpikes || qaBot.stuck > 20 || holeUnder || p.y + p.h >= GROUND - 2)) {
      demoAI.jump = true;
      demoAI.up = true;
      const tx = upPlat.x + upPlat.w / 2;
      if (tx < cx - 6) demoAI.x = -1;
      else if (tx > cx + 6) demoAI.x = 1;
      if (p.onGround && (holeSoon || holeUnder || spikeAhead) && qaBot.think % 8 === 0) superJump();
    }

    // Don't walk onto spikes underfoot — leap forward, don't dither reverse into them
    const spikeHere = state.hazards.some(function (h) {
      if (h.kind !== "spike") return false;
      if (!(h.always || hazardActive(h))) return false;
      return cx > h.x - 6 && cx < h.x + h.w + 6 && Math.abs(h.y - (p.y + p.h)) < 28;
    });
    if (spikeHere) {
      demoAI.jump = true;
      demoAI.x = 1;
      if (p.onGround) superJump();
      qaBot.airCommit = Math.max(qaBot.airCommit, 28);
      qaBot.airDir = 1;
    }

    const foe = nearestEnemy(cx, p.y + 20, 0);
    if (foe) {
      const dx = (foe.x + foe.w / 2) - cx;
      if (Math.abs(dx) < 280) {
        demoAI.x = dx >= 0 ? 1 : -1;
        if (foe.y + foe.h < p.y + 8) demoAI.up = true;
        if (Math.abs(dx) < 70 && foe.y < p.y) demoAI.jump = true;
      }
    }

    if (state.bossMode && state.boss && state.boss.alive) {
      const b = state.boss;
      const bx = b.x + b.w / 2;
      demoAI.shoot = true;
      if (b.vulnerable) {
        demoAI.x = bx > cx ? 1 : -1;
        if (Math.abs(bx - cx) < 120) demoAI.x = bx > cx ? -1 : 1;
      } else {
        // Keep distance during attacks
        demoAI.x = bx > cx + 160 ? 1 : (bx < cx - 160 ? -1 : (bx > cx ? -1 : 1));
        if (b.mode === "dash" || b.mode === "dashCharge" || b.mode === "skySlam" || b.mode === "pulseWave") {
          demoAI.jump = true;
          demoAI.x = bx > cx ? -1 : 1;
        }
      }
    }

    if (state.arena && state.arena.active && !state.arena.cleared) {
      // Clear arena before advancing past lock
      if (p.x > state.arena.lockR - 40) demoAI.x = -1;
    }

    // Once airborne over a pit, hold the crossing direction. Enemy tracking and
    // spike dodging would otherwise reverse the bot mid-jump and drop it in.
    if (p.onGround) {
      qaBot.airCommit = 0;
    } else if (qaBot.airCommit > 0) {
      qaBot.airCommit--;
      demoAI.x = qaBot.airDir;
      demoAI.jump = true;
    }
    if (p.onGround && (holeSoon || holeUnder)) {
      qaBot.airCommit = 45;
      qaBot.airDir = holeUnder ? 1 : demoAI.x || 1;
    }

    if (Math.abs(p.x - qaBot.lastX) < 0.4) qaBot.stuck++;
    else qaBot.stuck = 0;
    qaBot.lastX = p.x;
    qaBot.maxX = Math.max(qaBot.maxX, p.x);
    if (qaBot.stuck > 55) {
      demoAI.jump = true;
      demoAI.x = qaBot.think % 40 < 20 ? -1 : 1;
      if (qaBot.stuck > 90) {
        demoAI.up = true;
        if (p.onGround) superJump();
      }
    }

    // Outcome checks
    if (state.mode === "clear" || state.mode === "win" || state.mode === "credits") {
      qaBot.done = true;
      qaBot.result = "clear";
      qaBot.on = false;
    } else if (state.mode === "failed" || state.mode === "dead") {
      qaBot.deaths++;
      qaBot.done = true;
      qaBot.result = "dead";
      qaBot.on = false;
    } else if (!state.bossMode && p.x + p.w >= state.endX - 65) {
      qaBot.done = true;
      qaBot.result = "reached_end";
      qaBot.on = false;
    } else if (state.bossMode && state.boss && !state.boss.alive) {
      qaBot.done = true;
      qaBot.result = "boss_down";
      qaBot.on = false;
    } else if (qaBot.frames > (qaBot.maxFrames || (state.bossMode ? 80000 : 150000))) {
      qaBot.done = true;
      qaBot.result = "timeout";
      qaBot.on = false;
    }
  }

  function qaFinalizeIfNeeded() {
    if (!qaBot.on) return;
    if (state.mode === "failed" || state.mode === "dead") {
      qaBot.deaths++;
      qaBot.done = true;
      qaBot.result = "dead";
      qaBot.on = false;
    } else if (state.mode === "clear" || state.mode === "win" || state.mode === "credits") {
      qaBot.done = true;
      qaBot.result = "clear";
      qaBot.on = false;
    }
  }

  function qaStartScenario(spec) {
    muted = true;
    musicOn = false;
    try { stopMusic(); } catch (e) {}
    ensureAudio();
    state.godMode = false;
    if (hud.godBtn) {
      hud.godBtn.textContent = "GOD: OFF";
      hud.godBtn.setAttribute("aria-pressed", "false");
      hud.godBtn.classList.remove("is-on");
    }
    qaBot.on = false;
    qaBot.think = 0;
    qaBot.stuck = 0;
    qaBot.lastX = 0;
    qaBot.maxX = 0;
    qaBot.deaths = 0;
    qaBot.frames = 0;
    qaBot.done = false;
    qaBot.result = "";
    qaBot.airCommit = 0;
    qaBot.airDir = 1;
    qaBot.traversal = !!spec.traversal;
    qaBot.maxFrames = spec.maxSteps || (spec.boss ? 80000 : 150000);
    qaBot.causes = {};
    qaBot.label = spec.label || "scenario";
    qaBot.startedAt = performance.now();
    beginTestRun(spec);
    state.godMode = false;
    state.invuln = 0;
    state.talkQ = null;
    state.grace = 0;
    if (state.player) {
      state.player.goldT = 0;
      grantWeapon("SPREAD", 1);
      grantWeapon("RIFLE", 1);
      grantWeapon("WAVE", 0.8);
    }
    // Extra lives for long sectors so one spike doesn't abort the whole audit,
    // but still no invulnerability / god mode.
    state.lives = Math.max(state.lives, 30);
    state.diff = "easy";
    qaBot.on = true;
    demoAI.x = 1;
    demoAI.shoot = true;
    return validateCurrentLayout();
  }

  function qaSnapshot() {
    return {
      label: qaBot.label,
      mode: state.mode,
      level: state.level,
      bossMode: !!state.bossMode,
      midBoss: !!(state.boss && state.boss.midBoss),
      inSecret: !!state.inSecret,
      x: state.player ? Math.round(state.player.x) : 0,
      maxX: Math.round(qaBot.maxX),
      endX: state.endX,
      lives: state.lives,
      hp: state.playerHP,
      frames: qaBot.frames,
      done: qaBot.done,
      result: qaBot.result,
      godMode: !!state.godMode,
      arena: state.arena ? {
        active: state.arena.active,
        cleared: state.arena.cleared,
        left: state.arena.spawnLeft
      } : null,
      bossHp: state.boss && state.boss.alive ? state.boss.hp : 0
    };
  }

  async function qaSleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Synchronous playthrough with no rendering — a full sector runs in about a
  // second instead of the minutes the rAF-paced bot needs.
  function qaBurst(spec, maxSteps) {
    const layoutIssues = qaStartScenario(spec);
    const cap = maxSteps || 90000;
    const wallCap = spec.wallMs || (spec.boss ? 90000 : 120000);
    const wallStart = performance.now();
    let steps = 0;
    while (!qaBot.done && steps < cap) {
      steps++;
      if (performance.now() - wallStart > wallCap) {
        qaBot.done = true;
        qaBot.result = "timeout";
        qaBot.on = false;
        break;
      }
      if (state.mode !== "play") {
        qaFinalizeIfNeeded();
        if (qaBot.done) break;
        break;
      }
      tickQaBot();
      if (!qaBot.on) break;
      if (state.hitStop > 0) state.hitStop--;
      else updatePlay();
    }
    if (!qaBot.done) {
      qaFinalizeIfNeeded();
    }
    if (!qaBot.done) {
      qaBot.done = true;
      qaBot.result = "timeout";
      qaBot.on = false;
    }
    qaBot.on = false;
    const snap = qaSnapshot();
    const hardLayout = layoutIssues.filter(function (i) { return i.type === "spike_near_hole"; });
    const platIssues = layoutIssues.filter(function (i) { return i.type === "platform_overlap"; });
    const okPlay = snap.result === "clear" || snap.result === "reached_end" || snap.result === "boss_down";
    return {
      label: spec.label,
      ok: hardLayout.length === 0 && platIssues.length === 0 && okPlay && !snap.godMode,
      okPlay: okPlay,
      result: snap.result,
      steps: steps,
      maxX: snap.maxX,
      endX: snap.endX,
      progress: snap.endX ? Math.round(100 * snap.maxX / snap.endX) : 0,
      lives: snap.lives,
      deaths: qaBot.deaths,
      causes: qaBot.causes,
      godMode: snap.godMode,
      spikeNearHole: hardLayout.length,
      platformOverlap: platIssues.length
    };
  }

  function qaBurstSuite(specs) {
    muted = true;
    musicOn = false;
    try { stopMusic(); } catch (e) {}
    const out = [];
    for (let i = 0; i < specs.length; i++) out.push(qaBurst(specs[i], specs[i].maxSteps));
    state.mode = "title";
    qaBot.on = false;
    return out;
  }

  async function qaPlayScenario(spec, opts) {
    opts = opts || {};
    const layoutIssues = qaStartScenario(spec);
    const hardLayout = layoutIssues.filter(function (i) { return i.type === "spike_near_hole"; });
    // Soft-cap platform issues for report (still fail if many)
    const platIssues = layoutIssues.filter(function (i) { return i.type === "platform_overlap"; });
    const deadline = performance.now() + (opts.timeoutMs || (spec.boss ? 90000 : 120000));
    while (!qaBot.done && performance.now() < deadline) {
      await qaSleep(16);
    }
    if (!qaBot.done) {
      qaBot.done = true;
      qaBot.result = "timeout";
      qaBot.on = false;
    }
    const snap = qaSnapshot();
    const okPlay = snap.result === "clear" || snap.result === "reached_end" || snap.result === "boss_down";
    return {
      label: spec.label,
      ok: hardLayout.length === 0 && platIssues.length === 0 && okPlay && !snap.godMode,
      okLayout: hardLayout.length === 0 && platIssues.length === 0,
      okPlay: okPlay,
      godMode: snap.godMode,
      result: snap.result,
      maxX: snap.maxX,
      endX: snap.endX,
      progress: snap.endX ? Math.round(100 * snap.maxX / snap.endX) : 0,
      lives: snap.lives,
      frames: snap.frames,
      spikeNearHole: hardLayout.length,
      platformOverlap: platIssues.length,
      layoutIssues: layoutIssues.slice(0, 12),
      snap: snap
    };
  }

  async function qaRunSuite() {
    muted = true;
    musicOn = false;
    try { stopMusic(); } catch (e) {}
    const scenarios = [];
    for (let i = 0; i < LEVELS.length; i++) {
      scenarios.push({ label: "L" + (i + 1) + " " + LEVELS[i].name, level: i, skipTalk: true });
    }
    scenarios.push({ label: "SECRET ember", secret: "ember" });
    scenarios.push({ label: "SECRET storm", secret: "storm" });
    scenarios.push({ label: "SECRET signal", secret: "signal" });
    scenarios.push({ label: "BOSS mid", boss: "mid" });
    scenarios.push({ label: "BOSS final", boss: "final" });

    const report = { startedAt: new Date().toISOString(), v: "qa", results: [], pass: true };
    for (let s = 0; s < scenarios.length; s++) {
      const r = await qaPlayScenario(scenarios[s], {
        speed: scenarios[s].boss ? 8 : 12,
        timeoutMs: scenarios[s].boss ? 120000 : 180000
      });
      report.results.push(r);
      if (!r.ok) report.pass = false;
      console.log("[QA]", r.label, r.ok ? "PASS" : "FAIL", r.result, "maxX=" + r.maxX, "spikes@" + r.spikeNearHole, "plats@" + r.platformOverlap);
    }
    report.finishedAt = new Date().toISOString();
    window.__DG_QA_REPORT = report;
    state.mode = "title";
    qaBot.on = false;
    showOverlay("QA DONE", report.pass ? "ALL PASS" : "FAILURES — see __DG_QA_REPORT", "PRESS START");
    return report;
  }

  function qaValidateAllLayouts() {
    const out = [];
    const scenarios = [];
    for (let i = 0; i < LEVELS.length; i++) scenarios.push({ label: "L" + (i + 1) + " " + LEVELS[i].name, level: i, skipTalk: true });
    scenarios.push({ label: "SECRET ember", secret: "ember" });
    scenarios.push({ label: "SECRET storm", secret: "storm" });
    scenarios.push({ label: "SECRET signal", secret: "signal" });
    scenarios.push({ label: "BOSS mid", boss: "mid" });
    scenarios.push({ label: "BOSS final", boss: "final" });
    for (let s = 0; s < scenarios.length; s++) {
      const spec = scenarios[s];
      state.godMode = false;
      beginTestRun(spec);
      state.godMode = false;
      state.talkQ = null;
      const issues = validateCurrentLayout();
      out.push({
        label: spec.label,
        ok: issues.length === 0,
        spikeNearHole: issues.filter(function (i) { return i.type === "spike_near_hole"; }).length,
        platformOverlap: issues.filter(function (i) { return i.type === "platform_overlap"; }).length,
        platforms: state.platforms.filter(function (p) { return p && p.y < GROUND - 8; }).length,
        holes: state.holes.length,
        spikes: state.hazards.filter(function (h) { return h.kind === "spike"; }).length,
        issues: issues.slice(0, 8)
      });
    }
    return out;
  }

  window.__DG_QA = {
    validate: validateCurrentLayout,
    validateAll: qaValidateAllLayouts,
    play: qaPlayScenario,
    burst: qaBurst,
    burstSuite: qaBurstSuite,
    runSuite: qaRunSuite,
    snapshot: qaSnapshot,
    world: function () { return state; },
    step: function (n) {
      const trace = [];
      for (let i = 0; i < (n || 1); i++) {
        if (state.mode !== "play") { qaFinalizeIfNeeded(); break; }
        tickQaBot();
        if (state.hitStop > 0) state.hitStop--;
        else updatePlay();
        const p = state.player;
        if (p) trace.push({ x: Math.round(p.x), y: Math.round(p.y), vy: Math.round(p.vy * 10) / 10, g: !!p.onGround, j: !!demoAI.jump, dx: demoAI.x, lv: state.lives, hp: state.playerHP, iv: Math.round(state.invuln || 0) });
      }
      return trace;
    },
    bot: qaBot
  };

  function beginTestRun(opts) {
    opts = opts || {};
    ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    state.score = 0;
    state.lives = currentDiff().lives;
    state.nextLifeAt = LIFE_EVERY;
    state.combo = 0;
    state.comboTimer = 0;
    state.checkpointX = 80;
    state.inSecret = false;
    state.secretKey = !!opts.secretKey;
    state.secretKind = opts.secret === true ? "ember" : (opts.secret || null);
    state.secretCleared = false;
    state.secretsDone = blankSecretsDone();
    state.activeSecret = null;
    state.secretPortal = null;
    resetRunStats();
    hideOverlay();
    state.mode = "play";
    if (opts.boss === "mid") {
      state.level = MID_BOSS_LEVEL;
      buildLevel(MID_BOSS_LEVEL, true, false);
      startBossFight("mid");
    } else if (opts.boss === "final") {
      state.level = LEVELS.length - 1;
      buildLevel(LEVELS.length - 1, true, false);
      startBossFight("final");
    } else if (opts.secret) {
      const sid = opts.secret === true ? "ember" : opts.secret;
      const def = secretDef(sid) || SECRETS.ember;
      state.level = def.hostLevel;
      state.secretKey = true;
      state.secretKind = def.id;
      state.activeSecret = def.id;
      buildLevel("secret:" + def.id, false, false);
    } else {
      state.level = opts.level | 0;
      buildLevel(state.level, !!opts.skipTalk, false);
    }
    if (state.godMode) setGodMode(true);
    startTechno();
    updateHUD();
    postParent({ type: "dg-chrome", inGame: true });
    if (wantsTouchUI()) {
      enterFullscreen();
      setTimeout(fit, 100);
      setTimeout(fit, 300);
    }
  }

  function buildLevelSelect() {
    if (!hud.levels) return;
    hud.levels.innerHTML = "";
    const short = ["DOCKS", "TUNNEL", "SPIRE", "SLUMS", "RAIL", "VOID", "SEWERS"];
    LEVELS.forEach(function (L, i) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = (i + 1) + " " + (short[i] || L.name);
      b.title = L.name;
      b.addEventListener("click", function () {
        sfxUi();
        beginTestRun({ level: i, skipTalk: true });
      });
      hud.levels.appendChild(b);
    });
    const vault = document.createElement("button");
    vault.type = "button";
    vault.className = "dg-lv-secret";
    vault.textContent = "VAULT";
    vault.title = "Ember Vault secret stage";
    vault.addEventListener("click", function () {
      sfxUi();
      beginTestRun({ secret: "ember" });
    });
    hud.levels.appendChild(vault);
    const spire = document.createElement("button");
    spire.type = "button";
    spire.className = "dg-lv-secret";
    spire.textContent = "STORM";
    spire.title = "Storm Spire secret stage";
    spire.addEventListener("click", function () {
      sfxUi();
      beginTestRun({ secret: "storm" });
    });
    hud.levels.appendChild(spire);
    const crypt = document.createElement("button");
    crypt.type = "button";
    crypt.className = "dg-lv-secret";
    crypt.textContent = "CRYPT";
    crypt.title = "Signal Crypt secret stage";
    crypt.addEventListener("click", function () {
      sfxUi();
      beginTestRun({ secret: "signal" });
    });
    hud.levels.appendChild(crypt);
    const mid = document.createElement("button");
    mid.type = "button";
    mid.className = "dg-lv-boss";
    mid.textContent = "MID BOSS";
    mid.title = "Pulse Warden";
    mid.addEventListener("click", function () {
      sfxUi();
      beginTestRun({ boss: "mid" });
    });
    hud.levels.appendChild(mid);
    const fin = document.createElement("button");
    fin.type = "button";
    fin.className = "dg-lv-boss";
    fin.textContent = "FINAL";
    fin.title = "Redcore Sentinel";
    fin.addEventListener("click", function () {
      sfxUi();
      beginTestRun({ boss: "final" });
    });
    hud.levels.appendChild(fin);
  }

  function startGame(opts) {
    opts = opts || {};
    if (state.demo) {
      state.demo = false;
      stopMusic();
    }
    ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (!opts.keepDaily) {
      state.daily = false;
      state.dailyKey = null;
      clearRunSeed();
    }
    if (!opts.keepNg) state.ngPlus = !!opts.ngPlus;
    state.lastStand = false;
    state.score = 0;
    state.lives = currentDiff().lives;
    state.level = 0;
    state.nextLifeAt = LIFE_EVERY;
    state.combo = 0;
    state.comboTimer = 0;
    state.checkpointX = 80;
    state.inSecret = false;
    state.secretKey = false;
    state.secretKind = null;
    state.secretCleared = false;
    state.secretsDone = blankSecretsDone();
    state.activeSecret = null;
    state.secretPortal = null;
    resetRunStats();
    if (state.daily) awardMedal("daily");
    hideOverlay();
    state.mode = "play";
    buildLevel(state.level);
    if (state.player && state.ngPlus) {
      grantWeapon("RIFLE", 0.85);
      state.banner = "NEW GAME+ · 1.5× SCORE · HARDER HUNTERS";
      state.messageTimer = 110;
    }
    if (state.godMode) setGodMode(true);
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

  function startNgPlusRun() {
    if (!hasClearedOnce()) {
      state.banner = "CLEAR THE GAME TO UNLOCK NG+";
      state.messageTimer = 70;
      sfxUi();
      return;
    }
    state.ngPlus = true;
    sfxUi();
    startGame({ ngPlus: true, keepNg: true });
  }

  function startDailyRun() {
    state.daily = true;
    state.dailyKey = dailyId();
    state.ngPlus = false;
    setRunSeed(hashSeed(state.dailyKey + "|" + (state.diff || "normal")));
    sfxUi();
    startGame({ keepDaily: true });
    state.banner = "DAILY " + state.dailyKey;
    state.messageTimer = 90;
  }

  function advanceFromClear() {
    if (state.mode === "clear" && state.secretCleared) {
      const def = activeSecretDef() || SECRETS.ember;
      const dest = typeof def.exitTo === "number" ? def.exitTo : LEVELS.length - 1;
      hideOverlay();
      state.mode = "play";
      state.inSecret = false;
      state.secretCleared = false;
      state.activeSecret = null;
      state.secretKind = null;
      buildLevel(dest, false, true);
      if (!musicOn) startTechno();
      updateHUD();
      return;
    }
    if (state.level >= LEVELS.length - 1) {
      startCredits();
      return;
    }
    state.level += 1;
    hideOverlay();
    state.mode = "play";
    buildLevel(state.level, false, true);
    if (!musicOn) startTechno();
    updateHUD();
  }

  function onLevelComplete() {
    if (state.demo) {
      stopAttract();
      return;
    }
    const leftover = state.qrs.filter(function (q) { return !q.taken; }).length;
    const clearPts = Math.max(0, 500 - leftover * 20);
    const timePts = Math.ceil(state.levelTime / 1000) * 10;
    const noHitPts = !state.hitThisLevel ? 1000 : 0;
    const comboPts = state.combo >= 5 ? state.combo * 40 : 0;
    const grazePts = Math.min(800, (state.grazeCount || 0) * 25);
    const clearBonus = clearPts + timePts + noHitPts + comboPts + grazePts;
    addScore(clearBonus);
    state.bonusScore += clearBonus;
    state.sectorsCleared++;
    if (noHitPts) state.noHitClears++;
    state.lastClear = {
      clear: clearPts, time: timePts, noHit: noHitPts, combo: comboPts, graze: grazePts
    };
    const medals = evaluateSectorMedals({ boss: !!state._bossClear });
    state._bossClear = false;
    saveHiScore(state.score);
    saveDailyBest(state.score);
    const remainSec = Math.max(0, Math.ceil(state.levelTime / 1000));
    const pb = saveSectorPB(state.level, remainSec);
    const breakdown = formatClearBreakdown(state.lastClear);
    const perfect = !state.hitThisLevel && state.levelTime > sectorTimeBudget() * 0.45 && state.maxCombo >= 8;
    if (perfect) {
      addScore(1500);
      state.bonusScore += 1500;
      addJuice({ shake: 10, hitStop: 4, flash: 14, flashColor: "rgba(57,255,20,0.4)" });
    }
    if (pb.best) {
      addScore(250);
      state.bonusScore += 250;
    }
    if (state.level >= LEVELS.length - 1) {
      startCredits();
    } else {
      state.mode = "clear";
      sfxClear();
      showOverlay(
        perfect ? "PERFECT CLEAR!" : "SECTOR CLEAR",
        LEVELS[state.level].name + " complete!" +
          (perfect ? "\n★ TRIPLE GOAL +1500 ★" : "") +
          (pb.best ? "\n★ NEW SECTOR PB " + remainSec + "s left (+250) ★" : ("\nTime left " + remainSec + "s · " + sectorPbLine(state.level))) +
          (breakdown ? "\n" + breakdown : "") +
          "\nScore " + String(state.score).padStart(6, "0") +
          " · HI " + String(state.hiScore).padStart(6, "0") +
          "\nMax Combo ×" + state.maxCombo + " · Kills " + state.kills +
          "\n" + formatMedalsLine(medals),
        "NEXT LEVEL",
        { share: true, medals: medals }
      );
    }
  }

  function bossBusy(b) {
    return b.mode === "jump" || b.mode === "jumpCharge" || b.mode === "laser" || b.mode === "laserCharge"
      || b.mode === "skyRise" || b.mode === "skyHold" || b.mode === "skySlam"
      || b.mode === "pulseCharge" || b.mode === "pulseWave"
      || b.mode === "dashCharge" || b.mode === "dash"
      || b.mode === "pillarCharge" || b.mode === "pillar"
      || b.mode === "eyeCharge" || b.mode === "eyeFire";
  }

  function bossEnterPhase2(b) {
    if (b.warnedPhase2) return;
    b.warnedPhase2 = true;
    b.phase = 2;
    b.phaseFlash = 70;
    b.vulnerable = false;
    b.mode = "recover";
    b.timer = 55;
    state.banner = b.midBoss ? "⚠ PULSE OVERLOAD — PHASE 2!" : "⚠ CORE PROTOCOL 2 — ENRAGED!";
    state.messageTimer = 110;
    sfxArenaLock();
    sfxPhase2();
    explode(b.x + b.w / 2, b.y + b.h / 2, b.accentHot || "#39ff14", 48);
    pushScorePop(b.x + b.w / 2, b.y, "PHASE 2", b.accentHot || "#39ff14");
    addJuice({
      shake: 18,
      hitStop: 14,
      flash: 26,
      flashColor: b.midBoss ? "rgba(232,121,249,0.55)" : "rgba(239,68,68,0.5)"
    });
    beep(120, 0.25, "sawtooth", 0.1);
    beep(60, 0.3, "square", 0.08, 0.1);
    if (b.midBoss) {
      addHazard({
        kind: "laser", x: 220, y: 30, w: 10, h: GROUND - 140,
        on: 28, off: 48, t: 12, axis: "v"
      });
      addHazard({
        kind: "laser", x: 560, y: 30, w: 10, h: GROUND - 140,
        on: 28, off: 48, t: 36, axis: "v"
      });
    } else {
      addHazard({ kind: "spike", x: 160, y: GROUND - 18, w: 90, h: 18, on: 36, off: 44, t: 0 });
      addHazard({ kind: "spike", x: 520, y: GROUND - 18, w: 90, h: 18, on: 36, off: 44, t: 22 });
      addPlatform(280, GROUND - 210, 180, { skin: 1 });
    }
  }

  function pickBossAttack(b, p) {
    b.vulnerable = false;
    const roll = rnd();
    const hot = b.phase === 2;
    if (b.midBoss) {
      // Pulse Warden: burst / pulse rings / dash / short laser
      if (roll < 0.28) {
        b.mode = "pulseCharge";
        b.timer = hot ? 22 : 34;
        b.pulseR = 0;
        slideBeep(360, 720, 0.22, "sawtooth", 0.06);
        state.banner = "PULSE CHARGE — \"SYNC OR DIE\"";
        state.messageTimer = 40;
      } else if (roll < 0.52) {
        b.mode = "dashCharge";
        b.timer = hot ? 18 : 28;
        b.dashDir = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
        beep(240, 0.14, "square", 0.07);
        state.banner = "DASH STRIKE — \"MOVE!\"";
        state.messageTimer = 40;
      } else if (roll < 0.74) {
        b.mode = "eyeCharge";
        b.timer = hot ? 16 : 26;
        beep(700, 0.16, "square", 0.06);
        state.banner = "BURST VOLLEY — \"OPEN FIRE\"";
        state.messageTimer = 40;
      } else {
        b.mode = "laserCharge";
        b.laserAimX = p.x + p.w / 2;
        b.laserAimY = p.y + p.h / 2;
        b.timer = hot ? 20 : 30;
        slideBeep(420, 280, 0.25, "sawtooth", 0.05);
        state.banner = "PULSE BEAM — \"LOCK\"";
        state.messageTimer = 40;
      }
      return;
    }
    // Redcore Sentinel: slam / pillars / laser / jump
    if (roll < (hot ? 0.34 : 0.28)) {
      b.mode = "skyRise";
      b.timer = 50;
      b.vx = 0;
      b.vy = -8.5;
      beep(180, 0.14, "square", 0.07);
      state.banner = "ORBITAL SLAM — \"FALL\"";
      state.messageTimer = 45;
    } else if (roll < 0.52) {
      b.mode = "pillarCharge";
      const cx = p.x + p.w / 2;
      b.pillars = [
        Math.max(40, Math.min(W - 40, cx)),
        Math.max(40, Math.min(W - 40, cx - 140)),
        Math.max(40, Math.min(W - 40, cx + 140))
      ];
      if (!hot) b.pillars = b.pillars.slice(0, 2);
      b.timer = hot ? 28 : 40;
      slideBeep(200, 480, 0.28, "sawtooth", 0.06);
      state.banner = "PILLAR STRIKE — \"CAGE\"";
      state.messageTimer = 45;
    } else if (roll < 0.74) {
      b.mode = "laserCharge";
      b.laserAimX = p.x + p.w / 2;
      b.laserAimY = p.y + p.h / 2;
      b.timer = hot ? 24 : 38;
      slideBeep(420, 280, 0.3, "sawtooth", 0.05);
      state.banner = "CORE LASER — \"BURN\"";
      state.messageTimer = 40;
    } else if (roll < 0.88) {
      b.mode = "jumpCharge";
      b.timer = hot ? 16 : 26;
      state.banner = "SHOCK JUMP — \"RISE\"";
      state.messageTimer = 35;
    } else {
      b.mode = "eyeCharge";
      b.timer = hot ? 18 : 28;
      beep(700, 0.16, "square", 0.06);
      state.banner = "EYE BARRAGE — \"SEE ME\"";
      state.messageTimer = 40;
    }
  }

  function updateBoss() {
    const b = state.boss, p = state.player;
    if (!b || !b.alive || !p) return;
    if (b.hp <= b.maxHp / 2) bossEnterPhase2(b);
    else b.phase = 1;
    if (b.hitCD > 0) b.hitCD--;
    if (b.eyeCD > 0) b.eyeCD--;
    if (b.phaseFlash > 0) b.phaseFlash--;
    b.facing = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
    b.walk += b.mode === "jump" || b.mode === "skySlam" || b.mode === "dash" ? 0.32 : 0.2;

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
        state.messageTimer = 80;
      } else {
        grantWeapon("MAXI", 1.25);
        announceWeapon("MAXI");
      }
      sfxPickup(q.type === "health" ? "life" : "weapon");
    }

    if (!bossBusy(b) && b.mode !== "recover") {
      const spd = (b.phase === 2 ? 2.7 : 1.9) * (b.midBoss ? 1.15 : 1);
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

    // Passive eye fire only for Sentinel when idle (Warden saves ammo for bursts)
    if (!b.midBoss && (b.mode === "idle" || b.mode === "laser") && b.eyeCD <= 0) {
      bossFireEye(b);
      b.eyeCD = b.phase === 2 ? 42 : 64;
    }

    b.timer -= b.aggro || 1;

    if (b.mode === "idle" && b.timer <= 0) {
      pickBossAttack(b, p);
    } else if (b.mode === "laserCharge") {
      // slight tracking telegraph
      b.laserAimX += (p.x + p.w / 2 - b.laserAimX) * (b.midBoss ? 0.08 : 0.04);
      b.laserAimY += (p.y + p.h / 2 - b.laserAimY) * (b.midBoss ? 0.08 : 0.04);
      if (b.timer <= 0) {
        b.mode = "laser";
        b.timer = b.phase === 2 ? (b.midBoss ? 28 : 36) : (b.midBoss ? 22 : 28);
        sfxBossLaser();
      }
    } else if (b.mode === "laser") {
      const h = bossHand(b), dx = Math.cos(h.a) * 900, dy = Math.sin(h.a) * 900;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const t = Math.max(0, Math.min(1, ((cx - h.x) * dx + (cy - h.y) * dy) / (dx * dx + dy * dy)));
      const thick = b.midBoss ? 20 : 26;
      if (Math.hypot(cx - h.x - t * dx, cy - h.y - t * dy) < thick) hurtPlayer(null, "boss");
      if (b.timer <= 0) {
        b.mode = "recover"; b.timer = b.phase === 2 ? 26 : 42; b.vulnerable = true;
      }
    } else if (b.mode === "eyeCharge" && b.timer <= 0) {
      b.mode = "eyeFire";
      b.timer = b.phase === 2 ? (b.midBoss ? 42 : 36) : (b.midBoss ? 34 : 28);
      b.eyeCD = 0;
    } else if (b.mode === "eyeFire") {
      if (b.eyeCD <= 0) {
        if (b.midBoss) {
          // fan burst
          const e = bossEye(b);
          const base = Math.atan2(p.y + p.h / 2 - e.y, p.x + p.w / 2 - e.x);
          const spd = b.phase === 2 ? 5.4 : 4.2;
          [-0.28, 0, 0.28].forEach(function (off) {
            const a = base + off;
            state.bullets.push({
              x: e.x - 6, y: e.y - 4, w: 12, h: 8,
              vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
              life: 90, from: "enemy", fire: true
            });
          });
          beep(640, 0.06, "sawtooth", 0.06);
          b.eyeCD = b.phase === 2 ? 12 : 16;
        } else {
          bossFireEye(b);
          b.eyeCD = b.phase === 2 ? 14 : 18;
        }
      }
      if (b.timer <= 0) {
        b.mode = "recover"; b.timer = b.phase === 2 ? 24 : 38; b.vulnerable = true;
      }
    } else if (b.mode === "pulseCharge" && b.timer <= 0) {
      b.mode = "pulseWave";
      b.timer = 48;
      b.pulseR = 20;
      sfxBossLaser();
      noiseBurst(0.12, 0.08, 0, 600);
    } else if (b.mode === "pulseWave") {
      b.pulseR += b.phase === 2 ? 9.5 : 7.2;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const d = Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy);
      if (Math.abs(d - b.pulseR) < 22) hurtPlayer(null, "boss");
      if (b.phase === 2 && b.timer % 16 === 0) {
        bossFireEye(b);
      }
      if (b.timer <= 0 || b.pulseR > 420) {
        b.mode = "recover"; b.timer = 30; b.vulnerable = true; b.pulseR = 0;
      }
    } else if (b.mode === "dashCharge" && b.timer <= 0) {
      b.mode = "dash";
      b.timer = 36;
      b.vx = b.dashDir * (b.phase === 2 ? 11 : 8.5);
      b.vy = 0;
      sfxArenaLock();
      explode(b.x + b.w / 2, b.y + b.h / 2, "#ff2bd6", 12);
    } else if (b.mode === "dash") {
      b.x += b.vx;
      if (rectsOverlap({ x: p.x + 4, y: p.y + 8, w: p.w - 8, h: p.h - 10 }, b)) hurtPlayer(null, "boss");
      if (b.x < 20 || b.x > W - b.w - 20 || b.timer <= 0) {
        b.x = Math.max(36, Math.min(W - b.w - 16, b.x));
        b.vx = 0;
        b.mode = "recover";
        b.timer = b.phase === 2 ? 22 : 34;
        b.vulnerable = true;
        addJuice({ shake: 5, flash: 6 });
      }
    } else if (b.mode === "pillarCharge" && b.timer <= 0) {
      b.mode = "pillar";
      b.timer = b.phase === 2 ? 36 : 28;
      sfxBossLaser();
      addJuice({ shake: 4, flash: 8, flashColor: "rgba(0,229,255,0.25)" });
    } else if (b.mode === "pillar") {
      for (let i = 0; i < b.pillars.length; i++) {
        const px = b.pillars[i];
        if (Math.abs(p.x + p.w / 2 - px) < 28 && p.y + p.h > 60) hurtPlayer(null, "boss");
      }
      if (b.timer <= 0) {
        b.mode = "recover"; b.timer = b.phase === 2 ? 28 : 42; b.vulnerable = true;
        b.pillars = [];
      }
    } else if (b.mode === "skyRise") {
      b.y += b.vy;
      if (b.y <= 10) {
        b.y = 10;
        b.vy = 0;
        b.mode = "skyHold";
        b.timer = b.phase === 2 ? 28 : 40;
        b.slamX = Math.max(30, Math.min(W - b.w - 30, p.x + p.w / 2 - b.w / 2));
        beep(520, 0.12, "triangle", 0.06);
      }
    } else if (b.mode === "skyHold") {
      // track player a bit during hold so telegraph stays honest
      b.slamX += ((p.x + p.w / 2 - b.w / 2) - b.slamX) * 0.08;
      b.slamX = Math.max(30, Math.min(W - b.w - 30, b.slamX));
      if (b.timer <= 0) {
        b.mode = "skySlam";
        b.timer = 50;
        beep(140, 0.16, "sawtooth", 0.08);
      }
    } else if (b.mode === "skySlam") {
      b.x += (b.slamX - b.x) * 0.42;
      b.vy = 16;
      b.y += b.vy;
      if (b.y + b.h >= GROUND) {
        b.y = GROUND - b.h;
        b.x = b.slamX;
        b.vx = 0;
        b.vy = 0;
        if (Math.abs(p.x + p.w / 2 - (b.x + b.w / 2)) < 62) hurtPlayer(null, "boss");
        explode(b.x + b.w / 2, GROUND - 4, "#ff7a12", 26);
        addJuice({ shake: 10, hitStop: 3, flash: 12, flashColor: "rgba(255,122,18,0.35)" });
        // phase-2 shockwave ring
        if (b.phase === 2) {
          b.mode = "pulseWave";
          b.timer = 34;
          b.pulseR = 40;
          beep(70, 0.22, "square", 0.1);
        } else {
          beep(70, 0.22, "square", 0.1);
          b.mode = "recover";
          b.timer = 40;
          b.vulnerable = true;
        }
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
        addJuice({ shake: 5, flash: 6 });
        beep(80, 0.18, "square", 0.09);
      }
    } else if (b.mode === "recover" && b.timer <= 0) {
      b.mode = "idle";
      b.timer = b.phase === 2 ? (b.midBoss ? 18 : 22) : (b.midBoss ? 28 : 38);
      b.vulnerable = true;
    }
    if (rectsOverlap({ x: p.x + 5, y: p.y + 5, w: p.w - 10, h: p.h - 5 }, b) && !state.talkQ) hurtPlayer(null, "boss");
  }

  function updateHUD() {
    hud.score.textContent = String(state.score).padStart(6, "0");
    hud.lives.textContent = "♥".repeat(Math.max(0, state.lives)) || "—";
    hud.level.textContent = state.inSecret ? "SEC" : ("LV " + (state.level + 1));
    if (state.ngPlus && hud.level) hud.level.textContent = (state.inSecret ? "SEC" : ("LV " + (state.level + 1))) + " · NG+";
    if (state.godMode && hud.level) hud.level.textContent = (state.inSecret ? "SEC" : ("LV " + (state.level + 1))) + (state.ngPlus ? " · NG+" : "") + " · GOD";
    hud.time.textContent = Math.max(0, Math.ceil(state.levelTime / 1000));
    if (hud.time) {
      hud.time.style.color = (state.mode === "play" && state.levelTime > 0 && state.levelTime < 30000) ? "#fb7185" : "";
    }
    if (hud.hi) hud.hi.textContent = String(state.hiScore).padStart(6, "0");
    if (hud.combo) {
      const c = state.combo;
      hud.combo.textContent = "×" + c;
      const wrap = hud.combo.parentElement;
      if (wrap) {
        wrap.classList.toggle("is-hot", c >= 3);
        wrap.classList.toggle("is-max", c >= 10);
      }
    }
    hud.superJumps.textContent = state.player ? Math.max(0, 2 - state.player.airSupers) : 2;
    let gun = "PISTOL";
    if (state.player) {
      if (state.player.overclockT > 0) gun = "OVR " + Math.ceil(state.player.overclockT / 60) + "s";
      else if (state.player.goldT > 0) gun = "GOLD " + Math.ceil(state.player.goldT / 60) + "s";
      else if (state.player.speedT > 0) gun = "SPD " + Math.ceil(state.player.speedT / 60) + "s";
      else if (state.player.weapon) {
        const d = weaponDef(state.player.weapon);
        const bagN = (state.player.gunBag && state.player.gunBag.length) || 0;
        gun = (d ? d.label : state.player.weapon) + " ×" + state.player.beamFuel + (bagN ? (" +" + bagN) : "");
        if (state.player.weapon === "MAXI" && (state.player.maxiCharge || 0) >= 12) {
          gun += " CHG" + Math.min(3, Math.floor(state.player.maxiCharge / 18));
        }
      } else if (state.player.charge >= 10) {
        gun = state.player.charge >= 28 ? "CHARGE!" : "CHG " + Math.floor(state.player.charge / 28 * 100) + "%";
      }
    }
    hud.staff.textContent = gun;
    if (state.messageTimer > 0) {
      hud.msg.textContent = state.banner || currentLevel().name;
      hud.msg.style.opacity = "1";
    } else if (state.combo >= 3 && state.mode === "play") {
      hud.msg.textContent = "COMBO ×" + state.combo;
      hud.msg.style.opacity = "0.9";
    } else {
      hud.msg.style.opacity = "0";
    }
    syncMusicUrgency();
  }

  function inputX() {
    if (state.demo || qaBot.on) return demoAI.x;
    if (Math.abs(touch.jx) > 0.28) return touch.jx > 0 ? 1 : -1;
    let x = 0;
    if (keys.ArrowLeft || keys.a || keys.A || touch.left) x -= 1;
    if (keys.ArrowRight || keys.d || keys.D || touch.right) x += 1;
    return x;
  }
  function inputJump() {
    if (state.demo || qaBot.on) return !!demoAI.jump;
    return !!(keys[" "] || touch.jump);
  }
  function inputUp() {
    if (state.demo || qaBot.on) return !!demoAI.up;
    return !!(keys.ArrowUp || keys.w || keys.W || touch.up || touch.jy < -0.36);
  }
  function inputDown() {
    if (state.demo || qaBot.on) return !!demoAI.down;
    return !!(keys.ArrowDown || keys.s || keys.S || touch.down || touch.jy > 0.42);
  }
  function inputShoot() {
    if (state.demo || qaBot.on) return !!demoAI.shoot;
    return !!(keys.z || keys.Z || keys.x || keys.X || keys.Control || keys.Enter || keys.j || keys.J || touch.shoot);
  }

  function clearTouchInput() {
    touch.left = touch.right = touch.up = touch.down = false;
    touch.jump = touch.shoot = false;
    touch.jx = 0;
    touch.jy = 0;
    const jumpBtn = ROOT.querySelector("#dg-jump");
    const shootBtn = ROOT.querySelector("#dg-shoot");
    if (jumpBtn) jumpBtn.classList.remove("is-held");
    if (shootBtn) shootBtn.classList.remove("is-held");
    const knob = ROOT.querySelector("#dg-knob");
    if (knob) knob.style.transform = "translate(-50%, -50%)";
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
    sfxSuperJump();
    addJuice({ shake: 4, flash: 5, flashColor: "rgba(0,229,255,0.22)" });
    state.banner = "SUPER JUMP!";
    state.messageTimer = 35;
  }

  function landOnPlatform(p, prevBottom) {
    // One-way platforms: land only when falling onto the top edge.
    for (let i = 0; i < state.platforms.length; i++) {
      const plat = state.platforms[i];
      if (plat.gone) continue;
      const overX = p.x + p.w > plat.x + 2 && p.x < plat.x + plat.w - 2;
      if (!overX) continue;
      const onTop = prevBottom <= plat.y + 2 && p.y + p.h >= plat.y;
      if (onTop) {
        p.y = plat.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p.airSupers = 0;
        p.ridePlat = plat;
        if (plat.mover) {
          p.x += plat.dx || 0;
          p.y += plat.dy || 0;
        }
        if (plat.bounce) {
          p.vy = -11.5;
          p.onGround = false;
          sfxBounce();
          explode(p.x + p.w / 2, plat.y, "#c084fc", 8);
          return true;
        }
        if (plat.crumble && !plat.gone) {
          plat.life = (plat.life == null ? plat.maxLife : plat.life) - 1;
          if (plat.life <= 0) {
            plat.gone = true;
            explode(plat.x + plat.w / 2, plat.y, "#94a3b8", 10);
            sfxCrumble();
          }
        }
        return true;
      }
    }
    p.ridePlat = null;
    return false;
  }

  function hazardActive(h) {
    if (h.always) return true;
    if (h.kind === "gate") return !h.open;
    if (h.kind === "crusher") return h.phase === "down" || h.phase === "hold";
    if (h.kind === "drip") return h.active;
    if (h.kind === "acid") return true;
    const cycle = (h.on || 60) + (h.off || 60);
    const t = ((h.t || 0) % cycle + cycle) % cycle;
    return t < (h.on || 60);
  }

  function updateMovers() {
    for (let i = 0; i < state.platforms.length; i++) {
      const plat = state.platforms[i];
      if (!plat.mover) {
        plat.dx = 0;
        plat.dy = 0;
        continue;
      }
      plat.phase = (plat.phase || 0) + (plat.spd || 0.03);
      const nx = plat.ox + Math.sin(plat.phase) * (plat.ampX || 0);
      const ny = plat.oy + Math.sin(plat.phase * (plat.fy || 1)) * (plat.ampY || 0);
      plat.dx = nx - plat.x;
      plat.dy = ny - plat.y;
      plat.x = nx;
      plat.y = ny;
    }
  }

  function updateHazards(calm) {
    if (calm) return;
    const p = state.player;
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      h.t = (h.t || 0) + 1;

      if (h.kind === "crusher") {
        const down = h.down || 40, hold = h.hold || 18, up = h.up || 50;
        const cycle = down + hold + up;
        const t = h.t % cycle;
        if (t < down) {
          h.phase = "down";
          const u = t / down;
          h.y = h.yTop + (h.yBot - h.yTop) * u;
        } else if (t < down + hold) {
          h.phase = "hold";
          h.y = h.yBot;
        } else {
          h.phase = "up";
          const u = (t - down - hold) / up;
          h.y = h.yBot + (h.yTop - h.yBot) * u;
        }
      } else if (h.kind === "drip") {
        const period = h.period || 90;
        const phase = h.t % period;
        if (phase === 0) {
          h.active = true;
          h.fallY = 20;
          h.vy = 0;
        }
        if (h.active) {
          h.vy = (h.vy || 0) + 0.35;
          h.fallY += h.vy;
          if (h.fallY > GROUND - 8) {
            h.active = false;
            explode(h.x + 6, GROUND - 4, "#4ade80", 6);
          }
        }
      } else if (h.kind === "gate" && h.arena && state.arena) {
        h.open = !state.arena.active || state.arena.cleared;
      } else if (h.kind === "wind" && hazardActive(h) && p) {
        const box = { x: h.x, y: h.y, w: h.w, h: h.h };
        if (rectsOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, box)) {
          p.x += h.push || 0.4;
        }
      }

      if (!p || state.invuln > 0 || p.goldT > 0) continue;
      let hitBox = null;
      if (h.kind === "laser" && hazardActive(h)) {
        hitBox = { x: h.x, y: h.y, w: h.w, h: h.h };
      } else if (h.kind === "spike" && hazardActive(h)) {
        hitBox = { x: h.x, y: h.y, w: h.w, h: h.h };
      } else if (h.kind === "crusher" && (h.phase === "down" || h.phase === "hold")) {
        hitBox = { x: h.x, y: h.y, w: h.w, h: h.h };
      } else if (h.kind === "acid") {
        hitBox = { x: h.x, y: h.y - 8, w: h.w, h: 24 };
      } else if (h.kind === "drip" && h.active) {
        hitBox = { x: h.x, y: h.fallY, w: 12, h: 16 };
      } else if (h.kind === "gate" && !h.open) {
        hitBox = { x: h.x, y: h.y, w: h.w, h: h.h };
      }
      if (hitBox && rectsOverlap({ x: p.x + 4, y: p.y + 6, w: p.w - 8, h: p.h - 10 }, hitBox)) {
        if (h.kind === "gate") {
          // push back instead of instant death
          if (p.x + p.w / 2 < h.x + h.w / 2) p.x = h.x - p.w - 2;
          else p.x = h.x + h.w + 2;
          p.vx = 0;
        } else {
          const cause = h.kind === "acid" ? "acid"
            : h.kind === "spike" ? "spike"
            : h.kind === "laser" ? "laser"
            : h.kind === "crusher" ? "crusher"
            : h.kind === "drip" ? "acid"
            : "default";
          hurtPlayer(h.kind === "acid" || h.kind === "spike" ? p.safeX : null, cause);
          return;
        }
      }
    }
  }

  function updateArena(calm) {
    const a = state.arena;
    const p = state.player;
    if (!a || a.cleared || !p || state.bossMode) return;

    if (!a.triggered && p.x >= a.x + 40) {
      a.triggered = true;
      a.active = true;
      a.timer = 0;
      state.banner = "ARENA LOCK · CLEAR THE WAVE!";
      state.messageTimer = 90;
      sfxArenaLock();
    }
    if (!a.active) return;

    // Soft cam lock
    state.camX = Math.max(a.lockL - 20, Math.min(state.camX, a.lockR - W + 40));
    if (p.x < a.lockL) p.x = a.lockL;
    if (p.x > a.lockR - p.w) p.x = a.lockR - p.w;

    if (calm) return;
    a.timer++;
    if (a.spawnLeft > 0 && a.timer % 38 === 0) {
      const side = a.timer % 76 === 0 ? a.lockL + 30 : a.lockR - 80;
      spawnEnemy(side, a.spawnLeft % 3 === 0);
      const spawned = state.enemies[state.enemies.length - 1];
      if (spawned) {
        spawned.arenaBound = true;
        spawned.falling = false;
      }
      a.spawnLeft--;
    }
    const foes = state.enemies.filter(function (e) {
      return e.alive && (e.arenaBound || (e.x > a.lockL - 40 && e.x < a.lockR + 40));
    }).length;
    if (a.spawnLeft <= 0 && foes <= 0) {
      a.active = false;
      a.cleared = true;
      const arenaPts = 750 + state.level * 150;
      addScore(arenaPts);
      state.bonusScore += arenaPts;
      state.checkpointX = Math.max(state.checkpointX, a.x + 200);
      state.banner = "ARENA CLEAR · GATE OPEN!";
      state.messageTimer = 100;
      if (state.player) {
        pushScorePop(state.player.x + state.player.w / 2, state.player.y, "ARENA +" + arenaPts, "#39ff14");
      }
      sfxArenaClear();
    }
  }

  function drawHazards() {
    const t = performance.now();
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      const x = h.x - state.camX;
      if (h.kind === "laser") {
        if (x + h.w < -20 || x > W + 20) continue;
        const on = hazardActive(h);
        pxFill(N("metal"), x - 4, h.y - 4, h.w + 8, 8);
        pxFill(N("pinkDim"), x - 2, h.y - 2, h.w + 4, 4);
        ctx.globalAlpha = on ? 0.9 : 0.18;
        pxFill(on ? N("pink") : N("pinkDim"), x, h.y, h.w, h.h);
        if (on) {
          pxFill(N("white"), x + Math.max(1, (h.w / 2) | 0) - 1, h.y, Math.max(2, (h.w / 3) | 0), h.h);
          ctx.globalAlpha = 0.25 + Math.sin(t / 80) * 0.1;
          pxFill(N("pink2"), x - 3, h.y, h.w + 6, h.h);
        } else if (Math.sin(t / 100 + h.x) > 0.7) {
          ctx.globalAlpha = 0.35; pxFill(N("pink2"), x, h.y, h.w, h.h);
        }
        ctx.globalAlpha = 1;
      } else if (h.kind === "spike") {
        if (x + h.w < -10 || x > W + 10) continue;
        const on = hazardActive(h);
        const warn = !on && Math.floor(t / 140) % 2 === 0;
        const spikes = Math.max(3, Math.floor(h.w / 10));
        pxFill(N("metal2"), x, h.y + h.h - 4, h.w, 4);
        for (let s = 0; s < spikes; s++) {
          const sx = x + s * (h.w / spikes);
          const tip = on ? 0 : (warn ? 3 : 7);
          ctx.fillStyle = on ? N("white") : (warn ? N("orange") : N("steel"));
          ctx.beginPath();
          ctx.moveTo(sx + 1, h.y + h.h);
          ctx.lineTo(sx + h.w / spikes / 2, h.y + tip);
          ctx.lineTo(sx + h.w / spikes - 1, h.y + h.h);
          ctx.fill();
        }
      } else if (h.kind === "crusher") {
        if (x + h.w < -20 || x > W + 20) continue;
        ctx.globalAlpha = 0.25 + (h.phase === "down" ? 0.25 : 0);
        pxFill(N("redHot"), x + 4, GROUND - 4, h.w - 8, 4);
        ctx.globalAlpha = 1;
        pxBevel(x, h.y, h.w, h.h, N("orange"), N("red"), N("metal2"));
        pxFill(N("steel"), x + h.w / 2 - 5, 0, 10, h.y);
        pxFill(N("orange"), x + h.w / 2 - 3, 0, 6, h.y);
      } else if (h.kind === "acid") {
        if (x + h.w < -20 || x > W + 20) continue;
        pxFill(N("greenDim"), x, h.y, h.w, Math.min(40, h.h));
        ctx.globalAlpha = 0.55 + Math.sin(t / 200 + h.x) * 0.15;
        pxFill(N("green2"), x, h.y - 4, h.w, 10);
        ctx.globalAlpha = 1;
      } else if (h.kind === "drip" && h.active) {
        const dx = h.x - state.camX;
        if (dx < -20 || dx > W + 20) continue;
        const stretch = 10 + Math.min(18, (h.fallY || 0) * 0.04);
        pxFill(N("green2"), dx, h.fallY, 10, stretch);
        pxFill(N("green"), dx + 2, h.fallY + 2, 6, 6);
      } else if (h.kind === "gate") {
        if (h.open) continue;
        if (x + h.w < -20 || x > W + 20) continue;
        pxFill(N("ink"), x, h.y, h.w, h.h);
        for (let gy = 0; gy < h.h; gy += 14) pxFill(N("cyan"), x + 2, h.y + gy, h.w - 4, 4);
        pxOutline(N("cyan2"), x, h.y, h.w, h.h);
      } else if (h.kind === "wind") {
        if (x + h.w < -20 || x > W + 20) continue;
        if (!hazardActive(h)) continue;
        ctx.globalAlpha = 0.22 + Math.sin(t / 120 + h.x) * 0.08;
        pxFill(N("cyan2"), x, h.y, h.w, h.h);
        ctx.globalAlpha = 0.75;
        const dir = (h.push || 0) >= 0 ? 1 : -1;
        for (let wi = 0; wi < 4; wi++) {
          const wy = h.y + 20 + wi * 40 + (t / 30) % 40;
          pxFill(N("white"), x + (dir > 0 ? 10 : h.w - 30), wy, 20, 3);
        }
        ctx.globalAlpha = 1;
      }
    }
    if (state.arena && state.arena.active && !state.arena.cleared) {
      const a = state.arena;
      const ax = a.x - state.camX;
      ctx.globalAlpha = 0.18;
      pxFill(N("pink"), ax, 0, a.w, H);
      ctx.globalAlpha = 1;
      ctx.fillStyle = N("gold");
      ctx.font = "bold 14px monospace";
      ctx.fillText("ARENA " + state.arena.spawnLeft, Math.max(20, ax + 180), 36);
    }
  }

  function updatePlay() {
    const p = state.player;
    const L = currentLevel();
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
          sfxUi();
        }
      }
    } else {
      state.levelTime -= Math.min(100, levelNow - state.levelTick);
      state.levelTick = levelNow;
      if (state.levelTime <= 0) {
        if (state.godMode) {
          state.levelTime = sectorTimeBudget();
        } else {
          state.levelTime = 0;
          onTimeUp();
          updateHUD();
          return;
        }
      }
    }
    updateMovers();
    updateArena(calm);
    const ix = inputX();
    p.vx = ix * (p.speedT > 0 ? 6.6 : 3.2);
    if (p.speedT > 0) p.speedT--;
    if (p.goldT > 0) p.goldT--;
    if (p.overclockT > 0) {
      p.overclockT--;
      if (p.overclockT === 0) {
        state.banner = "OVERCLOCK ENDED";
        state.messageTimer = 45;
      }
    }
    p.aimUp = inputUp();
    p.crouch = inputDown();
    if (ix) p.facing = ix > 0 ? 1 : -1;
    if (ix) p.run += 0.25; else p.run = 0;

    const jumpDown = inputJump();
    const jumpPressed = jumpDown && !p.jumpWasDown;
    p.jumpWasDown = jumpDown;
    if (p.onGround) p.coyote = 8;
    else if (p.coyote > 0) p.coyote--;
    if (!state.talkQ) {
      if (jumpDown && p.onGround) {
        p.vy = -8.6;
        p.onGround = false;
        p.coyote = 0;
        sfxJump();
      } else if (jumpPressed && p.coyote > 0) {
        p.vy = -8.6;
        p.coyote = 0;
        sfxJump();
      }
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
    if (p.onGround && !isHoleAt(p.x + p.w / 2)) {
      p.safeX = p.x;
      if (p.x > (state.checkpointX || 0) + 280) {
        state.checkpointX = p.x;
        sfxCheckpoint();
        explode(p.x + p.w / 2, GROUND - 8, "#39ff14", 12);
        pushScorePop(p.x + p.w / 2, p.y - 8, "CHECKPOINT", "#39ff14");
        if (state.messageTimer < 25) {
          state.banner = "CHECKPOINT SAVED";
          state.messageTimer = 40;
        }
      }
    }
    if (state.comboTimer > 0) {
      state.comboTimer--;
      if (state.comboTimer <= 0) {
        if (state.combo >= 3) {
          state.banner = "COMBO BREAK ×" + state.combo;
          state.messageTimer = 40;
          sfxComboBreak();
          addJuice({ shake: 4, flash: 8, flashColor: "rgba(255,60,60,0.35)" });
        }
        state.combo = 0;
      }
    }
    for (let i = state.scorePops.length - 1; i >= 0; i--) {
      const sp = state.scorePops[i];
      sp.y += sp.vy;
      sp.life--;
      if (sp.life <= 0) state.scorePops.splice(i, 1);
    }
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

    if (p.y > H + 80) hurtPlayer(p.safeX, "fall");

    const rawFire = inputShoot();
    const firePressed = rawFire && !p.fireHeld;
    const fireReleased = !rawFire && p.fireHeld && !state.talkQ;
    p.fireHeld = rawFire;
    const firing = rawFire && !state.talkQ;
    if (state.talkQ) p.beaming = false;
    p.beamAim = p.aimUp ? -1 : p.crouch ? 1 : 0;
    const def = weaponDef(p.weapon);

    if (!state.talkQ && def && def.kind === "beam") {
      p.beaming = firing && p.beamFuel > 0;
      if (p.beaming) {
        shootGun(p.beamAim);
        if (p.beamFuel <= 0) {
          clearWeapon();
          state.banner = "SPECIAL GUN EMPTY!";
          state.messageTimer = 55;
        }
      }
    } else if (!state.talkQ && def && def.kind === "charge") {
      p.beaming = false;
      if (firing && p.beamFuel > 0) {
        p.maxiPending = 0;
        p.maxiCharge = Math.min(54, (p.maxiCharge || 0) + 1);
        if (p.maxiCharge === 18 || p.maxiCharge === 36 || p.maxiCharge === 54) {
          beep(400 + p.maxiCharge * 8, 0.04, "square", 0.04);
        }
      } else if (fireReleased && (p.maxiCharge || 0) >= 4) {
        p.maxiPending = Math.max(1, Math.min(3, Math.floor((p.maxiCharge || 0) / 18)));
      }
      if (p.maxiPending && !state.talkQ && p.shootCD <= 0 && p.beamFuel > 0) {
        const pow = p.maxiPending;
        p.maxiPending = 0;
        shootGun(p.beamAim, { power: pow });
        p.maxiCharge = 0;
        if (p.beamFuel <= 0) {
          clearWeapon();
          state.banner = "SPECIAL GUN EMPTY!";
          state.messageTimer = 55;
        }
      } else if (!firing && !p.maxiPending) {
        p.maxiCharge = 0;
      }
    } else if (!state.talkQ && def && (def.kind === "proj" || def.kind === "pellets" || def.kind === "wave" || def.kind === "pulse")) {
      p.beaming = false;
      p.maxiCharge = 0;
      if (firing && p.beamFuel > 0) {
        shootGun(p.beamAim);
        if (p.beamFuel <= 0) {
          clearWeapon();
          state.banner = "SPECIAL GUN EMPTY!";
          state.messageTimer = 55;
        }
      }
    } else if (!state.talkQ && !p.weapon) {
      p.beaming = false;
      p.maxiCharge = 0;
      if (firePressed) {
        p.charge = 1;
        shootGun(p.beamAim);
      } else if (firing) {
        p.charge = Math.min(45, (p.charge || 0) + 1);
      } else if (fireReleased && p.charge >= 28) {
        shootGun(p.beamAim);
        p.charge = 0;
      } else if (!firing) {
        p.charge = 0;
      }
    } else {
      p.beaming = false;
      p.beamTick = 0;
      p.maxiCharge = 0;
    }
    if (state.talkQ && (firePressed || inputJump())) state.talkT = 89;
    if (p.shootCD > 0) p.shootCD--;
    if (state.godMode) {
      state.invuln = 9999;
      p.goldT = Math.max(p.goldT, 60);
      if (p.weapon) p.beamFuel = Math.max(p.beamFuel, 50);
      // Keep pistol if player chose slot 1 — do not force MAXI every frame
    } else if (state.invuln > 0) {
      state.invuln--;
    }
    if (state.messageTimer > 0) state.messageTimer--;
    else tickTips();

    state.camX = Math.max(0, Math.min(state.endX - W, p.x - 180));

    if (state.bossMode) {
      updateBoss();
    } else if (!calm) {
      state.spawnTimer--;
      if (state.spawnTimer <= 0) {
        state.spawnTimer = 62 * L.enemyRate * currentDiff().spawnMult + Math.random() * 36;
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
      if (b.from === "player" && b.homing) {
        const tgt = nearestEnemy(b.x + b.w / 2, b.y + b.h / 2, Math.sign(b.vx) || 1);
        if (tgt) {
          const tx = tgt.x + tgt.w / 2 - (b.x + b.w / 2);
          const ty = tgt.y + tgt.h / 2 - (b.y + b.h / 2);
          const len = Math.hypot(tx, ty) || 1;
          const spd = 7.4;
          b.vx += (tx / len * spd - b.vx) * 0.18;
          b.vy += (ty / len * spd - b.vy) * 0.18;
        }
      }
      if (b.from === "player" && b.rico && b.bounces > 0) {
        if (b.y < 12) { b.y = 12; b.vy = Math.abs(b.vy); b.bounces--; beep(660, 0.03, "triangle", 0.03); }
        if (b.y + b.h > GROUND) { b.y = GROUND - b.h; b.vy = -Math.abs(b.vy); b.bounces--; beep(660, 0.03, "triangle", 0.03); }
        if (b.x < state.camX + 4) { b.x = state.camX + 4; b.vx = Math.abs(b.vx); b.bounces--; }
        if (b.x > state.camX + W - 12) { b.x = state.camX + W - 12; b.vx = -Math.abs(b.vx); b.bounces--; }
        if (b.bounces <= 0) b.life = Math.min(b.life, 8);
      }
      if (b.from === "player" && b.pulse) {
        b.vy += b.grav || 0.28;
        if (b.y + b.h >= GROUND) {
          pulseExplode(b);
          b.life = 0;
        }
      }
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
      if (e.elite) {
        if (e.shieldCD > 0) {
          e.shieldCD--;
          if (e.shieldCD <= 0) e.shieldUp = true;
        }
        if (e.mode === "telegraph" || e.mode === "dash") {
          e.shieldUp = false;
          e.shieldCD = Math.max(e.shieldCD || 0, 28);
        }
      }
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
        if (e.arenaBound && state.arena && state.arena.active) {
          if (e.x < state.arena.lockL + 8) { e.x = state.arena.lockL + 8; e.vx = Math.abs(e.vx || e.baseSpd || 1); }
          if (e.x > state.arena.lockR - e.w - 8) { e.x = state.arena.lockR - e.w - 8; e.vx = -Math.abs(e.vx || e.baseSpd || 1); }
          e.falling = false;
          e.y = GROUND - e.h;
          e.vy = 0;
        } else if (e.falling || isHoleAt(e.x + e.w / 2)) {
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
      const pad = currentDiff().hitPad || 6;
      if (rectsOverlap({ x: p.x + pad, y: p.y + pad + 2, w: Math.max(8, p.w - pad * 2), h: Math.max(12, p.h - pad * 2 - 2) }, e) && state.invuln <= 0) hurtPlayer(null, "enemy");
    }

    for (let i = 0; i < state.bullets.length; i++) {
      const b = state.bullets[i];
      if (b.from === "player") {
        for (let j = 0; j < state.enemies.length; j++) {
          const e = state.enemies[j];
          if (!e.alive) continue;
          if (rectsOverlap({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, e)) {
            damageEnemy(e, b.dmg || 1, Math.sign(b.vx) || state.player.facing, {
              knock: b.knock, antiShield: b.antiShield || (b.pulse ? 3 : (b.charged ? 2 : 0))
            });
            if (b.pulse) {
              pulseExplode(b);
              b.life = 0;
              continue;
            }
            explode(b.x + b.w / 2, b.y + b.h / 2, b.color || N("gold"), b.charged ? 12 : 5);
            if (b.charged) addJuice({ shake: 5, hitStop: 2, flash: 4 });
            if (b.rico && b.bounces > 0) {
              b.vx *= -1;
              b.vy = -Math.abs(b.vy) - 1;
              b.bounces--;
              b.x += b.vx * 2;
            } else {
              b.life = 0;
            }
          }
        }
        for (let pi = 0; pi < state.platforms.length; pi++) {
          const plat = state.platforms[pi];
          if (!plat.breakable || plat.gone) continue;
          if (!rectsOverlap({ x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }, plat)) continue;
          plat.hp = (plat.hp || 2) - (b.charged ? 2 : 1);
          explode(b.x + b.w / 2, b.y + b.h / 2, "#fbbf24", 8);
          b.life = 0;
          addJuice({ shake: 3 });
          if (plat.hp <= 0) {
            plat.gone = true;
            addScore(150);
            state.bonusScore += 150;
            pushScorePop(plat.x + plat.w / 2, plat.y, "+150", "#fbbf24");
            if (rnd() < 0.45) {
              state.qrs.push({
                x: plat.x + plat.w / 2 - 12, y: plat.y - 28,
                w: 24, h: 24, bob: rnd() * 4, taken: false,
                power: rnd() < 0.25 ? "speed" : 0
              });
            }
            state.banner = "NEON SHATTER!";
            state.messageTimer = 35;
            sfxBounce();
            addJuice({ shake: 5, flash: 4, flashColor: "rgba(251,191,36,0.3)" });
          }
          break;
        }
        if (state.bossMode && state.boss && state.boss.alive && rectsOverlap({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }, state.boss)) {
          damageEnemy(state.boss, b.dmg || 1, Math.sign(b.vx) || state.player.facing, {
            knock: b.knock, antiShield: b.antiShield || (b.pulse ? 3 : (b.charged ? 2 : 0))
          });
          if (b.pulse) pulseExplode(b);
          explode(b.x + b.w / 2, b.y + b.h / 2, b.color || N("green"), 6);
          if (b.rico && b.bounces > 0) {
            b.vx *= -1; b.vy *= -1; b.bounces--;
          } else {
            b.life = 0;
          }
        }
      } else if (b.from === "enemy") {
        const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const dist = Math.hypot(pcx - bcx, pcy - bcy);
        if (rectsOverlap(b, p)) {
          b.life = 0;
          hurtPlayer(null, "bullet");
        } else if (!b.grazed && state.invuln <= 0 && !(p.goldT > 0) && dist < 28 && dist > 10) {
          b.grazed = true;
          state.grazeCount = (state.grazeCount || 0) + 1;
          const gPts = 40 + Math.min(40, state.grazeCount);
          addScore(gPts);
          state.grazeScore = (state.grazeScore || 0) + gPts;
          state.bonusScore += gPts;
          const rank = styleRank(state.grazeCount);
          pushScorePop(pcx, p.y, rank.label + " +" + gPts, rank.color);
          sfxGraze();
          if (state.grazeCount === 1 || state.grazeCount % 5 === 0 || state.grazeCount === 3 || state.grazeCount === 6 || state.grazeCount === 12 || state.grazeCount === 20) {
            state.banner = rank.label + " ×" + state.grazeCount;
            state.messageTimer = 40;
          }
        }
      }
    }
    state.enemies = state.enemies.filter(function (e) {
      if (!e.alive) return false;
      if (e.arenaBound && state.arena && state.arena.active && !state.arena.cleared) return true;
      return e.x > state.camX - 100;
    });

    for (let i = 0; i < state.qrs.length; i++) {
      const q = state.qrs[i];
      if (q.taken) continue;
      q.bob += 0.12;
      const hit = { x: q.x, y: q.y + Math.sin(q.bob) * 5, w: q.w, h: q.h };
      if (rectsOverlap(p, hit)) {
        q.taken = true;
        if (q.power === "life") {
          if (state.lives < MAX_LIVES) state.lives++;
          addScore(300);
          state.banner = "1-UP QR! ♥×" + state.lives;
          state.messageTimer = 80;
          sfxOneUp();
        } else if (q.power === "ember" || q.power === "storm" || q.power === "signal") {
          const sid = q.power === "storm" ? "storm" : (q.power === "signal" ? "signal" : "ember");
          const def = secretDef(sid);
          state.secretKey = true;
          state.secretKind = sid;
          addScore(1000);
          state.banner = def ? def.keyBanner : "SECRET KEY!";
          state.messageTimer = 110;
          sfxOneUp();
          if (state.secretPortal && state.secretPortal.secretId === sid) state.secretPortal.open = true;
          state.flash = 10;
        } else if (q.power === "overclock") {
          addScore(600);
          activateOverclock(8);
        } else {
          addScore(q.power === "gold" ? 500 : q.power === "speed" ? 400 : 250);
          if (q.power === "speed") {
            p.speedT = 300;
            state.banner = "SPEED BOOST 5s!";
            state.messageTimer = 70;
            sfxPickup("speed");
          } else if (q.power === "gold") {
            p.goldT = 300;
            state.banner = "INVINCIBLE 5s!";
            state.messageTimer = 70;
            sfxPickup("gold");
          } else {
            sfxPickup();
          }
        }
        explode(q.x + 8, q.y + 8, q.power === "life" ? "#ff2bd6" : q.power === "ember" ? "#fb7185" : q.power === "storm" ? "#67e8f9" : q.power === "signal" ? "#34d399" : q.power === "overclock" ? "#fbbf24" : q.power === "gold" ? "#ffd400" : q.power === "speed" ? "#3b82f6" : "#39ff14", 12);
      }
    }
    for (let i = 0; i < state.staffs.length; i++) {
      const s = state.staffs[i];
      if (s.taken) continue;
      s.bob += 0.1;
      const hit = { x: s.x, y: s.y + Math.sin(s.bob) * 3, w: s.w, h: s.h };
      if (rectsOverlap(p, hit)) {
        s.taken = true;
        grantWeapon(s.type);
        if (s.ammo) state.player.beamFuel = s.ammo | 0;
        addScore(100);
        announceWeapon(s.type);
        sfxPickup("weapon");
      }
    }

    for (let i = 0; i < state.particles.length; i++) {
      const pt = state.particles[i];
      pt.x += pt.vx; pt.y += pt.vy;
      if (!pt.wave && !pt.noGrav) pt.vy += 0.15;
      pt.life--;
    }
    state.particles = state.particles.filter(function (pt) { return pt.life > 0; });

    if (!state.bossMode || state.hazards.length) updateHazards(calm);

    // Secret vault / spire portal
    if (state.secretPortal && state.secretKey && !state.inSecret) {
      const gate = state.secretPortal;
      const sid = gate.secretId;
      const keyOk = !!sid && state.secretKind === sid;
      if (keyOk && !isSecretDone(sid)) {
        gate.open = true;
        if (rectsOverlap(p, gate) && (inputUp() || inputJump())) {
          enterSecretStage();
          updateHUD();
          return;
        }
      } else {
        gate.open = false;
      }
    }

    if (!state.bossMode && p.x + p.w >= state.endX - 65) {
      if (state.arena && state.arena.active && !state.arena.cleared) {
        p.x = state.endX - 70;
      } else if (state.inSecret) {
        onSecretComplete();
      } else if (state.level === LEVELS.length - 1) startBossFight("final");
      else if (state.level === MID_BOSS_LEVEL) startBossFight("mid");
      else onLevelComplete();
      updateHUD();
      return;
    }
    updateHUD();
  }


  function placeProps(theme, len) {
    state.props = [];
    const step = theme === "slums" ? 160 : 220;
    for (let x = 120; x < len - 200; x += step + ((x / 17) | 0) % 40) {
      const roll = (x * 17 + (state.level || 0) * 13) % 7;
      let kind = "crate";
      if (theme === "docks") kind = roll < 3 ? "crate" : roll < 5 ? "arrow" : "coil";
      else if (theme === "tunnel") kind = roll < 3 ? "panel" : roll < 5 ? "cable" : "vent";
      else if (theme === "spire") kind = roll < 3 ? "mast" : roll < 5 ? "light" : "rail";
      else if (theme === "slums") kind = roll < 3 ? "fence" : roll < 5 ? "trash" : "graffiti";
      else if (theme === "skyrail") kind = roll < 3 ? "rail" : roll < 5 ? "signal" : "cable";
      else if (theme === "voidmarket") kind = roll < 3 ? "stall" : roll < 5 ? "holo" : "crate";
      else if (theme === "sewers" || theme === "secret") kind = roll < 3 ? "pipe" : roll < 5 ? "valve" : "grate";
      else if (theme === "storm") kind = roll < 4 ? "mast" : "signal";
      else kind = roll < 3 ? "crate" : "cable";
      const y = GROUND - (kind === "mast" ? 70 : kind === "stall" ? 48 : 28);
      state.props.push({ x: x, y: y, kind: kind, bob: x * 0.01 });
    }
  }

  function drawProps() {
    if (!state.props) return;
    const t = performance.now() / 200;
    for (let i = 0; i < state.props.length; i++) {
      const pr = state.props[i];
      const x = pr.x - state.camX;
      if (x < -60 || x > W + 60) continue;
      const y = pr.y;
      if (pr.kind === "crate") { pxBevel(x, y, 22, 18, N("wood2"), N("wood"), N("wood")); pxFill(N("ink"), x + 4, y + 6, 14, 2); }
      else if (pr.kind === "arrow") { pxFill(N("pink"), x, y + 8, 28, 4); ctx.fillStyle = N("gold"); ctx.beginPath(); ctx.moveTo(x + 28, y + 4); ctx.lineTo(x + 38, y + 10); ctx.lineTo(x + 28, y + 16); ctx.fill(); }
      else if (pr.kind === "coil") { pxFill(N("steel"), x, y + 10, 18, 8); pxFill(N("cyanDim"), x + 2, y + 4, 14, 6); }
      else if (pr.kind === "panel") { pxBevel(x, y, 26, 20, N("cyan"), N("cyanDim"), N("ink")); pxFill(N("green"), x + 4, y + 6, 4, 4); pxFill(N("pink"), x + 10, y + 6, 4, 4); }
      else if (pr.kind === "cable") { ctx.strokeStyle = N("purple"); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 20, y + 20 + Math.sin(t + pr.bob) * 4, x + 40, y + 8); ctx.stroke(); }
      else if (pr.kind === "vent") { pxFill(N("metal2"), x, y, 24, 14); for (let v = 0; v < 4; v++) pxFill(N("cyanDim"), x + 3 + v * 5, y + 3, 3, 8); }
      else if (pr.kind === "mast") { pxFill(N("steel"), x + 8, y, 4, 70); pxFill(N("cyan"), x + 2, y, 16, 4); pxFill(Math.sin(t) > 0 ? N("pink") : N("gold"), x + 6, y - 6, 8, 6); }
      else if (pr.kind === "light") { pxFill(N("metal"), x, y + 10, 6, 16); ctx.globalAlpha = 0.5 + Math.sin(t * 2 + pr.bob) * 0.3; pxFill(N("cyan2"), x - 4, y, 14, 10); ctx.globalAlpha = 1; }
      else if (pr.kind === "rail") { pxFill(N("steel"), x, y + 16, 40, 3); pxFill(N("cyan"), x, y + 14, 40, 2); }
      else if (pr.kind === "fence") { for (let f = 0; f < 5; f++) { pxFill(N("silver"), x + f * 7, y, 2, 24); } }
      else if (pr.kind === "trash") { pxFill(N("steel"), x, y + 8, 16, 12); pxFill(N("pinkDim"), x + 18, y + 10, 12, 10); }
      else if (pr.kind === "graffiti") { pxFill(N("pink"), x, y, 20, 8); pxFill(N("cyan"), x + 4, y + 10, 16, 6); }
      else if (pr.kind === "signal") { pxFill(N("metal"), x + 6, y, 4, 28); pxFill(Math.floor(t) % 2 ? N("redHot") : N("green"), x + 2, y - 4, 12, 8); }
      else if (pr.kind === "stall") { pxFill(N("purpleDim"), x, y, 36, 10); pxFill(N("ink"), x + 2, y + 10, 32, 24); }
      else if (pr.kind === "holo") { ctx.globalAlpha = 0.4 + Math.sin(t) * 0.2; pxFill(N("cyan2"), x, y, 14, 28); ctx.globalAlpha = 1; pxOutline(N("cyan"), x, y, 14, 28); }
      else if (pr.kind === "pipe") { pxFill(N("greenDim"), x, y + 8, 36, 10); pxFill(N("green2"), x + 4, y + 10, 28, 4); }
      else if (pr.kind === "valve") { pxFill(N("metal2"), x, y + 6, 16, 16); pxFill(N("orange"), x + 4, y + 10, 8, 8); }
      else if (pr.kind === "grate") { pxFill(N("ink"), x, y + 14, 28, 8); for (let g = 0; g < 5; g++) pxFill(N("steel"), x + 2 + g * 5, y + 15, 2, 6); }
    }
  }

  function drawCity() {
    const sDef = state.inSecret ? activeSecretDef() : null;
    const pal = PAL[sDef ? sDef.palIndex : Math.min(state.level, PAL.length - 1)];
    const bi = state.bossMode
      ? Math.min(5, imgs.backgrounds.length - 1)
      : state.inSecret
        ? Math.min(5, imgs.backgrounds.length - 1)
        : Math.min(state.level, imgs.backgrounds.length - 1);
    const bg = imgs.backgrounds[bi];
    if (bg && bg.complete && bg.naturalWidth) {
      const iw = bg.naturalWidth, ih = bg.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.imageSmoothingEnabled = false;
      if (state.inSecret) {
        ctx.fillStyle = "#fb7185";
        ctx.globalAlpha = 0.12;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pal[2];
      ctx.globalAlpha = 0.02 + (state.inSecret ? 0.06 : state.level * 0.01);
      ctx.fillRect(0, 0, W, GROUND);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = pal[0];
      ctx.fillRect(0, 0, W, H);
    }
    // Mid parallax neon silhouettes
    const mid = state.camX * 0.32;
    for (let i = 0; i < 10; i++) {
      const bx = ((i * 140 - mid) % (W + 160)) - 40;
      const bh = 40 + ((i * 37) % 70);
      ctx.globalAlpha = 0.18;
      pxFill(N("ink"), bx, GROUND - bh, 48 + (i % 3) * 12, bh);
      ctx.globalAlpha = 0.35;
      pxFill(i % 2 ? N("pinkDim") : N("cyanDim"), bx + 6, GROUND - bh + 8, 8, 8);
      ctx.globalAlpha = 1;
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

  function drawPlatformSprite(p, x) {
    const pool = imgs.platforms;
    const img = pool.length ? pool[(p.skin || 0) % pool.length] : null;
    const drawH = 36;
    if (!img || !img.complete || !img.naturalWidth) {
      const body = p.crumble ? N("steel") : p.mover ? N("ink") : p.bounce ? N("purpleDim") : p.breakable ? "#7c2d12" : N("metal");
      const top = p.crumble ? N("orange") : p.mover ? N("blue") : p.bounce ? N("purple2") : p.breakable ? N("gold2") : N("cyan");
      const bot = p.mover ? N("purple") : p.bounce ? N("pink2") : p.breakable ? N("orange") : N("pink");
      pxBevel(x, p.y, p.w, Math.max(8, p.h), top, bot, body);
      return;
    }
    const iw = img.naturalWidth, ih = img.naturalHeight;
    ctx.save();
    if (p.crumble) ctx.globalAlpha = 0.72 + 0.28 * Math.sin(performance.now() / 90);
    else if (p.voidFake) ctx.globalAlpha = 0.55;
    else if (p.breakable) ctx.globalAlpha = 0.92;
    if (p.w <= 96) {
      ctx.drawImage(img, x, p.y, p.w, drawH);
    } else {
      const cap = Math.max(18, Math.floor(iw * 0.24));
      const midSrc = Math.max(10, iw - cap * 2);
      let dx = x;
      let rem = p.w - cap * 2;
      ctx.drawImage(img, 0, 0, cap, ih, dx, p.y, cap, drawH);
      dx += cap;
      while (rem > 0) {
        const tw = Math.min(midSrc, rem);
        ctx.drawImage(img, cap, 0, midSrc, ih, dx, p.y, tw, drawH);
        dx += tw;
        rem -= tw;
      }
      ctx.drawImage(img, iw - cap, 0, cap, ih, dx, p.y, cap, drawH);
    }
    ctx.restore();
    if (p.mover) {
      const chev = Math.floor(performance.now() / 200) % 3;
      pxFill(N("cyan2"), x + 8 + chev * 6, p.y + 5, 5, 2);
    }
    if (p.bounce) {
      pxFill(N("purple2"), x + 4, p.y + 1, p.w - 8, 2);
    }
    if (p.crumble && p.life != null && p.maxLife) {
      pxFill(N("red"), x, p.y - 4, p.w * Math.max(0, p.life / p.maxLife), 2);
    }
    if (p.breakable) {
      for (let s = 0; s < p.w; s += 12) pxFill(N("gold2"), x + s, p.y, 6, 2);
    }
  }

  function drawPlatforms() {
    for (let i = 0; i < state.platforms.length; i++) {
      const p = state.platforms[i];
      if (p.gone || p.y >= GROUND) continue;
      const x = p.x - state.camX;
      if (x + p.w < -20 || x > W + 20) continue;
      drawPlatformSprite(p, x);
    }
    const start = Math.floor(state.camX / 32) * 32;
    for (let x = start; x < state.camX + W + 32; x += 32) {
      const sx = x - state.camX;
      pxFill((Math.floor(x / 32) % 2) ? N("ink") : N("void"), sx, GROUND, 32, H - GROUND);
      ctx.globalAlpha = 0.35;
      pxFill(N("metal2"), sx, GROUND, 32, H - GROUND);
      ctx.globalAlpha = 1;
      pxFill(N("cyan"), sx, GROUND, 32, 2);
      pxFill(N("pinkDim"), sx + 2, GROUND + 3, 28, 1);
      pxOutline(N("black"), sx, GROUND, 32, 12);
    }
    for (let i = 0; i < state.holes.length; i++) {
      const h = state.holes[i];
      const left = h.x - state.camX;
      const right = h.x + h.w - state.camX;
      if (right < -20 || left > W + 20) continue;
      pxFill(N("black"), left, GROUND, h.w, H - GROUND);
      pxFill(N("steel"), left - 8, GROUND, 8, H - GROUND);
      pxFill(N("steel"), right, GROUND, 8, H - GROUND);
      pxFill(N("silver"), left - 3, GROUND, 3, 36);
      pxFill(N("silver"), right, GROUND, 3, 36);
      pxFill(N("orange"), left - 8, GROUND - 2, 8, 2);
      pxFill(N("orange"), right, GROUND - 2, 8, 2);
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
    if (e.elite) {
      ctx.shadowColor = N("gold2");
      ctx.shadowBlur = 14;
      if (e.shieldUp) {
        ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 120) * 0.12;
        ctx.strokeStyle = N("gold");
        ctx.lineWidth = 3;
        ctx.beginPath();
        const side = e.facing > 0 ? w / 2 + 6 : -w / 2 - 6;
        ctx.arc(side * (e.facing > 0 ? -1 : 1), 0, h * 0.42, -1.1, 1.1);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = N("steel");
        ctx.lineWidth = 2;
        ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
        ctx.globalAlpha = 1;
      }
    }
    if (e.flash > 0) ctx.globalAlpha = 0.55 + (e.flash % 2) * 0.35;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (e.elite) {
      ctx.fillStyle = e.shieldUp ? N("gold") : N("orange");
      ctx.font = "bold 8px monospace";
      ctx.fillText(e.shieldUp ? "SHIELD" : "OPEN", -16, -h / 2 - 12);
    }

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
    const sx = b.x - state.camX, sy = b.y;
    const core = b.phase === 2 ? (b.accentHot || "#ff7a12") : (b.accent || "#ef4444");
    const pulse = 0.5 + Math.sin(performance.now() / (b.phase === 2 ? 70 : 140)) * 0.32;
    const eyeOn = b.mode === "eyeFire" || b.mode === "eyeCharge";
    const charging = b.mode.indexOf("Charge") >= 0 || b.mode === "skyHold" || b.mode === "pulseCharge"
      || b.mode === "dashCharge" || b.mode === "pillarCharge";
    const active = b.mode === "laser" || b.mode === "laserCharge";
    const img = imgs.boss;
    const useSprite = !b.midBoss && img && img.complete && img.naturalWidth;

    if (b.phaseFlash > 0) {
      ctx.globalAlpha = 0.25 + (b.phaseFlash % 6) * 0.08;
      ctx.fillStyle = core;
      ctx.fillRect(sx - 10, sy - 10, b.w + 20, b.h + 20);
      ctx.globalAlpha = 1;
    }

    if (useSprite) {
      const bob = Math.sin(b.walk || 0) * 1.6;
      const jumpLift = (b.mode === "jump" || b.mode === "skySlam" || b.mode === "dash") ? -4
        : (b.mode === "jumpCharge" || b.mode === "skyHold" || b.mode === "skyRise") ? -2 : 0;
      const h = b.h;
      const w = Math.round(img.naturalWidth * (h / img.naturalHeight));
      const dx = sx + (b.w - w) / 2;
      const dy = sy + bob + jumpLift;
      ctx.save();
      if (b.hitCD > 0) ctx.globalAlpha = 0.5 + (b.hitCD % 2) * 0.35;
      else if (charging) ctx.globalAlpha = 0.88 + pulse * 0.12;
      // Art faces camera-left by default (same as robots)
      if (b.facing > 0) {
        ctx.translate(dx + w, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, w, h);
      } else {
        ctx.drawImage(img, dx, dy, w, h);
      }
      ctx.restore();
      if (eyeOn || charging || active) {
        ctx.globalAlpha = eyeOn || active ? 0.55 : pulse * 0.4;
        ctx.fillStyle = eyeOn || charging ? "#ff7a12" : core;
        ctx.fillRect(sx + b.w * 0.32, sy + b.h * 0.28, b.w * 0.36, b.h * 0.18);
        ctx.globalAlpha = 1;
      }
      if (b.phase === 2) {
        ctx.globalAlpha = 0.22 + pulse * 0.2;
        ctx.fillStyle = b.accentHot || "#ff7a12";
        ctx.fillRect(sx + 8, sy + 4, b.w - 16, 4);
        ctx.globalAlpha = 1;
      }
      if (!b.vulnerable) drawGlobeShield(sx + b.w / 2, sy + b.h * 0.48, Math.max(70, b.w * 0.95), core);
      return;
    }

    // Procedural mid-boss (Pulse Warden)
    const f = b.facing < 0 ? -1 : 1;
    const step = Math.sin(b.walk) * 0.3, jump = b.mode === "jump" || b.mode === "skySlam" || b.mode === "dash" ? 0.55 : b.mode === "jumpCharge" || b.mode === "skyHold" || b.mode === "skyRise" ? 0.32 : 0;
    const armor = b.midBoss ? "#4a1760" : "#3f1212";
    const armor2 = b.midBoss ? "#7a2a9a" : "#7f1d1d";
    const armor3 = b.midBoss ? "#2a0a38" : "#1c0a0a";
    const trim = b.midBoss ? "#f0abfc" : "#fca5a5";
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
      box(trim, 1, -hw + 1, len - 2, 2);
      box("#0a1b2e", 4, -2, len - 8, 4);
      lit(core, len - 7, -hw + 2, 3, wide - 4, pulse);
      ctx.restore();
      return { x: lx + Math.cos(a) * len, y: ly + Math.sin(a) * len };
    }
    ctx.save();
    ctx.translate(sx + 39, sy);
    ctx.scale(f, 1);
    let k = limb(-5, 78, 23, 12, Math.PI / 2 + step + jump, armor2, "#04203f");
    let s = limb(k.x, k.y, 23, 10, Math.PI / 2 - step - jump * 1.4, armor3, "#03182f");
    box("#03101e", s.x - 4, s.y - 5, 20, 10); box(armor, s.x - 3, s.y - 4, 18, 8);
    k = limb(7, 78, 23, 12, Math.PI / 2 - step - jump, armor, "#052445");
    s = limb(k.x, k.y, 23, 10, Math.PI / 2 + step + jump * 1.4, armor, "#04203f");
    box("#03101e", s.x - 4, s.y - 5, 22, 10); box(armor2, s.x - 3, s.y - 4, 20, 8);
    box(trim, s.x - 3, s.y - 4, 20, 2);
    let elbow = limb(-9, 42, 16, 10, Math.PI / 2 - Math.sin(b.walk) * 0.2, armor2, "#052445");
    let hand = limb(elbow.x, elbow.y, 14, 8, Math.PI / 2 - 0.2, armor3, "#03182f");
    box("#5b7fa6", hand.x - 3, hand.y - 3, 7, 7);
    box("#03101e", -15, 26, 36, 56);
    box("#061225", -12, 28, 30, 52);
    box(armor2, -14, 28, 34, 30);
    box(trim, -14, 28, 34, 3);
    box(armor, -14, 50, 34, 8);
    box(b.midBoss ? "#d946ef" : "#b91c1c", -3, 34, 18, 14);
    for (let i = 0; i < 3; i++) {
      box("#03101e", 7, 36 + i * 4, 7, 3); box(core, 8, 37 + i * 4, 5, 1);
    }
    lit(core, 0, 36, 12, 12, pulse * 0.55);
    box("#03101e", 2, 38, 8, 8); box(core, 3, 39, 6, 6); box("#dffcff", 4, 40, 3, 3);
    box(armor, -11, 56, 26, 22); box("#04203f", -11, 72, 26, 6);
    for (let i = 0; i < 3; i++) box("#03101e", -9, 58 + i * 5, 22, 2);
    box("#03101e", -21, 30, 9, 24); box(armor, -20, 31, 7, 22);
    lit(core, -19, 33, 5, 4, pulse); lit(core, -19, 40, 5, 3, pulse * 0.7);
    box("#03101e", -21, 24, 16, 18); box(armor2, -20, 25, 14, 16);
    box(trim, -20, 25, 14, 2); lit(core, -17, 30, 8, 4, pulse);
    ctx.save();
    ctx.translate(13, 20);
    ctx.rotate(aimA * 0.7);
    box("#03101e", -8, -14, 32, 28);
    box(armor2, -6, -12, 28, 24);
    box(trim, -6, -12, 28, 3);
    box("#04203f", -6, 6, 28, 6);
    box("#03101e", 16, -6, 12, 14);
    box("#061225", 18, -4, 10, 10);
    lit(eyeOn || charging ? "#ff7a12" : core, 20, -2, 8, 6, eyeOn || charging ? 1 : pulse);
    box(eyeOn ? "#fff27a" : "#dffcff", 21, -1, 6, 4);
    box("#03101e", 0, 4, 12, 6);
    for (let i = 0; i < 3; i++) box("#5b7fa6", 2 + i * 3, 5, 2, 4);
    box("#8fb6d6", 4, -18, 2, 6); lit(core, 2, -22, 6, 4, pulse);
    if (eyeOn || charging) lit("#ff7a12", 14, -4, 16, 10, 0.5);
    ctx.restore();
    const gunA = active ? aimA : aimA * 0.85 + Math.sin(b.walk) * 0.1;
    elbow = limb(11, 46, 26, 12, gunA, armor2, "#052445");
    hand = limb(elbow.x, elbow.y, 24, 11, gunA, armor3, "#03182f");
    box("#03101e", hand.x - 6, hand.y - 6, 12, 12);
    box(active ? core : "#5b7fa6", hand.x - 4, hand.y - 4, 8, 8);
    if (active) lit(core, hand.x - 8, hand.y - 8, 16, 16, pulse);
    ctx.restore();
    if (!b.vulnerable) drawGlobeShield(sx + 39, sy + 54, 76, core);
  }

  function drawBossTelegraphs(b) {
    const accent = b.accentHot || "#39ff14";
    const blink = Math.floor(performance.now() / 100) % 2;
    if (b.mode === "pulseCharge" || b.mode === "pulseWave") {
      const cx = b.x + b.w / 2 - state.camX, cy = b.y + b.h / 2;
      const r = b.mode === "pulseWave" ? b.pulseR : 30 + (40 - Math.max(0, b.timer)) * 2;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = b.mode === "pulseWave" ? 0.85 : (blink ? 0.7 : 0.35);
      ctx.lineWidth = b.mode === "pulseWave" ? 8 : 3;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(8, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    }
    if (b.mode === "dashCharge" || b.mode === "dash") {
      const y = b.y + b.h - 12;
      ctx.globalAlpha = blink ? 0.55 : 0.28;
      ctx.fillStyle = "#ff2bd6";
      ctx.fillRect(20, y, W - 40, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fce7f3";
      ctx.font = "bold 11px monospace";
      ctx.fillText(b.dashDir < 0 ? "<<< DASH" : "DASH >>>", b.dashDir < 0 ? 40 : W - 120, y - 4);
    }
    if (b.mode === "pillarCharge" || b.mode === "pillar") {
      for (let i = 0; i < b.pillars.length; i++) {
        const px = b.pillars[i] - state.camX;
        ctx.globalAlpha = b.mode === "pillar" ? 0.75 : (blink ? 0.55 : 0.25);
        ctx.fillStyle = b.mode === "pillar" ? "#00e5ff" : "#ffd400";
        ctx.fillRect(px - 16, 20, 32, GROUND - 24);
        if (b.mode === "pillar") {
          ctx.fillStyle = "#e0f2fe";
          ctx.fillRect(px - 6, 20, 12, GROUND - 24);
        }
        ctx.globalAlpha = 1;
      }
    }
    if (b.mode === "laserCharge") {
      const h = bossHand(b);
      const ang = Math.atan2(b.laserAimY - h.y, b.laserAimX - h.x);
      ctx.save();
      ctx.translate(h.x - state.camX, h.y);
      ctx.rotate(ang);
      ctx.globalAlpha = blink ? 0.55 : 0.25;
      ctx.fillStyle = accent;
      ctx.fillRect(0, -2, 900, 4);
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(b.laserAimX - state.camX, b.laserAimY, 10 + (blink ? 4 : 0), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBullet(b, bx) {
    const cx = bx + (b.w || 8) / 2;
    const cy = b.y + (b.h || 6) / 2;
    const ang = Math.atan2(b.vy || 0, b.vx || 1);
    const col = b.color || N("gold");
    const flick = Math.floor(performance.now() / 55) % 2;

    if (b.homing || b.shot === "homing") {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      pxFill(N("ink"), -11, -5, 20, 10);
      pxFill(col, -9, -4, 18, 8);
      pxFill(N("white"), 2, -2, 10, 4);
      pxFill(N("purple2"), -12, -6, 5, 3);
      pxFill(N("purple2"), -12, 3, 5, 3);
      pxFill(flick ? N("orange") : N("gold"), -18, -3, 8, 6);
      pxFill(N("pink"), -16, -1, 4, 2);
      ctx.restore();
      return;
    }
    if (b.rico || b.shot === "rico") {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + (flick ? 0.2 : -0.2));
      ctx.fillStyle = N("ink");
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(6, 0); ctx.lineTo(0, 6); ctx.lineTo(-6, 0); ctx.fill();
      pxFill(N("white"), -2, -2, 4, 4);
      ctx.restore();
      return;
    }
    if (b.pulse || b.shot === "pulse") {
      const r = 9 + flick;
      ctx.globalAlpha = 0.35;
      pxFill(col, cx - r - 4, cy - r - 4, (r + 4) * 2, (r + 4) * 2);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = N("gold");
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      pxFill(N("white"), cx - 2, cy - 2, 3, 3);
      ctx.strokeStyle = N("orange");
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
      return;
    }
    if (b.charged || b.shot === "maxi") {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.4;
      pxFill(col, -18, -8, 28, 16);
      ctx.globalAlpha = 1;
      pxFill(N("ink"), -10, -7, 22, 14);
      pxFill(col, -8, -5, 20, 10);
      pxFill(N("white"), 0, -3, 12, 6);
      pxFill(N("gold"), 8, -2, 8, 4);
      // spikes
      pxFill(col, -4, -10, 4, 4);
      pxFill(col, -4, 6, 4, 4);
      pxFill(flick ? N("pink2") : N("pink"), -16, -3, 6, 6);
      ctx.restore();
      return;
    }
    // slug / pistol / spread bolt
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const long = b.shot === "spread" ? 14 : 16;
    ctx.globalAlpha = 0.4;
    pxFill(col, -long - 4, -2, 12, 4);
    ctx.globalAlpha = 1;
    pxFill(N("ink"), -6, -4, long, 8);
    pxFill(col, -5, -3, long - 1, 6);
    pxFill(N("white"), long - 10, -2, 8, 4);
    pxFill(N("gold"), long - 4, -1, 5, 2);
    if (b.shot === "spread") {
      pxFill(N("orange"), -8, -5, 3, 2);
      pxFill(N("orange"), -8, 3, 3, 2);
    }
    ctx.restore();
  }

  function drawFireball(b, bx) {
    const cx = bx + b.w / 2, cy = b.y + b.h / 2;
    const ang = Math.atan2(b.vy, b.vx || (b.facing || 1));
    const flick = Math.floor(performance.now() / 45) % 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.45;
    pxFill("#ff2b2b", -18, -8, 16, 16);
    ctx.globalAlpha = 1;
    pxFill("#7f1d1d", -12, -6, 22, 12);
    pxFill("#ef2b12", -10, -5, 18, 10);
    pxFill("#ff7a12", -2, -4, 14, 8);
    pxFill("#fff27a", 6, -3, 10, 6);
    pxFill("#ffffff", 12, -1, 5, 2);
    pxFill(flick ? "#fb7185" : "#ff2bd6", -16, -3, 6, 6);
    ctx.restore();
  }

  function drawEnemyBullet(b, bx) {
    if (b.fire) {
      drawFireball(b, bx);
      return;
    }
    const cx = bx + b.w / 2, cy = b.y + b.h / 2;
    const ang = Math.atan2(b.vy || 0, b.vx || 1);
    const flick = Math.floor(performance.now() / 60) % 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    if (b.lime) {
      ctx.globalAlpha = 0.45;
      pxFill("#39ff14", -16, -3, 14, 6);
      ctx.globalAlpha = 1;
      pxFill("#14532d", -8, -5, 20, 10);
      pxFill("#39ff14", -6, -4, 18, 8);
      pxFill("#b8ff4a", 4, -2, 12, 4);
      pxFill("#ffffff", 12, -1, 6, 2);
      pxFill(flick ? "#4ade80" : "#bbf7d0", -12, -2, 5, 4);
    } else {
      ctx.globalAlpha = 0.4;
      pxFill("#ff2bd6", -15, -3, 12, 6);
      ctx.globalAlpha = 1;
      pxFill("#831843", -7, -5, 18, 10);
      pxFill("#fb7185", -5, -4, 16, 8);
      pxFill("#fecdd3", 4, -2, 10, 4);
      pxFill("#ffffff", 10, -1, 6, 2);
      pxFill(flick ? "#ff2bd6" : "#f472b6", -14, -2, 5, 4);
    }
    ctx.restore();
  }

  function drawGlobeShield(cx, cy, r, color) {
    const t = performance.now() / 420;
    ctx.globalAlpha = 0.35 + Math.sin(t) * 0.1;
    ctx.fillStyle = color || "#39ff14";
    ctx.beginPath(); ctx.arc(cx, cy, r + Math.sin(t * 2) * 2, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlayerGun(p) {
    const s = gunPose(p, p.beamAim);
    const glow = weaponColor(p.weapon);
    const heat = p.beaming ? 1 : Math.min(1, p.shootCD / 8);
    const charge = !p.weapon ? Math.min(1, (p.charge || 0) / 28) : 0;
    const t = performance.now() / 110;
    // Aim laser / charge sight
    if (state.mode === "play" && !state.demo) {
      const tipX = s.x - state.camX, tipY = s.y;
      const aim = p.beamAim || 0;
      let dx = p.facing * 220, dy = 0;
      if (aim < 0) { dx = p.facing * 40; dy = -200; }
      else if (aim > 0) { dx = p.facing * 40; dy = 200; }
      const showing = p.beaming || p.fireHeld || charge > 0.15 || assistOn;
      if (showing) {
        ctx.save();
        ctx.globalAlpha = charge > 0 ? (0.25 + charge * 0.45) : (p.beaming ? 0.45 : 0.22);
        ctx.strokeStyle = charge > 0.9 ? "#fff27a" : (glow || "#67e8f9");
        ctx.lineWidth = charge > 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + dx, tipY + dy);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
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
    // weapon-specific silhouette upgrades
    if (p.weapon === "SPREAD") {
      ctx.fillStyle = N("ink");
      ctx.fillRect(24, -8, 12, 3); ctx.fillRect(24, -1, 12, 3); ctx.fillRect(24, 6, 12, 3);
      ctx.fillStyle = glow;
      ctx.fillRect(26, -7, 10, 1); ctx.fillRect(26, 0, 10, 1); ctx.fillRect(26, 7, 10, 1);
    } else if (p.weapon === "MAXI") {
      const mc = Math.min(1, (p.maxiCharge || 0) / 54);
      ctx.fillStyle = N("ink"); ctx.fillRect(22, -8, 16, 14);
      ctx.fillStyle = glow; ctx.fillRect(24, -6, 14, 10);
      ctx.globalAlpha = 0.3 + mc * 0.6;
      ctx.fillStyle = N("pink2"); ctx.fillRect(20, -10, 22, 18);
      ctx.globalAlpha = 1;
    } else if (p.weapon === "HOMING") {
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.moveTo(28, -6); ctx.lineTo(40, 0); ctx.lineTo(28, 6); ctx.fill();
    } else if (p.weapon === "RICOCHET") {
      ctx.fillStyle = glow; ctx.fillRect(28, -6, 5, 5); ctx.fillRect(34, 2, 5, 5);
    } else if (p.weapon === "WAVE") {
      ctx.strokeStyle = glow; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(30, 0, 8, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(30, 0, 12, -0.9, 0.9); ctx.stroke();
      ctx.lineWidth = 1;
    } else if (p.weapon === "PULSE") {
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(34, 0, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = N("gold"); ctx.beginPath(); ctx.arc(34, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else if (p.weapon === "RIFLE") {
      ctx.fillStyle = N("ink"); ctx.fillRect(26, -2, 18, 4);
      ctx.fillStyle = glow; ctx.fillRect(28, -1, 16, 2);
    }
    // charge glow on pistol
    if (charge > 0.2) {
      ctx.globalAlpha = 0.25 + charge * 0.55;
      ctx.fillStyle = charge >= 1 ? "#ffd400" : "#00e5ff";
      ctx.fillRect(-2, -8, 34, 16);
      ctx.globalAlpha = 1;
    }
    // muzzle flash
    ctx.globalAlpha = 0.45 + Math.sin(t) * 0.15 + heat * 0.35 + charge * 0.4;
    ctx.fillStyle = charge >= 1 ? "#ffd400" : glow;
    ctx.fillRect(28, -3, 6 + heat * 8 + charge * 10, 6);
    if (heat > 0.35 || charge > 0.5) {
      ctx.fillStyle = "#fff6c2";
      ctx.fillRect(32, -5, 8 + charge * 6, 10);
      ctx.fillStyle = glow;
      ctx.fillRect(36, -7, 5 + charge * 4, 14);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPickupQR(qx, qy, power) {
    const accent = power === "life" ? "#ff2bd6" : power === "gold" ? "#ffd400" : power === "speed" ? "#3b82f6" : power === "ember" ? "#fb7185" : power === "storm" ? "#67e8f9" : power === "signal" ? "#34d399" : power === "overclock" ? "#fbbf24" : "#39ff14";
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
    if (power === "ember" || power === "storm" || power === "signal") {
      ctx.fillStyle = accent;
      ctx.font = "bold 7px monospace";
      ctx.fillText("KEY", qx + 4, qy - 2);
    } else if (power === "overclock") {
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 7px monospace";
      ctx.fillText("OVR", qx + 3, qy - 2);
    }
  }

  function drawPickupGun(sx, sy, type) {
    const color = weaponColor(type);
    const d = weaponDef(type);
    const tag = (d && d.tag) || (type === "RICOCHET" ? "RIC" : String(type).slice(0, 3));
    const bob = Math.sin(performance.now() / 220 + sx) * 2.5;
    const y = sy + bob;
    // pedestal + glow
    ctx.globalAlpha = 0.22 + Math.sin(performance.now() / 160 + sx) * 0.08;
    pxFill(color, sx - 6, y - 4, 52, 40);
    ctx.globalAlpha = 1;
    pxBevel(sx - 2, sy + 30, 48, 10, N("cyan"), N("pink"), N("metal2"));
    pxFill(N("ink"), sx + 6, sy + 32, 28, 3);
    // common stock / grip
    pxFill(N("wood"), sx + 4, y + 14, 8, 12);
    pxFill(N("wood2"), sx + 5, y + 15, 5, 10);
    pxFill(N("metal"), sx + 10, y + 12, 6, 8);
    pxFill(N("ink"), sx + 12, y + 6, 18, 12);
    pxFill(N("metal2"), sx + 13, y + 7, 16, 10);
    pxFill(color, sx + 14, y + 9, 14, 3);

    if (type === "SPREAD") {
      pxFill(N("ink"), sx + 28, y + 4, 14, 4);
      pxFill(N("ink"), sx + 28, y + 10, 14, 4);
      pxFill(N("ink"), sx + 28, y + 16, 14, 4);
      pxFill(color, sx + 30, y + 5, 12, 2);
      pxFill(color, sx + 30, y + 11, 12, 2);
      pxFill(color, sx + 30, y + 17, 12, 2);
      pxFill(N("gold"), sx + 40, y + 4, 4, 16);
    } else if (type === "MAXI") {
      pxFill(N("ink"), sx + 26, y + 3, 18, 16);
      pxFill(color, sx + 28, y + 5, 14, 12);
      pxFill(N("pink2"), sx + 40, y + 7, 6, 8);
      pxFill(N("white"), sx + 30, y + 8, 8, 4);
      pxFill(N("gold"), sx + 16, y + 2, 6, 4);
    } else if (type === "HOMING") {
      pxFill(N("ink"), sx + 26, y + 6, 12, 8);
      pxFill(color, sx + 28, y + 7, 10, 6);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx + 38, y + 4); ctx.lineTo(sx + 50, y + 10); ctx.lineTo(sx + 38, y + 16); ctx.fill();
      pxFill(N("purple2"), sx + 24, y + 4, 4, 3);
      pxFill(N("purple2"), sx + 24, y + 13, 4, 3);
    } else if (type === "RICOCHET") {
      pxFill(N("ink"), sx + 26, y + 5, 12, 10);
      pxFill(color, sx + 28, y + 6, 10, 8);
      pxFill(N("green"), sx + 38, y + 2, 6, 6);
      pxFill(N("green2"), sx + 42, y + 12, 6, 6);
      pxFill(N("white"), sx + 30, y + 8, 4, 4);
    } else if (type === "WAVE") {
      pxFill(N("ink"), sx + 24, y + 5, 10, 10);
      pxFill(color, sx + 26, y + 6, 8, 8);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let a = 0; a < 3; a++) {
        ctx.beginPath();
        ctx.arc(sx + 34, y + 10, 6 + a * 5, -0.9, 0.9);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    } else if (type === "PULSE") {
      pxFill(N("ink"), sx + 24, y + 5, 10, 10);
      pxFill(N("orange"), sx + 26, y + 6, 8, 8);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(sx + 42, y + 10, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = N("gold");
      ctx.beginPath(); ctx.arc(sx + 42, y + 10, 4, 0, Math.PI * 2); ctx.fill();
      pxFill(N("white"), sx + 40, y + 8, 3, 3);
    } else if (type === "RIFLE") {
      pxFill(N("ink"), sx + 26, y + 8, 22, 5);
      pxFill(color, sx + 28, y + 9, 20, 3);
      pxFill(N("cyan2"), sx + 46, y + 7, 4, 7);
      pxFill(N("steel"), sx + 16, y + 3, 8, 4);
      pxFill(color, sx + 18, y + 4, 4, 2);
    } else {
      pxFill(N("ink"), sx + 26, y + 8, 16, 5);
      pxFill(color, sx + 28, y + 9, 14, 3);
      pxFill(N("silver"), sx + 40, y + 7, 4, 6);
    }
    // name plate
    pxFill(N("black"), sx + 2, y - 12, 28, 10);
    pxOutline(color, sx + 2, y - 12, 28, 10);
    ctx.fillStyle = color;
    ctx.font = "bold 8px monospace";
    ctx.fillText(tag, sx + 5, y - 4);
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


  function drawWeaponHotbar() {
    if (state.mode !== "play" || !state.player || state.demo) return;
    const p = state.player;
    const slots = hotbarSlots(p);
    const baseX = 14, baseY = H - 48;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const x = baseX + i * 78;
      const col = s.type ? weaponColor(s.type) : N("silver");
      ctx.globalAlpha = s.active ? 0.92 : 0.55;
      pxFill(N("ink"), x, baseY, 72, 38);
      pxOutline(s.active ? col : N("steel"), x, baseY, 72, 38);
      if (s.active) {
        pxFill(col, x, baseY, 72, 3);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = "bold 10px monospace";
      ctx.fillText((i + 1) + " " + s.label, x + 6, baseY + 16);
      ctx.fillStyle = N("white");
      ctx.font = "bold 9px monospace";
      ctx.fillText(s.ammo == null ? "INF" : ("x" + s.ammo), x + 6, baseY + 30);
    }
    if (p.weapon === "MAXI" && (p.maxiCharge || 0) > 0) {
      const ch = Math.min(1, p.maxiCharge / 54);
      pxFill(N("ink"), baseX, baseY - 10, 228, 6);
      pxFill(N("pink"), baseX, baseY - 10, 228 * ch, 6);
      pxOutline(N("pink2"), baseX, baseY - 10, 228, 6);
    }
  }

  function drawPlay() {
    const shakeAmt = state.shake || 0;
    const sox = shakeAmt ? (Math.random() - 0.5) * shakeAmt : 0;
    const soy = shakeAmt ? (Math.random() - 0.5) * shakeAmt * 0.72 : 0;
    ctx.save();
    ctx.translate(sox, soy);

    drawCity();
    drawPlatforms();
    drawProps();
    if (!state.bossMode || state.hazards.length) drawHazards();

    const gx = state.endX - 70 - state.camX;
    if (!state.bossMode && gx > -55 && gx < W) {
      const sDef = state.inSecret ? activeSecretDef() : null;
      ctx.fillStyle = sDef ? sDef.color : "#00e5ff";
      ctx.fillRect(gx - 5, GROUND - 84, 52, 84);
      ctx.fillStyle = "#101828";
      ctx.fillRect(gx, GROUND - 78, 42, 78);
      ctx.fillStyle = "#334155";
      ctx.fillRect(gx + 6, GROUND - 70, 30, 70);
      ctx.fillStyle = "#ffd400";
      ctx.fillRect(gx + 30, GROUND - 38, 4, 4);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px monospace";
      ctx.fillText(sDef ? sDef.relicLabel : "EXIT", gx + 8, GROUND - 88);
    }

    // Checkpoint flag
    if (!state.bossMode && state.checkpointX > 100) {
      const cx = state.checkpointX - state.camX;
      if (cx > -40 && cx < W + 40) {
        const wave = Math.sin(performance.now() / 200) * 2;
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(cx, GROUND - 52, 3, 52);
        ctx.fillStyle = "#39ff14";
        ctx.beginPath();
        ctx.moveTo(cx + 3, GROUND - 50 + wave);
        ctx.lineTo(cx + 22, GROUND - 42 + wave);
        ctx.lineTo(cx + 3, GROUND - 34 + wave);
        ctx.fill();
        ctx.fillStyle = "#bbf7d0";
        ctx.font = "bold 8px monospace";
        ctx.fillText("CK", cx - 4, GROUND - 56);
      }
    }

    if (state.secretPortal && !state.inSecret) {
      const gate = state.secretPortal;
      const px = gate.x - state.camX;
      if (px > -60 && px < W + 60) {
        const gDef = secretDef(gate.secretId) || SECRETS.ember;
        const open = !!(state.secretKey && state.secretKind === gate.secretId) || gate.open;
        const blink = Math.floor(performance.now() / 120) % 2;
        ctx.globalAlpha = open ? 0.85 : 0.35;
        ctx.fillStyle = open ? (blink ? gDef.color : gDef.color2) : "#64748b";
        ctx.fillRect(px, gate.y, gate.w, gate.h);
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(px + 6, gate.y + 8, gate.w - 12, gate.h - 16);
        if (open) {
          ctx.fillStyle = gDef.color;
          ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 180) * 0.2;
          ctx.fillRect(px + 10, gate.y + 16, gate.w - 20, gate.h - 32);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#ffd400";
          ctx.font = "bold 10px monospace";
          ctx.fillText(gDef.gateLabel, px + 6, gate.y - 6);
          ctx.fillText("↑ ENTER", px + 2, gate.y + gate.h + 12);
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#94a3b8";
          ctx.font = "bold 9px monospace";
          ctx.fillText("LOCKED", px + 4, gate.y - 6);
        }
        ctx.globalAlpha = 1;
      }
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
    if (p && p.beaming && p.weapon && weaponDef(p.weapon) && weaponDef(p.weapon).kind === "beam") {
      const rows = weaponDef(p.weapon).rows || 1;
      const tip = gunPose(p, p.beamAim), muzzle = tip.x - state.camX, muzzleY = tip.y;
      const col = weaponColor(p.weapon);
      const pulse = 0.5 + Math.sin(performance.now() / 50) * 0.2;
      for (let i = 0; i < rows; i++) {
        const angle = (i - (rows - 1) / 2) * 0.085;
        ctx.save();
        ctx.translate(muzzle, muzzleY);
        ctx.rotate(p.beamAim < 0 ? -Math.PI / 2 + angle : p.beamAim > 0 ? Math.PI / 2 - angle : p.facing > 0 ? angle : Math.PI - angle);
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = col;
        ctx.fillRect(0, -10, W + 160, 20);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, -5, W + 160, 10);
        ctx.globalAlpha = 1;
        ctx.fillStyle = N("white");
        ctx.fillRect(0, -2, W + 160, 4);
        ctx.fillStyle = col;
        for (let seg = 20; seg < W + 120; seg += 28) {
          ctx.globalAlpha = 0.7;
          ctx.fillRect(seg, -7, 6, 14);
        }
        ctx.globalAlpha = 1;
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
      drawBossTelegraphs(b);
      if (b.mode === "laserCharge" || b.mode === "laser") {
        const h = bossHand(b), len = 920;
        const beam = b.accentHot || "#39ff14";
        ctx.save(); ctx.translate(h.x - state.camX, h.y); ctx.rotate(h.a);
        ctx.fillStyle = b.mode === "laser" ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.08)";
        if (b.midBoss) {
          ctx.fillStyle = b.mode === "laser" ? "rgba(232,121,249,.4)" : "rgba(232,121,249,.18)";
        } else {
          ctx.fillStyle = b.mode === "laser" ? "rgba(57,255,20,.35)" : "rgba(57,255,20,.18)";
        }
        ctx.fillRect(0, b.mode === "laser" ? -8 : -1, len, b.mode === "laser" ? 16 : 2);
        if (b.mode === "laser") {
          ctx.fillStyle = beam; ctx.fillRect(0, -4, len, 8);
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
        ctx.fillStyle = "#ffd400";
        ctx.font = "bold 11px monospace";
        ctx.fillText("SLAM ZONE", wx - 32, 16);
      }
      ctx.fillStyle = "rgba(0,0,0,.78)"; ctx.fillRect(174, 14, 452, 31);
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px monospace";
      ctx.fillText(b.title || "REDCORE SENTINEL", 180, 26);
      if (b.phase === 2) {
        ctx.fillStyle = b.accentHot || "#39ff14";
        ctx.fillText("PHASE 2", 520, 26);
      }
      ctx.fillStyle = "#24283b"; ctx.fillRect(180, 31, 440, 9);
      ctx.fillStyle = b.phase === 2 ? (b.accentHot || "#39ff14") : (b.accent || "#00e5ff");
      ctx.fillRect(180, 31, 440 * Math.max(0, b.hp) / b.maxHp, 9);
      ctx.fillStyle = "#ffffff"; ctx.fillText("SHIELD " + "■".repeat(state.playerHP), 14, 26);
      if (b.vulnerable) {
        ctx.fillStyle = "#ffd400";
        ctx.font = "bold 10px monospace";
        ctx.fillText("WEAK!", b.x - state.camX + 18, b.y - 8);
      }
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
      else drawEnemyBullet(b, bx);
    }

    for (let i = 0; i < state.particles.length; i++) {
      const pt = state.particles[i];
      const px = pt.x - state.camX;
      if (pt.wave) {
        const face = pt.facing || 1;
        const age = 1 - Math.max(0, pt.life / 14);
        const reach = (pt.range || 140) * (0.35 + age * 0.65);
        ctx.globalAlpha = Math.max(0.15, pt.life / 18);
        ctx.strokeStyle = pt.color || N("cyan2");
        ctx.lineWidth = 3;
        for (let r = 0; r < 3; r++) {
          ctx.beginPath();
          ctx.arc(px, pt.y, reach * (0.45 + r * 0.2), face > 0 ? -0.85 : Math.PI - 0.85, face > 0 ? 0.85 : Math.PI + 0.85);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = Math.max(0, pt.life / 30);
      ctx.fillStyle = pt.color;
      ctx.fillRect(px, pt.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = state.flashColor || ("rgba(255,255,255," + (state.flash / 30) + ")");
      if (state.flashColor) {
        ctx.globalAlpha = Math.min(0.55, state.flash / 28);
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Urgency vignette: low time or last life
    if (state.mode === "play") {
      const lowTime = state.levelTime > 0 && state.levelTime < 30000;
      const lastLife = state.lives <= 1 && !state.bossMode;
      if (lowTime || lastLife) {
        const pulse = 0.12 + Math.sin(performance.now() / 180) * 0.06;
        const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, lowTime ? ("rgba(180,20,40," + (pulse + 0.18) + ")") : ("rgba(255,43,214," + (pulse + 0.1) + ")"));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        if (lowTime) {
          ctx.fillStyle = "#fb7185";
          ctx.font = "bold 12px monospace";
          ctx.fillText("TIME " + Math.ceil(state.levelTime / 1000), W / 2 - 28, 36);
        }
      }
    }

    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    drawWeaponHotbar();
    drawScoreAttackUI();

    if (state.talkQ && state.talkI < state.talkQ.length) {
      const line = state.talkQ[state.talkI];
      const you = line.who === "YOU";
      const bx = you ? 40 : W - 340;
      ctx.fillStyle = "rgba(2,8,20,.9)";
      ctx.fillRect(bx, 58, 300, 52);
      ctx.strokeStyle = you ? "#ffd400" : ((state.boss && state.boss.accent) || "#ef4444");
      ctx.strokeRect(bx, 58, 300, 52);
      ctx.fillStyle = you ? "#ffd400" : ((state.boss && state.boss.accent) || "#ef4444");
      ctx.font = "bold 11px monospace";
      ctx.fillText(you ? "FATHER ELIAS" : ((state.boss && state.boss.title) || "REDCORE SENTINEL"), bx + 10, 76);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "13px monospace";
      ctx.fillText(line.line, bx + 10, 98);
    }
  }

  function drawScoreAttackUI() {
    // Floating score pops
    for (let i = 0; i < state.scorePops.length; i++) {
      const sp = state.scorePops[i];
      const sx = sp.x - state.camX;
      if (sx < -40 || sx > W + 40) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, sp.life / 24));
      ctx.fillStyle = "#000";
      ctx.font = "bold 13px monospace";
      ctx.fillText(sp.text, sx + 1, sp.y + 1);
      ctx.fillStyle = sp.color;
      ctx.fillText(sp.text, sx, sp.y);
    }
    ctx.globalAlpha = 1;

    // Always-on combo meter (bottom-left)
    const c = state.combo;
    const t = Math.max(0, Math.min(1, state.comboTimer / 145));
    const mx = 14, my = H - 92, mw = 140, mh = 8;
    ctx.fillStyle = "rgba(2,6,23,0.72)";
    ctx.fillRect(mx - 6, my - 16, mw + 12, 30);
    ctx.fillStyle = c >= 10 ? "#ff2bd6" : c >= 5 ? "#ffd400" : c >= 3 ? "#00e5ff" : "#64748b";
    ctx.font = "bold 11px monospace";
    ctx.fillText(c > 0 ? ("COMBO ×" + c) : "COMBO", mx, my - 4);
    if (state.godMode) {
      ctx.fillStyle = "#39ff14";
      ctx.font = "bold 12px monospace";
      ctx.fillText("GOD MODE", W - 100, 22);
    }
    if (state.maxCombo > 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px monospace";
      ctx.fillText("MAX ×" + state.maxCombo, mx + 78, my - 4);
    }
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(mx, my, mw, mh);
    ctx.fillStyle = c >= 10 ? "#ff2bd6" : c >= 5 ? "#ffd400" : "#00e5ff";
    ctx.fillRect(mx, my, mw * (c > 0 ? Math.max(0.06, t) : 0), mh);
    if (c >= 3) {
      ctx.strokeStyle = c >= 10 ? "#ff2bd6" : "#ffd400";
      ctx.strokeRect(mx - 0.5, my - 0.5, mw + 1, mh + 1);
    }

    // Sector goal strip (medal chase)
    if (state.mode === "play" && !state.bossMode) {
      const budget = sectorTimeBudget();
      const timeOk = state.levelTime > budget * 0.45;
      const goals = [
        { ok: !state.hitThisLevel, label: "NO-HIT" },
        { ok: state.combo >= 8 || state.maxCombo >= 8, label: "COMBO" },
        { ok: timeOk, label: "SPEED" }
      ];
      let gx = W - 14;
      for (let i = goals.length - 1; i >= 0; i--) {
        const g = goals[i];
        ctx.font = "bold 10px monospace";
        const tw = ctx.measureText(g.label).width;
        gx -= tw + 14;
        ctx.fillStyle = g.ok ? "rgba(15,23,42,0.85)" : "rgba(2,6,23,0.55)";
        ctx.fillRect(gx - 4, 10, tw + 10, 16);
        ctx.strokeStyle = g.ok ? "#39ff14" : "#475569";
        ctx.strokeRect(gx - 4.5, 9.5, tw + 11, 17);
        ctx.fillStyle = g.ok ? "#39ff14" : "#64748b";
        ctx.fillText(g.label, gx, 22);
      }
    }
  }

  function loop() {
    tickJuice();
    if (state.mode === "title" && !GOD_QS && !QA_QS && !state.demo &&
        performance.now() - titleIdleAt > ATTRACT_IDLE_MS) {
      startAttract();
    }
    if (state.mode === "play") {
      if (state.demo) tickDemoAI();
      if (qaBot.on) {
        const speed = state.bossMode ? 8 : 14;
        for (let i = 0; i < speed; i++) {
          tickQaBot();
          if (!qaBot.on) break;
          if (state.hitStop > 0) state.hitStop--;
          else if (state.mode === "play") updatePlay();
          else break;
        }
      } else if (state.hitStop > 0) {
        state.hitStop--;
      } else {
        updatePlay();
      }
    } else {
      qaFinalizeIfNeeded();
    }
    if (state.mode === "credits") updateCredits();
    if (state.mode === "failed" && state.failAt && performance.now() >= state.failAt) {
      state.failAt = 0;
      hud.startBtn.style.display = "";
    }
    if (state.mode === "credits") {
      drawCredits();
    } else if (state.mode === "play" || state.mode === "paused" || state.mode === "clear" || state.mode === "failed" || state.mode === "dead" || state.mode === "win") {
      if (state.player) drawPlay();
      else drawCity();
      if (state.demo) {
        ctx.fillStyle = "rgba(2,6,23,0.35)";
        ctx.fillRect(0, 0, W, 28);
        ctx.fillStyle = "#67e8f9";
        ctx.font = "bold 14px monospace";
        ctx.fillText("DEMO · PRESS START", W / 2 - 78, 20);
      }
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
    if (state.demo) {
      startGame();
      return;
    }
    bumpTitleIdle();
    if (state.mode === "paused") resumeGame();
    else if (state.mode === "clear") advanceFromClear();
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
    if (state.demo) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleStartAction();
        return;
      }
      stopAttract();
      keys[e.key] = true;
      return;
    }
    keys[e.key] = true;
    if (state.mode === "title") bumpTitleIdle();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].indexOf(e.key) >= 0) e.preventDefault();
    const key = e.key;
    if ((key === "q" || key === "Q" || key === "Tab") && !e.repeat && state.mode === "play") {
      e.preventDefault();
      swapWeapon();
      return;
    }
    if (!e.repeat && state.mode === "play" && (key === "1" || key === "2" || key === "3" || key === "4")) {
      e.preventDefault();
      selectWeaponSlot(Number(key) - 1);
      return;
    }
    if ((key === "p" || key === "P" || key === "Escape") && !e.repeat) {
      if (state.mode === "play") {
        e.preventDefault();
        pauseGame();
        return;
      }
      if (state.mode === "paused") {
        e.preventDefault();
        resumeGame();
        return;
      }
    }
    if ((key === "r" || key === "R") && !e.repeat && (state.mode === "play" || state.mode === "paused")) {
      e.preventDefault();
      retrySector();
      return;
    }
    if (e.key === " " && !e.repeat && state.mode === "play") {
      const now = performance.now();
      if (now - lastSpaceTap < 420) superJump();
      lastSpaceTap = now;
    }
    if (GOD_QS && (e.key === "g" || e.key === "G") && !e.repeat) {
      e.preventDefault();
      ensureAudio();
      toggleGodMode();
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
  if (hud.fxBtn) {
    hud.fxBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ensureAudio();
      setFx(!fxOn);
      sfxUi();
    });
  }
  if (hud.assistBtn) {
    hud.assistBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      bumpTitleIdle();
      ensureAudio();
      setAssist(!assistOn);
      sfxUi();
    });
  }
  if (hud.swapBtn) {
    hud.swapBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ensureAudio();
      if (state.demo) { handleStartAction(); return; }
      swapWeapon();
    });
  }
  if (hud.pauseBtn) {
    hud.pauseBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ensureAudio();
      if (state.mode === "paused") resumeGame();
      else if (state.mode === "play") pauseGame();
    });
  }
  if (hud.diffBtn) {
    hud.diffBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      bumpTitleIdle();
      ensureAudio();
      if (state.mode === "title" || state.mode === "credits") cycleDiff();
    });
  }
  if (hud.dailyBtn) {
    hud.dailyBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      bumpTitleIdle();
      ensureAudio();
      if (state.mode === "title" || state.mode === "credits") startDailyRun();
    });
  }
  if (hud.ngBtn) {
    hud.ngBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      bumpTitleIdle();
      ensureAudio();
      if (state.mode === "title" || state.mode === "credits") startNgPlusRun();
    });
  }
  if (hud.shareBtn) {
    hud.shareBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ensureAudio();
      copyShareCard();
    });
  }
  if (hud.godBtn) {
    hud.godBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      ensureAudio();
      toggleGodMode();
    });
  }

  function bindTouch(id, prop) {
    const el = ROOT.querySelector(id);
    if (!el) return;
    let lastTap = 0;
    let ptrId = null;
    function down(ev) {
      if (ev.pointerType === "mouse" && ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      if (ev.pointerId != null && el.setPointerCapture) {
        try { el.setPointerCapture(ev.pointerId); ptrId = ev.pointerId; } catch (err) {}
      }
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
      if (ev && ev.pointerId != null && ptrId != null && ev.pointerId !== ptrId) return;
      ptrId = null;
      touch[prop] = false;
      el.classList.remove("is-held");
    }
    el.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    if (window.PointerEvent) {
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
    } else {
      el.addEventListener("touchstart", down, { passive: false });
      el.addEventListener("touchend", up, { passive: false });
      el.addEventListener("touchcancel", up, { passive: false });
      el.addEventListener("mousedown", down);
      el.addEventListener("mouseup", up);
      el.addEventListener("mouseleave", up);
    }
  }

  function bindJoystick() {
    const stick = ROOT.querySelector("#dg-stick");
    const knob = ROOT.querySelector("#dg-knob");
    if (!stick || !knob) return;
    let active = false, pid = null;
    let ox = 0, oy = 0;
    const DEAD = 0.28;
    function travel() {
      return Math.max(26, stick.clientWidth * 0.32);
    }
    function setKnob(nx, ny) {
      // Cardinal bias: strong horizontal + weak vertical = run clean (aim via dedicated flick)
      if (Math.abs(nx) > 0.55 && Math.abs(ny) < 0.32) ny = 0;
      if (Math.abs(ny) > 0.55 && Math.abs(nx) < 0.28) nx = 0;
      touch.jx = nx;
      touch.jy = ny;
      const t = travel();
      knob.style.transform = "translate(calc(-50% + " + (nx * t) + "px), calc(-50% + " + (ny * t) + "px))";
    }
    function read(clientX, clientY) {
      const range = Math.max(40, stick.clientWidth * 0.46);
      let dx = (clientX - ox) / range;
      let dy = (clientY - oy) / range;
      const m = Math.hypot(dx, dy);
      if (m < DEAD) {
        setKnob(0, 0);
        return;
      }
      const remapped = Math.min(1, (m - DEAD) / (1 - DEAD));
      dx = (dx / m) * remapped;
      dy = (dy / m) * remapped;
      setKnob(dx, dy);
    }
    function touchById(list) {
      if (!list) return null;
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === pid) return list[i];
      }
      return null;
    }
    function start(ev) {
      ev.preventDefault();
      active = true;
      ensureAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      const t = ev.changedTouches ? ev.changedTouches[0] : ev;
      if (t.identifier != null) pid = t.identifier;
      // Relative stick: first contact becomes origin (easier thumb placement)
      ox = t.clientX;
      oy = t.clientY;
      setKnob(0, 0);
    }
    function move(ev) {
      if (!active) return;
      let t = null;
      if (ev.touches || ev.changedTouches) {
        t = touchById(ev.touches) || touchById(ev.changedTouches);
        if (!t) return;
        ev.preventDefault();
      } else {
        t = ev;
        ev.preventDefault();
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
      active = false;
      pid = null;
      setKnob(0, 0);
    }
    stick.addEventListener("touchstart", start, { passive: false });
    stick.addEventListener("touchmove", move, { passive: false });
    stick.addEventListener("touchend", end, { passive: false });
    stick.addEventListener("touchcancel", end, { passive: false });
    // Keep tracking if thumb slides outside the stick ring
    window.addEventListener("touchmove", move, { passive: false, capture: true });
    window.addEventListener("touchend", end, { passive: false, capture: true });
    window.addEventListener("touchcancel", end, { passive: false, capture: true });
    stick.addEventListener("mousedown", start);
    stick.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  }
  bindJoystick();
  bindTouch("#dg-jump", "jump");
  bindTouch("#dg-shoot", "shoot");
  window.addEventListener("blur", clearTouchInput);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clearTouchInput();
  });
  window.addEventListener("pagehide", clearTouchInput);

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
      setTimeout(fit, 80);
      setTimeout(fit, 220);
      setTimeout(fit, 500);
      return;
    }
    const req = ROOT.requestFullscreen || ROOT.webkitRequestFullscreen ||
      document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!req) return;
    try {
      const el = (ROOT.requestFullscreen || ROOT.webkitRequestFullscreen) ? ROOT : document.documentElement;
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (p && p.then) p.then(function () { fit(); setTimeout(fit, 120); }).catch(function () { fit(); });
      else { fit(); setTimeout(fit, 120); }
    } catch (e) { fit(); }
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
  window.addEventListener("orientationchange", function () {
    clearTouchInput();
    setTimeout(fit, 80);
    setTimeout(fit, 220);
    setTimeout(function () {
      fit();
      if (wantsTouchUI() && state.mode === "play" && !isFullscreen()) enterFullscreen();
    }, 400);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      fit();
      if (wantsTouchUI() && state.mode === "play") setTimeout(fit, 60);
    });
  }
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
    if (state.demo) {
      handleStartAction();
      return;
    }
    if (!ROOT.classList.contains("dg-phone")) return;
    if (isFullscreen()) return;
    // Nudge into fullscreen on first touch while playing
    if (state.mode === "play") enterFullscreen();
  }, { passive: true });
  fit();

  if (GOD_QS) {
    buildLevelSelect();
    if (state.godMode) setGodMode(true);
  } else {
    if (hud.godBtn) hud.godBtn.style.display = "none";
    if (hud.levels) {
      hud.levels.innerHTML = "";
      hud.levels.style.display = "none";
    }
  }
  if (QA_QS) {
    state.godMode = false;
    if (hud.godBtn) {
      hud.godBtn.style.display = "none";
    }
    showOverlay("DIGISTRACTS QA", "No god mode · autoplay audit running…", "…");
    setTimeout(function () {
      qaRunSuite().then(function (report) {
        console.log("[QA] suite complete", report.pass, report);
      });
    }, 400);
  }
  syncDiffBtn();
  syncFxBtn();
  syncAssistBtn();
  bumpTitleIdle();
  if (!QA_QS) showOverlay("DIGISTRACTS", titleBootSub(), "PRESS START");
  updateHUD();
  fit();
  loop();
})();
