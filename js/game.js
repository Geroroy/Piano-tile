/* 피아노 타일 게임 본체 */
(function () {
  'use strict';

  const LANES = 4;
  const VISIBLE_ROWS = 4;
  // 판정선: 화면 아래에서 LINE 칸 위. 음악은 스크롤이 판정선에 닿는 순간 악보 박자대로 울린다.
  // 타일을 미리 쳐 두면 그 타일의 음은 제 박자에 울리고, 늦게 치면(MISS_WINDOW 안) 곧바로 울린다.
  const LINE = 0.75;
  const MISS_WINDOW = 0.65; // 짧은 타일: 밑변이 판정선을 이만큼(칸) 지나도록 안 치면 놓친 것
  // 키 큰 타일은 몸통이 판정선에 걸쳐 있는 동안(윗변이 판정선 근처에 올 때까지) 칠 수 있다
  const missLimit = (t) => Math.max(MISS_WINDOW, t.h - 0.2);
  const LOOKAHEAD = 0.12; // 초: 이만큼 앞의 음까지 미리 예약
  const LATE_SKIP = 0.6; // 칸: 늦게 친 타일에서 이보다 오래 지난 음은 건너뜀
  const SPEEDS = {
    slow: { label: '느리게', mult: 0.75 },
    normal: { label: '보통', mult: 1 },
    fast: { label: '빠르게', mult: 1.25 },
  };
  const KEYS = { d: 0, f: 1, j: 2, k: 3 };

  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#board');
  const g = canvas.getContext('2d');
  const ui = {
    menu: $('#menu'),
    songList: $('#song-list'),
    hud: $('#hud'),
    score: $('#score'),
    section: $('#section'),
    progress: $('#progress-fill'),
    result: $('#result'),
    resultTitle: $('#result-title'),
    resultStars: $('#result-stars'),
    resultScore: $('#result-score'),
    resultDetail: $('#result-detail'),
    practice: $('#practice'),
    pause: $('#pause'),
    countdown: $('#countdown'),
  };

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 저장 불가 환경 */ } },
  };

  const settings = Object.assign({ speed: 'normal', practice: false, sectionOnly: true }, store.get('pt.settings') || {});
  if (!SPEEDS[settings.speed]) settings.speed = 'normal';

  // ---------- 차트 생성 ----------
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const stepCache = new Map();
  function songData(song) {
    if (!stepCache.has(song)) stepCache.set(song, PianoTiles.songSteps(song));
    return stepCache.get(song);
  }

  // startSection ~ endSection 구간만 담은 차트. 줄 배치는 곡마다 고정(시드)이라 어디서 시작해도 같다.
  function buildChart(song, startSection, endSection) {
    const { steps, sections } = songData(song);
    const rand = rng32(hashStr(song.id));
    const tiles = [];
    let y = 0;
    let prevLane = -1;
    let started = false;
    for (const st of steps) {
      let lane = -1;
      if (!st.rest) {
        do { lane = Math.floor(rand() * LANES); } while (lane === prevLane);
        prevLane = lane;
        if (!started && st.section >= startSection) started = true;
      }
      if (!started) continue;
      if (!st.rest && st.section > endSection) break;
      if (st.rest) { y += st.rows; continue; }
      tiles.push({
        y, h: st.rows, lane, section: st.section, rps: st.rows / st.sec,
        events: st.events.slice().sort((a, b) => a.o - b.o), evIdx: -1,
        run: st.events.some((e) => e.o > 1e-6), // 트릴·꾸밈음처럼 한 번에 여러 음이 흘러나오는 타일
        long: st.rows >= 2, played: false, missed: false,
        holdStart: 0, holdProgress: 0, holding: false, voices: null, playedAt: 0,
      });
      y += st.rows;
    }
    return { song, tiles, sections, startSection, endSection, length: y };
  }

  // ---------- 상태 ----------
  let W = 0, H = 0, dpr = 1, rowH = 0, laneW = 0;
  let chart = null;
  let state = 'menu'; // menu | ready | playing | paused | countdown | failed | cleared
  let pausedFrom = null; // 일시정지 전 상태 (ready | playing)
  let countdownEnd = 0;
  let scroll = 0, speed = 0, next = 0, cur = 0, score = 0, errors = 0, missed = 0;
  let pending = []; // 음이 아직 남아 있는(해제된) 타일들
  let failTarget = null, failCell = null, endTimer = 0;
  let flashes = [], popups = [];
  const holds = new Map();
  let lastFrame = 0;

  // 지금 판정선 위를 지나가는 타일의 템포 (쉼표 구간은 앞 타일 템포)
  function targetSpeed() {
    const pos = scroll + LINE;
    const tiles = chart.tiles;
    while (cur + 1 < tiles.length && tiles[cur + 1].y <= pos + 1e-6) cur++;
    return tiles[cur].rps * SPEEDS[settings.speed].mult;
  }

  function unlock(t) {
    if (t.evIdx >= 0) return;
    t.evIdx = 0;
    t.voices = [];
    pending.push(t);
  }

  // 해제된 타일의 음 중 판정선에 곧 닿을 음들을 오디오 시계에 예약
  function scheduleNotes() {
    if (!pending.length || speed <= 0) return;
    const pos = scroll + LINE;
    const horizon = pos + speed * LOOKAHEAD;
    for (const t of pending) {
      while (t.evIdx < t.events.length) {
        const e = t.events[t.evIdx];
        const p = t.y + e.o * t.h;
        if (p > horizon) break;
        t.evIdx++;
        // 늦게 친 타일이라도 타일의 첫 음(o=0)은 반드시 울린다. 지나간 나머지 음만 건너뜀
        if (e.o > 0 && p < pos - LATE_SKIP) continue;
        const v = Piano.schedule(e.m, Math.max(0, (p - pos) / speed), e.v, (e.d * t.h) / speed);
        if (v) t.voices.push(v);
      }
    }
    pending = pending.filter((t) => t.evIdx < t.events.length);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stage = canvas.parentElement;
    W = Math.min(stage.clientWidth || window.innerWidth, 520);
    H = stage.clientHeight || window.innerHeight;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    rowH = H / VISIBLE_ROWS;
    laneW = W / LANES;
    boardCanvas = null;
    keyCache.clear();
  }

  // ---------- 게임 흐름 ----------
  function startSong(song, startSection, endSection) {
    Piano.ensure();
    Piano.stopAll();
    const last = songData(song).sections.length - 1;
    chart = buildChart(song, startSection || 0, endSection === undefined ? last : endSection);
    pending = [];
    scroll = -LINE; speed = 0; next = 0; cur = 0; score = 0; errors = 0; missed = 0;
    failTarget = null; failCell = null; endTimer = 0;
    flashes = []; popups = []; holds.clear();
    state = 'ready';
    ui.menu.hidden = true;
    ui.result.hidden = true;
    ui.pause.hidden = true;
    ui.countdown.hidden = true;
    ui.hud.hidden = false;
    updateHud();
  }

  // ---------- 일시정지 ----------
  // 오디오 시계 자체를 멈추므로 예약된 음과 화면이 함께 멈췄다가 그대로 이어진다
  function pause() {
    if (state !== 'playing' && state !== 'ready' && state !== 'countdown') return;
    if (state !== 'countdown') pausedFrom = state;
    state = 'paused';
    for (const id of [...holds.keys()]) finishHold(id, false);
    Piano.suspend();
    ui.countdown.hidden = true;
    const t = chart.tiles[Math.min(next, chart.tiles.length - 1)];
    $('#pause-where').textContent = chart.song.title + ' · ' + chart.sections[t.section] +
      ' · 진행 ' + Math.round((100 * next) / chart.tiles.length) + '%';
    const box = $('#pause-sections');
    box.innerHTML = '';
    const { steps, sections } = songData(chart.song);
    if (sections.length > 1) box.appendChild(sectionPicker(chart.song, steps, sections, 'pause-'));
    ui.pause.hidden = false;
    $('#btn-resume').focus();
  }

  function resume() {
    if (state !== 'paused') return;
    ui.pause.hidden = true;
    if (pausedFrom === 'ready') {
      state = 'ready';
      Piano.resume();
      return;
    }
    state = 'countdown';
    countdownEnd = performance.now() + 1800;
    ui.countdown.hidden = false;
  }

  function showMenu() {
    state = 'menu';
    chart = null;
    holds.clear();
    pending = [];
    Piano.stopAll();
    ui.result.hidden = true;
    ui.pause.hidden = true;
    ui.countdown.hidden = true;
    ui.hud.hidden = true;
    ui.menu.hidden = false;
    Piano.resume();
    renderMenu();
  }

  function tileBottom(t) { return H - (t.y - scroll) * rowH; }

  function hit(t, pointerId) {
    t.played = true;
    t.playedAt = performance.now();
    next++;
    score++;
    unlock(t);
    scheduleNotes();
    if (t.long) {
      t.holding = true;
      t.holdStart = scroll;
      holds.set(pointerId, t);
    }
    updateHud();
  }

  function finishHold(pointerId, complete) {
    const t = holds.get(pointerId);
    if (!t) return;
    holds.delete(pointerId);
    t.holding = false;
    const bonus = complete ? Math.round(t.h - 1) : Math.floor(t.holdProgress * (t.h - 1));
    if (complete) t.holdProgress = 1;
    else {
      // 긴 타일에서 일찍 손을 떼면 건반을 놓은 것처럼 소리를 멈춘다
      Piano.release(t.voices);
      t.evIdx = t.events.length;
    }
    if (bonus > 0) {
      score += bonus;
      popups.push({ x: (t.lane + 0.5) * laneW, y: tileBottom(t) - rowH * 0.5, text: '+' + bonus, born: performance.now() });
      updateHud();
    }
  }

  function fail(tile, cell) {
    state = 'failed';
    for (const id of [...holds.keys()]) finishHold(id, false);
    pending = [];
    // 곡을 먼저 멈추고 나서 '잘못 친' 소리를 낸다 (반대로 하면 효과음까지 꺼진다)
    Piano.stopAll();
    Piano.failSound('gameover');
    failCell = cell || null;
    failTarget = tile ? tile.y - LINE - 0.1 : null;
    if (tile) tile.missed = true;
    endTimer = 1.4;
  }

  function press(lane, yPx, pointerId) {
    if (!chart || (state !== 'ready' && state !== 'playing')) return;
    const t = chart.tiles[next];
    if (!t) return;
    if (state === 'ready') {
      if (lane !== t.lane) return;
      state = 'playing';
      scroll = t.y - LINE;
      speed = targetSpeed();
      hit(t, pointerId);
      return;
    }
    const onScreen = tileBottom(t) - t.h * rowH < H && tileBottom(t) > 0;
    if (lane === t.lane && onScreen) { hit(t, pointerId); return; }

    // 기다리던 타일을 놓치고 그다음 타일을 친 경우: 사이의 타일만 놓친 것으로 치고 이 타일은 인정.
    // (그러지 않으면 계속 한 칸씩 어긋나서 이후 모든 터치가 실수가 된다)
    const keyboard = String(pointerId).charAt(0) === 'k';
    for (let k = next + 1; k < chart.tiles.length && k <= next + 6; k++) {
      const c = chart.tiles[k];
      if (c.y - scroll > VISIBLE_ROWS) break;
      if (c.lane !== lane) continue;
      const b = tileBottom(c);
      const onTile = keyboard
        ? c.y - scroll - LINE < 0.9
        : yPx <= b + rowH * 0.25 && yPx >= b - c.h * rowH - rowH * 0.25;
      if (!onTile) break;
      if (!settings.practice) { fail(t); return; }
      for (let j = next; j < k; j++) {
        chart.tiles[j].missed = true;
        missed++;
      }
      next = k;
      hit(c, pointerId);
      return;
    }

    // 이미 친 타일 위를 다시 누른 경우는 무시
    for (let i = next - 1; i >= 0 && i >= next - 8; i--) {
      const p = chart.tiles[i];
      if (p.lane !== lane) continue;
      const b = tileBottom(p);
      if (yPx <= b + 4 && yPx >= b - p.h * rowH - 4) return;
    }
    const cell = { lane, x: (lane + 0.5) * laneW, y: yPx, born: performance.now() };
    if (settings.practice) {
      errors++;
      flashes.push(cell);
      updateHud();
    } else {
      fail(null, cell);
    }
  }

  function releasePointer(pointerId) {
    if (holds.has(pointerId)) finishHold(pointerId, false);
  }

  function finish() {
    const total = chart.tiles.length;
    const cleared = state === 'cleared';
    const ratio = Math.min(1, next / total);
    let stars = ratio >= 0.3 ? 1 : 0;
    if (ratio >= 0.6) stars = 2;
    if (cleared && !settings.practice) stars = 3;
    if (cleared && settings.practice) stars = Math.min(stars, 2);

    ui.resultTitle.textContent = cleared ? (settings.practice ? '연습 완주!' : '완주!') : '실패';
    ui.resultStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    ui.resultScore.textContent = score;
    const parts = [chart.song.title, SPEEDS[settings.speed].label, '진행 ' + Math.round(ratio * 100) + '%'];
    if (!isFullRun()) {
      parts.push(chart.startSection === chart.endSection
        ? '구간: ' + chart.sections[chart.startSection]
        : chart.sections[chart.startSection] + '부터');
    }
    if (settings.practice) parts.push('연습 모드 · 실수 ' + (errors + missed) + '회');
    ui.resultDetail.textContent = parts.join(' · ');

    if (!settings.practice && isFullRun()) {
      const key = 'pt.best.' + chart.song.id + '.' + settings.speed;
      const best = store.get(key) || { score: 0, stars: 0 };
      if (score > best.score || stars > best.stars) {
        store.set(key, { score: Math.max(score, best.score), stars: Math.max(stars, best.stars) });
      }
    }
    ui.result.hidden = false;
  }

  function isFullRun() {
    return chart.startSection === 0 && chart.endSection === chart.sections.length - 1;
  }

  // ---------- 업데이트 ----------
  function update(dt) {
    if (!chart) return;
    if (state === 'countdown') {
      const left = countdownEnd - performance.now();
      if (left <= 0) {
        ui.countdown.hidden = true;
        state = pausedFrom;
        Piano.resume();
      } else {
        ui.countdown.textContent = String(Math.ceil(left / 600));
      }
      return;
    }
    if (state === 'playing') {
      speed += (targetSpeed() - speed) * Math.min(1, dt * 8);
      scroll += speed * dt;

      for (const [id, t] of holds) {
        const target = t.y + t.h - LINE - 0.25; // 타일 윗변이 판정선 근처에 오면 완료
        t.holdProgress = target > t.holdStart ? Math.min(1, (scroll - t.holdStart) / (target - t.holdStart)) : 1;
        if (t.holdProgress >= 1) finishHold(id, true);
      }

      // 연습 모드에서는 안 친 타일도 판정선에 닿으면 음악이 끊기지 않게 자동으로 울린다
      if (settings.practice) {
        for (let i = next; i < chart.tiles.length && chart.tiles[i].y <= scroll + LINE + speed * LOOKAHEAD; i++) unlock(chart.tiles[i]);
      }
      scheduleNotes();

      const t = chart.tiles[next];
      if (t && t.y - scroll < LINE - missLimit(t)) {
        if (settings.practice) {
          t.missed = true;
          missed++;
          next++;
          updateHud();
        } else {
          fail(t);
        }
      }
      const lastTile = chart.tiles[chart.tiles.length - 1];
      if (state === 'playing' && next >= chart.tiles.length && holds.size === 0 &&
          scroll + LINE >= lastTile.y + lastTile.h) {
        state = 'cleared';
        endTimer = 1.2;
      }
    } else if (state === 'failed' || state === 'cleared') {
      if (failTarget !== null) scroll += (failTarget - scroll) * Math.min(1, dt * 8);
      else if (state === 'cleared') { scroll += speed * dt; scheduleNotes(); }
      if (endTimer > 0) {
        endTimer -= dt;
        if (endTimer <= 0) finish();
      }
    }
  }

  function updateHud() {
    if (!chart) return;
    ui.score.textContent = score;
    const t = chart.tiles[Math.min(next, chart.tiles.length - 1)];
    ui.section.textContent = chart.sections[t.section];
    ui.progress.style.width = (100 * next / chart.tiles.length).toFixed(1) + '%';
    ui.practice.hidden = !settings.practice;
    if (settings.practice) ui.practice.textContent = '연습 모드 · 실수 ' + (errors + missed);
  }

  // ---------- 그리기 ----------
  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ---------- 그리기: 진짜 건반 질감 (완전한 무채색) + 노랑 강조 ----------
  const YELLOW = '#f5c400';
  const FONT_DISPLAY = '"Bodoni Moda", "Didot", "Times New Roman", serif';
  const FONT_BODY = '"Gowun Batang", "Nanum Myeongjo", "Batang", serif';

  // 회색조 잡음: 상아·옻칠의 미세한 결
  function addGrain(cx, w, h, amount, streak) {
    const img = cx.getImageData(0, 0, w, h);
    const d = img.data;
    const col = new Float32Array(w);
    if (streak) for (let x = 0; x < w; x++) col[x] = (Math.random() - 0.5) * streak; // 세로 결
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = (Math.random() - 0.5) * amount + col[x];
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    }
    cx.putImageData(img, 0, 0);
  }

  // 흰 건반 판 (화면 크기가 바뀔 때만 다시 그림)
  let boardCanvas = null;
  function buildBoard() {
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const x = c.getContext('2d');
    const kw = pw / LANES;
    for (let l = 0; l < LANES; l++) {
      const kx = Math.round(l * kw), kx2 = Math.round((l + 1) * kw);
      // 상아 같은 은은한 광택: 가운데 밝고 가장자리 살짝 어둡게
      const lg = x.createLinearGradient(kx, 0, kx2, 0);
      lg.addColorStop(0, '#e4e4e4');
      lg.addColorStop(0.12, '#f4f4f4');
      lg.addColorStop(0.55, '#fbfbfb');
      lg.addColorStop(0.9, '#f1f1f1');
      lg.addColorStop(1, '#dedede');
      x.fillStyle = lg;
      x.fillRect(kx, 0, kx2 - kx, ph);
    }
    // 위에서 아래로 빛이 떨어지는 느낌
    const vg = x.createLinearGradient(0, 0, 0, ph);
    vg.addColorStop(0, 'rgba(0,0,0,0.07)');
    vg.addColorStop(0.35, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(255,255,255,0.15)');
    x.fillStyle = vg;
    x.fillRect(0, 0, pw, ph);
    addGrain(x, pw, ph, 5, 4);
    // 건반 사이 틈
    for (let l = 1; l < LANES; l++) {
      const gx = Math.round(l * kw);
      x.fillStyle = '#7a7a7a';
      x.fillRect(gx - Math.max(1, Math.round(dpr)), 0, Math.max(1, Math.round(dpr)), ph);
      const sg = x.createLinearGradient(gx, 0, gx + 5 * dpr, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0.16)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = sg;
      x.fillRect(gx, 0, 5 * dpr, ph);
    }
    boardCanvas = c;
  }

  // 검은 건반 (크기별로 한 번만 그려 둠)
  const keyCache = new Map();
  function blackKey(w, h) {
    const pw = Math.max(4, Math.round(w * dpr)), ph = Math.max(4, Math.round(h * dpr));
    const k = pw + 'x' + ph;
    if (keyCache.has(k)) return keyCache.get(k);
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const x = c.getContext('2d');
    const r = 3 * dpr;
    const bev = Math.max(2, Math.round(pw * 0.07));
    const lip = Math.min(Math.round(12 * dpr), Math.round(ph * 0.08));
    // 몸체 (아래 모서리 둥글게)
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(pw, 0);
    x.lineTo(pw, ph - r);
    x.quadraticCurveTo(pw, ph, pw - r, ph);
    x.lineTo(r, ph);
    x.quadraticCurveTo(0, ph, 0, ph - r);
    x.closePath();
    x.fillStyle = '#060606';
    x.fill();
    x.save();
    x.clip();
    // 양옆 경사면
    const lb = x.createLinearGradient(0, 0, bev, 0);
    lb.addColorStop(0, '#3a3a3a');
    lb.addColorStop(1, '#141414');
    x.fillStyle = lb;
    x.fillRect(0, 0, bev, ph);
    const rb = x.createLinearGradient(pw - bev, 0, pw, 0);
    rb.addColorStop(0, '#0e0e0e');
    rb.addColorStop(1, '#000');
    x.fillStyle = rb;
    x.fillRect(pw - bev, 0, bev, ph);
    // 윗면: 옻칠한 흑단
    const top = x.createLinearGradient(0, 0, 0, ph - lip);
    top.addColorStop(0, '#202020');
    top.addColorStop(0.5, '#111');
    top.addColorStop(1, '#070707');
    x.fillStyle = top;
    x.fillRect(bev, 0, pw - bev * 2, ph - lip);
    // 광택 반사 줄기
    const gl = x.createLinearGradient(bev, 0, pw - bev, 0);
    gl.addColorStop(0, 'rgba(255,255,255,0)');
    gl.addColorStop(0.18, 'rgba(255,255,255,0.10)');
    gl.addColorStop(0.3, 'rgba(255,255,255,0.03)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gl;
    x.fillRect(bev, 0, pw - bev * 2, ph - lip);
    // 앞쪽 턱 (연주자 쪽 끝)
    const lg = x.createLinearGradient(0, ph - lip, 0, ph);
    lg.addColorStop(0, '#2c2c2c');
    lg.addColorStop(0.35, '#151515');
    lg.addColorStop(1, '#000');
    x.fillStyle = lg;
    x.fillRect(0, ph - lip, pw, lip);
    // 윗면 가장자리 하이라이트
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.fillRect(bev, ph - lip - Math.max(1, Math.round(dpr)), pw - bev * 2, Math.max(1, Math.round(dpr)));
    x.restore();
    addGrain(x, pw, ph, 7, 3);
    keyCache.set(k, c);
    if (keyCache.size > 64) keyCache.delete(keyCache.keys().next().value);
    return c;
  }

  function drawTile(t, i, now) {
    const bottom = tileBottom(t);
    const top = bottom - t.h * rowH;
    if (top > H || bottom < 0) return;
    const x = t.lane * laneW + 2;
    const w = laneW - 4;
    const pad = 1;
    const h = t.h * rowH - pad * 2;

    if (t.missed) {
      g.drawImage(blackKey(w, h), x, top + pad, w, h);
      if (state === 'failed') {
        g.save();
        g.globalCompositeOperation = 'screen';
        g.fillStyle = 'rgba(206, 38, 46,' + (0.45 + 0.2 * Math.sin(now / 180)) + ')';
        g.fillRect(x, top + pad, w, h);
        g.restore();
      }
      return;
    }
    if (t.played && !t.holding) {
      // 눌린 건반: 옅은 그림자만 남는다
      const a = Math.max(0.12, 0.5 - (now - t.playedAt) / 600);
      g.globalAlpha = a;
      g.drawImage(blackKey(w, h), x, top + pad, w, h);
      g.globalAlpha = 1;
      if (t.long && t.holdProgress > 0) {
        const fillH = h * t.holdProgress;
        g.fillStyle = 'rgba(245, 196, 0, 0.22)';
        g.fillRect(x, bottom - pad - fillH, w, fillH);
      }
      return;
    }

    g.drawImage(blackKey(w, h), x, top + pad, w, h);
    const start = i === 0 && state === 'ready';

    if (t.long) {
      const cx = x + w / 2;
      g.strokeStyle = 'rgba(245, 196, 0, 0.8)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx, bottom - rowH * 0.35);
      g.lineTo(cx, top + rowH * 0.3);
      g.stroke();
      if (t.played) {
        const fillH = h * Math.max(t.holdProgress, 0.12);
        g.fillStyle = 'rgba(245, 196, 0, 0.85)';
        g.fillRect(x, bottom - pad - fillH, w, fillH);
      }
      g.save();
      g.translate(cx, bottom - rowH * 0.35);
      g.rotate(-0.35);
      g.fillStyle = t.played ? '#111' : YELLOW;
      g.beginPath();
      g.ellipse(0, 0, Math.min(laneW, rowH) * 0.13, Math.min(laneW, rowH) * 0.09, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    if (t.run && !t.played) {
      // 트릴 기호처럼 작은 물결
      const cx = x + w / 2, cy = bottom - Math.min(h * 0.5, rowH * 0.32);
      const a = Math.min(laneW * 0.09, 9);
      g.strokeStyle = YELLOW;
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k <= 24; k++) {
        const px = cx - a * 2 + (a * 4 * k) / 24;
        const py = cy + Math.sin((k / 24) * Math.PI * 4) * a * 0.45;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }

    if (start) {
      g.fillStyle = YELLOW;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(laneW * 0.2) + 'px ' + FONT_BODY;
      g.fillText('시작', x + w / 2, bottom - t.h * rowH / 2);
    }
  }

  function draw(now) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!boardCanvas || boardCanvas.width !== Math.round(W * dpr) || boardCanvas.height !== Math.round(H * dpr)) buildBoard();
    g.drawImage(boardCanvas, 0, 0, W, H);
    if (!chart) return;

    // 판정선 (노랑)
    const lineY = Math.round(H - LINE * rowH);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(0, lineY + 2, W, 1);
    g.fillStyle = YELLOW;
    g.fillRect(0, lineY - 1, W, 3);

    // 화면에 보이는 타일만 그린다
    const tiles = chart.tiles;
    let i = Math.max(0, next - 12);
    for (; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.y - scroll > VISIBLE_ROWS + 1) break;
      drawTile(t, i, now);
    }

    // 잘못 누른 자리: 건반에 붉은 잉크가 번지듯 (건반 결이 비치도록 곱하기 합성)
    const drawCell = (c, alpha, spread) => {
      g.save();
      g.beginPath();
      g.rect(c.lane * laneW + 2, 0, laneW - 4, H);
      g.clip();
      g.globalCompositeOperation = 'multiply';
      const r = rowH * (0.55 + 0.5 * spread);
      const rg = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      rg.addColorStop(0, 'rgba(206, 38, 46,' + (0.62 * alpha) + ')');
      rg.addColorStop(0.45, 'rgba(206, 38, 46,' + (0.34 * alpha) + ')');
      rg.addColorStop(1, 'rgba(206, 38, 46, 0)');
      g.fillStyle = rg;
      g.fillRect(c.x - r, c.y - r, r * 2, r * 2);
      g.restore();
    };
    const FLASH_MS = 520;
    flashes = flashes.filter((c) => now - c.born < FLASH_MS);
    flashes.forEach((c) => {
      const k = (now - c.born) / FLASH_MS;
      drawCell(c, 1 - k * k, Math.sqrt(k));
    });
    if (failCell) {
      const k = Math.min(1, (now - failCell.born) / 400);
      drawCell(failCell, 0.75 + 0.25 * Math.sin(now / 180), Math.sqrt(k));
    }

    popups = popups.filter((p) => now - p.born < 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 700 ' + Math.round(laneW * 0.24) + 'px ' + FONT_DISPLAY;
    g.lineWidth = 4;
    popups.forEach((p) => {
      const k = (now - p.born) / 700;
      const y = p.y - k * rowH * 0.6;
      g.globalAlpha = 1 - k;
      g.strokeStyle = '#111';
      g.strokeText(p.text, p.x, y);
      g.fillStyle = YELLOW;
      g.fillText(p.text, p.x, y);
      g.globalAlpha = 1;
    });
  }

  function frame(now) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    update(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  // ---------- 입력 ----------
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const lane = Math.floor(((e.clientX - r.left) / r.width) * LANES);
    if (lane < 0 || lane >= LANES) return;
    press(lane, e.clientY - r.top, 'p' + e.pointerId);
  });
  const onPointerUp = (e) => releasePointer('p' + e.pointerId);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYS) {
      if (!e.repeat) {
        const t = chart && chart.tiles[next];
        const y = t ? Math.min(H - 2, Math.max(2, tileBottom(t) - rowH / 2)) : H / 2;
        press(KEYS[k], y, 'k' + k);
      }
      e.preventDefault();
    } else if (e.key === 'Escape' && !composerPanel.hidden) {
      composerPanel.hidden = true;
    } else if (e.key === 'Escape' && state === 'paused') {
      resume();
    } else if (e.key === 'Escape' && (state === 'playing' || state === 'ready' || state === 'countdown')) {
      pause();
    } else if (e.key === 'Escape' && state !== 'menu') {
      showMenu();
    } else if ((e.key === 'Enter' || e.key === ' ') && !ui.result.hidden) {
      e.preventDefault();
      startSong(chart.song, chart.startSection, chart.endSection);
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYS) releasePointer('k' + k);
  });
  window.addEventListener('blur', () => {
    for (const id of [...holds.keys()]) finishHold(id, false);
    if (state === 'playing' || state === 'countdown') pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (state === 'playing' || state === 'countdown')) pause();
  });

  $('#btn-retry').addEventListener('click', () => startSong(chart.song, chart.startSection, chart.endSection));
  $('#btn-menu').addEventListener('click', showMenu);
  $('#btn-back').addEventListener('click', () => {
    if (state === 'playing' || state === 'ready' || state === 'countdown') pause();
    else showMenu();
  });
  $('#btn-resume').addEventListener('click', resume);
  $('#btn-restart').addEventListener('click', () => startSong(chart.song, chart.startSection, chart.endSection));
  $('#btn-pause-menu').addEventListener('click', showMenu);

  // ---------- 메뉴 ----------
  function renderMenu() {
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.speed === settings.speed));
    });
    $('#opt-practice').checked = settings.practice;

    ui.songList.innerHTML = '';
    PianoTiles.songs.forEach((song, si) => {
      const best = store.get('pt.best.' + song.id + '.' + settings.speed);
      const { steps, sections } = songData(song);
      const tileCount = steps.filter((st) => !st.rest).length;
      const minutes = steps.reduce((sum, st) => sum + st.sec, 0) / SPEEDS[settings.speed].mult / 60;

      const li = document.createElement('li');
      li.className = 'song-card';
      li.innerHTML =
        '<button class="song"><span class="song-main"><span class="song-title"></span><span class="song-sub"></span>' +
        '<span class="song-play">▶ 처음부터 전곡 플레이</span></span>' +
        '<span class="song-meta"><span class="song-best"></span><span class="song-diff"></span></span></button>';
      li.querySelector('.song-title').textContent = song.title;
      li.querySelector('.song-sub').textContent =
        song.composer + ' · 타일 ' + tileCount + '개 · 약\u00a0' + Math.max(1, Math.round(minutes)) + '분';
      li.querySelector('.song-diff').textContent = '난이도 ' + '●'.repeat(song.difficulty || 1) + '○'.repeat(5 - (song.difficulty || 1));
      li.querySelector('.song-best').textContent = best
        ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) + ' ' + best.score
        : '기록 없음';

      li.querySelector('.song').addEventListener('click', () => startSong(song, 0));
      const composer = PianoTiles.composers[song.composerId];
      if (composer) {
        const cb = document.createElement('button');
        cb.className = 'composer-link';
        cb.textContent = '작곡가 소개 · ' + composer.name + ' →';
        cb.addEventListener('click', () => showComposer(composer));
        li.appendChild(cb);
      }
      if (sections.length > 1) li.appendChild(sectionPicker(song, steps, sections));
      if (song.credit) {
        const credit = document.createElement('p');
        credit.className = 'song-credit';
        credit.textContent = '악보 데이터: ' + song.credit;
        li.appendChild(credit);
      }
      ui.songList.appendChild(li);
    });
  }

  // ---------- 작곡가 소개 ----------
  const composerPanel = $('#composer');
  function showComposer(c) {
    $('#composer-meta').textContent = [c.years, c.origin, c.era].filter(Boolean).join(' · ');
    const img = $('#composer-img');
    const initials = $('#composer-initials');
    const caption = $('#composer-caption');
    initials.textContent = c.initials || c.name.slice(0, 1);
    initials.hidden = false;
    img.hidden = true;
    caption.textContent = '';
    if (c.portrait) {
      img.onload = () => { img.hidden = false; initials.hidden = true; caption.textContent = c.portraitCaption || ''; };
      img.onerror = () => { img.hidden = true; initials.hidden = false; };
      img.alt = c.name + ' 초상';
      img.src = c.portrait;
    }
    $('#composer-name').textContent = c.name;
    $('#composer-original').textContent = c.original || '';
    const bio = $('#composer-bio');
    bio.innerHTML = '';
    c.bio.forEach((para) => { const p = document.createElement('p'); p.textContent = para; bio.appendChild(p); });
    const list = $('#composer-works');
    list.innerHTML = '';
    c.works.forEach((w) => {
      const li = document.createElement('li');
      li.innerHTML = '<div class="work-head"><span class="work-title"></span><span class="work-year"></span></div><p class="work-note"></p>';
      li.querySelector('.work-title').textContent = w.title;
      li.querySelector('.work-year').textContent = w.year || '';
      li.querySelector('.work-note').textContent = w.note || '';
      const song = w.song && PianoTiles.songs.find((x) => x.id === w.song);
      if (song) {
        li.classList.add('playable');
        const b = document.createElement('button');
        b.className = 'work-play';
        b.textContent = '▶ 이 곡 플레이';
        b.addEventListener('click', () => { composerPanel.hidden = true; startSong(song, 0); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    composerPanel.hidden = false;
    composerPanel.scrollTop = 0;
    $('#btn-composer-close').focus();
  }
  $('#btn-composer-close').addEventListener('click', () => { composerPanel.hidden = true; });

  function roman(n) {
    const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, r] of map) while (n >= v) { out += r; n -= v; }
    return out;
  }

  // 구간 바로가기: 누르면 그 구간부터 바로 시작
  function sectionPicker(song, steps, sections, idPrefix) {
    const secs = sections.map(() => 0);
    steps.forEach((st) => { if (!st.rest) secs[st.section] += st.sec; });
    const mult = SPEEDS[settings.speed].mult;
    const fmt = (sec) => {
      const t = Math.max(1, Math.round(sec / mult));
      return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    };

    const box = document.createElement('div');
    box.className = 'sections';
    const head = document.createElement('div');
    head.className = 'sections-head';
    head.innerHTML = '<span>구간 바로가기</span><label class="toggle small"><input type="checkbox"><span>이 구간만 치기</span></label>';
    const only = head.querySelector('input');
    only.id = (idPrefix || '') + 'section-only-' + song.id;
    only.checked = settings.sectionOnly;
    only.addEventListener('change', () => { settings.sectionOnly = only.checked; store.set('pt.settings', settings); });
    box.appendChild(head);

    const list = document.createElement('div');
    list.className = 'section-list';
    sections.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'section-chip';
      b.innerHTML = '<span class="chip-no"></span><span class="chip-name"></span><span class="chip-time"></span>';
      b.querySelector('.chip-no').textContent = roman(i + 1);
      b.querySelector('.chip-name').textContent = name;
      b.querySelector('.chip-time').textContent = fmt(secs[i]);
      b.addEventListener('click', () => startSong(song, i, settings.sectionOnly ? i : sections.length - 1));
      list.appendChild(b);
    });
    box.appendChild(list);
    return box;
  }

  document.querySelectorAll('[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      settings.speed = b.dataset.speed;
      store.set('pt.settings', settings);
      renderMenu();
    });
  });
  $('#opt-practice').addEventListener('change', (e) => {
    settings.practice = e.target.checked;
    store.set('pt.settings', settings);
  });

  // 테스트용: 주소 끝에 #debug 를 붙이면 상태를 들여다볼 수 있다
  if (location.hash === '#debug') {
    window.__pt = { get chart() { return chart; }, get scroll() { return scroll; }, get next() { return next; }, LINE, press };
  }

  // 스타인웨이 샘플 불러오기 (메뉴에 진행 상황 표시)
  const sampleStatus = $('#sample-status');
  Piano.loadSamples('samples/steinway/', (sm) => {
    if (sm.state === 'loading') {
      sampleStatus.textContent = '스타인웨이 그랜드 피아노 불러오는 중 · ' + sm.loaded + ' / ' + (sm.total || '…');
      sampleStatus.dataset.state = 'loading';
    } else if (sm.state === 'ready') {
      sampleStatus.textContent = '스타인웨이 그랜드 피아노 준비 완료';
      sampleStatus.dataset.state = 'ready';
    } else {
      sampleStatus.textContent = '피아노 샘플을 불러오지 못해 합성음으로 연주합니다';
      sampleStatus.dataset.state = 'failed';
    }
  });

  window.addEventListener('resize', resize);
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
