/*
 * 쇼팽 - 발라드 1번 G단조, Op. 23 (1835)
 * 퍼블릭 도메인 곡을 피아노 타일용으로 축약 편곡한 버전.
 * 원곡의 흐름(서주 → 제1주제 → 아지타토 → 제2주제 → A장조 클라이맥스
 * → 왈츠 → 제2주제 재현 → 제1주제 회상 → 프레스토 콘 푸오코 코다)을 따라간다.
 *
 * unit: 1 = 4분음표 1박이 타일 1칸. tempo: 섹션별 스크롤 속도 배율.
 */
PianoTiles.registerSong({
  id: 'chopin-ballade-1',
  title: '발라드 1번 G단조',
  composer: 'F. Chopin · Op. 23',
  difficulty: 4,
  reference: 'https://youtu.be/mxx_WcjV5U8',
  sections: [
    {
      name: 'Largo · 서주',
      tempo: 0.6,
      notes: `
        C3+C4/C2:2 Eb3+Eb4:1 Ab3+Ab4:1 |
        G3+G4:1 F3+F4:1 Eb3+Eb4:1 D3+D4:1 |
        Eb3+Eb4:2 C3+C4:1 Bb2+Bb3:1 |
        Ab2+Ab3:2 G2+G3:2 |
        G2+D3+G3+Bb3+Eb4:3 G2+D3+G3+Bb3+D4:3 r:1
      `,
    },
    {
      name: 'Moderato · 제1주제',
      tempo: 1.0,
      notes: `
        D4:1 |
        G4/G2+D3+G3:2 Bb4:1 A4/D3+G3:1 G4:1 F#4:1 |
        G4/Eb2+Bb2+G3:2 Bb4:1 D5/Eb3+G3:2 C5:1 |
        Bb4/D2+D3+G3:2 A4:1 G4/D3+F#3:1 F#4:1 A4:1 |
        G4/G2+D3+Bb3:3 r:1 D4:1 D4:1 |
        G4/G2+D3+G3:2 Bb4:1 A4/D3+G3:1 G4:1 D5:1 |
        Eb5/C3+G3:2 D5:1 C5/C3+Eb3+G3:1 Bb4:1 A4:1 |
        Bb4/D3+G3:2 G4:1 A4/D2+C3+F#3:2 F#4:1 |
        G4/G2+D3+Bb3:3 r:1 Bb4:1 C5:1 |
        D5/Bb2+F3+Bb3:2 Eb5:1 F5/D3+Ab3:2 Eb5:1 |
        D5/Eb2+Bb2+G3:2 C5:1 Bb4/Eb3+G3:1 A4:1 G4:1 |
        A4/C3+Eb3+F#3:2 Bb4:1 C5/D3+F#3:2 A4:1 |
        G4/G2+D3+G3+Bb3:3 D4:1 G4/G2:1 Bb4:1
      `,
    },
    {
      name: 'Agitato',
      tempo: 1.2,
      notes: `
        G4~Bb4/G2+D3:1 D5~G5:1 F#5~G5:1 D5~Bb4:1 A4~G4:1 F#4~D4:1 |
        Eb4~G4/C3+G3:1 C5~Eb5:1 D5~Eb5:1 C5~G4:1 F#4~Eb4:1 D4~C4:1 |
        Bb3~D4/G2+D3:1 G4~Bb4:1 A4~Bb4:1 G4~D4:1 C#4~D4:1 F#4~A4:1 |
        C5/D2+D3+A3:2 Bb4:1 A4:1 C5:1 D5:1 |
        Eb5/C3+G3+C4:2 D5:1 C5/A2+Eb3+F#3:2 A4:1 |
        Bb4+D5/G2+D3+G3:3 A4+C5/D2+A2+F#3:3 |
        G4+Bb4+D5/G1+G2:1 Bb4+D5+G5:1 A4+C5+F#5/D2+D3:1 G4+Bb4+G5:1 F4+Bb4+D5/Bb1+Bb2:2 |
        F4+Bb4/Bb1+Bb2:2 F4+Bb4:1 Eb4+G4:1 D4+F4:2 |
        D4+F4+Bb4/Bb1+F2+Bb2:3 r:1
      `,
    },
    {
      name: 'Meno mosso · 제2주제',
      tempo: 0.8,
      notes: `
        Bb4/Eb2+Bb2+G3:2 Eb5:1 D5/Eb3+G3:2 C5:1 |
        Bb4/Ab2+Eb3+C4:2 G4:1 Ab4/Bb2+F3+D4:2 F4:1 |
        G4/Eb2+Bb2+Eb3:2 Bb4:1 Eb5/G2+Eb3+Bb3:2 D5:1 |
        C5/Ab2+Eb3+Ab3:3 Bb4/Bb2+F3+Ab3:3 |
        Bb4/Eb2+Bb2+G3:2 Eb5:1 G5/Eb3+Bb3:2 F5:1 |
        Eb5/C3+G3+C4:2 D5:1 C5/Ab2+Eb3+Ab3:2 Bb4:1 |
        Ab4/Bb2+F3:2 G4:1 F4/Bb2+D3+Ab3:2 D4:1 |
        Eb4+G4+Bb4/Eb2+Bb2+Eb3:4 r:1
      `,
    },
    {
      name: 'A장조 · 클라이맥스',
      tempo: 1.05,
      notes: `
        E4+E5/A1+A2:2 A4+A5:1 G#4+G#5/E2+B2+E3:2 F#4+F#5:1 |
        E4+E5/D2+A2+F#3:2 C#4+C#5:1 D4+D5/E2+B2+G#3:2 B3+B4:1 |
        C#4+C#5/A1+A2+E3:2 E4+E5:1 A4+A5/C#2+A2+E3:2 G#4+G#5:1 |
        F#4+F#5/D2+A2+D3:3 E4+E5/E2+B2+D3:3 |
        A3+C#4+E4+A4/A1+A2:2 G#3+D4+E4+B4/E1+E2:2 A3+C#4+E4+A4/A1+A2:2 |
        Ab3+C4+Eb4+Ab4/Ab1+Ab2:2 G3+Bb3+Eb4+Bb4/Bb1+Bb2:2 r:1
      `,
    },
    {
      name: 'Scherzando · 왈츠',
      tempo: 1.25,
      notes: `
        Bb4~C5/Eb2+G3+Bb3:1 D5~Eb5:1 F5~G5:1 Ab5~G5/Bb2+F3+Ab3:1 F5~Eb5:1 D5~C5:1 |
        Bb4~C5/Eb2+G3+Bb3:1 D5~Eb5:1 F5~Eb5:1 D5~Eb5/Ab2+Eb3+C4:1 C5~Ab4:1 F4~D4:1 |
        Eb4+G4/Eb2+Bb2:1 Bb4:1 Eb5:1 G5/C3+G3:1 F5:1 Eb5:1 |
        D5/Bb2+F3+Ab3:1 C5:1 Bb4:1 Ab4/Bb2+D3+F3:1 G4:1 F4:1 |
        Bb5~Ab5~G5~F5/Eb2+Bb2:1 Eb5~D5~C5~Bb4:1 Ab4~G4~F4~Eb4:1 D4~Eb4/Bb1+Bb2:1 F4:1 Bb4:1 |
        Eb4+G4+Bb4/Eb2+Bb2+Eb3:2 r:1
      `,
    },
    {
      name: '제2주제 재현 · ff',
      tempo: 0.95,
      notes: `
        Bb3+Bb4/Eb1+Eb2:2 Eb4+Eb5:1 D4+D5/Bb1+Bb2:2 C4+C5:1 |
        Bb3+Bb4/Ab1+Ab2:2 G3+G4:1 Ab3+Ab4/Bb1+Bb2:2 F3+F4:1 |
        G3+G4+Bb4/Eb2+Bb2:2 Bb4+Bb5:1 Eb5+Eb6/G1+G2:2 D5+D6:1 |
        C5+Eb5+C6/C2+C3:3 Bb4+D5+Bb5/D2+D3:3 |
        G4+Bb4+D5+G5/G1+G2:3 r:1
      `,
    },
    {
      name: '제1주제 회상',
      tempo: 0.9,
      notes: `
        D4:1 |
        G4/G2+D3+G3:2 Bb4:1 A4/D3+G3:1 G4:1 F#4:1 |
        G4/Eb2+Bb2+G3:2 Bb4:1 D5/Eb3+G3:2 C5:1 |
        Bb4/D2+D3+G3:2 A4:1 G4/D3+F#3:1 F#4:1 A4:1 |
        G4/G2+D3+Bb3:2 D5:1 Eb5/C3+G3:2 F#4:1 |
        G4+D5/G2+D3+Bb3:2 D3+D4/D1+D2:2 r:1
      `,
    },
    {
      name: 'Presto con fuoco · 코다',
      tempo: 1.45,
      notes: `
        G4~D5/G1+G2:1 C5~Bb4:1 A4~G4:1 F#4~A4:1 C5~Eb5:1 D5~C5:1 |
        Bb4~D5/Eb2+Eb3:1 C5~Bb4:1 A4~G4:1 F#4~A4:1 C5~Eb5:1 D5~C5:1 |
        G4~Bb4/G1+G2:1 D5~G5:1 Bb5~A5:1 G5~F#5:1 Eb5~D5:1 C5~A4:1 |
        Bb4~D5/D2+D3:1 G5~Bb5:1 A5~G5:1 F#5~D5:1 C5~A4:1 F#4~D4:1 |
        G4+Bb4+D5+G5/G1+G2:1 r:0.5 G4+Bb4+D5+G5/G1+G2:1 r:0.5 |
        Eb4+G4+C5+Eb5/C2+C3:1 D4+F#4+A4+D5/D2+D3:1 |
        G4+Bb4+D5+G5/G1+G2:1 r:0.5 Eb4+G4+C5+Eb5/C2+C3:1 D4+F#4+A4+D5/D2+D3:1 r:0.5 |
        G5+G6~F#5+F#6~F5+F6~Eb5+Eb6/G2:1 D5+D6~C#5+C#6~C5+C6~Bb4+Bb5:1 |
        A4+A5~Ab4+Ab5~G4+G5~F#4+F#5:1 F4+F5~Eb4+Eb5~D4+D5~C#4+C#5:1 |
        C4+C5~Bb3+Bb4~A3+A4~Ab3+Ab4:1 G3+G4~F#3+F#4~F3+F4~Eb3+Eb4:1 |
        D3+D4/D1+D2:2 |
        Eb4+G4+C5/C2+C3:1 D4+F#4+A4+C5/D2+D3:1 G3+Bb3+D4+G4/G1+G2:2 |
        G2+G3+Bb3+D4/G1:2 G1+G2+D3+G3:3
      `,
    },
  ],
});
