# glitch: agent notes

**This checkout is live.** install.sh symlinks it into place, so the next Super+D runs whatever is on disk. glitch's own agent runs in `WORKDIR` (~/Work) and can edit this repo mid-turn.

- **Replace bin/glitch atomically** (temp file, then `mv`): bash reads scripts lazily, and a running `_turn`/`_live` keeps reading the old inode.
- **Test turns in a scratch runtime:** `XDG_RUNTIME_DIR=$(mktemp -d) setsid glitch _turn "…" true` (`GLITCH_AGENT=codex` to pick the agent). The live runtime holds the user's session id, history and turn queue, so a test there resumes or cancels their real conversation. A stand-in `claude`/`codex` early in PATH exercises the error and needs-you paths.
- **plugin/ is a keepLoaded panel:** QML edits need `omarchy restart shell`. After editing glitch.frag, recompile with `/usr/lib/qt6/bin/qsb --qt6 -o plugin/glitch.frag.qsb plugin/glitch.frag` and commit the .qsb (it's the fallback when qt6-shadertools is missing).
- **Omarchy notifications:** only `-u critical` stays on screen, and `-r <id>` updates a card in place. The shell ignores D-Bus CloseNotification; `omarchy-shell notifications dismiss <text>` closes every card whose summary *contains* the text, from any app. The body is StyledText (escape `& < >`) and must stay valid UTF-8 (cut by characters).
- **Hyprland config is Lua:** `o.bind(keys, desc, "cmd")` (/usr/share/omarchy/default/hypr/helpers.lua), `hyprctl dispatch 'hl.dsp.…'`, and `hyprctl configerrors` after `hyprctl reload`.
- **Adapters share the line protocol** documented above `adapter_claude`. Each must end with `exit <status>`: a turn with no result line is a failure.
- **Keep the vocabularies in sync:** the MOOD list in voice-prompt.md matches the `.mood` keys in reactions.json. Palette, pattern and motion names match Glitch.qml (`palettes`, `patterns`) and the pattern indices in glitch.frag. decide's mood options are the orb's (they drive the excited, surprised and focused flourishes), not the agent's.
- **Rings mean listening:** nothing shown while working (decide's choices or the `tool.*` reactions) uses rings.
- **Remote control** (`systemd/glitch-remote*`, `glitch _reap`): free sessions by restarting the whole server, never by killing one session's process (the app keeps showing it connected while its turns hang), and never add `--no-create-session-in-dir` (stopping would archive every session).
- **Never** `bypassPermissions` or Codex's `--dangerously-bypass-*` for glitch's turns, even for an agent `omarchy-agent` runs that way (grok): otherwise glitch runs agents with omarchy-agent's modes (glitch-remote's `bypassPermissions` is the user's choice; leave it). Tap-toggle, not hold, because releases of modifier-chord keys get lost.

Debug: `tail -f $XDG_RUNTIME_DIR/glitch/glitch.log`, `omarchy-shell -q glitch set '{"state":"thinking","reaction":{…}}'`, `libexec/preview`, `journalctl --user -u glitch-mind -u glitch-remote`, `quickshell log -p $OMARCHY_PATH/shell`.

Beep Jev is Yohei Nakajima's. This repo is private; don't publish it without his OK.
