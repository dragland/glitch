#!/bin/bash

# Install (or update) glitch on an Omarchy machine. Safe to re-run: it links
# this checkout into place, so `git pull && ./install.sh` is an update.
#
#   ./install.sh                 everything
#   ./install.sh --no-mind       skip the local decision model (orb uses reactions.json)
#   ./install.sh --no-voxtype    don't touch voxtype's config
#   ./install.sh --no-remote     skip remote control (sessions from the Claude app)
#   ./install.sh --no-desktop    skip desktop control (agents' clicks and keys)
#
# Only desktop control needs root, once (ydotool and /dev/uinput). Downloads
# (~1.3 GB with the mind) go to ~/.local/share/glitch, pinned and checksummed
# in this file.

set -euo pipefail

REPO=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/glitch"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN_ID=dragland.glitch

LLAMA_BUILD=b11552
LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_BUILD/llama-$LLAMA_BUILD-bin-ubuntu-vulkan-x64.tar.gz"
LLAMA_SHA=c7bb933f3584b73296fbadea6e0d6273ddb7907699ec59ef08d0bb59e0a8b997
MODEL=Qwen3-1.7B-Q4_K_M.gguf
MODEL_URL="https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/$MODEL"
MODEL_SHA=b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897
VOICE=en_US-kristin-medium
VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/kristin/medium/$VOICE"
VOICE_SHA=5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4
VOICE_JSON_SHA=5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c

with_mind=1
tweak_voxtype=1
with_remote=1
with_desktop=1
for arg in "$@"; do
  case "$arg" in
  --no-mind) with_mind=0 ;;
  --no-voxtype) tweak_voxtype=0 ;;
  --no-remote) with_remote=0 ;;
  --no-desktop) with_desktop=0 ;;
  -h | --help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '    %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

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
  local url=$1 out=$2 sha=$3
  if [[ ! -s $out ]]; then
    ok "downloading $(basename "$out")"
    curl -fL --progress-bar -o "$out.part" "$url"
    mv "$out.part" "$out"
  fi
  echo "$sha  $out" | sha256sum -c --quiet - || die "checksum mismatch for $out (delete it and re-run)"
  ok "have ${out/#$HOME/~}"
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
if [[ -n ${agent:-} && $agent != claude ]]; then
  echo "    note: glitch drives Claude Code (your Omarchy default agent '$agent' has no glitch adapter yet)."
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
# Exact versions from uv.lock, on a uv-managed Python (.python-version) so an
# Arch Python upgrade can't break the venv.
UV_PROJECT_ENVIRONMENT="$DATA/venv" uv sync --locked --managed-python --quiet --project "$REPO"
ok "synced from uv.lock"

step "Voice"
mkdir -p "$DATA/voices"
fetch "$VOICE_URL.onnx" "$DATA/voices/$VOICE.onnx" "$VOICE_SHA"
fetch "$VOICE_URL.onnx.json" "$DATA/voices/$VOICE.onnx.json" "$VOICE_JSON_SHA"

if ((with_mind)); then
  step "Mind (llama.cpp $LLAMA_BUILD + $MODEL)"
  mkdir -p "$DATA/models"
  if [[ ! -x $DATA/llama/llama-server || $(cat "$DATA/llama/BUILD" 2>/dev/null) != "$LLAMA_BUILD" ]]; then
    tmp=$(mktemp -d)
    curl -fL --progress-bar -o "$tmp/llama.tgz" "$LLAMA_URL"
    echo "$LLAMA_SHA  $tmp/llama.tgz" | sha256sum -c --quiet - || die "checksum mismatch for the llama.cpp download"
    tar xzf "$tmp/llama.tgz" -C "$tmp"
    rm -rf "$DATA/llama"
    mv "$tmp/llama-$LLAMA_BUILD" "$DATA/llama"
    echo "$LLAMA_BUILD" >"$DATA/llama/BUILD"
    rm -rf "$tmp"
  fi
  ok "have llama.cpp $LLAMA_BUILD"
  fetch "$MODEL_URL" "$DATA/models/$MODEL" "$MODEL_SHA"
  if [[ ! -s $DATA/mind.key ]]; then
    (umask 077 && head -c 24 /dev/urandom | base64 | tr -d '/+=' >"$DATA/mind.key")
    ok "created an API key for glitch-mind"
  fi
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
qsb_out="$REPO/plugin/glitch.frag.qsb"
if [[ ! -s $qsb_out || $REPO/plugin/orb.glsl -nt $qsb_out ]]; then
  # After a git pull, mtimes can make the committed glitch.frag.qsb look older than orb.glsl.
  if "$REPO/plugin/build-shader"; then
    ok "compiled orb.glsl"
  elif [[ -s $qsb_out ]]; then
    ok "using the committed glitch.frag.qsb"
  else
    die "couldn't build the orb shader from orb.glsl"
  fi
