# glitch

A voice-first companion for [Omarchy](https://omarchy.org). Tap **Super+D**,
talk, tap again: your coding agent (Claude Code) does it headless, while a
little creature at the bottom of the screen shows what it's doing, beeps its
mood, and speaks a one-line answer. The full reply waits on a sticky card;
click it to open the whole conversation.

The creature is a port of Yohei Nakajima's
[Beep Jev](https://beepjev.replit.app): its CSS patterns, palettes, keyframe
motions, mouse-following eye and Web Audio beep synth. A small local model
stands in for Jev, picking the creature's reaction as the agent works.

## Install

```bash
git clone git@github.com:dragland/glitch.git ~/Work/glitch
~/Work/glitch/install.sh
```

Needs Omarchy 4 with voxtype dictation (`omarchy-voxtype-install`) and Claude
Code installed. No sudo. The installer downloads ~1.3 GB (voice, llama.cpp,
Qwen3 1.7B; pinned and checksummed) into `~/.local/share/glitch`; `--no-mind`
skips the model and uses fixed reactions.

Update: `git pull && ./install.sh`. Remove: `./uninstall.sh` (`--purge` also
deletes downloads and settings).

## Use

| Key | |
|---|---|
| Super+D | tap to start talking, tap again to send (continues the session) |
| Super+Alt+D | same, but starts a fresh session |
| Super+Alt+Shift+D | open the session in a terminal |
| Super+Alt+Backspace | cancel: drop the recording, stop the turn, stop talking |

A tap while glitch is talking just quiets it. Say "new task, …" to start fresh
by voice. A session stays current for 15 minutes after its last turn; while the
reply card is on screen, the next Super+D continues it.

The agent runs in `WORKDIR` (~/Work) with `--permission-mode auto` and nobody
to answer prompts: anything auto mode won't allow is denied, and glitch says
"Need you: …" — click the card to finish in the terminal.

## How it works

```
 Super+D ─► glitch toggle ─► voxtype (local Whisper) ─► transcript
                                                          │
            ┌─────────────────────────────────────────────┘
            ▼
   claude -p --resume <session> --output-format stream-json --include-partial-messages
            │  tool steps, streamed words                     final reply ─┐
            ▼                                                              ▼
   libexec/decide ──(each tool step / 8 s)──► reaction        SAY: + MOOD: lines
   (Qwen3 1.7B via glitch-mind, reads                          │
    answer probabilities, like Jev)                            ├─► decide (final reaction)
            │                                                  ├─► Piper voice (SAY)
            ▼                                                  └─► sticky card (full reply)
   omarchy-shell glitch set {state, reaction} ─► plugin/Glitch.qml + glitch.frag (GPU)
   libexec/cue {voice, pitch, rate, energy, mood} ─► beeps
```

- **bin/glitch** is the whole pipeline: the key state machine, the session
  policy, the Claude adapter, live decisions, speech and the reply card.
  Runtime state lives in `$XDG_RUNTIME_DIR/glitch/` (`glitch.log` first when
  debugging).
- **plugin/** is an Omarchy shell plugin (`dragland.glitch`, a click-through
  overlay). `glitch.frag` draws Beep Jev's patterns, border, glows and eye, and
  QML runs its motions at the display's refresh rate.
- **libexec/cue** synthesizes beep phrases (six voices: chirp, blip, bubble,
  robot, chatter, whisper). **libexec/speak** loads Piper while the agent
  works and renders the SAY line when it arrives. **libexec/decide** asks the
  local model multiple-choice questions (mood, pattern, palette, motion, voice,
  energy, pitch, rate; only pattern, motion and energy while working) and reads
  each answer's probabilities from one forward pass, in parallel.
- **config/** holds the defaults: `glitch.conf` (settings),
  `voice-prompt.md` (the SAY/MOOD reply convention given to the agent) and
  `reactions.json` (fallback reactions for each state and mood).
- **hypr/glitch.lua** has the keybindings; **systemd/glitch-mind.service**
  runs llama.cpp (Vulkan) on 127.0.0.1:8765 behind an API key.

## Where things go

| | |
|---|---|
| `~/.local/bin/glitch`, `~/.config/hypr/glitch.lua`, `~/.config/omarchy/plugins/dragland.glitch`, `~/.config/systemd/user/glitch-mind.service` | symlinks into this repo |
| `~/.config/hypr/hyprland.lua` | gets `require("hypr.glitch")` (and a comment); a `.bak` is kept |
| `~/.config/glitch/` | your overrides: `glitch.conf` (sourced over the default), `reactions.json` (merged over it), `voice-prompt.md` (replaces it) |
| `~/.local/share/glitch/` | venv (from `uv.lock`, uv-managed Python), voices, llama.cpp, model, `mind.key` |
| voxtype config | recording cap raised to 10 min, a vocabulary hint (skip with `--no-voxtype`, then set `RECORD_LIMIT` to voxtype's cap) |

Working on glitch itself: see AGENTS.md. `libexec/preview` cycles orb styles on
screen for tuning `reactions.json`.

## Credits

The creature's look, motion and sound come from Beep Jev by Yohei Nakajima,
ported from the public app's bundle. The decision approach follows his
[glance](https://github.com/yoheinakajima/glance) and TypeSafe's Jev. This repo
is private; check with him before publishing it.
