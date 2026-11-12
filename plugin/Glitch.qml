import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Services.Pipewire
import Quickshell.Wayland
import qs.Commons

// The face of glitch (bin/glitch). Its palettes, patterns, motions and beeps
// come from the Beep Jev creature (beepjev.replit.app, Yohei Nakajima); the
// shader (glitch.frag) draws them on a globe-edged disc whose pattern is
// centred on a gaze point, so the eye is the pattern.
//
// Two inputs:
//   1. A state plus a Jev-style reaction, over IPC (what it feels):
//        omarchy-shell glitch set '{"state":"tool","reaction":{"palette":"ocean","pattern":"waves",
//          "motion":"orbit","mood":"focused","energy":0.4}}'
//   2. Live signals, one per line, appended to $XDG_RUNTIME_DIR/glitch/orb.events
//      (what is happening right now):
//        turn             a new turn: clear ticks, moons, edits
//        tok <chars>      streamed text: the pattern drifts at token speed
//        tool <id> <cat>  a tool call went out (look, make, run, delegate)
//        end <id>         it came back
//        rest             the work is over: nothing is out any more
//        ctx <0..1>       how full the context is (the tide, shown while working)
//        say <hz> <v>...  the loudness envelope of the line about to be spoken (v = 0..99)
//        hush             speech stopped early
//      The mic level while listening is read here, from PipeWire.
Item {
  id: root

  property string mode: "idle"
  property bool shown: false

  // Reaction (the fields Jev chooses in the original).
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
    mono:     { color1: "#ffffff", color2: "#888888", bg: "#0a0a0a" },
    mint:     { color1: "#4de3a4", color2: "#17877a", bg: "#04130f" }
  })
  readonly property var patterns: ({ rings: 0, checker: 1, waves: 2, dots: 3, stripes: 4, noise: 5, fine: 6 })
  readonly property var pal: palettes[paletteName] || palettes.electric

  // CSS `transition-all duration-700 ease-out` on the creature.
  property color color1: pal.color1
  property color color2: pal.color2
  property color bgColor: pal.bg
  Behavior on color1 { ColorAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on color2 { ColorAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on bgColor { ColorAnimation { duration: 700; easing.type: Easing.OutCubic } }

  // A new pattern fades in over the old one.
  property string prevPattern: "rings"
  property real patMix: 0
  NumberAnimation { id: patFade; target: root; property: "patMix"; from: 1; to: 0; duration: 400; easing.type: Easing.InOutQuad }

  // One CSS px in logical px: the original's 200 px idle creature is ~128 here.
  readonly property real k: Style.space(128) / 200

  // width: 200 + (activity + energy) * 100 px; glow 40 + activity * 100 px.
  property real baseDiameter: 200 + (activity + energy) * 100
  property real baseGlow: 40 + activity * 100
  property real creatureScale: 1 + activity * 0.1
  Behavior on baseDiameter { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on baseGlow { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
  Behavior on creatureScale { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
  // The voice moves size and glow directly, with no easing in between.
  readonly property real diameter: baseDiameter + (mode === "listening" ? 8 : 5) * voice

  readonly property bool working: mode === "thinking" || mode === "tool"
  readonly property bool conversing: mode === "listening" || mode === "transcribing" || mode === "speaking"

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
    if (r.pattern && r.pattern !== root.pattern) {
      root.prevPattern = root.pattern
      root.pattern = r.pattern
      patFade.restart()
    }
    if (r.motion && r.motion !== root.motion) { root.motion = r.motion; motionAmp.restart(); phaseAnim.restart() }
    if (r.mood) root.mood = r.mood
    if (r.energy !== undefined) root.energy = Math.max(0, Math.min(1, Number(r.energy)))
    if (s === "tool" || s === "speaking" || (s === "listening" && root.mode !== "listening")) root.bump(0.25)
    if (s === "transcribing" && root.mode === "listening") { root.dipAt = root.clock; root.rushUntil = root.clock + 0.45; blinkAnim.restart() }
    if (s !== root.mode) root.sayStart = -1  // a new state ends the last line's envelope
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

  // ---- live signals ----------------------------------------------------------
  property real clock: 0            // seconds, advanced each frame while visible

  property real pendingChars: 0     // streamed text not yet turned into drift
  property real tokenRate: 0        // 0..1.5, about 1 at full streaming speed
  property real scrollX: 0
  property real scrollY: 0

  property var inflight: ({})       // tool id -> category
  property real lookUntil: -1       // quick tools still get a visible beat
  property real cometUntil: -1
  property real lookAngle: -0.5
  readonly property bool lookOut: working && (countOut("look") > 0 || clock < lookUntil)
  readonly property bool toolOut: working && (countOut("run") + countOut("delegate") > 0 || clock < cometUntil)
  property real radarAmt: lookOut ? 1 : 0
  property real cometAmt: toolOut ? 1 : 0
  Behavior on radarAmt { NumberAnimation { duration: 250 } }
  Behavior on cometAmt { NumberAnimation { duration: 300 } }

  property int edits: 0
  property real editAt: -10
  property real flash: 0
  // Cells only ever fill in: the first edit starts from the same share as none.
  property real reveal: 0.06 + 0.72 * (1 - Math.exp(-0.5 * Math.max(1, edits)))
  Behavior on reveal { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }

  property int ticks: 0             // tool calls this turn
  property real tickAt: -10
  property real workAlpha: working ? 1 : 0   // ticks and tide belong to the work: gone once it speaks
  Behavior on workAlpha { NumberAnimation { duration: 600 } }

  property var moons: []            // subagents out working: {id, born, back, w, ph, rad}
  property int moonsBorn: 0         // this turn, so each takes its own orbit
  property real ctx: 0              // context fill 0..1

  function countOut(cat) {
    var n = 0
    for (var id in inflight) if (inflight[id] === cat) n++
    return n
  }

  function event(line) {
    var a = line.trim().split(" ")
    switch (a[0]) {
    case "turn":
      ticks = 0; edits = 0; moons = []; moonsBorn = 0; inflight = ({}); pendingChars = 0; flash = 0
      scrollX = 0; scrollY = 0
      break
    case "rest":
      inflight = ({})
      if (moons.some(o => o.back < 0)) moons = moons.map(o => o.back < 0 ? Object.assign({}, o, { back: clock }) : o)
      break
    case "tok":
      pendingChars = Math.max(0, Math.min(2000, pendingChars + (Number(a[1]) || 0)))
      break
    case "tool": {
      var cat = a[2] || "run", next = Object.assign({}, inflight)
      next[a[1]] = cat
      inflight = next
      ticks++
      tickAt = clock
      if (cat === "make") { edits++; flash = 1; editAt = clock }
      else if (cat === "look") { lookUntil = clock + 0.9; lookAngle = Math.random() * 2 * Math.PI }
      else {
        cometUntil = clock + 0.6
        if (cat === "delegate" && moons.length < 6) {
          var i = moonsBorn++ % 6
          moons = moons.concat([{ id: a[1], born: clock, back: -1, w: [1.9, -1.4, 1.6, -1.1, 1.3, -1.7][i],
                                  ph: Math.random() * 2 * Math.PI, rad: [40, 54, 46, 60, 50, 66][i] }])
        }
      }
      break
    }
    case "end": {
      var left = Object.assign({}, inflight)
      delete left[a[1]]
      inflight = left
      var ms = moons.slice(), hit = false
      for (var j = 0; j < ms.length; j++)
        if (ms[j].id === a[1] && ms[j].back < 0) { ms[j] = Object.assign({}, ms[j], { back: clock }); hit = true }
      if (hit) moons = ms
      break
    }
    case "ctx":
      ctx = Math.max(0, Math.min(1, Number(a[1]) || 0))
      break
    case "say": {
      var hz = Number(a[1]) || 50, e = []
      for (var n = 2; n < a.length; n++) e.push(Math.max(0, Math.min(1, Number(a[n]) / 99)) || 0)
      sayEnv = e; sayHz = hz; sayStart = clock + 0.06  // pw-play takes a moment to start
      break
    }
    case "hush":
      sayStart = -1
      break
    }
  }

  // The script appends to this file; tail hands each line over as it lands.
  // GLITCH_RT points a test instance at a scratch directory.
  readonly property string runtimeDir: Quickshell.env("GLITCH_RT") || (Quickshell.env("XDG_RUNTIME_DIR") + "/glitch")
  Process {
    running: true
    // The file is made first: a tail that starts without it polls for the
    // rest of its life, and every signal lands up to its poll interval late.
    command: ["sh", "-c", 'mkdir -p "$1" && : >>"$1/orb.events" && exec tail -n 0 -F "$1/orb.events"', "sh", root.runtimeDir]
    stdout: SplitParser { onRead: line => root.event(line) }
    onExited: running = true
  }

  // ---- voice -------------------------------------------------------------------
  // Listening: the mic's level. Speaking: the envelope of the wav being played.
  // Shown as light (halo, glow) and travel (rings in when you talk, out when it
  // does), with about 1% of rim give and a 2% stretch.
  property real voice: 0            // smoothed, drives halo and travel
  property real voiceFast: 0        // nearly raw, drives the give
  property real micMax: 0.02        // running peak, linear, never under -34 dBFS: a quiet voice still fills the range
  property var sayEnv: []
  property real sayHz: 50
  property real sayStart: -1
  property real ringPhase: 0
  property real rushUntil: -1       // the swallow: the last rings run in
  property real dipAt: -10
  property real lastOnset: -10
  property var pingStart: [-10, -10, -10, -10]
  property vector4d pings: Qt.vector4d(0, 0, 0, 0)
  property real pingDir: 1

  PwObjectTracker { objects: [Pipewire.defaultAudioSource] }
  PwNodePeakMonitor {
    id: mic
    node: Pipewire.defaultAudioSource
    enabled: root.shown && root.mode === "listening"
  }

  function ping(dir) {
    var p = pingStart.slice(), oldest = 0
    for (var i = 1; i < 4; i++) if (p[i] < p[oldest]) oldest = i
    p[oldest] = clock
    pingStart = p
    pingDir = dir
  }

  // An impulse that rings out (the swallow, an edit).
  function kick(u, freq, damp) { return u <= 0 ? 0 : Math.exp(-damp * u) * Math.sin(freq * u) }

  // ---- the eye -------------------------------------------------------------------
  // The gaze point the pattern is centred on. It follows the pointer like the
  // original's eye, rests on centre while you talk, and goes to the work.
  property real cursorPctX: 50
  property real cursorPctY: 50
  property double lastMouseMove: 0
  property real eyeX: 0
  property real eyeY: 0
  property real wanderX: 0
  property real wanderY: 0
  // wanderTick only forces re-evaluation: Date.now() isn't reactive.
  readonly property bool mouseIdle: Date.now() - lastMouseMove > 4000 && wanderTick >= 0
  property int wanderTick: 0

  readonly property point eyeTarget: {
    if (conversing) return Qt.point(0, -4)
    if (lookOut) return Qt.point(34 * Math.cos(lookAngle) + 6 * Math.sin(clock * 5), 26 * Math.sin(lookAngle) + 5 * Math.cos(clock * 4))
    if (working && clock - editAt < 1.2) return Qt.point(-4, 18)
    if (toolOut) return Qt.point(0, 0)
    if (working && mouseIdle) return Qt.point(wanderX, wanderY)
    return Qt.point((cursorPctX - 50) * 0.5, (cursorPctY - 50) * 0.5)
  }

  // A blink flattens the magnification for a moment.
  property real lid: 1
  SequentialAnimation {
    id: blinkAnim
    NumberAnimation { target: root; property: "lid"; to: 0.08; duration: 70; easing.type: Easing.InQuad }
    NumberAnimation { target: root; property: "lid"; to: 1; duration: 110; easing.type: Easing.OutQuad }
  }
  Timer {
    interval: 3000
    repeat: true
    running: root.shown && !root.reduceMotion
    onTriggered: { blinkAnim.restart(); interval = 2600 + Math.random() * 3600 }
  }

  // The overlay takes no input, so the cursor is polled over Hyprland's request
  // socket while the orb is visible (20 Hz, no process spawns). One request per
  // connection: Hyprland answers `j/cursorpos` and hangs up.
  property string cursorBuf: ""
  Socket {
    id: hyprSock
    path: Quickshell.env("XDG_RUNTIME_DIR") + "/hypr/" + Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE") + "/.socket.sock"
    onConnectedChanged: if (connected) { root.cursorBuf = ""; write("j/cursorpos"); flush() }
    parser: SplitParser {
      splitMarker: ""
      onRead: data => {
        root.cursorBuf += data
        if (root.readCursor(root.cursorBuf)) hyprSock.connected = false
      }
    }
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
    onTriggered: if (!hyprSock.connected) hyprSock.connected = true
  }

  Timer {
    interval: 1100
    repeat: true
    running: root.shown
    onTriggered: {
      root.wanderTick++
      var a = Math.random() * 2 * Math.PI, d = 22 * (0.3 + Math.random() * 0.7)
      root.wanderX = Math.cos(a) * d
      root.wanderY = Math.sin(a) * d
    }
  }

  // ---- per frame -----------------------------------------------------------------
  property real swellPhase: 0
  property real swellDrift: 0
  property real radarAngle: 0
  property real cometAngle: 0

  FrameAnimation {
    running: panel.visible
    onTriggered: {
      var dt = Math.min(frameTime, 0.1)
      root.clock += dt

      // Frame-rate independent version of the original's `x += (target - x) * 0.1` at 60 fps.
      var f = 1 - Math.pow(0.9, dt * 60)
      root.eyeX += (root.eyeTarget.x - root.eyeX) * f
      root.eyeY += (root.eyeTarget.y - root.eyeY) * f

      var target = 0
      if (root.mode === "listening") {
        // The monitor's peak is the cube root of the sample peak; undo that, or
        // room noise alone reads as a tenth of full scale.
        var raw = Math.pow(mic.peak || 0, 3)
        root.micMax = Math.max(root.micMax * Math.pow(0.5, dt / 20), raw, 0.02)
        target = Math.min(1.25, raw / (root.micMax * 0.8))
      } else if (root.sayStart >= 0) {
        var i = Math.floor((root.clock - root.sayStart) * root.sayHz)
        if (i >= 0 && i < root.sayEnv.length) target = root.sayEnv[i]
      }
      var before = root.voice
      root.voiceFast += (target - root.voiceFast) * (1 - Math.exp(-dt / 0.03))
      root.voice += (target - root.voice) * (1 - Math.exp(-dt / 0.09))
      if (root.voice >= 0.5 && before < 0.5 && root.clock - root.lastOnset >= 0.2) {
        root.lastOnset = root.clock
        root.ping(root.mode === "listening" ? -1 : 1)
      }

      // Rings creep in while you talk and out while it does, faster with the sound.
      if (root.mode === "listening") root.ringPhase += (14 + 150 * root.voice) * dt
      else if (root.mode === "speaking") root.ringPhase -= (8 + 140 * root.voice) * dt
      if (root.clock < root.rushUntil) root.ringPhase += 400 * dt
      root.ringPhase %= 42000

      // Streamed text becomes drift, eased so bursts don't jerk.
      var flow = root.pendingChars * (1 - Math.exp(-dt / 0.25))
      root.pendingChars -= flow
      root.tokenRate = dt > 0 ? Math.min(1.5, flow / dt / 220) : 0
      if (root.working && !root.reduceMotion) {  // scroll resets each turn, so it stays small
        root.scrollX += 30 * root.tokenRate * dt
        root.scrollY += 16 * root.tokenRate * dt
      }

      // Waves roll gently at rest, and at token speed while working.
      var pace = root.reduceMotion ? 0 : (root.working ? 0.2 + root.tokenRate : 1)
      root.swellPhase = (root.swellPhase + 1.57 * pace * dt) % (2 * Math.PI)
      root.swellDrift = (root.swellDrift - 10 * pace * dt) % 40

      root.radarAngle = (root.radarAngle + 3.6 * dt) % (2 * Math.PI)
      root.cometAngle = (root.cometAngle + 7.0 * dt) % (2 * Math.PI)
      root.flash *= Math.exp(-7 * dt)

      var p = root.pingStart, u = [0, 0, 0, 0]
      for (var n = 0; n < 4; n++) {
        var x = (root.clock - p[n]) / 0.8
        u[n] = x > 0 && x < 1 ? x : 0
      }
      root.pings = Qt.vector4d(u[0], u[1], u[2], u[3])

      // A subagent's moon that has come home is removed, with a bump and one ping.
      var ms = root.moons, keep = ms.filter(m => m.back < 0 || root.clock - m.back < 0.5)
      if (keep.length !== ms.length) {
        root.moons = keep
        root.bump(0.3)
        if (root.mode !== "listening") root.ping(1)  // while listening, pings travel inward only
      }
    }
  }

  // Like the original's prefers-reduced-motion rule: with Hyprland animations
  // off, the creature holds still (colours and size still change).
  property bool reduceMotion: false
  Process {
    running: true
    command: ["hyprctl", "-j", "getoption", "animations:enabled"]
    stdout: StdioCollector {
      onStreamFinished: { try { root.reduceMotion = JSON.parse(text).int === 0 } catch (e) {} }
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
    switch (reduceMotion ? "still" : motion) {
    case "breathe": return { x: 0, y: 0, rot: 0, sx: 1 + 0.15 * s * a, sy: 1 + 0.15 * s * a }
    case "wobble": { var w = -1 + 2 * s; return { x: 0, y: 0, rot: 5 * w * a, sx: 1 + 0.05 * w * a, sy: 1 + 0.05 * w * a } }
    case "orbit": return { x: 20 * Math.cos(2 * Math.PI * t) * a, y: 20 * Math.sin(2 * Math.PI * t) * a, rot: 0, sx: 1, sy: 1 }
    case "jitter": {
      var pts = [[0, 0], [-2, 2], [2, -2], [-2, -2], [2, 2]]
      var i = Math.min(3, Math.floor(t * 4)), f = t * 4 - i
      return { x: (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f) * a, y: (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f) * a, rot: 0, sx: 1, sy: 1 }
    }
    // A hop with 1% of squash.
    case "bounce": return { x: 0, y: -24 * s * a, rot: 0, sx: 1 + (0.01 - 0.02 * s) * a, sy: 1 + (-0.01 + 0.02 * s) * a }
    default: return { x: 0, y: 0, rot: 0, sx: 1, sy: 1 }
    }
  }

  // The little give: a 2% stretch as it speaks, a dip as it swallows your
  // request, and a smaller one for each edit.
  readonly property var give: {
    if (reduceMotion) return { sx: 1, sy: 1 }
    var g = kick(clock - dipAt, 13, 6), e = kick(clock - editAt, 15, 7)
    var v = sayStart >= 0 ? voiceFast : 0
    return { sx: 1 + 0.008 * v + 0.025 * g + 0.02 * e, sy: 1 + 0.022 * v - 0.04 * g - 0.03 * e }
  }

  // Surprised: the pill's own animate-bounce (1 s), independent of the body.
  property real pillPhase: 0
  NumberAnimation on pillPhase {
    from: 0; to: 1; loops: Animation.Infinite; duration: 1000
    running: root.mood === "surprised" && panel.visible && !root.reduceMotion
  }

  // Excited: animate-ping ring, 1 s loop (scale to 2x and fade by 75%).
  property real excitedRing: 0
  SequentialAnimation on excitedRing {
    running: root.mood === "excited" && panel.visible && !root.reduceMotion
    loops: Animation.Infinite
    NumberAnimation { from: 0.001; to: 1; duration: 750; easing.type: Easing.OutCubic }
    PauseAnimation { duration: 250 }
  }

  IpcHandler {
    target: "glitch"
    function set(payloadJson: string): string { root.set(payloadJson); return "ok" }
    function event(line: string): string { root.event(line); return "ok" }
    function hide(): string { root.shown = false; root.mode = "idle"; return "ok" }
    function ping(): string { return "ok" }
  }

  PanelWindow {
    id: panel
    // Follow the focused monitor so the orb appears where you're looking
    // (GLITCH_SCREEN pins it to one output, for testing).
    screen: {
      var name = Quickshell.env("GLITCH_SCREEN") || (Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : "")
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
        y: parent.height - 260 * root.k - height / 2
        transform: [
          Scale {
            origin.x: creature.width / 2; origin.y: creature.height / 2
            xScale: root.motionT.sx * root.creatureScale * root.give.sx
            yScale: root.motionT.sy * root.creatureScale * root.give.sy
          },
          Rotation { origin.x: creature.width / 2; origin.y: creature.height / 2; angle: root.motionT.rot },
          Translate {
            x: (root.motionT.x + root.eyeX * 0.2) * root.k
            y: (root.motionT.y + root.eyeY * 0.2) * root.k
          }
        ]

        ShaderEffect {
          id: body
          // Creature plus room for the outer glow and the voice rings.
          readonly property real padCss: 190
          width: (root.diameter + 2 * padCss) * root.k
          height: width
          anchors.centerIn: parent
          fragmentShader: Qt.resolvedUrl("glitch.frag.qsb")

          property color primary: root.color1
          property color secondary: root.color2
          property color bg: root.bgColor
          property real itemPx: root.diameter + 2 * padCss
          property real diameter: root.diameter
          property real glowBlur: Math.min(130, root.baseGlow + 80 * root.voice)
          property real glowAlpha: 0.25 + 0.22 * root.voice
          property real pattern: root.patterns[root.pattern] !== undefined ? root.patterns[root.pattern] : 0
          property real pattern2: root.patterns[root.prevPattern] !== undefined ? root.patterns[root.prevPattern] : 0
          property real patMix: root.patMix
          property point eye: Qt.point(root.eyeX, root.eyeY)
          property real lens: (0.62 + 0.06 * root.voice) * root.lid
          property real lensSize: 30 + root.energy * 8 + 7 * root.voice
          property real eyeGlow: (0.62 + (root.sayStart >= 0 ? 0.3 * root.voice : 0)) * (0.2 + 0.8 * root.lid)
          property real aa: 1 / (root.k * (panel.screen ? panel.screen.devicePixelRatio : 1))
          property point scroll: Qt.point(root.scrollX, root.scrollY)
          property real ringPhase: root.ringPhase
          property real swellPhase: root.swellPhase
          property real swellDrift: root.swellDrift
          property real reveal: root.reveal
          property real flash: root.flash
          property real wobble: root.mode === "listening" && !root.reduceMotion ? 0.010 * root.voiceFast : 0
          property real wobblePhase: root.clock
          property real radar: 0.36 * root.radarAmt
          property real radarAngle: root.radarAngle
          property real comet: root.cometAmt
          property real cometAngle: root.cometAngle
          property real tide: root.ctx
          property real tideShow: root.workAlpha
          property real tidePhase: root.clock
          property vector4d pings: root.pings
          property real pingDir: root.pingDir
          property real ring: root.mood === "excited" ? root.excitedRing : 0
        }

        // Ticks on the bezel: one per tool call this turn, the newest one lit.
        Repeater {
          model: Math.min(root.ticks, 39)
          Rectangle {
            required property int index
            readonly property real fresh: index === (root.ticks - 1) % 39 ? Math.exp(-(root.clock - root.tickAt) * 3) : 0
            readonly property real a: -Math.PI / 2 + index * 0.161
            readonly property real orbit: (root.diameter / 2 + 10) * root.k
            width: (6.6 + 3.8 * fresh) * root.k
            height: width
            radius: width / 2
            color: Qt.tint(root.color2, Qt.rgba(1, 1, 1, 0.55))
            opacity: root.workAlpha * (0.55 + 0.45 * fresh)
            x: creature.width / 2 + Math.cos(a) * orbit - width / 2
            y: creature.height / 2 + Math.sin(a) * orbit - height / 2
          }
        }

        // Moons: subagents out working. A returning one fires a single ping.
        Repeater {
          model: root.moons.length
          Item {
            required property int index
            readonly property var m: root.moons[index] || { born: 0, back: -1, w: 1, ph: 0, rad: 40 }
            readonly property real out: root.smooth((root.clock - m.born) / 0.7)
            readonly property real home: m.back < 0 ? 0 : root.smooth((root.clock - m.back) / 0.5)
            readonly property real orbit: ((root.diameter / 2 + m.rad * out) * (1 - home) + root.diameter / 4 * home) * root.k
            readonly property real a: m.ph + m.w * (root.clock - m.born)
            x: creature.width / 2 + Math.cos(a) * orbit
            y: creature.height / 2 + Math.sin(a) * orbit
            Rectangle {  // glow
              width: 26 * root.k; height: width; radius: width / 2
              anchors.centerIn: parent
              color: root.color2
              opacity: 0.16 * parent.out * (1 - parent.home)
            }
            Rectangle {
              width: 9.2 * (0.4 + 0.6 * parent.out) * (1 - 0.4 * parent.home) * root.k; height: width; radius: width / 2
              anchors.centerIn: parent
              color: Qt.tint(root.color2, Qt.rgba(1, 1, 1, 0.55))
              opacity: 0.95 * (1 - parent.home)
            }
          }
        }

        // Surprised: a little white pill bouncing above the creature.
        Rectangle {
          visible: root.mood === "surprised"
          width: 16 * root.k
          height: 32 * root.k
          radius: width / 2
          color: Qt.rgba(1, 1, 1, 0.5)
          anchors.horizontalCenter: parent.horizontalCenter
          y: parent.height / 2 - root.diameter * root.k / 2 - 32 * root.k - 40 * root.k * root.swing(root.pillPhase)
        }
      }
    }
  }

  function smooth(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u) }
}
