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

  const songs = [];
  function registerSong(song) {
    // 등록 시점에 표기 오류를 바로 잡아내도록 미리 파싱해 본다
    song.sections.forEach((sec) => {
      try { parseNotation(sec.notes); }
      catch (e) { throw new Error('[' + song.title + ' / ' + sec.name + '] ' + e.message); }
    });
    songs.push(song);
  }

  global.PianoTiles = { songs, registerSong, parseNotation, noteToMidi };
})(typeof window !== 'undefined' ? window : globalThis);
