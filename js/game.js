/* 피아노 타일 게임 본체 */
(function () {
  'use strict';

  const LANES = 4;
  const VISIBLE_ROWS = 4;
  // 판정선: 화면 아래에서 LINE 칸 위. 음악은 스크롤이 판정선에 닿는 순간 악보 박자대로 울린다.
  // 타일을 미리 쳐 두면 그 타일의 음은 제 박자에 울리고, 늦게 치면(MISS_WINDOW 안) 곧바로 울린다.
  const LINE = 0.75;
  const MISS_WINDOW = 0.65; // 타일 밑변이 판정선을 이만큼(칸) 지나도록 안 치면 놓친 것
  const LOOKAHEAD = 0.12; // 초: 이만큼 앞의 음까지 미리 예약
  const LATE_SKIP = 0.6; // 칸: 늦게 친 타일에서 이보다 오래 지난 음은 건너뜀
  const SPEEDS = {
    slow: { label: '느리게', mult: 0.75 },
    normal: { label: '원곡 속도', mult: 1 },
    fast: { label: '빠르게', mult: 1.3 },
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
  let state = 'menu'; // menu | ready | playing | failed | cleared
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
        if (p < pos - LATE_SKIP) continue;
        const v = Piano.schedule(e.m, Math.max(0, (p - pos) / speed), 0.25 + e.v * 0.75, (e.d * t.h) / speed);
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
    ui.hud.hidden = false;
    updateHud();
  }

  function showMenu() {
    state = 'menu';
    chart = null;
    holds.clear();
    pending = [];
    Piano.stopAll();
    ui.result.hidden = true;
    ui.hud.hidden = true;
    ui.menu.hidden = false;
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
    Piano.failSound();
    for (const id of [...holds.keys()]) finishHold(id, false);
    pending = [];
    Piano.stopAll();
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

    // 이미 친 타일 위를 다시 누른 경우는 무시
    for (let i = next - 1; i >= 0 && i >= next - 8; i--) {
      const p = chart.tiles[i];
      if (p.lane !== lane) continue;
      const b = tileBottom(p);
      if (yPx <= b + 4 && yPx >= b - p.h * rowH - 4) return;
    }
    const cell = { lane, row: Math.floor((H - yPx) / rowH), born: performance.now() };
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
      if (t && t.y - scroll < LINE - MISS_WINDOW) {
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

  // 색: 상아빛 악보 종이 위의 흑단 건반, 금박, 클라레
  const C = {
    paper: '#f5ecd9',
    paperEdge: '#e6d6b6',
    staff: 'rgba(122, 92, 58, 0.13)',
    lane: 'rgba(138, 108, 73, 0.28)',
    ebonyTop: '#3a2a20',
    ebonyBottom: '#120c09',
    gilt: 'rgba(224, 196, 135, 0.55)',
    claretTop: '#9a2a3b',
    claretBottom: '#5e1320',
    gold: '#b8914b',
    goldLight: '#e0c487',
    played: 'rgba(122, 92, 58,',
    crimson: '#a3192b',
    crimsonBright: '#d23043',
  };
  const FONT_DISPLAY = '"Bodoni Moda", "Didot", "Times New Roman", serif';
  const FONT_BODY = '"Gowun Batang", "Nanum Myeongjo", "Batang", serif';

  function drawTile(t, i, now) {
    const bottom = tileBottom(t);
    const top = bottom - t.h * rowH;
    if (top > H || bottom < 0) return;
    const x = t.lane * laneW + 1;
    const w = laneW - 2;
    const pad = 1;
    const h = t.h * rowH - pad * 2;

    if (t.missed) {
      g.fillStyle = (state === 'failed' && Math.floor(now / 160) % 2) ? C.crimsonBright : C.crimson;
      g.fillRect(x, top + pad, w, h);
      return;
    }
    if (t.played && !t.holding) {
      const a = Math.max(0.3, 1 - (now - t.playedAt) / 300);
      g.fillStyle = C.played + (a * 0.16) + ')';
      g.fillRect(x, top + pad, w, h);
      if (t.long) {
        const fillH = h * t.holdProgress;
        g.fillStyle = 'rgba(184, 145, 75, 0.18)';
        g.fillRect(x, bottom - pad - fillH, w, fillH);
      }
      return;
    }

    const start = i === 0 && state === 'ready';
    const grad = g.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, start ? C.claretTop : C.ebonyTop);
    grad.addColorStop(1, start ? C.claretBottom : C.ebonyBottom);
    g.fillStyle = grad;
    g.fillRect(x, top + pad, w, h);
    // 금박 안쪽 테두리
    g.strokeStyle = C.gilt;
    g.lineWidth = 1;
    g.strokeRect(x + 4.5, top + pad + 4.5, w - 9, h - 9);

    if (t.long) {
      const cx = x + w / 2;
      g.strokeStyle = 'rgba(224, 196, 135, 0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx, bottom - rowH * 0.35);
      g.lineTo(cx, top + rowH * 0.3);
      g.stroke();
      if (t.played) {
        const fillH = h * Math.max(t.holdProgress, 0.12);
        const fg = g.createLinearGradient(0, bottom - fillH, 0, bottom);
        fg.addColorStop(0, 'rgba(240, 214, 150, 0.95)');
        fg.addColorStop(1, 'rgba(184, 145, 75, 0.95)');
        g.fillStyle = fg;
        g.fillRect(x, bottom - pad - fillH, w, fillH);
      }
      // 음표 머리 모양 표시
      g.save();
      g.translate(cx, bottom - rowH * 0.35);
      g.rotate(-0.35);
      g.fillStyle = t.played ? C.paper : C.goldLight;
      g.beginPath();
      g.ellipse(0, 0, Math.min(laneW, rowH) * 0.13, Math.min(laneW, rowH) * 0.09, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    if (start) {
      g.fillStyle = C.paper;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(laneW * 0.2) + 'px ' + FONT_BODY;
      g.fillText('시작', x + w / 2, bottom - t.h * rowH / 2);
    }
  }

  function draw(now) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 종이
    const paper = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.2, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    paper.addColorStop(0, C.paper);
    paper.addColorStop(1, C.paperEdge);
    g.fillStyle = paper;
    g.fillRect(0, 0, W, H);

    // 오선: 칸마다 한 묶음, 판과 함께 흘러간다
    g.strokeStyle = C.staff;
    g.lineWidth = 1;
    const gap = rowH * 0.07;
    const off = ((scroll % 1) + 1) % 1;
    for (let r = -1; r <= VISIBLE_ROWS + 1; r++) {
      const mid = H - (r - off + 0.5) * rowH;
      for (let k = -2; k <= 2; k++) {
        const y = Math.round(mid + k * gap) + 0.5;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
    }

    g.strokeStyle = C.lane;
    for (let l = 1; l < LANES; l++) {
      g.beginPath();
      g.moveTo(Math.round(l * laneW) + 0.5, 0);
      g.lineTo(Math.round(l * laneW) + 0.5, H);
      g.stroke();
    }
    if (!chart) return;

    // 판정선 (금줄)
    const lineY = Math.round(H - LINE * rowH) + 0.5;
    g.strokeStyle = 'rgba(184, 145, 75, 0.75)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, lineY - 2);
    g.lineTo(W, lineY - 2);
    g.moveTo(0, lineY + 1);
    g.lineTo(W, lineY + 1);
    g.stroke();

    // 화면에 보이는 타일만 그린다
    const tiles = chart.tiles;
    let i = Math.max(0, next - 12);
    for (; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.y - scroll > VISIBLE_ROWS + 1) break;
      drawTile(t, i, now);
    }

    const drawCell = (c, alpha) => {
      g.fillStyle = 'rgba(163, 25, 43,' + alpha + ')';
      const bottom = H - c.row * rowH;
      g.fillRect(c.lane * laneW + 1, bottom - rowH + 1, laneW - 2, rowH - 2);
    };
    flashes = flashes.filter((c) => now - c.born < 300);
    flashes.forEach((c) => drawCell(c, 0.6 * (1 - (now - c.born) / 300)));
    if (failCell) drawCell(failCell, Math.floor(now / 160) % 2 ? 0.9 : 0.6);

    popups = popups.filter((p) => now - p.born < 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 700 ' + Math.round(laneW * 0.24) + 'px ' + FONT_DISPLAY;
    popups.forEach((p) => {
      const k = (now - p.born) / 700;
      g.fillStyle = 'rgba(125, 29, 44,' + (1 - k) + ')';
      g.fillText(p.text, p.x, p.y - k * rowH * 0.6);
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
  window.addEventListener('blur', () => { for (const id of [...holds.keys()]) finishHold(id, false); });

  $('#btn-retry').addEventListener('click', () => startSong(chart.song, chart.startSection, chart.endSection));
  $('#btn-menu').addEventListener('click', showMenu);
  $('#btn-back').addEventListener('click', showMenu);

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
        song.composer + ' · 타일 ' + tileCount + '개 · 약 ' + Math.max(1, Math.round(minutes)) + '분';
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
  function sectionPicker(song, steps, sections) {
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
    only.id = 'section-only-' + song.id;
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

  window.addEventListener('resize', resize);
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
