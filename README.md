# glitch

Voice companion for [Omarchy](https://omarchy.org). Tap a key, talk, and an orb shows your coding agent at work.

<div align="center">
  <img src="docs/orb.webp" width="360" alt="The orb waking up, saying hello, listening, working and reporting back" />
</div>

With sound:

https://github.com/user-attachments/assets/cdc3288a-8444-4d4a-a234-3a0bc62211b6

## How it works

- Tap **Super+D**, talk, tap again
- Local Whisper (voxtype) transcribes it, and your coding agent (Claude Code or Codex, whichever is Omarchy's default) does it headless
- An orb at the bottom of the screen reacts as the agent works and beeps its mood
- It speaks a one-line answer, and the full reply waits on a card that opens the conversation
- When the agent needs permission, the orb asks out loud and Omarchy's menu offers Allow once / Deny
- Root goes through `pkexec`, so you get Omarchy's fingerprint or password dialog

## The orb

Its patterns, palettes, motions and beep synth come from Yohei Nakajima's [Beep Jev](https://beepjev.replit.app). A small local model picks its look and sound as the agent works.

- **Voice.** The halo follows the mic while you talk and its own voice while it answers. Rings travel inward for you and outward for it.
- **Eye.** The pattern is magnified where it looks: the middle while you talk, the work while it works. It blinks.
- **Work.** The pattern drifts as text streams. Reading shows a radar sweep, an edit flashes the rim, and a comet runs the rim while a command or subagent is out.
- **Turn.** One tick appears on the rim per tool call and a moon orbits per subagent. A faint tide shows how full the context is (Claude only).

## Install

```bash
omarchy plugin add https://github.com/dragland/glitch.git
~/.config/omarchy/plugins/dragland.glitch/install.sh
```

`add` only clones the plugin; install.sh does the rest. A clone anywhere else works too, through its own `install.sh`.

**Prerequisites**: Omarchy 4, voxtype dictation (`omarchy install dictation voxtype`), and Claude Code or Codex

What install.sh changes on the machine:

- Downloads ~1.5 GB to `~/.local/share/glitch`, pinned and checksummed: a Python environment, a Piper voice, and llama.cpp with the orb's model (1.1 GB; `--no-mind` skips it). The model runs on the GPU through Vulkan where there is a driver, and on the CPU otherwise.
- Adds one line to `~/.config/hypr/hyprland.lua` for the keys below
- Asks for root once, for desktop control: it installs ydotool, gives your login session `/dev/uinput`, and adds [config/desktop.md](config/desktop.md) to `~/.claude/rules`, which every Claude session on the machine reads. `--no-desktop` skips all of it.
- Raises voxtype's recording cap to 10 minutes and gives Whisper a vocabulary hint (`--no-voxtype` skips both; then set `RECORD_LIMIT` to voxtype's own cap)
- Installs `uv` through mise if it is missing, starts the `glitch-mind` user service, and restarts the Omarchy shell to load the orb

**Update**: `omarchy plugin update dragland.glitch` (`git pull` in a clone elsewhere), then run `install.sh` again.

**Remove**: run `uninstall.sh` first (`--purge` also deletes downloads and settings), and only then `omarchy plugin remove dragland.glitch`, which deletes the folder uninstall.sh lives in. If you removed it first, clone it again and run its `uninstall.sh`. Uninstalling leaves the root part of desktop control:

```bash
sudo pacman -R ydotool && sudo rm /etc/udev/rules.d/70-uinput.rules /etc/modules-load.d/uinput.conf
```

## Usage

| Key | |
|---|---|
| Super+D | tap to start talking, tap again to send (continues the session) |
| Super+Alt+D | same, in a fresh session |
| Super+Alt+Shift+D | open the session in a terminal |
| Super+Alt+Backspace | cancel the recording, the turn and the speech |

- A tap while glitch is talking quiets it
- "new task, …" starts a fresh session by voice
- For 15 minutes after a turn, the next Super+D continues that session (`RESUME_WINDOW`) and the reply card stays on screen (`CARD_SECONDS`; 0 shows no card)
- The agent runs the way `omarchy-agent` runs it: Claude in auto mode, Codex with `--approve-for-me`
- Claude can use your signed-in Chrome through Claude in Chrome (sign the extension into the same claude.ai account), and the rest of the desktop with grim, hyprctl, ydotool and wtype

## Settings

Defaults are in [config/glitch.conf](config/glitch.conf); override them in `~/.config/glitch/glitch.conf`. Your own `reactions.json` there merges over the default, and your own `voice-prompt.md` replaces it (a session reads it when it starts, so try it with Super+Alt+D).

Three parts are off until you turn them on.

### Mutter

With `MUTTER=1` and a re-run of `install.sh` (~0.2 GB more), glitch now and then speaks one of the agent's thoughts in Mandarin, in a second voice. It speaks English only for its answer and a permission question, so a Mandarin voice mid-turn can't be mistaken for either. Mandarin is its only language, since the voice and the phone's pinyin are built for it. It needs the local model.

### Remote control

With `REMOTE=1` and a re-run of `install.sh`, this machine shows up in the Claude app and at claude.ai/code while you're logged in (Claude Code's remote control, as the `glitch-remote` service).

