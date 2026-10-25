#!/usr/bin/env bash
# Pre-fetch the BN254 CRS prefix bb needs, over HTTPS. bb's built-in download
# uses plain http:// (crs.aztec-cdn.foundation), which some sandboxes/CI block;
# with this file present bb never hits the network. 2^20 points (32 MiB)
# covers this circuit (2^16-scale) with lots of headroom.
set -euo pipefail
dir="${CRS_PATH:-$HOME/.bb-crs}"
file="$dir/bn254_g1_compressed.dat"
bytes=$(( (1 << 20) * 32 ))
mkdir -p "$dir"
if [ -f "$file" ] && [ "$(wc -c < "$file")" -ge "$bytes" ]; then
  echo "CRS present: $file"; exit 0
fi
curl -fsSL -r "0-$((bytes - 1))" -o "$file.tmp" https://crs.aztec-cdn.foundation/g1_compressed.dat
mv "$file.tmp" "$file"
echo "CRS fetched: $file ($bytes bytes)"
