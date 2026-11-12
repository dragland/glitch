import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Services.Pipewire
import Quickshell.Wayland
import qs.Commons
import "orb.mjs" as Orb

// The face of glitch (bin/glitch). Its palettes, patterns, motions and beeps
// come from the Beep Jev creature (beepjev.replit.app, Yohei Nakajima); the
// shader (orb.glsl) draws them on a globe-edged disc whose pattern is centred
// on a gaze point, so the eye is the pattern.
//
// This file only hosts the orb: orb.mjs holds its logic and lists its inputs,
// shared with the web orb (web/orb.js). Here, the state comes over IPC, the
// live signals are tailed from $XDG_RUNTIME_DIR/glitch/orb.events, and the mic
// level while listening is read from PipeWire.
Item {
  id: root

  readonly property var core: Orb.createOrb()
  property var f: core.frame()
  readonly property var u: f.uniforms
  readonly property real k: Style.space(128) / 200

  function set(payloadJson) { core.set(payloadJson); f = core.frame() }
  function event(line) { core.event(line); f = core.frame() }
  function rgba(c) { return Qt.rgba(c[0], c[1], c[2], c[3]) }
  function v2(a) { return Qt.point(a[0], a[1]) }
  function v4(a) { return Qt.vector4d(a[0], a[1], a[2], a[3]) }

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

  PwObjectTracker { objects: [Pipewire.defaultAudioSource] }
  PwNodePeakMonitor {
    id: mic
    node: Pipewire.defaultAudioSource
    enabled: root.f.listening
  }

  // The overlay takes no input, so the cursor is polled over Hyprland's request
  // socket while the orb is visible. One request per connection: Hyprland
  // answers `j/cursorpos` and hangs up.
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
    core.cursor((c.x - scr.x) / scr.width * 100, (c.y - scr.y) / scr.height * 100)
    return true
  }

  Timer {
    interval: 50
    repeat: true
    running: panel.visible
    onTriggered: if (!hyprSock.connected) hyprSock.connected = true
  }

  FrameAnimation {
    running: root.f.visible
    onTriggered: {
      // The monitor's peak is the cube root of the sample peak; undo that, or
      // room noise alone reads as a tenth of full scale.
      if (root.f.listening) root.core.mic(Math.pow(mic.peak || 0, 3))
      root.f = root.core.step(frameTime)
    }
  }

  Process {
    running: true
    command: ["hyprctl", "-j", "getoption", "animations:enabled"]
    stdout: StdioCollector {
      onStreamFinished: { try { root.core.reduceMotion(JSON.parse(text).int === 0); root.f = root.core.frame() } catch (e) {} }
    }
  }

  IpcHandler {
    target: "glitch"
    function set(payloadJson: string): string { root.set(payloadJson); return "ok" }
    function event(line: string): string { root.event(line); return "ok" }
    function hide(): string { root.core.hide(); root.f = root.core.frame(); return "ok" }
    function ping(): string { return "ok" }
  }

  PanelWindow {
    id: panel
    // GLITCH_SCREEN pins it to one output, for testing.
    screen: {
      var name = Quickshell.env("GLITCH_SCREEN") || (Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : "")
      for (var i = 0; i < Quickshell.screens.length; i++)
        if (Quickshell.screens[i].name === name) return Quickshell.screens[i]
      return Quickshell.screens[0]
    }
    visible: root.f.visible
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
      opacity: root.f.opacity
      scale: root.f.scale

      Item {
        id: creature
        width: parent.width
        height: parent.width
        y: parent.height - 260 * root.k - height / 2
        transform: [
          Scale { origin.x: creature.width / 2; origin.y: creature.height / 2; xScale: root.f.sx; yScale: root.f.sy },
          Rotation { origin.x: creature.width / 2; origin.y: creature.height / 2; angle: root.f.rot },
          Translate { x: root.f.x * root.k; y: root.f.y * root.k }
        ]

        ShaderEffect {
          width: root.f.size * root.k
          height: width
          anchors.centerIn: parent
          anchors.alignWhenCentered: false
          fragmentShader: Qt.resolvedUrl("glitch.frag.qsb")

          property real aa: 1 / (root.k * (panel.screen ? panel.screen.devicePixelRatio : 1))
          property color primary: root.rgba(root.u.primary)
          property color secondary: root.rgba(root.u.secondary)
          property color bg: root.rgba(root.u.bg)
          property real itemPx: root.u.itemPx
          property real diameter: root.u.diameter
          property real glowBlur: root.u.glowBlur
          property real glowAlpha: root.u.glowAlpha
          property real pattern: root.u.pattern
          property real pattern2: root.u.pattern2
          property real patMix: root.u.patMix
          property point eye: root.v2(root.u.eye)
          property real lens: root.u.lens
          property real lensSize: root.u.lensSize
          property real eyeGlow: root.u.eyeGlow
          property point scroll: root.v2(root.u.scroll)
          property real ringPhase: root.u.ringPhase
          property real swellPhase: root.u.swellPhase
          property real swellDrift: root.u.swellDrift
          property real reveal: root.u.reveal
          property real flash: root.u.flash
          property real wobble: root.u.wobble
          property real wobblePhase: root.u.wobblePhase
          property real radar: root.u.radar
          property real radarAngle: root.u.radarAngle
          property real comet: root.u.comet
          property real cometAngle: root.u.cometAngle
          property real tide: root.u.tide
          property real workShow: root.u.workShow
          property real tidePhase: root.u.tidePhase
          property vector4d pings: root.v4(root.u.pings)
          property real pingDir: root.u.pingDir
          property real ring: root.u.ring
          property real ticks: root.u.ticks
          property point tickFresh: root.v2(root.u.tickFresh)
          property vector4d moon0: root.v4(root.u.moon0)
          property vector4d moon1: root.v4(root.u.moon1)
          property vector4d moon2: root.v4(root.u.moon2)
          property vector4d moon3: root.v4(root.u.moon3)
          property vector4d moon4: root.v4(root.u.moon4)
          property vector4d moon5: root.v4(root.u.moon5)
          property point pill: root.v2(root.u.pill)
        }
      }
    }
  }
}