- Sessions started there run in `WORKDIR` (`~/Work`) with Claude in Chrome
- `REMOTE_PERMISSION_MODE` sets their permission mode. The default, `auto`, has Claude judge each action itself. `bypassPermissions` skips every check, so set it only if anyone who can reach your claude.ai account may do anything on this machine. Restart `glitch-remote` after changing it.
- The first install asks you to run `claude remote-control` once in `WORKDIR` to accept its prompts
- After an hour with no Claude activity (`REMOTE_IDLE_MIN`), the server restarts to free its sessions. The next message brings a session back with its context.
- Anyone signed into your claude.ai account can drive these sessions, so turn on Require trusted devices at claude.ai/settings/account
- glitch's own voice turns don't appear there

### Phone portal

A page with its own orb that the phone opens over HTTPS, at home or through Tailscale. It talks to the same conversation as Super+D, and a turn asked from the phone answers only on the phone. It runs while you're logged in at the desk. So far tried only on Android with Chrome.

1. Run `glitch phone`. It picks this machine's LAN address, makes a certificate, starts the portal, and prints the firewall and Tailscale commands left for you to run, then a QR code. Reserve that address in your router (a DHCP reservation), since the certificate and the paired app are tied to it.
2. Scan the code on the phone, on the same Wi-Fi, and proceed past Chrome's warning (Advanced, then Proceed), since the phone doesn't trust the certificate yet. The page hands it over and walks through installing it in Settings.
3. Before pairing, open the installed certificate on the phone (Trusted credentials > User) and compare its SHA-256 fingerprint with the one `glitch phone` printed. Nothing protected that download, so remove the certificate if they differ. The real one vouches only for that one address, and the key that signed it is destroyed.
4. Open glitch from that page, say "pair my phone" at the desk (or run `glitch pair`), and type the code it speaks.
5. Install it to the home screen.

On the phone:

- Hold the orb to talk and let go to send. Slide off it to discard the recording, and tap while glitch speaks to quiet it.
- While a turn works, the page shows the agent's latest thought. With the mutter on, it shows the Mandarin, with pinyin above each character, as it is spoken.
- When a turn needs your permission, the page shows the tool's whole input with Allow once and Deny, and waits up to 5 minutes. If the page isn't open, a notification asks instead. Root prompts appear only at the desk.
- Stop ends the running turn, whichever side started it, and "new chat, …" starts fresh
- Away from home the page offers an Open Tailscale button. With notifications allowed, the phone tells you when glitch needs you or finished a reply you didn't hear.

`glitch unpair` forgets every phone, and `glitch phone --off` turns the portal off. If the address changes, set the new `PORTAL_ADDR` in `~/.config/glitch/glitch.conf`, run `glitch cert --renew` and `glitch phone`, install the new certificate, add the app to the home screen again and pair again.

## Tech stack

- **Desktop**: Omarchy 4 shell plugin (Quickshell, QML) on Hyprland
- **Speech in**: voxtype (local Whisper)
- **Speech out**: Piper
- **Agent**: Claude Code or Codex, headless
- **Orb**: one fragment shader, shared by the desk and the phone
- **Orb's model**: Qwen3 1.7B on llama.cpp (TypeSafe's Jev or OpenAI with `MIND`)
- **Phone**: Python HTTPS server, WebGL2 page, Web Push

## Project structure

```
glitch/
├── bin/glitch         # The pipeline: keys, sessions, agent adapters, approvals, speech, reply card
├── plugin/
│   ├── orb.mjs        # The orb's logic, shared with the phone
│   ├── orb.glsl       # The orb's shader, shared with the phone
│   └── Glitch.qml     # Hosts the orb in the Omarchy shell
├── web/               # The phone portal's page and service worker
├── libexec/
│   ├── cue            # Beep synth
│   ├── speak          # Piper voice
│   ├── decide         # Picks the orb's reaction
│   ├── mandarin       # Translates a thought for the mutter
│   ├── portal         # The phone portal's HTTPS server
│   ├── preview        # Cycles orb styles while you tune reactions.json
│   └── desktop-root   # Desktop control's root half
├── config/            # Defaults: glitch.conf, reactions.json, voice-prompt.md, desktop.md
├── systemd/           # User units: glitch-mind, glitch-remote, glitch-portal
├── hypr/glitch.lua    # Key bindings
├── manifest.json      # Omarchy shell plugin manifest
├── install.sh
└── uninstall.sh
```

## Development

The log is `$XDG_RUNTIME_DIR/glitch/glitch.log`. To work on glitch itself, read [AGENTS.md](AGENTS.md).

## License

MIT, see [LICENSE](LICENSE).

## Credits

The creature's patterns, palettes, motions and beep synth come from Beep Jev by Yohei Nakajima (ported from the public app's bundle). The decision approach follows his [glance](https://github.com/yoheinakajima/glance) and TypeSafe's Jev.
