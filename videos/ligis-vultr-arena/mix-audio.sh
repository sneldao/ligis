#!/bin/sh
# Mix the final audio bed for ligis-vultr-arena:
#   music (60s, ducked) + 8 VO lines at scene times + SFX on the verdict stamps.
# Output: audio/mixed.mp3 (referenced by index.html).
set -eu
cd "$(dirname "$0")"
A=audio

ffmpeg -v error -y \
  -i $A/v1.mp3 -i $A/v2.mp3 -i $A/v3.mp3 -i $A/v4.mp3 \
  -i $A/v5.mp3 -i $A/v6.mp3 -i $A/v7.mp3 -i $A/v8.mp3 \
  -i $A/music.mp3 \
  -i $A/sfx-go.mp3 -i $A/sfx-stop.mp3 -i $A/sfx-stop.mp3 \
  -i $A/sfx-slide.mp3 -i $A/sfx-slide.mp3 \
  -filter_complex "
    [0:a]adelay=400|400[v1];
    [1:a]adelay=5500|5500[v2];
    [2:a]adelay=11600|11600[v3];
    [3:a]adelay=19350|19350[v4];
    [4:a]adelay=25400|25400[v5];
    [5:a]adelay=33400|33400[v6];
    [6:a]adelay=42400|42400[v7];
    [7:a]adelay=51100|51100[v8];
    [v1][v2][v3][v4][v5][v6][v7][v8]amix=inputs=8:normalize=0[vo];
    [8:a]volume='0.14*(1-0.75*between(t,18.9,20.6))':eval=frame,
         afade=t=in:st=0:d=1.2,afade=t=out:st=56.5:d=3.5[mus];
    [9:a]adelay=8650|8650,volume=0.45[g1];
    [10:a]adelay=19500|19500,volume=0.9[s1];
    [11:a]adelay=30900|30900,volume=0.8[s2];
    [12:a]adelay=13000|13000,volume=0.3[w1];
    [13:a]adelay=42000|42000,volume=0.3[w2];
    [vo][mus][g1][s1][s2][w1][w2]amix=inputs=7:normalize=0[mix]
  " \
  -map "[mix]" -t 60 -c:a libmp3lame -q:a 3 $A/mixed.mp3

ffprobe -v error -show_entries format=duration -of csv=p=0 $A/mixed.mp3
