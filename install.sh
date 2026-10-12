#!/bin/bash

# Install (or update) glitch on an Omarchy machine. Safe to re-run: it links
# this checkout into place, so `git pull && ./install.sh` is an update.
#
#   ./install.sh                 everything
#   ./install.sh --no-mind       skip the local decision model (orb uses reactions.json)
#   ./install.sh --no-voxtype    don't touch voxtype's config
#
# Nothing here needs sudo. Downloads (~1.9 GB with the mind) go to
# ~/.local/share/glitch, pinned to the versions below.

set -euo pipefail

REPO=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/glitch"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN_ID=dragland.glitch

LLAMA_BUILD=b11552
LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_BUILD/llama-$LLAMA_BUILD-bin-ubuntu-vulkan-x64.tar.gz"
MODEL=Qwen3-1.7B-Q4_K_M.gguf
MODEL_URL="https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/$MODEL"
VOICE=en_US-kristin-medium
VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/$VOICE"

with_mind=1
tweak_voxtype=1
for arg in "$@"; do
  case "$arg" in
  --no-mind) with_mind=0 ;;
  --no-voxtype) tweak_voxtype=0 ;;
  -h | --help) sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '    %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Point $2 at $1, replacing an older link but never a real file.
link() {
  local target=$1 path=$2
  mkdir -p "$(dirname "$path")"
  if [[ -e $path && ! -L $path ]]; then
    die "$path exists and isn't a symlink; move it aside and re-run"
  fi
  ln -sfn "$target" "$path"
  ok "${path/#$HOME/~} -> ${target/#$HOME/~}"
}

fetch() {
  local url=$1 out=$2
  [[ -s $out ]] && { ok "have ${out/#$HOME/~}"; return; }
  ok "downloading $(basename "$out")"
  curl -fL --progress-bar -o "$out.part" "$url" && mv "$out.part" "$out"
}

step "Checking requirements"
command -v omarchy-shell >/dev/null || die "this needs Omarchy 4 (omarchy-shell not found)"
for cmd in jq curl pw-play hyprctl; do
  command -v "$cmd" >/dev/null || die "missing $cmd"
done
if ! command -v voxtype >/dev/null; then
  die "voxtype (dictation) isn't installed; run: omarchy-voxtype-install"
fi
agent=$(omarchy-default-agent 2>/dev/null || true)
if [[ ${agent:-} != claude ]]; then
  echo "    note: glitch drives Claude Code; your Omarchy default agent is '${agent:-unset}'."
  echo "          Set it with: omarchy default agent claude"
fi
command -v claude >/dev/null || echo "    note: claude isn't on PATH yet; install Claude Code before talking to glitch"
if ! command -v uv >/dev/null; then
  command -v mise >/dev/null || die "need uv (or mise to install it): https://docs.astral.sh/uv/"
  mise use -g uv@latest >/dev/null
  eval "$(mise env -s bash)"
  ok "installed uv with mise"
fi
ok "ok"

step "Python environment (Piper voice, beep synth, decision client)"
mkdir -p "$DATA"
# Exact versions from uv.lock, into glitch's own venv (uv fetches a Python if needed).
UV_PROJECT_ENVIRONMENT="$DATA/venv" uv sync --frozen --quiet --project "$REPO"
ok "synced from uv.lock"

step "Voice"
mkdir -p "$DATA/voices"
fetch "$VOICE_URL.onnx" "$DATA/voices/$VOICE.onnx"
fetch "$VOICE_URL.onnx.json" "$DATA/voices/$VOICE.onnx.json"

if ((with_mind)); then
  step "Mind (llama.cpp $LLAMA_BUILD + $MODEL)"
  mkdir -p "$DATA/models"
  if [[ ! -x $DATA/llama/llama-server || $(cat "$DATA/llama/BUILD" 2>/dev/null) != "$LLAMA_BUILD" ]]; then
    tmp=$(mktemp -d)
    curl -fL --progress-bar -o "$tmp/llama.tgz" "$LLAMA_URL"
    tar xzf "$tmp/llama.tgz" -C "$tmp"
    rm -rf "$DATA/llama"
    mv "$tmp/llama-$LLAMA_BUILD" "$DATA/llama"
    echo "$LLAMA_BUILD" >"$DATA/llama/BUILD"
    rm -rf "$tmp"
  fi
  ok "have llama.cpp $LLAMA_BUILD"
  fetch "$MODEL_URL" "$DATA/models/$MODEL"
