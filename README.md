# glitch

A voice-first companion for [Omarchy](https://omarchy.org). Tap **Super+D**,
talk, tap again: your coding agent (Claude Code or Codex, whichever is Omarchy's
default) does it headless, while a little creature at the bottom of the screen
shows what it's doing, beeps its mood and speaks a one-line answer. The full
reply waits on a sticky card; click it to open the conversation.

The creature is a port of Yohei Nakajima's [Beep Jev](https://beepjev.replit.app):
its patterns, palettes, motions, mouse-following eye and beep synth. A decision
model (local by default) stands in for Jev, picking its reaction as the agent
works.

## Install

```bash
git clone git@github.com:dragland/glitch.git ~/glitch
~/glitch/install.sh
```

Needs Omarchy 4 with voxtype dictation (`omarchy-voxtype-install`) and Claude
Code or Codex. No sudo. Downloads (~1.3 GB, pinned in install.sh) go to
`~/.local/share/glitch`; `--no-mind` skips the local model.

Update with `git pull && ./install.sh`; remove with `./uninstall.sh`
(`--purge` also deletes downloads and settings).

## Use

| Key | |
|---|---|
| Super+D | tap to start talking, tap again to send (continues the session) |
| Super+Alt+D | same, in a fresh session |
| Super+Alt+Shift+D | open the session in a terminal |
| Super+Alt+Backspace | cancel the recording, the turn and the speech |

A tap while glitch is talking just quiets it, and "new task, …" starts fresh
by voice. While the reply card is on screen (15 minutes after the last turn),
the next Super+D continues that session.

The agent runs the way `omarchy-agent` runs it (Claude in auto mode, Codex
with `--approve-for-me`). When Claude would ask your permission, the orb asks
out loud and Omarchy's menu offers Allow once / Deny; root goes through
`pkexec`, so you get Omarchy's fingerprint or password dialog. Claude gets Claude
in Chrome, so it can use your signed-in Chrome (sign the extension into the
same claude.ai account).

### From your phone

install.sh also runs Claude Code's remote control as a user service
(`glitch-remote`), so this machine shows up in the Claude app and at
claude.ai/code while you're logged in, and you can start sessions on it from
there, as can your claude.ai projects. They run in `~/Work` with
`bypassPermissions` and Claude in Chrome; change that with
`systemctl --user edit glitch-remote`. Once every session has been quiet for an
hour (`REMOTE_IDLE_MIN`), the server restarts to free them; the next message
brings a session back with its context. Glitch's own voice
turns are `claude -p` and don't appear there. The first install asks you to run
`claude remote-control` once in `~/Work` to accept its prompts; `--no-remote`
skips installing it. Turn on **Require trusted devices** at
claude.ai/settings/account, since anyone signed into your account can drive
these sessions.

Settings and their defaults are in [config/glitch.conf](config/glitch.conf);
override them in `~/.config/glitch/glitch.conf`. Your own `reactions.json` there
merges over the default, and your own `voice-prompt.md` replaces it (agents
pick it up at the start of a session, so try it with Super+Alt+D).

## How it works

```
Super+D ─► voxtype (local Whisper) ─► transcript ─► agent, headless, resuming the session
                                                       │ tool steps, streamed words   │ reply ending in SAY: / MOOD:
                                                       ▼                              ▼
                       libexec/decide ─► reaction ─► orb      Piper speaks SAY · card holds the reply
```

- `bin/glitch`: the whole pipeline (keys, sessions, agent adapters, approvals,
  speech, reply card). Its log is `$XDG_RUNTIME_DIR/glitch/glitch.log`.
- `plugin/`: the Omarchy shell plugin that draws the orb (`glitch.frag` on the GPU).
- `libexec/`: `cue` (beeps), `speak` (Piper), `decide` (the decision model:
  `local`, `jev` or `openai`), `preview` (cycles orb styles while you tune
  `reactions.json`).
- `config/`: defaults, including the SAY/MOOD convention in `voice-prompt.md`.

install.sh symlinks the code into `~/.local/bin`, `~/.config/hypr` (plus one
`require` line in `hyprland.lua`), `~/.config/omarchy/plugins` and
`~/.config/systemd/user`, and raises voxtype's recording cap (skip that with
`--no-voxtype`, then set `RECORD_LIMIT` to voxtype's own cap). Working on
glitch itself: see AGENTS.md.

## Credits

The creature's look, motion and sound come from Beep Jev by Yohei Nakajima,
ported from the public app's bundle; the decision approach follows his
[glance](https://github.com/yoheinakajima/glance) and TypeSafe's Jev. This repo
is private; check with him before publishing it.
