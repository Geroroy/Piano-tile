# Piano Tiles

브라우저에서 바로 실행되는 피아노 타일 게임입니다. 빌드나 설치 없이 `index.html`을 열면 됩니다(GitHub Pages로도 바로 배포됩니다).
음원 파일 없이 Web Audio로 피아노 소리를 합성합니다.

## 플레이 방법

- 내려오는 **검은 타일**만 탭/클릭하세요. 타일을 칠 때마다 그 구간의 원곡(양손)이 악보의 리듬과 세기 그대로 연주됩니다.
- 빈 칸을 누르거나 타일을 놓치면 실패합니다.
- 키보드: `D` `F` `J` `K` = 1~4번 줄, `Esc` = 메뉴, 결과 화면에서 `Enter` = 다시 하기
- **긴 타일**(가운데 선이 있는 타일)은 누르고 있으면 보너스 점수를 받습니다.
- 속도: 느리게(0.75배) / 원곡 속도 / 빠르게(1.3배). 스크롤 속도는 악보의 템포 변화를 따라갑니다.
- **구간 바로가기**: 메뉴에서 구간(예: 코다)을 누르면 그 부분부터 바로 시작합니다. "이 구간만 치기"를 켜면 그 구간이 끝날 때 결과가 나오고, 끄면 곡 끝까지 이어집니다. 기록은 전곡을 처음부터 플레이했을 때만 저장됩니다.
- **연습 모드**를 켜면 틀려도 끝까지 진행됩니다(기록은 저장되지 않음).

## 수록곡

| 곡 | 파일 | 악보 데이터 |
| --- | --- | --- |
| 쇼팽 – 발라드 1번 G단조, Op. 23 (전곡, 약 9분) | `songs/chopin-ballade-1.js` | [ASAP dataset](https://github.com/fosfrancesco/asap-dataset) 악보 MIDI (CC BY-NC-SA 4.0) |

## 곡 추가하기

### MIDI에서 변환 (권장)

MIDI 파일이 있으면 변환기가 모든 음을 원래 리듬·세기 그대로 타일에 나눠 담습니다(Node.js 필요, 의존성 없음).

```bash
node tools/midi2chart.js 곡.mid --id my-song --title "곡 제목" --composer "작곡가" \
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

## 라이선스 참고

발라드 1번 차트(`songs/chopin-ballade-1.js`)는 ASAP dataset(Foscarin et al., 2020)의 악보 MIDI에서 만들었으며, 원 데이터의 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 조건(출처 표기, 비상업적 이용, 동일 조건 변경 허락)을 따릅니다.
