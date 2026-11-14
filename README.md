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

It can also mutter while it works (off by default). With `MUTTER=1` in
`~/.config/glitch/glitch.conf` and a re-run of `./install.sh`, every so often it
speaks one of the agent's thoughts in Mandarin, in a second voice. glitch speaks
English only for its answer and a permission question, so a Mandarin voice
mid-turn can't be mistaken for either. Mandarin is the only language it has: the voice and the
phone's pinyin are built for it. glitch-mind translates, so the mutter needs
an install without `--no-mind`.

## Install

```bash
omarchy plugin add https://github.com/dragland/glitch.git
~/.config/omarchy/plugins/dragland.glitch/install.sh
```

`add` only clones the plugin; install.sh does the rest. A clone anywhere else
works too: run its `install.sh`.

Needs Omarchy 4 with voxtype dictation (`omarchy install dictation voxtype`)
and Claude Code or Codex. What install.sh does to the machine:

- Downloads ~1.5 GB (pinned and checksummed in install.sh) to
  `~/.local/share/glitch`: a Python environment, a Piper voice, and llama.cpp
  with a small local model that picks the orb's reactions (1.1 GB; `--no-mind`
  skips it). The model runs on the GPU through Vulkan where there is a driver
  and on the CPU otherwise. The mutter adds ~0.2 GB.
- Binds the keys below with one `require` line in `~/.config/hypr/hyprland.lua`.
- Asks for root once, for desktop control: it installs ydotool and gives your
  login session `/dev/uinput`, and it adds [config/desktop.md](config/desktop.md)
  to `~/.claude/rules`, which every Claude session on the machine reads.
  `--no-desktop` skips all of it.
- Raises voxtype's recording cap to 10 minutes and gives Whisper a vocabulary
  hint (`--no-voxtype` skips both; then set `RECORD_LIMIT` to voxtype's own cap).
- Installs `uv` through mise if it is missing, starts the `glitch-mind` user
  service, and restarts the Omarchy shell to load the orb.

Remote control and the phone portal stay off until you turn them on (below).

Update with `omarchy plugin update dragland.glitch` (`git pull` in a clone
elsewhere), then run `install.sh` again. To remove it, run `uninstall.sh` first
(`--purge` also deletes downloads and settings) and only then, if you added it
as a plugin, `omarchy plugin remove dragland.glitch`: that command deletes the
folder uninstall.sh lives in. Uninstalling leaves the root part of desktop
control: `sudo pacman -R ydotool && sudo rm
/etc/udev/rules.d/70-uinput.rules /etc/modules-load.d/uinput.conf` removes it.

## Use

| Key | |
|---|---|
| Super+D | tap to start talking, tap again to send (continues the session) |
| Super+Alt+D | same, in a fresh session |
| Super+Alt+Shift+D | open the session in a terminal |
| Super+Alt+Backspace | cancel the recording, the turn and the speech |

A tap while glitch is talking just quiets it, and "new task, …" starts fresh
by voice. For 15 minutes after a turn the next Super+D continues that session
(`RESUME_WINDOW`), and the reply card stays on screen as long (`CARD_SECONDS`,
set separately; 0 shows no card).

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

With `REMOTE=1` in `~/.config/glitch/glitch.conf` and a re-run
of `./install.sh`, `glitch-remote` (Claude Code's remote control) lists this
machine in the Claude app and at claude.ai/code while you're logged in.
Sessions you or your claude.ai projects start there run in `WORKDIR` (`~/Work`)
with Claude in Chrome, in the permission mode `REMOTE_PERMISSION_MODE` names:
`auto` by default, where Claude judges each action itself, with nobody at the
desk to ask. `bypassPermissions` skips every check, so set it only if anyone
who can reach your claude.ai account may do anything on this machine. Restart
`glitch-remote` after changing the mode. glitch's own voice turns (`claude -p`)
don't appear there.

- The first install asks you to run `claude remote-control` once in `WORKDIR`
  to accept its prompts.
- After an hour with no Claude activity (`REMOTE_IDLE_MIN`), the server
  restarts to free its sessions. The next message brings a session back with
  its context.
- Anyone signed into your claude.ai account can drive these sessions, so turn
  on Require trusted devices at claude.ai/settings/account.

### Phone portal

A page with its own orb that the phone opens over HTTPS, at home or through
Tailscale. It talks to the same conversation as Super+D, and a turn asked from
the phone answers only on the phone. It runs while you're logged in at the desk.
So far tried only on Android with Chrome.

1. Run `glitch phone`. It picks this machine's LAN address (reserve it in your router, a DHCP reservation, since the certificate and the paired app are tied to it), makes a certificate, starts the portal, and prints the firewall and Tailscale commands left for you to run, then a QR code.
2. Scan the code on the phone, on the same Wi-Fi, and proceed past Chrome's warning (Advanced, then Proceed): the phone doesn't trust the certificate yet. The page hands it over and walks through installing it in Settings.
3. Before pairing, open the installed certificate on the phone (Trusted credentials > User) and compare its SHA-256 fingerprint with the one `glitch phone` printed. That download was not protected, so this check is what tells you the certificate is yours; remove it if they differ. The real one vouches only for that one address, and `glitch cert` destroys the key that signed it.
4. Open glitch from that page, say "pair my phone" at the desk (or run `glitch pair`), and type the code it speaks.
5. Install it to the home screen.

`glitch phone --off` turns the portal off again.

If the address changes, set the new `PORTAL_ADDR` in `~/.config/glitch/glitch.conf`, run `glitch cert --renew` and `glitch phone`, and install the new certificate on the phone. After a new address or `PORTAL_PORT`, add the app to the home screen again and pair it again. `glitch unpair` forgets every phone.

- Hold the orb to talk and let go to send. Slide off it to throw the recording away, and tap while glitch speaks to quiet it. The reply is typed out as it is spoken, with the full text below.
- While a phone turn works, the page shows the agent's latest thought or working note under the status line. A muttered thought shows its Mandarin, with pinyin above each character, as it is spoken, and its English once it has been. The desk shows no text.
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
- `manifest.json`: what makes the repo an Omarchy shell plugin.
- `config/`: defaults, including the SAY/MOOD convention in `voice-prompt.md`.

To work on glitch itself, read AGENTS.md.

## Credits

The creature's patterns, palettes, motions and beep synth come from Beep Jev
by Yohei Nakajima (ported from the public app's bundle); the decision approach
follows his [glance](https://github.com/yoheinakajima/glance) and TypeSafe's Jev.

MIT licensed; see [LICENSE](LICENSE).
