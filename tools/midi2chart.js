#!/usr/bin/env node
/*
 * MIDI 파일 → 피아노 타일 곡 파일(songs/*.js) 변환기
 *
 * MIDI의 모든 음을 원래 리듬·세기 그대로 타일에 나눠 담는다.
 * 타일을 치면 그 타일 구간의 음들(양손)이 실제 박자대로 연주된다.
 *
 * 사용법:
 *   node tools/midi2chart.js 입력.mid --id my-song --title "곡 제목" --composer "작곡가" > songs/my-song.js
 *
 * 옵션:
 *   --rate <칸/초>    원곡 템포에서 목표 타일 속도 (기본 2.3). 마디마다 이 값에 가장 가까운 타일 길이를 고른다
 *   --max-rows <N>    새 음 없이 이어지는 구간을 합친 '긴 타일'의 최대 칸 수 (기본 4)
 *   --tracks 0,1      사용할 트랙 번호 (기본: 전부)
 *   --sections "1:서주|8:제1주제"   마디 번호:구간 이름 (메뉴의 시작 구간 선택과 화면 표시에 사용)
 *   --credit "..."    출처 표기
 *   --difficulty N    1~5
 *   --per-onset       타일 1개 = 악보에서 동시에 시작하는 음 한 묶음 (터치 하나가 정확히 한 순간의 음).
 *                     타일 높이는 게임이 원곡 박자로 정하고, 너무 빽빽한 곳만 칠 수 있게 늘린다.
 *   --composer-id ID  composers/ 폴더의 작곡가 정보 ID (예: chopin)
 *   --tempo-map 파일  악보 지시어에 맞춘 템포 지도(JSON, tools/tempo/ 참고). 없으면 MIDI의 템포를 그대로 씀
 */
'use strict';
const fs = require('fs');

function parseArgs(argv) {
  const opts = {
    rate: 2.3, maxRows: 4, tracks: null, sections: '', credit: '', difficulty: 3,
    id: 'new-song', title: '새 곡', composer: '',
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--rate') opts.rate = parseFloat(v());
    else if (a === '--max-rows') opts.maxRows = parseInt(v(), 10);
    else if (a === '--tracks') opts.tracks = v().split(',').map(Number);
    else if (a === '--sections') opts.sections = v();
    else if (a === '--credit') opts.credit = v();
    else if (a === '--composer-id') opts.composerId = v();
    else if (a === '--per-onset') opts.perOnset = true;
    else if (a === '--tempo-map') opts.tempoMap = v();
    else if (a === '--difficulty') opts.difficulty = parseInt(v(), 10);
    else if (a === '--id') opts.id = v();
    else if (a === '--title') opts.title = v();
    else if (a === '--composer') opts.composer = v();
    else rest.push(a);
  }
  opts.file = rest[0];
  return opts;
}

// ---- 최소한의 Standard MIDI File 파서 ----
function parseMidi(buf) {
  let p = 0;
  const u32 = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
  const u16 = () => { const v = buf.readUInt16BE(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (buf.toString('ascii', 0, 4) !== 'MThd') throw new Error('MIDI 파일이 아닙니다');
  p = 4;
  const hdrLen = u32();
  u16(); // format
  const ntrks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('SMPTE 타임코드 MIDI는 지원하지 않습니다');
  p = 8 + hdrLen;

  const tracks = [];
  const tempos = [];
  const timeSigs = [];
  for (let t = 0; t < ntrks && p < buf.length; t++) {
    const id = buf.toString('ascii', p, p + 4); p += 4;
    const len = u32();
    const end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    const notes = [];
    const open = new Map();
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      if (buf[p] & 0x80) status = buf[p++]; // 아니면 running status
      const type = status & 0xf0;
      if (status === 0xff) {
        const mt = buf[p++];
        const l = vlq();
        if (mt === 0x51) tempos.push({ tick, qpm: 60000000 / ((buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2]) });
        if (mt === 0x58) timeSigs.push({ tick, num: buf[p], den: 1 << buf[p + 1] });
        p += l;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; continue; }
      const d1 = buf[p++];
      const d2 = (type === 0xc0 || type === 0xd0) ? 0 : buf[p++];
      const ch = status & 0x0f;
      if (ch === 9) continue; // 드럼 채널 무시
      const key = ch * 128 + d1;
      if (type === 0x90 && d2 > 0) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ pitch: d1, start: tick, vel: d2 });
      } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        const stack = open.get(key);
        if (stack && stack.length) { const n = stack.shift(); n.end = tick; notes.push(n); }
      }
    }
    p = end;
    tracks.push(notes);
  }
  tempos.sort((a, b) => a.tick - b.tick);
  timeSigs.sort((a, b) => a.tick - b.tick);
  return { division, tracks, tempos, timeSigs };
}