fi

step "Linking code into place"
link "$REPO/bin/glitch" "$HOME/.local/bin/glitch"
link "$REPO/plugin" "$CONFIG/omarchy/plugins/$PLUGIN_ID"
link "$REPO/hypr/glitch.lua" "$CONFIG/hypr/glitch.lua"
mkdir -p "$CONFIG/glitch"
if [[ ! -f $CONFIG/glitch/glitch.conf ]]; then
  printf '# Your glitch overrides (see %s/config/glitch.conf for every setting).\n' "$REPO" >"$CONFIG/glitch/glitch.conf"
  ok "created ~/.config/glitch/glitch.conf"
fi

step "Orb shader"
if [[ -x /usr/lib/qt6/bin/qsb ]]; then
  /usr/lib/qt6/bin/qsb --qt6 -o "$REPO/plugin/glitch.frag.qsb" "$REPO/plugin/glitch.frag"
  ok "compiled glitch.frag"
elif [[ -s $REPO/plugin/glitch.frag.qsb ]]; then
  ok "using the prebuilt glitch.frag.qsb (install qt6-shadertools to rebuild)"
else
  die "no glitch.frag.qsb and no qsb to build it (pacman -S qt6-shadertools)"
fi

step "Keybindings"
hypr="$CONFIG/hypr/hyprland.lua"
if ! grep -q 'require("hypr.glitch")' "$hypr"; then
  cp "$hypr" "$hypr.bak.$(date +%s)"
  printf '\n-- glitch voice companion (%s)\nrequire("hypr.glitch")\n' "$REPO" >>"$hypr"
  ok "added require(\"hypr.glitch\") to ~/.config/hypr/hyprland.lua"
fi
hyprctl reload >/dev/null
if [[ -n $(hyprctl configerrors 2>/dev/null | tr -d '[:space:]') ]]; then
  hyprctl configerrors
  die "Hyprland reports config errors (see above)"
fi
ok "Super+D talk · Super+Alt+D talk in a new session · Super+Alt+Shift+D open session"

if ((with_mind)); then
  step "Mind service"
  link "$REPO/systemd/glitch-mind.service" "$CONFIG/systemd/user/glitch-mind.service"
  systemctl --user daemon-reload
  systemctl --user enable glitch-mind.service >/dev/null 2>&1
  systemctl --user restart glitch-mind.service
  for _ in $(seq 1 30); do curl -fs localhost:8765/health >/dev/null 2>&1 && break; sleep 1; done
  curl -fs localhost:8765/health >/dev/null 2>&1 && ok "glitch-mind is up on :8765" || echo "    warning: glitch-mind isn't answering yet (journalctl --user -u glitch-mind)"
fi

if ((tweak_voxtype)); then
  step "Voxtype"
  vt=0
  if (($(voxtype config get audio.max_duration_secs 2>/dev/null | grep -o '[0-9]*' | head -1 || echo 0) < 600)); then
    voxtype config set audio.max_duration_secs 600 >/dev/null && vt=1 && ok "recording limit: 10 minutes"
  fi
  if ! voxtype config get whisper.initial_prompt 2>/dev/null | grep -qi omarchy; then
    voxtype config set whisper.initial_prompt "Omarchy, Hyprland, Claude, Claude Code, Codex, Quickshell, voxtype, Neovim, GitHub, glitch." >/dev/null && vt=1 && ok "vocabulary hint for Whisper"
  fi
  ((vt)) && systemctl --user restart voxtype && ok "restarted voxtype"
  ((vt)) || ok "already tuned"
fi

step "Shell plugin"
omarchy-shell -q shell rescanPlugins >/dev/null 2>&1 || true
sleep 1
omarchy plugin enable "$PLUGIN_ID" >/dev/null
# The orb is a keepLoaded panel, which only picks up new code on a shell restart.
omarchy restart shell >/dev/null 2>&1
for _ in $(seq 1 20); do omarchy-shell -q glitch ping >/dev/null 2>&1 && break; sleep 0.5; done
omarchy-shell -q glitch ping >/dev/null 2>&1 && ok "orb loaded" || die "the orb plugin didn't load (quickshell log -p \$OMARCHY_PATH/shell)"

step "Done"
echo "    Tap Super+D, talk, tap again. Try: \"what theme am I on?\""
echo "    Settings: ~/.config/glitch/glitch.conf · logs: \$XDG_RUNTIME_DIR/glitch/glitch.log"
