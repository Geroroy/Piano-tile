/*
 * 곡 등록소 + 악보 표기법 파서
 *
 * 표기법 (공백으로 토큰 구분, '|' 는 마디선으로 무시됨)
 *   G4:1            G4 를 1박 (타일 1개)
 *   G3+Bb3+D4:2     화음, 2박 (2박 이상은 '롱 타일' = 누르고 있기)
 *   G4~Bb4~D5:1     한 타일 안에서 순서대로 연주 (빠른 음형/아르페지오)
 *   G4/G2+D3:1      '/' 뒤는 왼손 반주(타일 칠 때 같이 울림)
 *   r:1             쉼표 (타일 없이 1박 비움)
 * 음 이름: C D E F G A B + (#, b) + 옥타브. 예: F#4, Bb3, Eb5, C#2
 */
(function (global) {
  'use strict';

  const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function noteToMidi(name) {
    const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(name.trim());
    if (!m) throw new Error('잘못된 음 이름: "' + name + '"');
    let v = NOTE_BASE[m[1].toUpperCase()];
    for (const c of m[2]) v += c === '#' ? 1 : -1;
    return v + (parseInt(m[3], 10) + 1) * 12;
  }

  function parseChord(text) {
    return text.split('+').filter(Boolean).map(noteToMidi);
  }

  function parseNotation(src) {
    const steps = [];
    for (const tok of src.split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const colon = tok.lastIndexOf(':');
      if (colon < 0) throw new Error('길이(:박)가 없는 토큰: "' + tok + '"');
      const body = tok.slice(0, colon);
      const dur = parseFloat(tok.slice(colon + 1));
      if (!(dur > 0)) throw new Error('잘못된 길이: "' + tok + '"');
      if (body === 'r') { steps.push({ rest: true, dur }); continue; }
      const [mel, bass] = body.split('/');
      steps.push({
        dur,
        seq: mel.split('~').map(parseChord),
        bass: bass ? parseChord(bass) : [],
      });
    }
    return steps;
  }

  /*
   * MIDI 변환기(tools/midi2chart.js)가 만드는 '시간 기록' 차트
   *   칸,박,템포[,표시[,늘임]]:시작.음.길이.세기;...   (시작·길이는 1박 = 96, 칸이 0이면 '한 순간 = 한 타일' 모드)
   *     표시: 1 = 페달 다시 밟기, 2 = 마디 첫 박, 4 = 마디 가운데, 8 = 4분음표 박, 16 = 음계(쓸어 올리기/내리기)
   *     늘임: 손으로 칠 수 없을 만큼 빠른 마디를 '마스터' 난이도에서 늘이는 비율
   *     음계 늘임: 아주 빠른 음계 구간을 모든 난이도에서 늘이는 비율
   *   r:칸                               쉼표
   * '//' 뒤는 주석
   */
  const TICKS = 96;
  function parseTimedChart(src) {
    const steps = [];
    for (const line of src.split('\n')) {
      for (const tok of line.replace(/\/\/.*$/, '').split(/\s+/)) {
        if (!tok) continue;
        const [head, body] = tok.split(':');
        if (head === 'r') { steps.push({ rest: true, rows: parseFloat(body) }); continue; }
        const [rows, beats, qpm, flags, k, ks] = head.split(',').map(Number);
        if (!(rows >= 0 && beats > 0 && qpm > 0)) throw new Error('잘못된 타일: "' + tok + '"');
        const events = (body ? body.split(';') : []).map((e) => {
          const [o, m, d, v] = e.split('.').map(Number);
          return { o: o / TICKS, m, d: d / TICKS, v: v / 127 };
        });
        steps.push({ rows, beats, qpm, events, pedal: ((flags | 0) & 1) === 1, flags: flags | 0, k: k || 1, ks: ks || 1 });
      }
    }
    return steps;
  }

  /*
   * 곡을 공통 타일 목록으로 바꾼다.
   * 타일: { rows, sec(원곡 속도에서 걸리는 초), section, events:[{ o, d (타일 길이 대비 비율), m, v }] }
   * 쉼표: { rest: true, rows, sec }
   */
  const BASE_RPS = 2.4; // 직접 쓴 표기법 곡의 기본 속도 (칸/초)
  // '한 순간 = 한 타일' 모드: 화면은 일정한 속도로 흐르고, 타일 높이는 원곡의 다음 음까지 시간에 비례.
  // 너무 빽빽해 칠 수 없는 곳(ONSET_MIN_ROWS 미만)만 시간을 늘린다.
  const ONSET_RPS = 3.2;
  const ONSET_MIN_ROWS = 0.42; // 안전장치 (변환기가 이미 마디 단위로 늘려 둠)
  const ONSET_MAX_ROWS = 3;
  function songSteps(song, stretch) {
    const out = [];
    if (song.chart) {
      const marks = (song.sections || [{ name: song.title, tile: 0 }]).slice().sort((a, b) => a.tile - b.tile);
      let tileNo = 0, si = 0, di = -1;
      const dirs = (song.directions || []).slice().sort((a, b) => a.tile - b.tile);
      for (const st of parseTimedChart(song.chart)) {
        const secPerBeat = 60 / (st.qpm || 120);
        if (st.rest) { out.push({ rest: true, rows: st.rows, sec: null }); continue; }
        while (si + 1 < marks.length && marks[si + 1].tile <= tileNo) si++;
        if (st.rows === 0) {
          // 마스터: 칠 수 있게 늘린 시간 / 그 밖: 원곡 템포 그대로 (치는 순간을 줄이므로 늘릴 필요 없음)
          const full = stretch
            ? Math.max(ONSET_MIN_ROWS, st.beats * secPerBeat * st.k * ONSET_RPS)
            : Math.max(0.02, st.beats * secPerBeat * st.ks * ONSET_RPS);
          const h = Math.min(full, ONSET_MAX_ROWS);
          while (di + 1 < dirs.length && dirs[di + 1].tile <= tileNo) di++;
          out.push({
            rows: h,
            sec: h / ONSET_RPS,
            section: si,
            direction: di >= 0 && dirs[di].tile <= tileNo ? dirs[di].text : '',
            pedal: st.pedal,
            flags: st.flags,
            // 길이는 원래 음 사이 간격 대비 비율 → 늘어난 만큼 함께 늘어남
            // 시작·길이는 원래 음 사이 간격 대비 비율 → 늘어난 만큼 함께 늘어남 (꾸밈음 타일은 o>0)
            events: st.events.map((e) => ({ o: (e.o / st.beats) * (full / h), d: (e.d / st.beats) * (full / h), m: e.m, v: e.v })),
          });
          if (full > h) out.push({ rest: true, rows: full - h, sec: (full - h) / ONSET_RPS });
          tileNo++;
          continue;
        }
        out.push({
          rows: st.rows,
          sec: st.beats * secPerBeat,
          section: si,
          events: st.events.map((e) => ({ o: e.o / st.beats, d: e.d / st.beats, m: e.m, v: e.v })),
        });
        tileNo++;
      }
      applyPedal(out);
      // 쉼표는 앞 타일과 같은 속도로 흐르게
      out.forEach((s, i) => {
        if (!s.rest || s.sec !== null) return;
        const ref = out.slice(0, i).reverse().find((x) => !x.rest) || out.find((x) => !x.rest);
        s.sec = ref ? (s.rows * ref.sec) / ref.rows : s.rows / BASE_RPS;
      });
      return { steps: out, sections: marks.map((m) => m.name) };
    }
    song.sections.forEach((sec, si) => {
      const unit = sec.unit || 1;
      const rps = BASE_RPS * (sec.tempo || 1);
      for (const st of parseNotation(sec.notes)) {
        const rows = st.dur / unit;
        if (st.rest) { out.push({ rest: true, rows, sec: rows / rps }); continue; }
        const h = Math.max(1, rows);
        const n = st.seq.length;
        const events = [];
        st.seq.forEach((chord, i) => chord.forEach((m) => events.push({ o: i / n, d: n > 1 ? 1 / n : 1, m, v: 0.75 })));
        st.bass.forEach((m) => events.push({ o: 0, d: 1, m, v: 0.5 }));
        out.push({ rows: h, sec: h / rps, section: si, events });
      }
    });
    return { steps: out, sections: song.sections.map((s) => s.name) };
  }

  /*
   * 음 길이 다듬기 (칸 단위로 계산하므로 늘어난 구간에서도 비율이 유지된다)
   * - 레가토: 다음 음 직전까지 이어지는 음은 다음 음과 살짝 겹치게 (쉼표·스타카토는 그대로)
   * - 페달: 페달 표시가 있는 곡은 다음 '다시 밟기' 직후까지 음이 이어진다
   */
  const LEGATO_ROWS = 0.15;
  const PEDAL_LIFT_ROWS = 0.12; // 새 화성이 울린 직후에 떼기 (레가토 페달)
  const MAX_RING_ROWS = 14;
  function applyPedal(steps) {
    let y = 0;
    const tiles = [];
    for (const st of steps) {
      if (!st.rest) tiles.push({ st, y });
      y += st.rows;
    }
    const usesPedal = tiles.some((t) => t.st.pedal);
    let nextChange = y;
    for (let i = tiles.length - 1; i >= 0; i--) {
      const { st, y: ty } = tiles[i];
      const nextY = i + 1 < tiles.length ? tiles[i + 1].y : y;
      st.events.forEach((e) => {
        const start = ty + e.o * st.rows;
        let end = start + e.d * st.rows;
        if (end >= nextY - 0.25 * (nextY - ty)) end = Math.max(end, nextY + LEGATO_ROWS);
        if (usesPedal) end = Math.max(end, nextChange + PEDAL_LIFT_ROWS);
        end = Math.min(end, start + Math.max(e.d * st.rows, MAX_RING_ROWS));
        e.d = (end - start) / st.rows;
      });
      if (st.pedal) nextChange = ty;
    }
  }

  /*
   * 난이도: 치는 순간(타일)을 음악적으로 중요한 순간만 남기고, 나머지 음은 그 타일에 붙여 제 박자에 자동으로 울린다.
   * 화면은 계속 원곡 템포로 흐르므로 싱크는 그대로다.
   *   minGap: 타일 사이 최소 간격(초). null 이면 모든 순간을 친다(마스터).
   */
  const LEVELS = {
    basic: { label: '기본', minGap: 0.34 },
    challenge: { label: '도전', minGap: 0.235 },
    master: { label: '마스터', minGap: null },
  };

  // 순간의 중요도: 첫 박·박, 멜로디(높은 음), 세기, 화성 변화, 다음 음까지 길이
  function importance(t, top, spanRows) {
    const pitches = t.events.filter((e) => e.o < 1e-6).map((e) => e.m);
    const hi = Math.max(...pitches), lo = Math.min(...pitches);
    let s = 0;
    if (t.flags & 2) s += 4;
    if (t.flags & 4) s += 2.5;
    if (t.flags & 8) s += 1.2;
    if (t.pedal) s += 1.2;
    if (hi >= top - 2) s += 2.2; // 그 근처에서 가장 높은 선율
    if (hi < 55) s -= 1.2; // 베이스만 있는 순간
    s += Math.max(...t.events.map((e) => e.v)) * 1.5;
    s += Math.min(2, (spanRows / ONSET_RPS) * 2.5);
    s += Math.min(1, (pitches.length - 1) * 0.3); // 화음
    return s + (hi - lo > 0 ? 0 : 0);
  }

  function thin(steps, minGap) {
    let y = 0;
    const tiles = [];
    for (const st of steps) {
      if (!st.rest) tiles.push({ st, y });
      y += st.rows;
    }
    const total = y;
    const minRows = minGap * ONSET_RPS;
    // 근처(±0.6초)에서 가장 높은 음 = 멜로디 추정
    const win = 0.6 * ONSET_RPS;
    const tops = tiles.map((t) => Math.max(...t.st.events.map((e) => e.m)));
    tiles.forEach((t, i) => {
      let top = tops[i];
      for (let j = i - 1; j >= 0 && t.y - tiles[j].y < win; j--) top = Math.max(top, tops[j]);
      for (let j = i + 1; j < tiles.length && tiles[j].y - t.y < win; j++) top = Math.max(top, tops[j]);
      const span = (i + 1 < tiles.length ? tiles[i + 1].y : total) - t.y;
      t.score = importance(t.st, top, span);
      t.top = tops[i];
    });
    const kept = [];
    tiles.forEach((t, i) => {
      const forced = i === 0 || t.st.section !== tiles[i - 1].st.section;
      const last = kept[kept.length - 1];
      if (!last || forced || t.y - last.y >= minRows - 1e-6) { kept.push(t); return; }
      // 너무 가까우면 더 중요한 쪽을 남긴다 (그 앞 타일과의 간격도 지켜질 때만)
      const prev = kept[kept.length - 2];
      const lastForced = last === tiles[0] || (tiles[tiles.indexOf(last) - 1] && tiles[tiles.indexOf(last) - 1].st.section !== last.st.section);
      if (!lastForced && t.score > last.score + 0.4 && (!prev || t.y - prev.y >= minRows - 1e-6)) kept[kept.length - 1] = t;
    });
    // 남긴 타일마다 다음 타일 전까지의 모든 음을 붙인다
    const out = [];
    let ti = 0;
    kept.forEach((k, j) => {
      const endY = j + 1 < kept.length ? kept[j + 1].y : total;
      while (tiles[ti] !== k) ti++;
      const span = endY - k.y;
      const h = Math.min(span, ONSET_MAX_ROWS);
      const events = [];
      for (let x = ti; x < tiles.length && tiles[x].y < endY - 1e-9; x++) {
        const src = tiles[x];
        src.st.events.forEach((e) => {
          const p = src.y + e.o * src.st.rows;
          events.push({ o: (p - k.y) / h, d: (e.d * src.st.rows) / h, m: e.m, v: e.v });
        });
      }
      out.push({ rows: h, sec: h / ONSET_RPS, section: k.st.section, direction: k.st.direction, flags: k.st.flags, events, top: k.top });
      if (span > h + 1e-9) out.push({ rest: true, rows: span - h, sec: (span - h) / ONSET_RPS });
    });
    return out;
  }

  const levelCache = new Map();
  function levelSteps(song, level) {
    const key = song.id + ':' + level;
    if (levelCache.has(key)) return levelCache.get(key);
    const lv = LEVELS[level] || LEVELS.challenge;
    let res;
    if (!song.chart || lv.minGap === null) {
      res = songSteps(song, true);
    } else {
      const base = songSteps(song, false);
      res = { steps: thin(base.steps, lv.minGap), sections: base.sections };
    }
    res.steps.forEach((st) => {
      if (!st.rest && st.top === undefined) st.top = Math.max(...st.events.map((e) => e.m));
    });
    assignLanes(res.steps, 4);
    levelCache.set(key, res);
    return res;
  }

  /*
   * 줄 배치: 피아노 롤(연주 영상의 떨어지는 음)처럼 음높이를 줄에 대응한다. 낮은 음 = 왼쪽, 높은 음 = 오른쪽.
   * 4줄뿐이라 앞뒤 LANE_WINDOW 초 안의 음역을 4줄에 펼친다 → 상승·하강·도약이 그대로 보인다.
   * 바로 앞 타일과 같은 줄이 되면(겹쳐 보이므로) 음이 움직인 방향으로 한 칸 비킨다.
   */
  const LANE_WINDOW = 1.2;
  const LANE_MIN_SPAN = 7; // 음역이 이보다 좁으면(트릴·반복음) 이만큼으로 넓혀 작은 움직임은 옆 줄로만
  function assignLanes(steps, lanes) {
    const tiles = [];
    let y = 0;
    steps.forEach((st) => {
      if (!st.rest) {
        const atStart = st.events.filter((e) => e.o < 1e-6);
        const pitch = Math.max(...(atStart.length ? atStart : st.events).map((e) => e.m));
        tiles.push({ st, y, pitch });
      }
      y += st.rows;
    });
    const win = LANE_WINDOW * ONSET_RPS;
    let lo = 0, hi = 0, prevLane = -1, prevPitch = 0, prevMove = 1;
    tiles.forEach((t, i) => {
      while (tiles[lo].y < t.y - win) lo++;
      while (hi + 1 < tiles.length && tiles[hi + 1].y <= t.y + win) hi++;
      let min = Infinity, max = -Infinity;
      for (let j = lo; j <= hi; j++) { min = Math.min(min, tiles[j].pitch); max = Math.max(max, tiles[j].pitch); }
      if (max - min < LANE_MIN_SPAN) { const mid = (max + min) / 2; min = mid - LANE_MIN_SPAN / 2; max = mid + LANE_MIN_SPAN / 2; }
      let lane = Math.min(lanes - 1, Math.max(0, Math.round(((t.pitch - min) / (max - min)) * (lanes - 1))));
      if (lane === prevLane) {
        const dir = Math.sign(t.pitch - prevPitch) || -prevMove;
        lane += dir;
        if (lane < 0 || lane >= lanes) lane -= 2 * dir;
      }
      if (prevLane >= 0 && lane !== prevLane) prevMove = Math.sign(lane - prevLane);
      t.st.lane = lane;
      prevLane = lane;
      prevPitch = t.pitch;
    });
    // 음계처럼 한 방향으로 차례로 움직이는 구간(4타일 이상, 장3도 이내 걸음)은 계단처럼 쓸어 올리거나 내린다
    // 올라가면 1→2→3→4→1→2…, 내려가면 4→3→2→1→4…
    const stepDir = (i) => {
      const d = tiles[i].pitch - tiles[i - 1].pitch;
      // 음계 구간(표시 16)에서는 난이도에 따라 2~3음마다 치므로 완전5도까지를 '한 걸음'으로 본다
      const inSweep = (tiles[i].st.flags & 16) && (tiles[i - 1].st.flags & 16);
      const maxStep = inSweep ? 7 : 4;
      return d !== 0 && Math.abs(d) <= maxStep && tiles[i].y - tiles[i - 1].y < win ? Math.sign(d) : 0;
    };
    for (let i = 1; i < tiles.length;) {
      const dir = stepDir(i);
      let j = i;
      while (dir && j + 1 < tiles.length && stepDir(j + 1) === dir) j++;
      if (dir && j - i + 2 >= 4) {
        let lane = tiles[i - 1].st.lane;
        for (let k = i; k <= j; k++) {
          lane += dir;
          if (lane >= lanes) lane = 0;
          if (lane < 0) lane = lanes - 1;
          tiles[k].st.lane = lane;
        }
        if (j + 1 < tiles.length && tiles[j + 1].st.lane === lane) {
          const n = tiles[j + 1];
          n.st.lane = lane + (lane + 1 < lanes ? 1 : -1);
        }
        i = j + 1;
      } else {
        i++;
      }
    }
    // 마지막 점검: 바로 앞과 같은 줄이면 음 방향으로 비킨다 (뒤 타일과도 겹치지 않게)
    for (let i = 1; i < tiles.length; i++) {
      const t = tiles[i], p = tiles[i - 1];
      if (t.st.lane !== p.st.lane) continue;
      const dir = Math.sign(t.pitch - p.pitch) || 1;
      const nextLane = i + 1 < tiles.length ? tiles[i + 1].st.lane : -1;
      const options = [p.st.lane + dir, p.st.lane - dir, p.st.lane + 2 * dir, p.st.lane - 2 * dir]
        .filter((l) => l >= 0 && l < lanes);
      t.st.lane = options.find((l) => l !== nextLane) !== undefined ? options.find((l) => l !== nextLane) : options[0];
    }
    return steps;
  }

  const songs = [];
  function registerSong(song) {
    // 등록 시점에 표기 오류를 바로 잡아낸다
    try { songSteps(song, true); }
    catch (e) { throw new Error('[' + song.title + '] ' + e.message); }
    songs.push(song);
  }

  const composers = {};
  function registerComposer(c) { composers[c.id] = c; }

  global.PianoTiles = { songs, registerSong, levelSteps, LEVELS, assignLanes, composers, registerComposer, parseNotation, parseTimedChart, songSteps, noteToMidi };
})(typeof window !== 'undefined' ? window : globalThis);