const TICKS = 96; // 차트에 저장하는 시간 해상도: 4분음표 1박 = 96

/*
 * 악보 MIDI에는 페달이 없으므로 피아니스트처럼 '화성이 바뀔 때' 다시 밟는 지점을 표시한다.
 * - 베이스 음(G3 아래, 또는 옥타브만으로 된 선율)이 새 음이름으로 바뀌면 다시 밟음
 * - 새 마디가 베이스 음으로 시작하면 다시 밟음
 * - 한 마디 넘게 다시 밟지 않았으면 다음 음에서 다시 밟음
 */
/*
 * 트릴·꾸밈음·아주 빠른 음계: 음 간격이 ORN_GAP 초보다 짧게 이어지는 음들은 한 타일에 묶어
 * 원래 속도로 울리게 한다 (하나씩 늘려 치면 떨림이 아니라 또박또박한 소리가 됨).
 * 긴 패시지는 ORN_MAX_NOTES 음 / ORN_MAX_SEC 초 단위로 나눠 여러 번 치게 한다.
 */
const ORN_GAP = 0.095;
const GRACE_GAP = 0.095; // 두 음만 있어도 이보다 가까우면 묶음 (꾸밈음·펼침화음)
const ORN_MAX_NOTES = 8;
const ORN_MAX_SEC = 0.45;
function mergeOrnaments(tiles) {
  const secOf = (t) => (t.beats * 60) / t.qpm;
  const out = [];
  for (let i = 0; i < tiles.length;) {
    let j = i;
    while (j + 1 < tiles.length && secOf(tiles[j]) < ORN_GAP) j++;
    // 3음 이상 빠른 연속음, 또는 꾸밈음·펼침화음처럼 아주 가까운 두 음
    const tight = j > i && secOf(tiles[i]) < GRACE_GAP;
    if (j - i + 1 < 3 && !tight) { out.push(tiles[i]); i++; continue; }
    // i..j 가 빠른 연속 음 (j 는 마지막 음)
    for (let k = i; k <= j;) {
      let e = k, sec = 0;
      while (e + 1 <= j && e - k + 1 < ORN_MAX_NOTES && sec + secOf(tiles[e]) < ORN_MAX_SEC) { sec += secOf(tiles[e]); e++; }
      const group = tiles.slice(k, e + 1);
      const last = group[group.length - 1];
      out.push({
        start: group[0].start,
        beats: r6(last.start + last.beats - group[0].start),
        rows: 0,
        qpm: group[0].qpm,
        notes: group.flatMap((g) => g.notes),
        run: true,
      });
      k = e + 1;
    }
    i = j + 1;
  }
  tiles.length = 0;
  out.forEach((t) => tiles.push(t));
}

/* 템포 지도: [마디(소수 가능), BPM, 'step'|'ramp'] 목록 → 박 위치별 BPM */
function tempoMapFn(points, bars) {
  const posOf = (m) => {
    const i = Math.min(bars.length - 1, Math.max(0, Math.floor(m) - 1));
    return bars[i].start + (m - Math.floor(m)) * bars[i].len + (m - 1 >= bars.length ? bars[i].len : 0);
  };
  const pts = points.map(([m, q, kind]) => ({ pos: posOf(m), q, ramp: kind === 'ramp' }));
  return (b) => {
    let i = -1;
    for (let k = 0; k < pts.length; k++) if (pts[k].pos <= b + 1e-6) i = k;
    if (i < 0) return pts[0].q;
    const n = pts[i + 1];
    if (n && n.ramp && n.pos > pts[i].pos) {
      const f = Math.min(1, (b - pts[i].pos) / (n.pos - pts[i].pos));
      return pts[i].q + (n.q - pts[i].q) * f;
    }
    return pts[i].q;
  };
}

