#!/usr/bin/env bash
# scripts/setup-git.sh — initialize the local git repo and wire the pre-commit
# secret-scan hook. Safe to re-run: it does not destroy existing commits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# 1. Make hooks executable
chmod +x "$ROOT_DIR/.githooks/pre-commit"
chmod +x "$ROOT_DIR/tools/secret-scan.sh"

# 2. Initialize git if needed
if [[ ! -d "$ROOT_DIR/.git" ]]; then
  echo "→ git init"
  git init -b main
  git config user.name "${GIT_USER_NAME:-pharos-skill}" || true
  git config user.email "${GIT_USER_EMAIL:-pharos-skill@local}" || true
fi

# 3. Point core.hooksPath at .githooks (so the pre-commit hook is used)
echo "→ git config core.hooksPath .githooks"
git config core.hooksPath .githooks

# 4. Pre-create the baseline file (empty) so the hook can update it later
if [[ ! -f "$ROOT_DIR/.secrets.baseline" ]]; then
  cat > "$ROOT_DIR/.secrets.baseline" <<'EOF'
# Secret-scan baseline. Each line: <fingerprint>  <rule>  <file:line>
# Regenerate with: bash tools/secret-scan.sh --update-baseline
EOF
  echo "→ wrote .secrets.baseline"
fi

# 5. Optional: enable git-secrets / gitleaks if installed
if command -v gitleaks >/dev/null 2>&1; then
  echo "→ gitleaks detected ($(gitleaks version 2>/dev/null | head -1))"
  echo "  The pre-commit hook will use it for a more thorough scan."
else
  echo "→ gitleaks not installed (using built-in scanner)"
  echo "  Tip: brew install gitleaks   # for better secret detection"
fi

# 6. First commit (only if there are no commits yet)
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo
  echo "→ Making first commit..."
  git add -A
  if git commit -m "Initial commit: Ligis

  - 2 Solidity contracts (PharosAgentID + CredentialRegistry)
  - 35 Foundry tests, all passing
  - CLI (7 commands) + MCP server (6 tools)
  - SKILL.md + 6 references
  - install.sh + deploy/verify/demo scripts
  - Pre-commit secret-scan hook

  Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"; then
    echo "→ Initial commit created."
  else
    echo "→ Initial commit blocked by secret-scan. Resolve and re-run." >&2
    exit 1
  fi
fi

echo
echo "✓ Git setup complete."
echo "  hooks path:  $(git config core.hooksPath)"
echo "  repo root:   $ROOT_DIR"
echo
echo "Next:"
echo "  git status            # verify nothing sensitive is staged"
echo "  git log --oneline     # confirm the initial commit"
echo "  git remote add origin <url>   # when you're ready to push"
