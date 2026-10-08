#!/usr/bin/env node
/*
 * MIDI 파일 → 피아노 타일 곡 파일(songs/*.js) 변환기
 *
 * 사용법:
 *   node tools/midi2chart.js 입력.mid --id my-song --title "곡 제목" --composer "작곡가" > songs/my-song.js
 *
 * 옵션:
 *   --unit <박>      타일 1칸의 길이 (4분음표=1, 기본 1). 이보다 짧은 음들은 한 타일 안에 '~' 로 묶임
 *   --split <MIDI>   이 음 미만은 왼손 반주로 취급 (기본 60 = C4)
 *   --tracks 0,2     사용할 트랙 번호 (기본: 전부)
 *   --tempo <배율>   섹션 스크롤 속도 배율 (기본 1)
 *   --bars <N>       N 마디(4/4 기준 4N박)마다 섹션을 나눔 (기본 16)
 *   --max-chord <N>  오른손 화음 최대 음 수 (기본 3, 1이면 멜로디만)
 */
'use strict';
const fs = require('fs');

function parseArgs(argv) {
  const opts = { unit: 1, split: 60, tracks: null, tempo: 1, bars: 16, maxChord: 3, id: 'new-song', title: '새 곡', composer: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--unit') opts.unit = parseFloat(v());
    else if (a === '--split') opts.split = parseInt(v(), 10);
    else if (a === '--tracks') opts.tracks = v().split(',').map(Number);
    else if (a === '--tempo') opts.tempo = parseFloat(v());
    else if (a === '--bars') opts.bars = parseInt(v(), 10);
    else if (a === '--max-chord') opts.maxChord = parseInt(v(), 10);
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
      let b = buf[p];
      if (b & 0x80) { status = b; p++; } // 아니면 running status
      const type = status & 0xf0;
      if (status === 0xff) { p++; const l = vlq(); p += l; continue; }
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
  return { division, tracks };
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const name = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
const fmt = (x) => String(Math.round(x * 100) / 100);

function convert(opts) {
  const { division, tracks } = parseMidi(fs.readFileSync(opts.file));
  const notes = tracks.filter((_, i) => !opts.tracks || opts.tracks.includes(i)).flat();
  if (!notes.length) throw new Error('음표가 없습니다');

  // 16분음표 격자로 정렬해서 같은 시점의 음을 묶는다
  const grid = division / 4;
  const onsets = new Map();
  for (const n of notes) {
    const q = Math.round(n.start / grid);
    if (!onsets.has(q)) onsets.set(q, []);
    onsets.get(q).push(n.pitch);
  }
  const times = [...onsets.keys()].sort((a, b) => a - b);

  // 각 시점: 오른손(split 이상) 위쪽 음들, 왼손 최저음 몇 개
  const events = times.map((q, i) => {
    const ps = [...new Set(onsets.get(q))].sort((a, b) => a - b);
    const rh = ps.filter((m) => m >= opts.split).slice(-opts.maxChord);
    const lh = ps.filter((m) => m < opts.split).slice(0, 3);
    const nextQ = i + 1 < times.length ? times[i + 1] : q + 4;
    return { beat: (q * grid) / division, dur: ((nextQ - q) * grid) / division, rh, lh };
  });

  // unit 보다 짧은 이벤트는 다음 이벤트와 한 타일로 합친다
  const steps = [];
  let cur = null;
  for (const e of events) {
    const mel = e.rh.length ? e.rh : e.lh.slice(-1);
    const bass = e.rh.length ? e.lh : e.lh.slice(0, -1);
    if (!cur) cur = { beat: e.beat, dur: 0, seq: [], bass: [] };
    cur.seq.push(mel);
    if (!cur.bass.length) cur.bass = bass;
    cur.dur += e.dur;
    if (cur.dur >= opts.unit - 1e-6) { steps.push(cur); cur = null; }
  }
  if (cur) steps.push(cur);

  const sections = [];
  const barBeats = 4 * opts.bars;
  for (const st of steps) {
    const si = Math.floor(st.beat / barBeats);
    if (!sections[si]) sections[si] = [];
    const mel = st.seq.map((c) => c.map(name).join('+')).join('~');
    const bass = st.bass.length ? '/' + st.bass.map(name).join('+') : '';
    sections[si].push(mel + bass + ':' + fmt(st.dur));
  }

  const out = sections.filter(Boolean).map((toks, i) => {
    const lines = [];
    for (let j = 0; j < toks.length; j += 6) lines.push('        ' + toks.slice(j, j + 6).join(' '));
    return `    {\n      name: '파트 ${i + 1}',\n      tempo: ${opts.tempo},\n      unit: ${opts.unit},\n      notes: \`\n${lines.join('\n')}\n      \`,\n    },`;
  });

  return `PianoTiles.registerSong({
  id: ${JSON.stringify(opts.id)},
  title: ${JSON.stringify(opts.title)},
  composer: ${JSON.stringify(opts.composer)},
  difficulty: 3,
  sections: [
${out.join('\n')}
  ],
});
`;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error('사용법: node tools/midi2chart.js 입력.mid [--id ID] [--title 제목] [--composer 작곡가] [--unit 1] [--split 60]');
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
