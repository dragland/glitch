#!/bin/bash

# Remove glitch's links, keybinding hook, service and orb plugin.
#
#   ./uninstall.sh           keep downloads (~/.local/share/glitch) and settings
#   ./uninstall.sh --purge   also delete downloads and ~/.config/glitch

set -uo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/glitch"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN_ID=dragland.glitch

unlink_if_link() { [[ -L $1 ]] && rm "$1" && echo "    removed ${1/#$HOME/~}"; }

echo "==> Stopping glitch"
systemctl --user disable --now glitch-mind.service >/dev/null 2>&1
unlink_if_link "$CONFIG/systemd/user/glitch-mind.service"
systemctl --user daemon-reload

omarchy plugin disable "$PLUGIN_ID" >/dev/null 2>&1
unlink_if_link "$CONFIG/omarchy/plugins/$PLUGIN_ID"
omarchy-shell -q shell rescanPlugins >/dev/null 2>&1

hypr="$CONFIG/hypr/hyprland.lua"
if grep -q 'require("hypr.glitch")' "$hypr" 2>/dev/null; then
  cp "$hypr" "$hypr.bak.$(date +%s)"
  sed -i '/^-- glitch voice companion/d; /^require("hypr.glitch")$/d' "$hypr"
  echo "    removed require(\"hypr.glitch\") from ~/.config/hypr/hyprland.lua"
fi
unlink_if_link "$CONFIG/hypr/glitch.lua"
hyprctl reload >/dev/null 2>&1

unlink_if_link "$HOME/.local/bin/glitch"

if [[ ${1:-} == --purge ]]; then
  rm -rf "$DATA" "$CONFIG/glitch"
  echo "    deleted ~/.local/share/glitch and ~/.config/glitch"
fi
echo "==> Done (voxtype settings were left as they are)"
