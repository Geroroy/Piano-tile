/* 피아노 타일 게임 본체 */
(function () {
  'use strict';

  const LANES = 4;
  const VISIBLE_ROWS = 4;
  const MISS_MARGIN = 0.35; // 타일 밑변이 화면 아래로 이만큼(칸) 내려가면 놓친 것으로 판정
  const SPEEDS = {
    normal: { label: '보통', rps: 2.4 },
    fast: { label: '빠름', rps: 3.2 },
    insane: { label: '매우 빠름', rps: 4.2 },
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

  const settings = Object.assign({ speed: 'normal', practice: false }, store.get('pt.settings') || {});
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

  function buildChart(song) {
    const rand = rng32(hashStr(song.id));
    const tiles = [];
    let y = 0;
    let prevLane = -1;
    song.sections.forEach((sec, si) => {
      const unit = sec.unit || 1;
      for (const st of PianoTiles.parseNotation(sec.notes)) {
        const rows = st.dur / unit;
        if (st.rest) { y += rows; continue; }
        const h = Math.max(1, rows);
        let lane;
        do { lane = Math.floor(rand() * LANES); } while (lane === prevLane);
        prevLane = lane;
        tiles.push({
          y, h, lane, section: si, seq: st.seq, bass: st.bass,
          long: h >= 2, played: false, missed: false,
          holdStart: 0, holdProgress: 0, holding: false, voices: null, playedAt: 0,
        });
        y += h;
      }
    });
    return { song, tiles, length: y };
  }

  // ---------- 상태 ----------
  let W = 0, H = 0, dpr = 1, rowH = 0, laneW = 0;
  let chart = null;
  let state = 'menu'; // menu | ready | playing | failed | cleared
  let scroll = 0, speed = 0, next = 0, score = 0, errors = 0, missed = 0;
  let failTarget = null, failCell = null, endTimer = 0;
  let flashes = [], popups = [];
  const holds = new Map();
  let lastFrame = 0;

  function sectionTempo(i) { return chart.song.sections[i].tempo || 1; }
  function targetSpeed() {
    const t = chart.tiles[Math.min(next, chart.tiles.length - 1)];
    return SPEEDS[settings.speed].rps * sectionTempo(t.section);
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
  function startSong(song) {
    Piano.ensure();
    chart = buildChart(song);
    scroll = 0; speed = 0; next = 0; score = 0; errors = 0; missed = 0;
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
    const span = (t.h / Math.max(speed, 0.5)) * 0.9;
    t.voices = Piano.playStep(t.seq, t.bass, span);
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
    else Piano.release(t.voices);
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
    failCell = cell || null;
    failTarget = tile ? tile.y - 0.6 : null;
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
    if (settings.practice) parts.push('연습 모드 · 실수 ' + (errors + missed) + '회');
    ui.resultDetail.textContent = parts.join(' · ');

    if (!settings.practice) {
      const key = 'pt.best.' + chart.song.id + '.' + settings.speed;
      const best = store.get(key) || { score: 0, stars: 0 };
      if (score > best.score || stars > best.stars) {
        store.set(key, { score: Math.max(score, best.score), stars: Math.max(stars, best.stars) });
      }
    }
    ui.result.hidden = false;
  }

  // ---------- 업데이트 ----------
  function update(dt) {
    if (!chart) return;
    if (state === 'playing') {
      speed += (targetSpeed() - speed) * Math.min(1, dt * 2.5);
      scroll += speed * dt;

      for (const [id, t] of holds) {
        const target = t.y + t.h - 1;
        t.holdProgress = target > t.holdStart ? Math.min(1, (scroll - t.holdStart) / (target - t.holdStart)) : 1;
        if (t.holdProgress >= 1) finishHold(id, true);
      }

      const t = chart.tiles[next];
      if (t && t.y - scroll < -MISS_MARGIN) {
        if (settings.practice) {
          t.missed = true;
          missed++;
          next++;
          updateHud();
        } else {
          fail(t);
        }
      }
      if (state === 'playing' && next >= chart.tiles.length && holds.size === 0) {
        state = 'cleared';
        endTimer = 1.2;
      }
    } else if (state === 'failed' || state === 'cleared') {
      if (failTarget !== null) scroll += (failTarget - scroll) * Math.min(1, dt * 8);
      else if (state === 'cleared') scroll += speed * dt;
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
    ui.section.textContent = chart.song.sections[t.section].name;
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

  function drawTile(t, i, now) {
    const bottom = tileBottom(t);
    const top = bottom - t.h * rowH;
    if (top > H || bottom < 0) return;
    const x = t.lane * laneW + 1;
    const w = laneW - 2;
    const pad = 1;

    if (t.missed) {
      g.fillStyle = (state === 'failed' && Math.floor(now / 160) % 2) ? '#ff3b4a' : '#c4202d';
      g.fillRect(x, top + pad, w, t.h * rowH - pad * 2);
      return;
    }
    if (t.played && !t.holding) {
      const a = Math.max(0.25, 1 - (now - t.playedAt) / 250);
      g.fillStyle = 'rgba(30, 36, 48,' + (a * 0.18) + ')';
      g.fillRect(x, top + pad, w, t.h * rowH - pad * 2);
      if (t.long) {
        const fillH = (t.h * rowH - pad * 2) * t.holdProgress;
        g.fillStyle = 'rgba(40, 140, 255, 0.18)';
        g.fillRect(x, bottom - pad - fillH, w, fillH);
      }
      return;
    }

    const grad = g.createLinearGradient(0, top, 0, bottom);
    if (i === 0 && state === 'ready') {
      grad.addColorStop(0, '#1f8fff');
      grad.addColorStop(1, '#0a5fd1');
    } else {
      grad.addColorStop(0, '#2a2f3a');
      grad.addColorStop(1, '#0b0d12');
    }
    g.fillStyle = grad;
    g.fillRect(x, top + pad, w, t.h * rowH - pad * 2);

    if (t.long) {
      const cx = x + w / 2;
      g.strokeStyle = 'rgba(120, 200, 255, 0.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, bottom - rowH * 0.35);
      g.lineTo(cx, top + rowH * 0.3);
      g.stroke();
      if (t.played) {
        const fillH = (t.h * rowH - pad * 2) * Math.max(t.holdProgress, 0.12);
        const fg = g.createLinearGradient(0, bottom - fillH, 0, bottom);
        fg.addColorStop(0, 'rgba(110, 210, 255, 0.95)');
        fg.addColorStop(1, 'rgba(40, 140, 255, 0.95)');
        g.fillStyle = fg;
        g.fillRect(x, bottom - pad - fillH, w, fillH);
      }
      g.fillStyle = t.played ? '#ffffff' : 'rgba(150, 210, 255, 0.9)';
      g.beginPath();
      g.arc(cx, bottom - rowH * 0.35, Math.min(laneW, rowH) * 0.12, 0, Math.PI * 2);
      g.fill();
    }

    if (i === 0 && state === 'ready') {
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 ' + Math.round(laneW * 0.2) + 'px system-ui, sans-serif';
      g.fillText('시작', x + w / 2, bottom - t.h * rowH / 2);
    }
  }

  function draw(now) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#f7f8fa';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#d9dde4';
    g.lineWidth = 1;
    for (let l = 1; l < LANES; l++) {
      g.beginPath();
      g.moveTo(Math.round(l * laneW) + 0.5, 0);
      g.lineTo(Math.round(l * laneW) + 0.5, H);
      g.stroke();
    }
    if (!chart) return;

    // 화면에 보이는 타일만 그린다
    const tiles = chart.tiles;
    let i = Math.max(0, next - 12);
    for (; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.y - scroll > VISIBLE_ROWS + 1) break;
      drawTile(t, i, now);
    }

    const drawCell = (c, alpha) => {
      g.fillStyle = 'rgba(232, 40, 56,' + alpha + ')';
      const bottom = H - c.row * rowH;
      g.fillRect(c.lane * laneW + 1, bottom - rowH + 1, laneW - 2, rowH - 2);
    };
    flashes = flashes.filter((c) => now - c.born < 300);
    flashes.forEach((c) => drawCell(c, 0.6 * (1 - (now - c.born) / 300)));
    if (failCell) drawCell(failCell, Math.floor(now / 160) % 2 ? 0.9 : 0.6);

    popups = popups.filter((p) => now - p.born < 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 ' + Math.round(laneW * 0.22) + 'px system-ui, sans-serif';
    popups.forEach((p) => {
      const k = (now - p.born) / 700;
      g.fillStyle = 'rgba(20, 130, 255,' + (1 - k) + ')';
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
    } else if (e.key === 'Escape' && state !== 'menu') {
      showMenu();
    } else if ((e.key === 'Enter' || e.key === ' ') && !ui.result.hidden) {
      e.preventDefault();
      startSong(chart.song);
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYS) releasePointer('k' + k);
  });
  window.addEventListener('blur', () => { for (const id of [...holds.keys()]) finishHold(id, false); });

  $('#btn-retry').addEventListener('click', () => startSong(chart.song));
  $('#btn-menu').addEventListener('click', showMenu);
  $('#btn-back').addEventListener('click', showMenu);

  // ---------- 메뉴 ----------
  function renderMenu() {
    document.querySelectorAll('[data-speed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.speed === settings.speed));
    });
    $('#opt-practice').checked = settings.practice;

    ui.songList.innerHTML = '';
    PianoTiles.songs.forEach((song) => {
      const best = store.get('pt.best.' + song.id + '.' + settings.speed);
      const tileCount = buildChart(song).tiles.length;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'song';
      btn.innerHTML =
        '<span class="song-main"><span class="song-title"></span><span class="song-sub"></span></span>' +
        '<span class="song-meta"><span class="song-best"></span><span class="song-diff"></span></span>';
      btn.querySelector('.song-title').textContent = song.title;
      btn.querySelector('.song-sub').textContent = song.composer + ' · 타일 ' + tileCount + '개';
      btn.querySelector('.song-diff').textContent = '난이도 ' + '●'.repeat(song.difficulty || 1) + '○'.repeat(5 - (song.difficulty || 1));
      btn.querySelector('.song-best').textContent = best
        ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) + ' ' + best.score
        : '기록 없음';
      btn.addEventListener('click', () => startSong(song));
      li.appendChild(btn);
      ui.songList.appendChild(li);
    });
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

  window.addEventListener('resize', resize);
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
