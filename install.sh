#!/bin/bash

# Install (or update) glitch on an Omarchy machine. Safe to re-run: it links
# this checkout into place, so `git pull && ./install.sh` is an update.
#
#   ./install.sh                 everything
#   ./install.sh --no-mind       skip the local decision model (orb uses reactions.json)
#   ./install.sh --no-voxtype    don't touch voxtype's config
#   ./install.sh --no-desktop    skip desktop control (agents' clicks and keys)
#
# Remote control (sessions from the Claude app) and the phone portal are off until
# you turn them on: REMOTE=1 in ~/.config/glitch/glitch.conf, and `glitch phone`.
#
# Only desktop control needs root, once (ydotool and /dev/uinput). Downloads
# (~1.5 GB with the mind) go to ~/.local/share/glitch, pinned and checksummed
# in this file.

set -euo pipefail

REPO=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/glitch"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN_ID=dragland.glitch

LLAMA_BUILD=b11552
# One build per machine: Vulkan where a GPU driver offers it, else the CPU build
# (the model is small enough for either).
declare -A LLAMA_SHA=(
  [vulkan-x64]=c7bb933f3584b73296fbadea6e0d6273ddb7907699ec59ef08d0bb59e0a8b997
  [x64]=a45a6afda05d08028bd37998072ab602c96799bccde126835941623cb99bb727
  [vulkan-arm64]=c832d1e635d4abdc4de366b1540cf407ca3ed5c8c90a214e2cc1ae1d30c2b9d6
  [arm64]=8c5e5074c4e303308367471941b70a0f1fac4a1a35c7c67c0bec895d8df092f9
)
MODEL=Qwen3-1.7B-Q4_K_M.gguf
MODEL_URL="https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/$MODEL"
MODEL_SHA=b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897
VOICE=en_US-kristin-medium
VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/kristin/medium/$VOICE"
VOICE_SHA=5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4
VOICE_JSON_SHA=5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c
MUTTER=zh_CN-xiao_ya-medium
MUTTER_URL="https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/zh/zh_CN/xiao_ya/medium/$MUTTER"
MUTTER_SHA=cb2ce4ca1f5a36a7b23ae48f0651ce2c854c331ef7a804e5c5dc643d0f74f0e2
MUTTER_JSON_SHA=e1ec027b7065959643c1463705398d413ed4fdaa626d7d8ef1d12ab87e9a0320
# Piper's Chinese voices read characters with g2pW. Piper runs g2pW's config.py as code,
# and transformers fetches the tokenizer it names from huggingface.co unless that name
# is a local folder.
G2PW_URL="https://huggingface.co/datasets/rhasspy/piper-checkpoints/resolve/005db054ce8f013d8213b7dd4b0917de3c9347fe/zh/zh_CN/_resources/g2pw.tar.gz"
G2PW_SHA=252c6f561c11014fbb243d70aec993a816d82109887b91edcda0261ab9967060
BERT_URL="https://huggingface.co/google-bert/bert-base-chinese/resolve/8f23c25b06e129b6c986331a13d8d025a92cf0ea"
BERT_VOCAB_SHA=45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c
BERT_CONFIG_SHA=0f6d13e6f4da6f9e24f22ada6bc3be571123d858d7c0c05a8a7cd55a9c23c2e8

with_mind=1
tweak_voxtype=1
with_desktop=1
for arg in "$@"; do
  case "$arg" in
  --no-mind) with_mind=0 ;;
  --no-voxtype) tweak_voxtype=0 ;;
  --no-remote) echo "note: --no-remote is gone; remote control is off unless REMOTE=1 in ~/.config/glitch/glitch.conf" ;;
  --no-desktop) with_desktop=0 ;;
  -h | --help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

