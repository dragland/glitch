import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons

// The face of glitch (bin/glitch): a port of the Beep Jev creature
// (beepjev.replit.app, Yohei Nakajima). Its CSS patterns, borders and glows are
// drawn by glitch.frag (install.sh compiles it: qsb --qt6 -o glitch.frag.qsb glitch.frag)
// and its CSS keyframe motions run as scene-graph animations, so everything
// moves at the display's refresh rate on the GPU.
//
// The script pushes a state plus a Jev-style reaction:
//   omarchy-shell glitch set '{"state":"tool","reaction":{"palette":"ocean","pattern":"waves",
//     "motion":"orbit","mood":"focused","energy":0.4}}'
Item {
  id: root

  property string mode: "idle"
  property bool shown: false

  // Reaction (same fields Jev chooses in the original).
  property string paletteName: "electric"
  property string pattern: "rings"
  property string motion: "breathe"
  property string mood: "curious"
  property real energy: 0.5

  // Activity energy (the original's typing energy): bumps on events, decays
  // 0.05 every 100 ms.
  property real activity: 0

  readonly property var palettes: ({
    electric: { color1: "#00f0ff", color2: "#ff0055", bg: "#08080c" },
    sunset:   { color1: "#ff7b54", color2: "#ffb26b", bg: "#1a0b12" },
    ocean:    { color1: "#00a8cc", color2: "#27496d", bg: "#011520" },
    citrus:   { color1: "#b2d826", color2: "#ffcc00", bg: "#121808" },
    candy:    { color1: "#ff99cc", color2: "#cc99ff", bg: "#1a081c" },
    mono:     { color1: "#ffffff", color2: "#888888", bg: "#0a0a0a" }
  })
  readonly property var patterns: ({ rings: 0, checker: 1, waves: 2, dots: 3, stripes: 4, noise: 5 })
  readonly property var pal: palettes[paletteName] || palettes.electric

  // CSS `transition-all duration-700 ease-out` on the creature.
  property color color1: pal.color1
  property color color2: pal.color2
  property color bgColor: pal.bg
  Behavior on color1 { ColorAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on color2 { ColorAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on bgColor { ColorAnimation { duration: 700; easing.type: Easing.OutCubic } }

  // One CSS px in logical px: the original's 200 px idle creature is ~128 here.
  readonly property real k: Style.space(128) / 200

  // width: 200 + (activity + energy) * 100 px; glow 40 + activity * 100 px.
  property real diameter: 200 + (activity + energy) * 100
  property real glowBlur: 40 + activity * 100
  property real creatureScale: 1 + activity * 0.1
  Behavior on diameter { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on glowBlur { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on creatureScale { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }

  // Eye: follows a wandering target with the original's 10%-per-frame ease.
  property real eyeTargetX: working && mouseIdle ? wanderX : (cursorPctX - 50) * 0.5
  property real eyeTargetY: working && mouseIdle ? wanderY : (cursorPctY - 50) * 0.5
  property real eyeX: 0
  property real eyeY: 0

  function bump(amount) { activity = Math.min(1, activity + amount) }

  function lingerFor(s) {
    if (s === "done") return 4500
    if (s === "needs_you") return 25000
    if (s === "error") return 9000
    if (s === "idle") return 1200
    return 0
  }

  function set(payloadJson) {
    var m
    try { m = JSON.parse(payloadJson || "{}") } catch (e) { return }
    var s = m.state || "idle"
    if (s === "idle" && !root.shown) return
    var r = m.reaction || {}
    if (r.palette) root.paletteName = r.palette
    if (r.pattern) root.pattern = r.pattern
    if (r.motion && r.motion !== root.motion) { root.motion = r.motion; motionAmp.restart(); phaseAnim.restart() }
    if (r.mood) root.mood = r.mood
    if (r.energy !== undefined) root.energy = Math.max(0, Math.min(1, Number(r.energy)))
    if (s === "tool" || s === "speaking" || (s === "listening" && root.mode !== "listening")) root.bump(0.25)
    root.mode = s
    root.shown = true
    var linger = lingerFor(s)
    if (linger > 0) { hideTimer.interval = linger; hideTimer.restart() }
    else hideTimer.stop()
  }

  Timer {
    id: hideTimer
    onTriggered: root.shown = false
  }

  Timer {
    interval: 100
    repeat: true
    running: root.shown
    onTriggered: root.activity = Math.max(0, root.activity - 0.05)
  }

  // Speech-like flutter: while you talk or it talks, small bumps at syllable
  // rate stand in for the original's keystrokes.
  Timer {
    interval: 150 + Math.random() * 120
    repeat: true
    running: root.shown && (root.mode === "listening" || root.mode === "speaking")
    onTriggered: { if (Math.random() < 0.7) root.bump(0.08) }
  }

  // ---- the mouse ------------------------------------------------------------
  // Like the original, the eye follows the pointer: offset (pct - 50) * 0.5 px,
  // and moving the mouse feeds activity energy (+0.05 per move). The overlay
  // takes no input, so the cursor is polled from Hyprland while it's visible.
  property real cursorPctX: 50
  property real cursorPctY: 50
  property double lastMouseMove: 0

  Process {
    id: cursorProc
    command: ["hyprctl", "-j", "cursorpos"]
    stdout: StdioCollector { onStreamFinished: root.readCursor(text) }
  }

  function readCursor(raw) {
    var c
    try { c = JSON.parse(raw) } catch (e) { return false }
    var scr = panel.screen
    if (!scr || c.x === undefined) return true
    var px = Math.max(0, Math.min(100, (c.x - scr.x) / scr.width * 100))
    var py = Math.max(0, Math.min(100, (c.y - scr.y) / scr.height * 100))
    if (Math.abs(px - cursorPctX) + Math.abs(py - cursorPctY) > 0.15) {
      cursorPctX = px
      cursorPctY = py
      lastMouseMove = Date.now()
      bump(0.05)
    }
    return true
  }

  Timer {
    interval: 50
    repeat: true
    running: panel.visible
    onTriggered: if (!cursorProc.running) cursorProc.running = true
  }

  // Eye target: the pointer, unless the mouse has been idle for a while during
  // work, when the eye wanders (or scans while searching) on its own.
  property real wanderX: 0
  property real wanderY: 0
  readonly property bool mouseIdle: Date.now() - lastMouseMove > 4000 && wanderTick >= 0
  property int wanderTick: 0
  Timer {
    interval: 1100
    repeat: true
    running: root.shown
    onTriggered: {
      root.wanderTick++
      var reach = 22
      if (root.pattern === "waves") {
        root.wanderX = root.wanderX > 0 ? -reach : reach
        root.wanderY = 0
      } else {
        var a = Math.random() * 2 * Math.PI, d = reach * (0.3 + Math.random() * 0.7)
        root.wanderX = Math.cos(a) * d
        root.wanderY = Math.sin(a) * d
      }
    }
  }
  readonly property bool working: mode === "thinking" || mode === "tool" || mode === "transcribing"

  FrameAnimation {
    running: panel.visible
    onTriggered: {
      // Frame-rate independent version of `x += (target - x) * 0.1` at 60 fps.
      var f = 1 - Math.pow(0.9, frameTime * 60)
      root.eyeX += (root.eyeTargetX - root.eyeX) * f
      root.eyeY += (root.eyeTargetY - root.eyeY) * f
    }
  }

  // ---- CSS keyframe motions ------------------------------------------------
  readonly property var motionDurations: ({ bounce: 1000, orbit: 4000, wobble: 2000, breathe: 4000, jitter: 200, still: 1000 })
  property real phase: 0
  NumberAnimation on phase {
    id: phaseAnim
    from: 0; to: 1; loops: Animation.Infinite
    duration: root.motionDurations[root.motion] || 4000
    running: panel.visible
  }
  // Blend into a new motion instead of the original's hard class swap.
  property real amp: 1
  NumberAnimation { id: motionAmp; target: root; property: "amp"; from: 0; to: 1; duration: 450; easing.type: Easing.OutCubic }

  // ease-in-out between keyframes at 0%, 50%, 100%.
  function swing(t) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * t) }
  readonly property var motionT: {
    var t = phase, s = swing(t), a = amp
    switch (motion) {
    case "breathe": return { x: 0, y: 0, rot: 0, sx: 1 + 0.15 * s * a, sy: 1 + 0.15 * s * a }
    case "wobble": { var w = -1 + 2 * s; return { x: 0, y: 0, rot: 5 * w * a, sx: 1 + 0.05 * w * a, sy: 1 + 0.05 * w * a } }
    case "orbit": return { x: 20 * Math.cos(2 * Math.PI * t) * a, y: 20 * Math.sin(2 * Math.PI * t) * a, rot: 0, sx: 1, sy: 1 }
    case "jitter": {
      var pts = [[0, 0], [-2, 2], [2, -2], [-2, -2], [2, 2]]
      var i = Math.min(3, Math.floor(t * 4)), f = t * 4 - i
      return { x: (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f) * a, y: (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f) * a, rot: 0, sx: 1, sy: 1 }
    }
    case "bounce": return { x: 0, y: -40 * s * a, rot: 0, sx: 1 + (0.05 - 0.1 * s) * a, sy: 1 + (-0.05 + 0.1 * s) * a }
    default: return { x: 0, y: 0, rot: 0, sx: 1, sy: 1 }
    }
  }

  // Excited: animate-ping ring, 1 s loop (scale to 2x and fade by 75%).
  property real ping: 0
  SequentialAnimation on ping {
    running: root.mood === "excited" && panel.visible
    loops: Animation.Infinite
    NumberAnimation { from: 0.001; to: 1; duration: 750; easing.type: Easing.OutCubic }
    PauseAnimation { duration: 250 }
  }

  IpcHandler {
    target: "glitch"
    function set(payloadJson: string): string { root.set(payloadJson); return "ok" }
    function hide(): string { root.shown = false; return "ok" }
    function state(): string { return root.shown ? root.mode : "hidden" }
    function ping(): string { return "ok" }
  }

  PanelWindow {
    id: panel
    // Follow the focused monitor so the orb appears where you're looking.
    screen: {
      var name = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
      for (var i = 0; i < Quickshell.screens.length; i++)
        if (Quickshell.screens[i].name === name) return Quickshell.screens[i]
      return Quickshell.screens[0]
    }
    visible: root.shown || stage.opacity > 0.01
    anchors { bottom: true }
    implicitWidth: Math.ceil(760 * root.k)
    implicitHeight: Math.ceil(760 * root.k)
    color: "transparent"
    WlrLayershell.namespace: "glitch-orb"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    mask: Region {}

    Item {
      id: stage
      anchors.fill: parent
      opacity: root.shown ? 1 : 0
      scale: root.shown ? 1 : 0.85
      Behavior on opacity { NumberAnimation { duration: 400; easing.type: Easing.OutCubic } }
      Behavior on scale { NumberAnimation { duration: 500; easing.type: Easing.OutBack } }

      // Motion + the creature's own translate (eye * 0.2) and scale.
      Item {
        id: creature
        // Centre the creature low in the window, leaving headroom for growth and bounce.
        width: parent.width
        height: parent.width
        y: parent.height - 230 * root.k - height / 2
        transform: [
          Scale {
            origin.x: creature.width / 2; origin.y: creature.height / 2
            xScale: root.motionT.sx * root.creatureScale
            yScale: root.motionT.sy * root.creatureScale
          },
          Rotation { origin.x: creature.width / 2; origin.y: creature.height / 2; angle: root.motionT.rot },
          Translate {
            x: (root.motionT.x + root.eyeX * 0.2) * root.k
            y: (root.motionT.y + root.eyeY * 0.2) * root.k
          }
        ]

        ShaderEffect {
          id: body
          // Creature plus room for the outer glow.
          readonly property real padCss: 150
          width: (root.diameter + 2 * padCss) * root.k
          height: width
          anchors.centerIn: parent
          fragmentShader: Qt.resolvedUrl("glitch.frag.qsb")

          property color primary: root.color1
          property color secondary: root.color2
          property color bg: root.bgColor
          property real itemPx: root.diameter + 2 * padCss
          property real diameter: root.diameter
          property real glowBlur: root.glowBlur
          property real pattern: root.patterns[root.pattern] !== undefined ? root.patterns[root.pattern] : 0
          property point eye: Qt.point(root.eyeX, root.eyeY)
          property real eyeSize: 40 + root.energy * 20
          property real aa: 1 / (root.k * (panel.screen ? panel.screen.devicePixelRatio : 1))
          property real ring: root.mood === "excited" ? root.ping : 0
          property real focusRing: root.mood === "focused" ? 1 : 0
        }

        // Surprised: a little white pill bouncing above the creature.
        Rectangle {
          visible: root.mood === "surprised"
          width: 16 * root.k
          height: 32 * root.k
          radius: width / 2
          color: Qt.rgba(1, 1, 1, 0.5)
          anchors.horizontalCenter: parent.horizontalCenter
          y: parent.height / 2 - root.diameter * root.k / 2 - 32 * root.k - 40 * root.k * root.swing(root.phase)
        }
      }
    }
  }
}
