#!/bin/bash

# Remove glitch's links, keybinding hook, services and orb plugin.
#
#   ./uninstall.sh           keep downloads (~/.local/share/glitch) and settings
#   ./uninstall.sh --purge   also delete downloads and ~/.config/glitch

set -uo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/glitch"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN_ID=dragland.glitch

unlink_if_link() { [[ -L $1 ]] && rm "$1" && echo "    removed ${1/#$HOME/~}"; }

echo "==> Stopping glitch"
glitch cancel >/dev/null 2>&1
systemctl --user disable --now glitch-mind.service >/dev/null 2>&1
unlink_if_link "$CONFIG/systemd/user/glitch-mind.service"
systemctl --user disable --now glitch-remote-reap.timer glitch-remote.service >/dev/null 2>&1
for u in glitch-remote.service glitch-remote-reap.service glitch-remote-reap.timer; do
  unlink_if_link "$CONFIG/systemd/user/$u"
done
systemctl --user daemon-reload

omarchy plugin disable "$PLUGIN_ID" >/dev/null 2>&1
unlink_if_link "$CONFIG/omarchy/plugins/$PLUGIN_ID"
omarchy-shell -q shell rescanPlugins >/dev/null 2>&1

hypr="$CONFIG/hypr/hyprland.lua"
if grep -q 'require("hypr.glitch")' "$hypr" 2>/dev/null; then
  cp "$hypr" "$hypr.bak.$(date +%s)"
  # The installer appended a blank line, a comment and the require.
  sed -i -z 's/\n\n-- glitch voice companion[^\n]*\nrequire("hypr.glitch")\n/\n/' "$hypr"
  sed -i '/^-- glitch voice companion/d; /^require("hypr.glitch")$/d' "$hypr"
  echo "    removed require(\"hypr.glitch\") from ~/.config/hypr/hyprland.lua"
fi
unlink_if_link "$CONFIG/hypr/glitch.lua"
hyprctl reload >/dev/null 2>&1

unlink_if_link "$HOME/.local/bin/glitch"
systemctl --user disable --now ydotool.service >/dev/null 2>&1
unlink_if_link "$HOME/.claude/rules/glitch-desktop.md"

if [[ ${1:-} == --purge ]]; then
  rm -rf "$DATA" "$CONFIG/glitch"
  echo "    deleted ~/.local/share/glitch and ~/.config/glitch"
fi
echo "==> Done (voxtype settings, the ydotool package and its /etc/udev and /etc/modules-load.d files were left as they are)"
