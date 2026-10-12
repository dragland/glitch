# glitch: agent notes

**This checkout is live.** install.sh symlinks it into ~/.local/bin,
~/.config/hypr, ~/.config/omarchy/plugins/dragland.glitch and
~/.config/systemd/user, so the next Super+D runs whatever is on disk. glitch's
own agent runs in ~/Work and can edit this repo mid-turn.

- **Replace bin/glitch atomically** (write a temp file, then `mv`). Bash reads scripts lazily, and a running `_turn`/`_live` keeps reading the old inode.
- **Detached children close the lock fds** (`8>&- 9>&-` = key.lock/turn.lock). If a new `setsid … &` drops them, every later key press logs `key ignored: busy`.
- **plugin/ is a keepLoaded panel:** QML edits need `omarchy restart shell`. After editing glitch.frag, run `/usr/lib/qt6/bin/qsb --qt6 -o plugin/glitch.frag.qsb plugin/glitch.frag` and commit the .qsb; it's the fallback when qt6-shadertools is missing.
- **Notifications:** the shell ignores D-Bus CloseNotification for on-screen cards. `omarchy-shell notifications dismiss <text>` closes every card whose summary *contains* the text, from any app. Only `-u critical` stays on screen. `-r <id>` updates a card in place. The body is rendered as StyledText, so escape `& < >`. Keep it valid UTF-8 (cut by characters, never `head -c`).
- **Hyprland config is Lua.** Bind with `o.bind(keys, desc, "cmd")` (/usr/share/omarchy/default/hypr/helpers.lua). Dispatch is `hyprctl dispatch 'hl.dsp.…'`. Run `hyprctl configerrors` after `hyprctl reload`.
- **Adapters** (`adapter_claude`, `adapter_codex`) share one line protocol. `GLITCH_AGENT=codex` overrides Omarchy's default agent for testing. Codex has no streamed text deltas and sometimes batches shell calls invisibly. `codex exec resume` lacks `--approve-for-me`, so its policy goes in as `-c` keys. Session ids are per agent (`sid.agent`).
- **Claude adapter:** `-p --output-format stream-json` needs `--verbose`. The jq in `adapter_claude` is the event contract, and the line protocol is documented above it. It must end with `exit <status>`: a turn with no result line counts as a failure.
- **Keep the vocabularies in sync:** the MOOD list in voice-prompt.md matches the `.mood` keys in reactions.json. Palette, pattern and motion names match the `palettes`/`patterns` in Glitch.qml and the pattern indices in glitch.frag. decide's mood options are the orb's (they drive the excited/surprised/focused flourishes), not the agent's.
- **Rings mean listening.** decide never picks rings while working. Don't reuse that look for other states.
- **Never** `--permission-mode bypassPermissions`. Tap-toggle, not hold: releases of modifier-chord keys get lost.

Test turns against a scratch runtime, never the live one: `XDG_RUNTIME_DIR=$(mktemp -d) setsid glitch _turn "…" true`. The live runtime holds the user's session id, history and turn queue, so a test turn there can resume or cancel their real conversation. A stand-in `claude` earlier in PATH lets you exercise the error and needs-you paths.

Debug without talking:
- `tail -f $XDG_RUNTIME_DIR/glitch/glitch.log`
- `omarchy-shell -q glitch set '{"state":"thinking","reaction":{"palette":"ocean"}}'`
- `libexec/preview`
- `echo '{"phase":"done","say":"hi"}' | ~/.local/share/glitch/venv/bin/python -I libexec/decide`
- `journalctl --user -u glitch-mind`
- `quickshell log -p $OMARCHY_PATH/shell`

Beep Jev is Yohei Nakajima's. This repo is private; don't publish it without his OK.
