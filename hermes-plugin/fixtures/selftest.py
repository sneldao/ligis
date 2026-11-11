#!/usr/bin/env python3
"""Live self-test for the ligis plugin.

Reads the credential registry over raw JSON-RPC and asserts the demo matrix
holds. This is the gate the build plan refers to: if any row fails, the
plugin is not ready to ship.

Run from the plugin directory:

    python3 fixtures/selftest.py

Exit code 0 means every fixture reproduced. Non-zero means the plugin's
demo is not currently true and must not be recorded as working.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The plugin directory name contains a hyphen, so it cannot be imported by
# name. Load it under an alias instead.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from _loader import chains  # noqa: E402
from fixtures.subjects import DEMO_MATRIX  # noqa: E402

read_capability = chains.read_capability


def main() -> int:
    failures = 0
    print("ligis live self-test — read-only eth_call against public testnets\n")

    for row in DEMO_MATRIX:
        status = read_capability(row["subject"], row["capability"], row["chain"])
        actual = status.status
        expected = row["expect"]
        ok = actual == expected

        marker = "PASS" if ok else "FAIL"
        print(f"[{marker}] {row['label']}")
        print(f"       subject    {row['subject']}")
        print(f"       capability {row['capability']}")
        print(f"       chain      {row['chain']}")
        print(f"       expected   {expected}")
        print(f"       actual     {actual}")
        if status.issuer:
            print(f"       issuer     {status.issuer}")
        if status.capability_hash:
            print(f"       hash       {status.capability_hash}")
        if status.error:
            print(f"       error      {status.error}")
        print()

        if not ok:
            failures += 1

    total = len(DEMO_MATRIX)
    if failures:
        print(f"FAILED — {failures} of {total} fixtures did not reproduce.")
        return 1

    print(f"OK — all {total} fixtures reproduced live from the chain.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