else
  ok "glitch.frag.qsb is current"
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
ok "Super+D talk · Super+Alt+D talk in a new session · Super+Alt+Shift+D open session · Super+Alt+Backspace cancel"

if ((with_mind)); then
  step "Mind service"
  link "$REPO/systemd/glitch-mind.service" "$CONFIG/systemd/user/glitch-mind.service"
  systemctl --user daemon-reload
  systemctl --user enable glitch-mind.service >/dev/null 2>&1
  systemctl --user restart glitch-mind.service
  for _ in $(seq 1 30); do curl -fs localhost:8765/health >/dev/null 2>&1 && break; sleep 1; done
  curl -fs localhost:8765/health >/dev/null 2>&1 && ok "glitch-mind is up on :8765" || echo "    warning: glitch-mind isn't answering yet (journalctl --user -u glitch-mind)"
fi

if ((with_remote)); then
  step "Remote control (sessions from the Claude app)"
  for u in glitch-remote.service glitch-remote-reap.service glitch-remote-reap.timer; do
    link "$REPO/systemd/$u" "$CONFIG/systemd/user/$u"
  done
  systemctl --user daemon-reload
  # The service has no TTY for Claude's one-time "Enable Remote Control?"
  # (remoteDialogSeen, undocumented: re-check when Claude changes) or the trust
  # prompt for ~/Work; without both, the server exits and restarts every 30 s.
  if [[ -d $HOME/Work ]] && jq -e --arg dir "$HOME/Work" '.remoteDialogSeen and .projects[$dir].hasTrustDialogAccepted' \
    "$HOME/.claude.json" >/dev/null 2>&1; then
    # Start only a stopped server: a restart would cut off its sessions mid-turn.
    systemctl --user enable glitch-remote.service glitch-remote-reap.timer >/dev/null 2>&1 || true
    systemctl --user start glitch-remote-reap.timer >/dev/null 2>&1 || true
    if ! systemctl --user is-active --quiet glitch-remote.service; then
      systemctl --user start glitch-remote.service >/dev/null 2>&1 || true
      sleep 5 # a server that can't start (signed out, folder already served) exits within seconds
    fi
    if systemctl --user is-active --quiet glitch-remote.service; then
      ok "$(hostname) shows up in the Claude app (Code tab)"
    else
      echo "    warning: glitch-remote isn't running (journalctl --user -u glitch-remote)"
    fi
  else
    echo "    one-time setup: run  cd ~/Work && claude remote-control"
    echo "    answer y and trust the folder, Ctrl+C once it's up, then re-run ./install.sh"
  fi
fi

step "Phone portal"
link "$REPO/systemd/glitch-portal.service" "$CONFIG/systemd/user/glitch-portal.service"
systemctl --user daemon-reload
{ read -r p_addr; read -r p_port; read -r p_cert; read -r p_key; } < <(
  set +u
  {
    . "$REPO/config/glitch.conf"
    [[ -f $CONFIG/glitch/glitch.conf ]] && . "$CONFIG/glitch/glitch.conf"
  } >/dev/null
  printf '%s\n' "$PORTAL_ADDR" "$PORTAL_PORT" "$PORTAL_CERT" "$PORTAL_KEY"
)
if [[ -z $p_addr ]]; then
  ok "off (to use it: set PORTAL_ADDR in ~/.config/glitch/glitch.conf, run glitch cert, install its CA file on the phone, re-run ./install.sh)"
elif [[ ! -f $DATA/portal/glitch-ca.crt || ! -f $p_cert || ! -f $p_key ]]; then
  ok "off until there's a certificate: run glitch cert, install its CA file on the phone, re-run ./install.sh"
