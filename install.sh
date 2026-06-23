#!/usr/bin/env bash
# Install the Ligis Skill for Claude Code, Codex, or other Agent Skills-compatible
# coding agents. Idempotent. Skips same-named skills unless --force is passed.
#
# Usage:
#   ./install.sh                       # install all skills (Claude Code default)
#   ./install.sh --claude              # same as default
#   ./install.sh --codex               # install to Codex skill directory
#   ./install.sh --all                 # install for both
#   ./install.sh --force               # overwrite existing same-named skills
#   ./install.sh --prune-managed       # remove other managed skills (DANGEROUS)
#   ./install.sh --target /custom/path # install to a custom directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET=""
TARGETS=()
FORCE=0
PRUNE_MANAGED=0

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --claude)
      TARGETS+=("claude")
      shift
      ;;
    --codex)
      TARGETS+=("codex")
      shift
      ;;
    --all)
      TARGETS=("claude" "codex")
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --prune-managed)
      PRUNE_MANAGED=1
      shift
      ;;
    --target)
      TARGET="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 && -z "$TARGET" ]]; then
  # Default: Claude Code
  TARGETS=("claude")
fi

resolve_target_dir() {
  local kind="$1"
  case "$kind" in
    claude)
      echo "${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
      ;;
    codex)
      echo "${CODEX_SKILLS_DIR:-$HOME/.codex/skills}"
      ;;
    *)
      echo "Unknown target kind: $kind" >&2
      return 1
      ;;
  esac
}

install_to() {
  local dest="$1"
  local label="${2:-$dest}"

  mkdir -p "$dest"

  local installed=0
  local skipped=0
  local failed=0

  # The Skill is shipped as a single directory. The agent picks it up by name.
  # We copy the whole repo (it's small) so the agent has SKILL.md, references/,
  # assets/, scripts/, and the deployable contracts.
  for item in SKILL.md README.md LICENSE package.json tsconfig.json foundry.toml remappings.txt \
              references assets scripts src test .gitignore; do
    if [[ -e "$SCRIPT_DIR/$item" ]]; then
      if [[ -e "$dest/$item" && $FORCE -eq 0 ]]; then
        skipped=$((skipped + 1))
        continue
      fi
      rm -rf "$dest/$item"
      cp -R "$SCRIPT_DIR/$item" "$dest/$item"
      installed=$((installed + 1))
    fi
  done

  # Make scripts executable
  if [[ -d "$dest/scripts" ]]; then
    chmod +x "$dest/scripts"/*.sh 2>/dev/null || true
  fi
  chmod +x "$dest/install.sh" 2>/dev/null || true

  cat <<EOF

Installed to: $label
  Copied: $installed
  Skipped (already present, use --force to overwrite): $skipped
  Failed: $failed

Next steps:
  1. Open $label/SKILL.md - the entry point the Agent reads first.
  2. Run \`bash scripts/deploy.sh atlantic\` to deploy the contracts to Pharos Atlantic.
  3. The deployed addresses will be written to assets/deployment.json.
  4. The Agent can now use \`ligis-{issue,verify,revoke,rotate}\` from any task.

EOF
}

if [[ -n "$TARGET" ]]; then
  install_to "$TARGET" "$TARGET"
else
  for kind in "${TARGETS[@]}"; do
    dest="$(resolve_target_dir "$kind")"
    install_to "$dest" "$kind ($dest)"
  done
fi

if [[ $PRUNE_MANAGED -eq 1 ]]; then
  echo "WARNING: --prune-managed would remove other managed skills. This install does not currently support pruning." >&2
fi