conf() (
  set +u
  {
    . "$REPO/config/glitch.conf"
    [[ -f $CONFIG/glitch/glitch.conf ]] && . "$CONFIG/glitch/glitch.conf"
  } >/dev/null
  printf '%s' "${!1}"
)

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
case $(uname -m) in
x86_64) arch=x64 ;;
aarch64) arch=arm64 ;;
*) arch= ;;
esac
if ((with_mind)) && [[ -z $arch ]]; then
  echo "    note: no llama.cpp build for $(uname -m); installing without the local model (as --no-mind)"
  with_mind=0
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
  # A Vulkan driver (an ICD) and the loader; a software rasteriser (lavapipe) alone is slower than the CPU build.
  variant=$arch
  if ldconfig -p 2>/dev/null | grep -q 'libvulkan\.so\.1' &&
    compgen -G '/usr/share/vulkan/icd.d/*.json' | grep -qv lvp; then
    variant=vulkan-$arch
  fi
  # An install from before there were variants wrote only the build, and was vulkan-x64.
  have=$(cat "$DATA/llama/BUILD" 2>/dev/null || true)
  [[ $have == "$LLAMA_BUILD" ]] && have="$LLAMA_BUILD vulkan-x64"
  if [[ ! -x $DATA/llama/llama-server || $have != "$LLAMA_BUILD $variant" ]]; then
    tmp=$(mktemp -d)
    curl -fL --progress-bar -o "$tmp/llama.tgz" \
      "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_BUILD/llama-$LLAMA_BUILD-bin-ubuntu-$variant.tar.gz"
    echo "${LLAMA_SHA[$variant]}  $tmp/llama.tgz" | sha256sum -c --quiet - || die "checksum mismatch for the llama.cpp download"
    tar xzf "$tmp/llama.tgz" -C "$tmp"
    rm -rf "$DATA/llama"
    mv "$tmp/llama-$LLAMA_BUILD" "$DATA/llama"
    echo "$LLAMA_BUILD $variant" >"$DATA/llama/BUILD"
    rm -rf "$tmp"
  fi
  ok "have llama.cpp $LLAMA_BUILD ($variant)"
  fetch "$MODEL_URL" "$DATA/models/$MODEL" "$MODEL_SHA"

  step "Mutter (Mandarin voice; the mind translates for it)"
  # Piper downloads its own g2pW, unpinned, when it finds the voice without one.
  g2pw="$DATA/voices/g2pW"
  if [[ $(cat "$g2pw/SHA" 2>/dev/null) != "$G2PW_SHA $BERT_VOCAB_SHA" ]]; then
    fetch "$G2PW_URL" "$DATA/voices/g2pw.tar.gz" "$G2PW_SHA"
    rm -rf "$g2pw.new"
    mkdir -p "$g2pw.new/bert-base-chinese"
    tar xzf "$DATA/voices/g2pw.tar.gz" -C "$g2pw.new"
    fetch "$BERT_URL/vocab.txt" "$g2pw.new/bert-base-chinese/vocab.txt" "$BERT_VOCAB_SHA"
    fetch "$BERT_URL/tokenizer_config.json" "$g2pw.new/bert-base-chinese/tokenizer_config.json" "$BERT_CONFIG_SHA"
    sed -i "s|^model_source = .*|model_source = '$g2pw/bert-base-chinese'|" "$g2pw.new/config.py"
    grep -qxF "model_source = '$g2pw/bert-base-chinese'" "$g2pw.new/config.py" || die "g2pW's config.py has no model_source line"
    echo "$G2PW_SHA $BERT_VOCAB_SHA" >"$g2pw.new/SHA"
    rm -rf "$g2pw"
    mv "$g2pw.new" "$g2pw"
    rm -f "$DATA/voices/g2pw.tar.gz"
  fi
  ok "have ${g2pw/#$HOME/~}"
  fetch "$MUTTER_URL.onnx" "$DATA/voices/$MUTTER.onnx" "$MUTTER_SHA"
  fetch "$MUTTER_URL.onnx.json" "$DATA/voices/$MUTTER.onnx.json" "$MUTTER_JSON_SHA"
  if [[ ! -s $DATA/mind.key ]]; then
    (umask 077 && head -c 24 /dev/urandom | base64 | tr -d '/+=' >"$DATA/mind.key")
    ok "created an API key for glitch-mind"
  fi
fi

step "Linking code into place"
link "$REPO/bin/glitch" "$HOME/.local/bin/glitch"
# `omarchy plugin add` clones the repo to this path; any other checkout is linked there.
[[ $REPO -ef $CONFIG/omarchy/plugins/$PLUGIN_ID ]] || link "$REPO" "$CONFIG/omarchy/plugins/$PLUGIN_ID"
link "$REPO/hypr/glitch.lua" "$CONFIG/hypr/glitch.lua"
mkdir -p "$CONFIG/glitch"
if [[ ! -f $CONFIG/glitch/glitch.conf ]]; then
  printf '# Your glitch overrides (see %s/config/glitch.conf for every setting).\n' "$REPO" >"$CONFIG/glitch/glitch.conf"
  ok "created ~/.config/glitch/glitch.conf"
