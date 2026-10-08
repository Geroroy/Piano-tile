#!/bin/sh
# 쇼팽 발라드 1번 차트 재생성
# MIDI 출처: ASAP dataset (CC BY-NC-SA 4.0)
#   https://raw.githubusercontent.com/fosfrancesco/asap-dataset/master/Chopin/Ballades/1/midi_score.mid
# 사용법: sh tools/build-ballade-1.sh midi_score.mid
set -e
node "$(dirname "$0")/midi2chart.js" "$1" --id chopin-ballade-1 --title "발라드 1번 G단조" --composer "F. Chopin · Op. 23" --composer-id chopin --difficulty 5 \
  --credit "ASAP dataset (Foscarin et al., 2020) 악보 MIDI, CC BY-NC-SA 4.0 — https://github.com/fosfrancesco/asap-dataset" \
  --sections "1:Largo · 서주|8:Moderato · 제1주제|36:전개|44:아지타토|68:Meno mosso · 제2주제|94:제1주제 변형|106:제2주제 · A장조 클라이맥스|126:전환부|138:왈츠 · E♭장조|166:제2주제 재현|194:제1주제 재현|208:Presto con fuoco · 코다" \
  > "$(dirname "$0")/../songs/chopin-ballade-1.js"
