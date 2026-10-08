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
   *   칸,박,템포:시작.음.길이.세기;...   (시작·길이는 1박 = 96)
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
        const [rows, beats, qpm] = head.split(',').map(Number);
        if (!(rows > 0 && beats > 0 && qpm > 0)) throw new Error('잘못된 타일: "' + tok + '"');
        const events = (body ? body.split(';') : []).map((e) => {
          const [o, m, d, v] = e.split('.').map(Number);
          return { o: o / TICKS, m, d: d / TICKS, v: v / 127 };
        });
        steps.push({ rows, beats, qpm, events });
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
  function songSteps(song) {
    const out = [];
    if (song.chart) {
      const marks = (song.sections || [{ name: song.title, tile: 0 }]).slice().sort((a, b) => a.tile - b.tile);
      let tileNo = 0, si = 0;
      for (const st of parseTimedChart(song.chart)) {
        const secPerBeat = 60 / (st.qpm || 120);
        if (st.rest) { out.push({ rest: true, rows: st.rows, sec: null }); continue; }
        while (si + 1 < marks.length && marks[si + 1].tile <= tileNo) si++;
        out.push({
          rows: st.rows,
          sec: st.beats * secPerBeat,
          section: si,
          events: st.events.map((e) => ({ o: e.o / st.beats, d: e.d / st.beats, m: e.m, v: e.v })),
        });
        tileNo++;
      }
      // 쉼표는 앞 타일과 같은 속도로 흐르게
      out.forEach((s, i) => {
        if (!s.rest) return;
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

  const songs = [];
  function registerSong(song) {
    // 등록 시점에 표기 오류를 바로 잡아낸다
    try { songSteps(song); }
    catch (e) { throw new Error('[' + song.title + '] ' + e.message); }
    songs.push(song);
  }

  global.PianoTiles = { songs, registerSong, parseNotation, parseTimedChart, songSteps, noteToMidi };
})(typeof window !== 'undefined' ? window : globalThis);