fi

step "Orb shader"
qsb_out="$REPO/plugin/glitch.frag.qsb"
# Only for an edited orb.glsl: a rebuild of the committed one would leave the checkout
# changed, and `omarchy plugin update` pulls only into a clean one.
if [[ ! -s $qsb_out ]] || ! git -C "$REPO" diff --quiet HEAD -- plugin/orb.glsl 2>/dev/null; then
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
# modmask: Shift 1, Alt 8, Super 64. Lua bindings show no command, so glitch's own are known by their description.
taken=$(hyprctl binds -j 2>/dev/null | jq -r '.[] | select((.description // "") | test("glitch") | not)
  | select(((.key | ascii_downcase) == "d" and (.modmask == 64 or .modmask == 72 or .modmask == 73))
      or ((.key | ascii_downcase) == "backspace" and .modmask == 72))
  | "\(.description // .dispatcher) (modmask \(.modmask), \(.key))"' || true)
if [[ -n $taken ]]; then
  echo "    warning: glitch's keys are already bound, and both bindings will fire:"
  sed 's/^/      /' <<<"$taken"
  echo "    change one of them (glitch's are in $REPO/hypr/glitch.lua)"
fi
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
  mind_port=$(conf MIND_PORT)
  for _ in $(seq 1 30); do curl -fs "localhost:$mind_port/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -fs "localhost:$mind_port/health" >/dev/null 2>&1 && ok "glitch-mind is up on :$mind_port" || echo "    warning: glitch-mind isn't answering yet (journalctl --user -u glitch-mind)"
fi

step "Remote control (sessions from the Claude app)"
workdir=$(conf WORKDIR)
if [[ $(conf REMOTE) != 1 ]]; then
  systemctl --user disable --now glitch-remote-reap.timer >/dev/null 2>&1 || true
  if systemctl --user is-active --quiet glitch-remote.service; then
    echo "    note: glitch-remote is still running; stop it with: systemctl --user disable --now glitch-remote"
  else
    systemctl --user disable glitch-remote.service >/dev/null 2>&1 || true
  fi
  ok "off (to list this machine in the Claude app: REMOTE=1 in ~/.config/glitch/glitch.conf, then re-run ./install.sh)"
else
  ok "sessions started from the app run in ${workdir/#$HOME/~} with permission mode $(conf REMOTE_PERMISSION_MODE)"
  for u in glitch-remote.service glitch-remote-reap.service glitch-remote-reap.timer; do
    link "$REPO/systemd/$u" "$CONFIG/systemd/user/$u"
  done
  systemctl --user daemon-reload
  # The service has no TTY for Claude's one-time "Enable Remote Control?"
  # (remoteDialogSeen, undocumented: re-check when Claude changes) or the trust
  # prompt for WORKDIR; without both, the server exits and restarts every 30 s.
  if [[ -d $workdir ]] && jq -e --arg dir "$workdir" '.remoteDialogSeen and .projects[$dir].hasTrustDialogAccepted' \
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
    echo "    one-time setup: run  mkdir -p ${workdir/#$HOME/~} && cd ${workdir/#$HOME/~} && claude remote-control"
    echo "    answer y and trust the folder, Ctrl+C once it's up, then re-run ./install.sh"
  fi
fi

step "Phone portal"
link "$REPO/systemd/glitch-portal.service" "$CONFIG/systemd/user/glitch-portal.service"
systemctl --user daemon-reload
# Once `glitch phone` has turned it on, an update restarts it onto the new code.
# Safe mid-turn: KillMode=process leaves a running phone turn alone.
if systemctl --user is-enabled --quiet glitch-portal.service 2>/dev/null; then
  systemctl --user restart glitch-portal.service >/dev/null 2>&1 || true
  sleep 2
fi
"$REPO/bin/glitch" phone --status | sed 's/^/    /'

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
  ok "every Claude session on this machine now reads those desktop instructions (--no-desktop leaves them out)"
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
