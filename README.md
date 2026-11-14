# glitch

A voice-first companion for [Omarchy](https://omarchy.org). Tap **Super+D**,
talk, tap again: your coding agent (Claude Code or Codex, whichever is Omarchy's
default) does it headless, while a little creature at the bottom of the screen
shows what it's doing, beeps its mood and speaks a one-line answer. The full
reply waits on a sticky card; click it to open the conversation.

The creature grew out of Yohei Nakajima's [Beep Jev](https://beepjev.replit.app):
its patterns, palettes, motions and beep synth. A decision model (local by
default) stands in for Jev, picking its look and sound as the agent works. The
orb also moves with what is happening:

- **Voice.** The halo follows the mic while you talk and its own voice while
  it answers. Rings travel inward for you and outward for it.
- **The eye is the pattern.** The pattern is centred and magnified at the
  point it looks at: the middle while you talk, the work while it works. It
  blinks.
- **Working.** The pattern drifts as text streams. Reading shows a radar
  sweep, an edit flashes the rim and fills in checker cells, and a comet runs
  the rim while a command or subagent is out.
- **The turn.** One pale tick appears on the rim per tool call, and a moon
  orbits per subagent, returning with a ping. A faint tide shows how full the
  context is (Claude only; Codex doesn't report it). All of it fades when the
  orb starts to speak.

While it works, it also mutters: every so often one of the agent's thoughts
is spoken in Mandarin, in a second voice. Apart from a permission question,
English is only the answer, so a voice mid-turn can't be mistaken for one.
glitch-mind translates it, so it needs an install without `--no-mind`; an
empty `MUTTER_VOICE` turns it off.

## Install

```bash
git clone git@github.com:dragland/glitch.git ~/glitch
~/glitch/install.sh
```

Needs Omarchy 4 with voxtype dictation (`omarchy-voxtype-install`) and Claude
Code or Codex. Root once, for desktop control (`--no-desktop` skips it).
Downloads (~1.5 GB, pinned in install.sh) go to `~/.local/share/glitch`;
`--no-mind` skips the local model.

Update with `git pull && ./install.sh`; remove with `./uninstall.sh`
(`--purge` also deletes downloads and settings). It leaves the root part of
desktop control: `sudo pacman -R ydotool && sudo rm
/etc/udev/rules.d/70-uinput.rules /etc/modules-load.d/uinput.conf` removes it.

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
`pkexec`, so you get Omarchy's fingerprint or password dialog.

Claude can use your signed-in Chrome through Claude in Chrome (sign the
extension into the same claude.ai account). Linux has no built-in computer use,
so [config/desktop.md](config/desktop.md) tells every Claude session (voice,
phone, terminal) to take screenshots, find and launch windows, click and type
with grim, hyprctl, ydotool and wtype.

### From the Claude app

While you're logged in, `glitch-remote` (Claude Code's remote control) lists
this machine in the Claude app and at claude.ai/code. Sessions you or your
claude.ai projects start there run in `~/Work` with `bypassPermissions` and
Claude in Chrome (`systemctl --user edit glitch-remote` changes that).
Glitch's own voice turns (`claude -p`) don't appear there.

- The first install asks you to run `claude remote-control` once in `~/Work`
  to accept its prompts. `./install.sh --no-remote` leaves remote control out
  entirely.
- After an hour with no Claude activity (`REMOTE_IDLE_MIN`), the server
  restarts to free its sessions. The next message brings a session back with
  its context.
- Anyone signed into your claude.ai account can drive these sessions, so turn
  on Require trusted devices at claude.ai/settings/account.

### Phone portal

A page with its own orb that the phone opens over HTTPS, at home or through
Tailscale. It talks to the same conversation as Super+D, and a turn asked from
the phone answers only on the phone. It runs while you're logged in at the desk.

1. Reserve this machine's address in your router (a DHCP reservation), since the certificate and the paired app are tied to it, and set `PORTAL_ADDR=<that address>` in `~/.config/glitch/glitch.conf`.
2. Run `glitch cert`.
3. Copy `~/.local/share/glitch/portal/glitch-ca.crt` to the phone and install it in Settings > Security > Encryption & credentials > Install a certificate > CA certificate. Check that its fingerprint matches the one `glitch cert` printed. `glitch cert` destroys the CA's key, so it can't vouch for anything else.
4. Re-run `./install.sh`. It starts the portal and prints its address and the firewall and Tailscale commands left for you to run.
5. Open that address on the phone, say "pair my phone" at the desk (or run `glitch pair`), and type the code it speaks.
6. Install it to the home screen.

If the address changes, run `glitch cert --renew` and install the new CA file on the phone. After a new address or `PORTAL_PORT`, re-run `./install.sh`, add the app to the home screen again and pair it again. `glitch unpair` forgets every phone.

- Hold the orb to talk and let go to send. Slide off it to throw the recording away, and tap while glitch speaks to quiet it. The reply is typed out as it is spoken, with the full text below.
- While a phone turn works, the page shows the agent's latest thoughts and working notes under the status line. A muttered thought shows its Mandarin, with pinyin above each character, as it is spoken, and its English once it has been. The desk shows no text.
- When a phone turn needs your permission, the page shows everything the tool would get (the whole command, a file's full new content, every field of any other tool) with Allow once and Deny. It waits up to 5 minutes, and desk requests queue behind it. If the page isn't open, a notification asks instead: Deny answers at once, a short one-line shell command can be allowed from it after unlock, and anything else opens the full card. Root prompts (pkexec) appear only at the desk.
- Stop ends the running turn, whichever side started it. "new chat, …" starts fresh as at the desk and clears the page. The page also clears 15 minutes after the last turn, once it is off screen and the reply has been heard.
- Away from home the page offers an Open Tailscale button. If you allow notifications, the phone tells you when glitch needs you or finished a reply you didn't hear.

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
                       live signals (orb.events) ───► orb
```

- `bin/glitch`: the whole pipeline (keys, sessions, agent adapters, approvals,
  speech, reply card). Its log is `$XDG_RUNTIME_DIR/glitch/glitch.log`.
- `plugin/`: the orb. `orb.mjs` (its logic) and `orb.glsl` (its shader) are
  shared with the phone; `Glitch.qml` hosts them in the Omarchy shell, taking
  the reaction over IPC, live signals from `$XDG_RUNTIME_DIR/glitch/orb.events`
  and the mic level from PipeWire.
- `web/`: the phone portal's page, service worker and web host of the orb.
- `libexec/`: `cue` (beeps), `speak` (Piper), `decide` (the decision model:
  `local`, `jev` or `openai`), `mandarin` (translates a thought for the mutter), `preview`
  (cycles orb styles while you tune `reactions.json`), `desktop-root` (desktop
  control's root half), `portal` (the phone portal's HTTPS server).
- `config/`: defaults, including the SAY/MOOD convention in `voice-prompt.md`.

install.sh symlinks the code into place, adds one `require` line to
`~/.config/hypr/hyprland.lua`, installs ydotool with access to `/dev/uinput`
(as root), and raises voxtype's recording cap (skip that with `--no-voxtype`,
then set `RECORD_LIMIT` to voxtype's own cap). To work on glitch itself, read
AGENTS.md.

## Credits

The creature's patterns, palettes, motions and beep synth come from Beep Jev
by Yohei Nakajima (ported from the public app's bundle); the decision approach
follows his [glance](https://github.com/yoheinakajima/glance) and TypeSafe's Jev. This repo
is private; check with him before publishing it.