/*
 * 칠 수 없을 만큼 빠른 곳은 '음 하나'가 아니라 '마디 전체'를 같은 비율로 늘린다 → 마디 안 리듬 비율 유지.
 * 늘이는 비율은 마디마다 최대 STRETCH_STEP 배씩만 바뀌게 다듬어 갑작스러운 템포 변화가 없게 한다.
 */
const MIN_TAP_SEC = 0.135;
const STRETCH_STEP = 1.1;
function stretchBars(tiles, bars) {
  const barOf = (t) => {
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].start <= t.start + 1e-6) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const k = bars.map(() => 1);
  tiles.forEach((t) => {
    if (t.run) return;
    const sec = (t.beats * 60) / t.qpm;
    const bi = barOf(t);
    k[bi] = Math.max(k[bi], MIN_TAP_SEC / sec);
  });
  for (let i = 1; i < k.length; i++) k[i] = Math.max(k[i], k[i - 1] / STRETCH_STEP);
  for (let i = k.length - 2; i >= 0; i--) k[i] = Math.max(k[i], k[i + 1] / STRETCH_STEP);
  // 템포는 원래대로 두고 늘임 비율만 기록 (게임의 '마스터' 난이도에서만 적용)
  tiles.forEach((t) => {
    const bi = barOf(t);
    t.k = k[bi];
    // 박 위치 표시: 2 = 마디 첫 박, 4 = 마디 가운데, 8 = 4분음표 박
    const pos = r6(t.start - bars[bi].start);
    t.flags = (pos === 0 ? 2 : 0) | (Math.abs(pos - bars[bi].len / 2) < 1e-6 ? 4 : 0) | (Math.abs(pos - Math.round(pos)) < 1e-6 ? 8 : 0);
  });
  if (process.env.STRETCH_DEBUG) {
    k.forEach((x, i) => { if (x > 1.25) process.stderr.write('  m' + (i + 1) + ' x' + x.toFixed(2) + '\n'); });
  }
  const stretched = k.filter((x) => x > 1.001).length;
  process.stderr.write('늘인 마디 ' + stretched + '/' + k.length + ', 최대 ' + Math.max(...k).toFixed(2) + '배\n');
}

