# Piano Tiles

브라우저에서 실행되는 피아노 타일 게임입니다. 빌드는 필요 없고, GitHub Pages나 아무 정적 웹 서버로 열면 됩니다
(예: `python3 -m http.server` 후 http://localhost:8000).
피아노 소리는 Salamander 그랜드 피아노 샘플(아래 '음원' 참고)을 씁니다. `index.html`을 파일로 직접 열면 브라우저가 샘플 로딩을 막아서 합성음으로 대신 연주합니다.

## 플레이 방법

- 내려오는 **검은 타일**만 탭/클릭하세요. 타일을 치면 그 순간의 음(양손, 화음이면 화음 전체)이 악보의 세기 그대로 울립니다.
- **난이도** (음악은 늘 원곡 박자로 흐르고, 바뀌는 건 '직접 치는 순간'의 수)
  - 기본: 중요한 순간만(최대 초당 약 3번). 사이의 음은 친 타일에 이어 제 박자에 자동으로 울림
  - 도전(기본값): 멜로디와 박을 거의 다(최대 초당 약 4번). 빠른 반주·꾸밈음만 자동
  - 마스터: 악보의 모든 순간을 직접(타일 하나 = 한 순간). 손으로 칠 수 없을 만큼 빠른 마디만 조금 늘림
  - 중요도는 마디 첫 박·박, 멜로디(높은 음), 세기, 화성 변화, 음 길이로 정합니다.
- **줄 배치는 피아노 롤처럼 음높이를 따릅니다**: 낮은 음은 왼쪽, 높은 음은 오른쪽(앞뒤 1.2초 음역을 4줄에 펼침). 음계처럼 한 방향으로 차례로 움직이는 곳은 계단처럼 쓸어 올라가거나(1→2→3→4) 내려옵니다(4→3→2→1).
- 템포는 악보의 지시어(Lento, Moderato, ritenuto, agitato, sempre più mosso, calando, Meno mosso, rall., più animato, animato, con forza, Presto con fuoco, accel. …)를 따릅니다(`tools/tempo/ballade-1.json`). 점점 빠르게·느리게는 여러 마디에 걸쳐 서서히 바뀌고, 플레이 중 화면에 지시어가 표시됩니다.
- 타일 높이는 다음 타일까지의 시간에 비례합니다. (마스터) 손으로 칠 수 없을 만큼 빠른 마디는 음 하나가 아니라 마디 전체를 같은 비율(최대 1.4배)로 늘려서 리듬 비율을 지키고, 앞뒤 마디로 서서히 이어지게 합니다.
- 트릴·꾸밈음·펼침화음(음 간격 95ms 미만)은 늘리면 떨림이 사라지므로, 최대 8음/0.45초씩 한 타일에 묶어 원래 속도로 울립니다.
- 코다 끝처럼 12음 이상 이어지며 한 옥타브 넘게 쓸고 가는 빠른 음계는 트릴과 구분해, 초당 약 9음으로 늦추고(앞뒤 마디는 서서히) 계단처럼 쓸어 가는 타일을 직접 칩니다.
- 음악은 노란 판정선을 기준으로 흐릅니다. 타일을 미리 쳐 두면 그 음이 제 박자에 울립니다.
- 악보 MIDI에는 페달이 없어서, 화성이 바뀌는 곳에서 다시 밟는 페달과 손가락 레가토를 자동으로 붙입니다(`tools/midi2chart.js`의 `markPedal`).
- 빈 칸을 누르거나 타일을 놓치면 실패합니다.
- 키보드: `D` `F` `J` `K` = 1~4번 줄, `Esc` = 일시정지, 결과 화면에서 `Enter` = 다시 하기
- **일시정지**: 오른쪽 위 버튼이나 `Esc`. 계속하기(3·2·1 카운트다운 후 이어서), 다시 하기, 메인 메뉴, 구간 바로가기를 고를 수 있습니다. 다른 앱·탭으로 넘어가면 자동으로 일시정지됩니다.
- **긴 타일**(가운데 선이 있는 타일)은 누르고 있으면 보너스 점수를 받습니다.
- 속도: 느리게(0.75배) / 보통 / 빠르게(1.25배)
- **구간 바로가기**: 메뉴에서 구간(예: 코다)을 누르면 그 부분부터 바로 시작합니다. "이 구간만 치기"를 켜면 그 구간이 끝날 때 결과가 나오고, 끄면 곡 끝까지 이어집니다. 기록은 전곡을 처음부터 플레이했을 때만 저장됩니다.
- **연습 모드**를 켜면 틀려도 끝까지 진행됩니다(기록은 저장되지 않음).

## 수록곡

| 곡 | 파일 | 악보 데이터 |
| --- | --- | --- |
| 쇼팽 – 발라드 1번 G단조, Op. 23 (전곡, 약 10분) | `songs/chopin-ballade-1.js` | [ASAP dataset](https://github.com/fosfrancesco/asap-dataset) 악보 MIDI (CC BY-NC-SA 4.0) |

## 곡 추가하기

### MIDI에서 변환 (권장)

MIDI 파일이 있으면 변환기가 모든 음을 원래 리듬·세기 그대로 타일에 담습니다(Node.js 필요, 의존성 없음).
`--per-onset`을 주면 타일 하나 = 악보의 한 순간이 됩니다.

```bash
node tools/midi2chart.js 곡.mid --per-onset --id my-song --title "곡 제목" --composer "작곡가" \
  --sections "1:도입|17:1절|33:후렴" > songs/my-song.js
```

그다음 `index.html`의 곡 목록 주석 아래에 `<script src="songs/my-song.js"></script>` 한 줄을 추가합니다.

| 옵션 | 설명 |
| --- | --- |
| `--sections "마디:이름\|..."` | 구간 이름(화면 표시, 시작 구간 선택) |
| `--rate 2.3` | 원곡 템포에서의 목표 타일 속도(칸/초). 마디마다 이 값에 가장 가까운 타일 길이를 고름 |
| `--max-rows 4` | 새 음이 없는 구간을 합친 긴 타일의 최대 칸 수 |
| `--tracks 0,1` | 사용할 트랙 |
| `--credit "..."` | 출처 표기(메뉴에 표시) |
| `--difficulty 3` | 난이도 1~5 |

**악보(score) MIDI**를 쓰는 것이 좋습니다. 사람이 연주한 MIDI는 박자가 흔들려서 타일이 고르게 나뉘지 않습니다.
발라드 1번은 `sh tools/build-ballade-1.sh midi_score.mid`로 다시 만들 수 있습니다.

### 직접 쓰기 (간단한 곡)

```js
PianoTiles.registerSong({
  id: 'my-song',
  title: '곡 제목',
  composer: '작곡가',
  difficulty: 2,
  sections: [
    { name: '도입', tempo: 1, notes: `C4:1 D4:1 E4/C3+G3:2 r:1` },
  ],
});
```

| 표기 | 의미 |
| --- | --- |
| `G4:1` | G4 음, 1박 = 타일 1칸 |
| `G3+Bb3+D4:2` | 화음. 2박 이상은 긴 타일 |
| `G4~Bb4~D5:1` | 타일 하나에서 순서대로 연주 |
| `G4/G2+D3:1` | `/` 뒤는 왼손 반주 |
| `r:1` | 쉼표 |

음 이름은 `C D E F G A B` + `#`/`b` + 옥타브(가운데 도 = `C4`). 섹션의 `tempo`는 속도 배율(1 = 초당 2.4칸), `unit`은 타일 1칸의 박 수입니다.

## 작곡가 소개 추가하기

곡 카드의 "작곡가 소개" 버튼은 `composers/` 폴더의 정보를 보여줍니다. 새 작곡가는 파일을 만들고 `index.html`의 작곡가 주석 아래에 스크립트 한 줄을 추가하세요.

```js
PianoTiles.registerComposer({
  id: 'bach',                      // 곡 파일의 composerId 와 같게
  name: '요한 제바스티안 바흐',
  original: 'Johann Sebastian Bach',
  years: '1685 – 1750',
  origin: '독일',
  era: '바로크',
  bio: ['문단 1', '문단 2'],
  works: [
    { title: '평균율 클라비어 곡집', year: '1722', note: '한 줄 설명', song: 'bach-wtc-1' }, // song: 게임에 있는 곡이면 '플레이' 버튼이 생김
  ],
});
```

곡 파일에는 `composerId: 'bach'`를 넣습니다(변환기 옵션 `--composer-id bach`).

## 음원

`samples/salamander/`의 피아노 샘플은 [Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano)(Alexander Holm, Yamaha C5 그랜드, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/))에서 가져왔습니다. SFZ 매핑은 kinwie / sfzinstruments 작업입니다.
원본(48kHz/24bit, 16단계 세기, 단3도 간격)에서 8단계 세기(1–36, 37–50, 51–60, 61–76, 77–90, 91–100, 101–116, 117–127) × 30음을 스테레오 80kbps MP3로 줄이고 타건 지점에 맞춰 앞을 잘랐으며, 건반을 놓을 때의 댐퍼 소리 88개를 함께 씁니다(`tools/convert-salamander.py`, `manifest.json`).

## 라이선스 참고

발라드 1번 차트(`songs/chopin-ballade-1.js`)는 ASAP dataset(Foscarin et al., 2020)의 악보 MIDI에서 만들었으며, 원 데이터의 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 조건(출처 표기, 비상업적 이용, 동일 조건 변경 허락)을 따릅니다.
