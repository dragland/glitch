#!/bin/bash

# Remove glitch's links, keybinding hook and services, and disable the orb plugin.
#
#   ./uninstall.sh           keep downloads (~/.local/share/glitch) and settings
#   ./uninstall.sh --purge   also delete downloads, ~/.config/glitch and ~/.local/state/glitch

set -uo pipefail

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/glitch"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN_ID=dragland.glitch

unlink_if_link() { [[ -L $1 ]] && rm "$1" && echo "    removed ${1/#$HOME/~}"; }

echo "==> Stopping glitch"
glitch cancel >/dev/null 2>&1
systemctl --user disable --now glitch-mind.service >/dev/null 2>&1
unlink_if_link "$CONFIG/systemd/user/glitch-mind.service"
systemctl --user daemon-reload

omarchy plugin disable "$PLUGIN_ID" >/dev/null 2>&1
unlink_if_link "$CONFIG/omarchy/plugins/$PLUGIN_ID"
[[ -d $CONFIG/omarchy/plugins/$PLUGIN_ID ]] && echo "    the plugin's folder is this checkout; finish with: omarchy plugin remove $PLUGIN_ID"
omarchy-shell -q shell rescanPlugins >/dev/null 2>&1

hypr="$CONFIG/hypr/hyprland.lua"
if grep -q 'require("hypr.glitch")' "$hypr" 2>/dev/null; then
  cp "$hypr" "$hypr.bak.$(date +%s)"
  sed -i -z 's/\n\n-- glitch voice companion[^\n]*\nrequire("hypr.glitch")\n/\n/' "$hypr"
  sed -i '/^-- glitch voice companion/d; /^require("hypr.glitch")$/d' "$hypr"
  echo "    removed require(\"hypr.glitch\") from ~/.config/hypr/hyprland.lua"
fi
unlink_if_link "$CONFIG/hypr/glitch.lua"
hyprctl reload >/dev/null 2>&1

unlink_if_link "$HOME/.local/bin/glitch"
systemctl --user disable --now ydotool.service >/dev/null 2>&1
unlink_if_link "$CONFIG/systemd/user/ydotool.service.d/glitch.conf"
rmdir "$CONFIG/systemd/user/ydotool.service.d" 2>/dev/null
unlink_if_link "$HOME/.claude/rules/glitch-desktop.md"

systemctl --user disable --now glitch-portal.service >/dev/null 2>&1
unlink_if_link "$CONFIG/systemd/user/glitch-portal.service"

systemctl --user disable glitch-remote-reap.timer glitch-remote.service >/dev/null 2>&1
for u in glitch-remote.service glitch-remote-reap.service glitch-remote-reap.timer; do
  unlink_if_link "$CONFIG/systemd/user/$u"
done
systemctl --user daemon-reload

if [[ ${1:-} == --purge ]]; then
  rm -rf "$DATA" "$CONFIG/glitch" "${XDG_STATE_HOME:-$HOME/.local/state}/glitch"
  echo "    deleted ~/.local/share/glitch, ~/.config/glitch and ~/.local/state/glitch"
fi
echo "==> Done (voxtype settings and desktop control's root part were left as they are; the README's Install section has the command that removes that part)"
# Last, since stopping it also ends a remote control session running this script.
systemctl --user stop glitch-remote-reap.timer glitch-remote.service >/dev/null 2>&1