function markPedal(tiles, bars) {
  let bi = 0, curBar = -1, lastChange = -Infinity;
  let held = new Set(); // 지금 페달 아래 울리는 음이름들
  for (const t of tiles) {
    while (bi + 1 < bars.length && bars[bi + 1].start <= t.start + 1e-6) bi++;
    const pitches = t.notes.map((n) => n.m);
    const low = Math.min(...pitches);
    const octavesOnly = pitches.length > 1 && pitches.every((p) => p % 12 === low % 12);
    const bass = low < 55 || octavesOnly ? low : null;
    let change = lastChange === -Infinity;
    // 베이스가 지금 화성에 없는 음으로 바뀌면 (화성이 어느 정도 쌓였을 때)
    if (bass !== null && !held.has(bass % 12) && held.size >= 3) change = true;
    // 새 마디가 베이스로 시작하면
    if (bass !== null && bi !== curBar) change = true;
    // 음계처럼 서로 다른 음이 너무 많이 쌓이면 (흐려지지 않게)
    if (held.size >= 6 && pitches.some((p) => !held.has(p % 12))) change = true;
    // 한 마디 넘게 밟고 있었으면
    if (t.start - lastChange > bars[bi].len + 1e-6) change = true;
    if (change) {
      t.pedal = true;
      lastChange = t.start;
      curBar = bi;
      held = new Set();
    }
    pitches.forEach((p) => held.add(p % 12));
  }
}
const UNITS = [0.5, 1, 1.5, 2, 3, 4, 6];
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function convert(opts) {
  const { division: D, tracks, tempos, timeSigs } = parseMidi(fs.readFileSync(opts.file));

  // 음 모으기 (같은 높이·같은 시작의 중복 음은 긴 쪽만 남김)
  const byKey = new Map();
  tracks.forEach((t, i) => {
    if (opts.tracks && !opts.tracks.includes(i)) return;
    for (const n of t) {
      const s = n.start / D;
      const e = (n.end !== undefined ? n.end : n.start + D) / D;
      const key = n.pitch + '@' + n.start;
      const prev = byKey.get(key);
      if (!prev || prev.e < e) byKey.set(key, { s, e, m: n.pitch, v: Math.max(n.vel, prev ? prev.v : 0) });
    }
  });
  const notes = [...byKey.values()].sort((a, b) => a.s - b.s || a.m - b.m);
  if (!notes.length) throw new Error('음표가 없습니다');
  const endBeat = Math.max(...notes.map((n) => n.s)) + 1e-6;

  let qpmAt = (b) => {
    let q = 120;
    for (const t of tempos) { if (t.tick / D <= b + 1e-9) q = t.qpm; else break; }
    return q;
  };

  // 마디 목록
  const sigs = timeSigs.length ? timeSigs : [{ tick: 0, num: 4, den: 4 }];
  const bars = [];
  for (let b = 0, si = 0; b < endBeat;) {
    while (si + 1 < sigs.length && sigs[si + 1].tick / D <= b + 1e-9) si++;
    const len = (sigs[si].num * 4) / sigs[si].den;
    bars.push({ start: b, len });
    b = r6(b + len);
  }

  if (opts.tempoMap) qpmAt = tempoMapFn(JSON.parse(fs.readFileSync(opts.tempoMap, 'utf8')).points, bars);

  // 마디별로 타일 길이(unit)를 고르고 잘게 나눈다
  const tiles = []; // { start, beats, rows, qpm } 또는 { rest:true, rows }
  const barFirstTile = [];
  let ni = 0;
  if (opts.perOnset) {
    // 같은 순간에 시작하는 음들을 한 타일로. rows=0 은 '게임이 높이를 정함'
    for (let i = 0; i < notes.length;) {
      let j = i;
      while (j < notes.length && Math.abs(notes[j].s - notes[i].s) < 1e-6) j++;
      const s = notes[i].s;
      const group = notes.slice(i, j);
      const nextS = j < notes.length ? notes[j].s : s + Math.max(1, ...group.map((n) => n.e - s));
      tiles.push({ start: s, beats: r6(nextS - s), rows: 0, qpm: qpmAt(s), notes: group });
      i = j;
    }
    mergeOrnaments(tiles);
    stretchBars(tiles, bars);
    let ti = 0;
    for (const bar of bars) {
      while (ti < tiles.length && tiles[ti].start < bar.start - 1e-6) ti++;
      barFirstTile.push(ti);
    }
    markPedal(tiles, bars);
  }
  for (const bar of opts.perOnset ? [] : bars) {
    const qpm = qpmAt(bar.start);
    let unit = 1, best = Infinity;
    for (const u of UNITS) {
      if (Math.abs(bar.len / u - Math.round(bar.len / u)) > 1e-6) continue;
      const diff = Math.abs(Math.log((qpm / 60 / u) / opts.rate));
      if (diff < best) { best = diff; unit = u; }
    }
    barFirstTile.push(tiles.length);
    for (let k = 0; k < Math.round(bar.len / unit); k++) {
      const s = r6(bar.start + k * unit);
      const e = r6(s + unit);
      const startIdx = ni;
      while (ni < notes.length && notes[ni].s < e - 1e-6) ni++;
      const hasOnset = ni > startIdx;
      const last = tiles[tiles.length - 1];
      if (!hasOnset && last && !last.rest && last.rows + 1 <= opts.maxRows) {
        last.beats = r6(last.beats + unit);
        last.rows += 1;
      } else if (!hasOnset) {
        if (last && last.rest) last.rows += 1;
        else tiles.push({ rest: true, rows: 1 });
      } else {
        tiles.push({ start: s, beats: unit, rows: 1, qpm, notes: notes.slice(startIdx, ni) });
      }
    }
  }

  // 구간 이름 → 타일 번호(쉼표 제외한 순번)
  const playableIndex = [];
  let count = 0;
  tiles.forEach((t) => { playableIndex.push(count); if (!t.rest) count++; });
  const sections = opts.sections
    ? opts.sections.split('|').map((part) => {
      const [bar, ...name] = part.split(':');
      const bi = Math.min(bars.length - 1, Math.max(0, parseInt(bar, 10) - 1));
      return { name: name.join(':').trim(), tile: playableIndex[barFirstTile[bi]] || 0 };
    })
    : [{ name: opts.title, tile: 0 }];

  // 템포 지도의 악보 지시어(라틴어/이탈리아어만) → 화면에 표시할 위치
  const directions = [];
  if (opts.tempoMap) {
    for (const [m, , , label] of JSON.parse(fs.readFileSync(opts.tempoMap, 'utf8')).points) {
      if (!label || /[가-힣]/.test(label)) continue;
      const bi = Math.min(bars.length - 1, Math.max(0, Math.floor(m) - 1));
      directions.push({ text: label, tile: playableIndex[barFirstTile[bi]] || 0 });
    }
  }

  // 직렬화: 타일 = "칸,박,템포:시작.음.길이.세기;..."  쉼표 = "r:칸"
  const lines = [];
  bars.forEach((bar, bi) => {
    const from = barFirstTile[bi];
    const to = bi + 1 < bars.length ? barFirstTile[bi + 1] : tiles.length;
    const toks = tiles.slice(from, to).map((t) => {
      if (t.rest) return 'r:' + t.rows;
      const ev = t.notes.map((n) => [
        Math.round((n.s - t.start) * TICKS), n.m, Math.max(1, Math.round((n.e - n.s) * TICKS)), n.v,
      ].join('.'));
      const flags = (t.pedal ? 1 : 0) | (t.flags || 0);
      const tail = t.k && t.k > 1.001 ? ',' + flags + ',' + Math.round(t.k * 1000) / 1000 : flags ? ',' + flags : '';
      return t.rows + ',' + r6(t.beats) + ',' + Math.round(t.qpm * 100) / 100 + tail + ':' + ev.join(';');
    });
    if (toks.length) lines.push('    ' + toks.join(' ') + '  // m.' + (bi + 1));
  });

  return `/*
 * ${opts.title} — ${opts.composer}
 * tools/midi2chart.js 로 MIDI에서 자동 생성된 파일입니다. 직접 고치기보다 MIDI를 다시 변환하세요.
${opts.credit ? ' * 출처: ' + opts.credit + '\n' : ''} */
PianoTiles.registerSong({
  id: ${JSON.stringify(opts.id)},
  title: ${JSON.stringify(opts.title)},
  composer: ${JSON.stringify(opts.composer)},
${opts.composerId ? '  composerId: ' + JSON.stringify(opts.composerId) + ',\n' : ''}  difficulty: ${opts.difficulty},
  credit: ${JSON.stringify(opts.credit)},
  sections: ${JSON.stringify(sections, null, 2).replace(/\n/g, '\n  ')},
${directions.length ? '  directions: ' + JSON.stringify(directions) + ',\n' : ''}
  chart: \`
${lines.join('\n')}
  \`,
});
`;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error('사용법: node tools/midi2chart.js 입력.mid [--id ID] [--title 제목] [--composer 작곡가] [--sections "1:도입|9:후렴"]');
    process.exit(1);
  }
  try {
    process.stdout.write(convert(opts));
  } catch (e) {
    console.error('변환 실패: ' + e.message);
    process.exit(1);
  }
}

module.exports = { parseMidi, convert };
