#!/usr/bin/env bash
# Mix voiceover lines with scene-aligned gaps into mixed.mp3
set -euo pipefail

DIR="$(cd "$(dirname "$0")/audio" && pwd)"
cd "$DIR"

# Scene start times (milliseconds) matching the composition
# Frame 1 Hook: 200ms, Frame 2 Gate: 4300ms, Frame 3 Escrow: 14300ms,
# Frame 4 Dispute: 24300ms, Frame 5 Verdict: 40300ms, Frame 6 Close: 50500ms
S1=200
S2=4300
S3=14300
S4=24300
S5=40300
S6=50500

ffmpeg -y \
  -i s1.mp3 -i s2.mp3 -i s3.mp3 -i s4.mp3 -i s5.mp3 -i s6.mp3 \
  -filter_complex "\
[0:a]adelay=${S1}:all=1,volume=1.0[a0];\
[1:a]adelay=${S2}:all=1,volume=1.0[a1];\
[2:a]adelay=${S3}:all=1,volume=1.0[a2];\
[3:a]adelay=${S4}:all=1,volume=1.0[a3];\
[4:a]adelay=${S5}:all=1,volume=1.0[a4];\
[5:a]adelay=${S6}:all=1,volume=1.0[a5];\
[a0][a1][a2][a3][a4][a5]amix=inputs=6:normalize=0:duration=longest[out]" \
  -map "[out]" -t 60 -c:a libmp3lame -b:a 192k mixed.mp3

echo "wrote mixed.mp3"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 mixed.mp3
