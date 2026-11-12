## Desktop control (Omarchy, Hyprland, Wayland)

There is no built-in computer use on Linux; drive the desktop with these instead. Prefer the most precise tool: Claude in Chrome for the browser, `hyprctl` for windows, and the screen only for what nothing else reaches.

- See: `grim /tmp/screen.png` (or `grim -g "x,y wxh"` for a region), then read the image. Its pixels are the cursor coordinates (`hyprctl monitors` for layout and scale).
- Windows: `hyprctl clients -j`, `hyprctl activewindow -j`; launch apps with `omarchy launch …` or `uwsm-app -- <cmd>`.
- Mouse: `ydotool mousemove --absolute -x X -y Y`, then `ydotool click 0xC0` (left; `0xC1` right). Check the result with `hyprctl cursorpos` or a new screenshot.
- Keyboard: `wtype 'text'` types into the focused window; `wtype -M ctrl l -m ctrl` for a chord.

Someone may be using this screen: look before you click, and act in the window you mean to. Ask before you buy, send, post or delete anything that wasn't explicitly asked for.
