-- glitch keybindings. install.sh links this to ~/.config/hypr/glitch.lua and
-- adds require("hypr.glitch") to ~/.config/hypr/hyprland.lua.
--
-- Tap to start talking, tap again to send. Either key sends; the one that
-- starts the recording decides whether it continues the session or starts fresh.
o.bind("SUPER + D", "Talk to glitch (tap to start/send)", "glitch toggle")
o.bind("SUPER + ALT + D", "Talk to glitch, new session (tap to start/send)", "glitch toggle --new")
o.bind("SUPER + ALT + SHIFT + D", "Open the glitch session in a terminal", "glitch open")
o.bind("SUPER + ALT + BACKSPACE", "Cancel glitch (recording, turn and speech)", "glitch cancel")