else
  systemctl --user enable glitch-portal.service >/dev/null 2>&1 || true
  # Safe mid-turn: KillMode=process leaves a running phone turn alone.
  systemctl --user restart glitch-portal.service >/dev/null 2>&1 || true
  sleep 2
  if systemctl --user is-active --quiet glitch-portal.service; then
    ok "https://$p_addr:$p_port (pair a phone: glitch pair)"
  else
    echo "    warning: glitch-portal isn't running (journalctl --user -u glitch-portal)"
  fi
  # Opening the port and routing it over Tailscale need root (or the Tailscale
  # operator), so they're the owner's to run.
  todo=()
  lan=$(ip -j -4 addr show 2>/dev/null | jq -r --arg a "$p_addr" \
    '.[] | select(.ifname != "tailscale0") | .addr_info[] | select(.local == $a) | .prefixlen' | head -1)
  if [[ -z $lan ]]; then
    echo "    warning: $p_addr (PORTAL_ADDR) isn't an address of this machine (ip -4 addr)"
  elif command -v ufw >/dev/null; then
    IFS=. read -r a b c d <<<"$p_addr"
    n=$(((a << 24 | b << 16 | c << 8 | d) & (0xffffffff << (32 - lan)) & 0xffffffff))
    lan="$((n >> 24)).$((n >> 16 & 255)).$((n >> 8 & 255)).$((n & 255))/$lan"
    # ufw saves each rule in user.rules as "### tuple ### allow tcp <port> <dst> any <src> in[_<iface>]".
    rules=$(cat /etc/ufw/user.rules 2>/dev/null)
    grep -q "^### tuple ### allow tcp $p_port 0\.0\.0\.0/0 any ${lan//./\\.} in\b" <<<"$rules" ||
      todo+=("sudo ufw allow from $lan to any port $p_port proto tcp comment 'glitch portal LAN'")
    grep -q "^### tuple ### allow tcp $p_port 0\.0\.0\.0/0 any 0\.0\.0\.0/0 in_tailscale0\b" <<<"$rules" ||
      todo+=("sudo ufw allow in on tailscale0 to any port $p_port proto tcp comment 'glitch portal Tailscale'")
  fi
  if command -v tailscale >/dev/null; then
    # --advertise-routes replaces the whole list, so repeat the routes already advertised.
    prefs=$(tailscale debug prefs 2>/dev/null) || prefs='{"AdvertiseRoutes":["<routes it already advertises>"]}'
    routes=$(jq -r --arg r "$p_addr/32" '.AdvertiseRoutes // [] | if index([$r]) then "" else . + [$r] | join(",") end' <<<"$prefs")
    ts="sudo "
    [[ $(jq -r '.OperatorUser // ""' <<<"$prefs") == "$(id -un)" ]] && ts=
    [[ -n $routes ]] && todo+=("${ts}tailscale set --advertise-routes=$routes")
  fi
  if ((${#todo[@]})); then
    echo "    to reach it from the phone, run:"
    printf '      %s\n' "${todo[@]}"
    [[ ${todo[*]} == *advertise-routes* ]] &&
      echo "    then approve the $p_addr/32 route in the Tailscale admin console (Machines) and turn on Use Tailscale subnets in the phone's Tailscale app"
  fi
fi

if ((with_desktop)); then
  step "Desktop control (screenshots, windows, clicks and keys for agents)"
  if ! command -v ydotool >/dev/null || [[ ! -w /dev/uinput ]]; then
    if [[ -t 0 ]]; then root=sudo; else root=pkexec; fi
    if $root "$REPO/libexec/desktop-root"; then
      ok "installed ydotool; /dev/uinput is yours while you're logged in"
    else
      echo "    warning: desktop control needs root once; re-run ./install.sh (or --no-desktop)"
    fi
  fi
  link "$REPO/systemd/ydotool.service.d/glitch.conf" "$CONFIG/systemd/user/ydotool.service.d/glitch.conf"
  systemctl --user daemon-reload
  systemctl --user enable --now ydotool.service >/dev/null 2>&1 || true
  # Every Claude session (voice, phone, terminal) loads ~/.claude/rules.
  link "$REPO/config/desktop.md" "$HOME/.claude/rules/glitch-desktop.md"
  for _ in 1 2 3 4 5; do ydotool mousemove -x 0 -y 0 >/dev/null 2>&1 && break; sleep 0.5; done
  ydotool mousemove -x 0 -y 0 >/dev/null 2>&1 && ok "ydotool works" || echo "    warning: ydotool can't reach /dev/uinput (journalctl --user -u ydotool)"
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
omarchy restart shell >/dev/null 2>&1
for _ in $(seq 1 20); do omarchy-shell -q glitch ping >/dev/null 2>&1 && break; sleep 0.5; done
omarchy-shell -q glitch ping >/dev/null 2>&1 && ok "orb loaded" || die "the orb plugin didn't load (quickshell log -p \$OMARCHY_PATH/shell)"

step "Done"
echo "    Tap Super+D, talk, tap again. Try: \"what theme am I on?\""
echo "    Settings: ~/.config/glitch/glitch.conf · logs: \$XDG_RUNTIME_DIR/glitch/glitch.log"
