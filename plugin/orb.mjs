// The orb's logic, shared by the desktop plugin (Glitch.qml) and the web orb
// (web/orb.js): plain ES module, no host APIs, so both run the same motion.
// Hosts feed inputs, call step(dt) once per frame and draw the frame it returns
// with orb.glsl.
//
// Two inputs:
//   1. A state plus a Jev-style reaction (what it feels):
//        set('{"state":"tool","reaction":{"palette":"ocean","pattern":"waves",
//          "motion":"orbit","mood":"focused","energy":0.4}}')
//   2. Live signals, one per line (what is happening right now):
//        turn             a new turn: clear ticks, moons, edits
//        tok <chars>      streamed text: the pattern drifts at token speed
//        tool <id> <cat>  a tool call went out (look, make, run, delegate)
//        end <id>         it came back
//        rest             the work is over: nothing is out any more
//        ctx <0..1>       how full the context is (the tide, shown while working)
//        say <hz> <v>...  the loudness envelope of the line about to be spoken (v = 0..99)
//        hush             speech stopped early
//   Hosts also feed the mic's linear sample peak while listening, and may feed
//   the cursor (percent of the screen) and reduced motion.
//
// createOrb({ now, persist }): now is the host's clock in seconds; the hide
// deadlines run on it, so they hold while no frames are drawn. Without it they
// run on step time. With persist, the orb never hides on its own (only hide()
// hides it): it shows from the first set, idle included, and after a resting
// state it keeps that state's look.
//
// Units are the orb's CSS px: the stage is stage.size square and the orb's
// centre sits stage.orbY above its bottom edge. A frame (step/frame) holds:
//   visible            draw and keep stepping; false once faded out
//   wakeAt             when (on the host's clock) to call wake() if no frame has
//                      been stepped by then, or -1
//   listening          the host should feed mic()
//   opacity, scale     the stage's, about the stage centre
//   sx, sy, rot, x, y  the orb's scale, rotation (degrees, clockwise) and offset,
//                      applied in that order about the orb centre
//   size               side of the shader quad, centred on the orb
//   uniforms           every orb.glsl uniform but aa (aa(k, dpr) gives it for a
//                      stage drawn k device-independent px per CSS px): numbers,
//                      and arrays for colours (rgba 0..1) and vectors

export const stage = { size: 760, orbY: 260 }
export const aa = (k, dpr) => 1 / (k * dpr)

const palettes = {
  electric: { color1: "#00f0ff", color2: "#ff0055", bg: "#08080c" },
  sunset:   { color1: "#ff7b54", color2: "#ffb26b", bg: "#1a0b12" },
  ocean:    { color1: "#00a8cc", color2: "#27496d", bg: "#011520" },
  citrus:   { color1: "#b2d826", color2: "#ffcc00", bg: "#121808" },
  candy:    { color1: "#ff99cc", color2: "#cc99ff", bg: "#1a081c" },
  mono:     { color1: "#ffffff", color2: "#888888", bg: "#0a0a0a" },
  mint:     { color1: "#4de3a4", color2: "#17877a", bg: "#04130f" }
}
const patterns = { rings: 0, checker: 1, waves: 2, dots: 3, stripes: 4, noise: 5, fine: 6 }
const motionSeconds = { bounce: 1, orbit: 4, wobble: 2, breathe: 4, jitter: 0.2, still: 1 }
const lingerSeconds = { done: 4.5, needs_you: 25, error: 9, idle: 1.2 }
const PAD = 190
const FADE = 0.4
const MOONS = 6
const TICKS = 39

const linear = u => u
const inQuad = u => u * u
const outQuad = u => u * (2 - u)
const inOutQuad = u => u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)
const outCubic = u => 1 + (u - 1) ** 3
const outBack = u => { const s = 1.70158, v = u - 1; return v * v * ((s + 1) * v + s) + 1 }

function rgba(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]
}
const mixv = (a, b, u) => Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * u) : a + (b - a) * u

// Timed as Qt Quick times them, so the desktop orb moves as it did: an animation
// started during a step first moves on the next one.
let stepping = false
const begin = o => { o.fresh = stepping }
const held = o => { if (!o.fresh) return false; o.fresh = false; return true }

function tween(v) { return { v, from: v, to: v, t: 0, dur: 0, ease: linear, key: undefined, fresh: false } }
function go(tw, to, dur, ease, from) {
  tw.from = from === undefined ? tw.v : from
  tw.v = tw.from
  tw.to = to; tw.t = 0; tw.dur = dur; tw.ease = ease
  begin(tw)
}
function follow(tw, to, dur, ease, key) {
  key = key === undefined ? to : key
  if (key === tw.key) return
  tw.key = key
  go(tw, to, dur, ease)
}
function advance(tw, dt) {
  if (tw.dur <= 0 || held(tw)) return
  tw.t += dt
  const u = Math.min(1, tw.t / tw.dur)
  tw.v = mixv(tw.from, tw.to, tw.ease(u))
  if (u >= 1) tw.dur = 0
}

function timer(seconds, repeat) { return { seconds, repeat, on: false, left: 0 } }
function run(tm, on) { if (on && !tm.on) tm.left = tm.seconds; tm.on = on }
function fires(tm, dt) {
  if (!tm.on) return false
  tm.left -= dt
  if (tm.left > 1e-9) return false
  if (tm.repeat) tm.left = tm.seconds; else tm.on = false
  return true
}

function loop(t) { return { on: false, t, fresh: false } }
function restart(lp) { lp.t = 0; begin(lp) }
function gate(lp, on) { if (on && !lp.on) restart(lp); lp.on = on }

const swing = t => 0.5 - 0.5 * Math.cos(2 * Math.PI * t)
const smooth = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u) }
const kick = (u, freq, damp) => u <= 0 ? 0 : Math.exp(-damp * u) * Math.sin(freq * u)

export function createOrb(opts = {}) {
  let mode = "idle", shown = false
  let paletteName = "electric", pattern = "rings", prevPattern = "rings", motion = "breathe", mood = "curious"
  let energy = 0.5, activity = 0, reduce = false

  let clock = 0, wall = 0, lastStep = 0, hideAt = -1, fadeEnd = -1
  const now = opts.now || (() => wall)
  let pendingChars = 0, tokenRate = 0, scrollX = 0, scrollY = 0
  let inflight = {}, lookUntil = -1, cometUntil = -1, lookAngle = -0.5
  let edits = 0, editAt = -10, flash = 0, ticks = 0, tickAt = -10
  let moons = [], moonsBorn = 0, ctx = 0

  let voice = 0, voiceFast = 0, micMax = 0.02, micRaw = 0
  let sayEnv = [], sayHz = 50, sayStart = -1
  let ringPhase = 0, rushUntil = -1, dipAt = -10, lastOnset = -10
  let pingStart = [-10, -10, -10, -10], pings = [0, 0, 0, 0], pingDir = 1

  let cursorX = 50, cursorY = 50, lastMove = -Infinity, mouseIdle = true
  let eyeX = 0, eyeY = 0, wanderX = 0, wanderY = 0
  let swellPhase = 0, swellDrift = 0, radarAngle = 0, cometAngle = 0
  const lidBlink = { t: -1, from: 1, fresh: false }
  let lid = 1

  const persist = !!opts.persist
  const pal = () => palettes[paletteName] || palettes.electric
  const color1 = tween(rgba(pal().color1)), color2 = tween(rgba(pal().color2)), bg = tween(rgba(pal().bg))
  color1.key = pal().color1; color2.key = pal().color2; bg.key = pal().bg
  const patMix = tween(0)
  const baseDiameter = tween(200 + energy * 100), baseGlow = tween(40), creatureScale = tween(1)
  const radarAmt = tween(0), cometAmt = tween(0), workAlpha = tween(0), amp = tween(1)
  const reveal = tween(0.06 + 0.72 * (1 - Math.exp(-0.5)))
  const opacity = tween(0), scale = tween(0.85)
  const tweens = [color1, color2, bg, patMix, baseDiameter, baseGlow, creatureScale, radarAmt, cometAmt, reveal, workAlpha, amp, opacity, scale]
  for (const tw of [baseDiameter, baseGlow, creatureScale, radarAmt, cometAmt, workAlpha, reveal, opacity, scale]) tw.key = tw.v

  const decayTimer = timer(0.1, true)
  const blinkTimer = timer(3, true), wanderTimer = timer(1.1, true)
  const phase = loop(0), pill = loop(0), excited = loop(-1)

  const working = () => mode === "thinking" || mode === "tool"
  const conversing = () => mode === "listening" || mode === "transcribing" || mode === "speaking"
  const visible = () => shown || opacity.v > 0.01
  const countOut = cat => { let n = 0; for (const id in inflight) if (inflight[id] === cat) n++; return n }
  const lookOut = () => working() && (countOut("look") > 0 || clock < lookUntil)
  const toolOut = () => working() && (countOut("run") + countOut("delegate") > 0 || clock < cometUntil)
  const bump = amount => { activity = Math.min(1, activity + amount) }
  const blink = () => { lidBlink.t = 0; lidBlink.from = lid; begin(lidBlink) }
  const conceal = t => { shown = false; hideAt = -1; fadeEnd = t + FADE; micRaw = 0 }

  function snap() {
    for (const tw of tweens) { tw.fresh = false; advance(tw, tw.dur) }
    lid = 1
    lidBlink.t = -1
  }

  function ping(dir) {
    let oldest = 0
    for (let i = 1; i < 4; i++) if (pingStart[i] < pingStart[oldest]) oldest = i
    pingStart[oldest] = clock
    pingDir = dir
  }

  function derive() {
    const p = pal()
    follow(color1, rgba(p.color1), 0.7, outCubic, p.color1)
    follow(color2, rgba(p.color2), 0.7, outCubic, p.color2)
    follow(bg, rgba(p.bg), 0.7, outCubic, p.bg)
    follow(baseDiameter, 200 + (activity + energy) * 100, 0.7, outCubic)
    follow(baseGlow, 40 + activity * 100, 0.7, outCubic)
    follow(creatureScale, 1 + activity * 0.1, 0.7, outCubic)
    follow(radarAmt, lookOut() ? 1 : 0, 0.25, linear)
    follow(cometAmt, toolOut() ? 1 : 0, 0.3, linear)
    follow(reveal, 0.06 + 0.72 * (1 - Math.exp(-0.5 * Math.max(1, edits))), 0.22, outCubic)
    follow(workAlpha, working() ? 1 : 0, 0.6, linear)
    follow(opacity, shown ? 1 : 0, FADE, outCubic)
    follow(scale, shown ? 1 : 0.85, 0.5, outBack)
    run(decayTimer, shown)
    run(wanderTimer, shown)
    run(blinkTimer, shown && !reduce)
    gate(phase, visible())
    gate(pill, mood === "surprised" && visible() && !reduce)
    gate(excited, mood === "excited" && visible() && !reduce)
    if (!visible()) snap()
  }

  function set(payload) {
    let m = payload
    if (typeof payload !== "object" || payload === null) {
      try { m = JSON.parse(payload || "{}") } catch (e) { return }
    }
    const s = m.state || "idle"
    if (s === "idle" && !shown && !persist) return
    const r = m.reaction || {}
    if (r.palette) paletteName = r.palette
    if (r.pattern && r.pattern !== pattern) {
      prevPattern = pattern
      pattern = r.pattern
      go(patMix, 0, 0.4, inOutQuad, 1)
    }
    if (r.motion && r.motion !== motion) { motion = r.motion; go(amp, 1, 0.45, outCubic, 0); restart(phase) }
    if (r.mood) mood = r.mood
    if (r.energy !== undefined) energy = Math.max(0, Math.min(1, Number(r.energy)))
    if (s === "tool" || s === "speaking" || (s === "listening" && mode !== "listening")) bump(0.25)
    if (s === "transcribing" && mode === "listening") { dipAt = clock; rushUntil = clock + 0.45; blink() }
    if (s !== mode) sayStart = -1
    if (mode === "listening" && s !== "listening") micRaw = 0
    const t = now()
    if (!visible()) lastStep = t
    mode = s
    shown = true
    const linger = lingerSeconds[s] || 0
    hideAt = linger > 0 && !persist ? t + linger : -1
    derive()
  }

  function event(line) {
    const a = String(line).trim().split(" ")
    switch (a[0]) {
    case "turn":
      ticks = 0; edits = 0; moons = []; moonsBorn = 0; inflight = {}; pendingChars = 0; flash = 0
      scrollX = 0; scrollY = 0
      break
    case "rest":
      inflight = {}
      for (const o of moons) if (o.back < 0) o.back = clock
      break
    case "tok":
      pendingChars = Math.max(0, Math.min(2000, pendingChars + (Number(a[1]) || 0)))
      break
    case "tool": {
      const cat = a[2] || "run"
      inflight[a[1]] = cat
      ticks++
      tickAt = clock
      if (cat === "make") { edits++; flash = 1; editAt = clock }
      else if (cat === "look") { lookUntil = clock + 0.9; lookAngle = Math.random() * 2 * Math.PI }
      else {
        cometUntil = clock + 0.6
        if (cat === "delegate" && moons.length < MOONS) {
          const i = moonsBorn++ % MOONS
          moons.push({ id: a[1], born: clock, back: -1, w: [1.9, -1.4, 1.6, -1.1, 1.3, -1.7][i],
                       ph: Math.random() * 2 * Math.PI, rad: [40, 54, 46, 60, 50, 66][i] })
        }
      }
      break
    }
    case "end":
      delete inflight[a[1]]
      for (const o of moons) if (o.id === a[1] && o.back < 0) o.back = clock
      break
    case "ctx":
      ctx = Math.max(0, Math.min(1, Number(a[1]) || 0))
      break
    case "say": {
      sayHz = Number(a[1]) || 50
      sayEnv = a.slice(2).map(v => Math.max(0, Math.min(1, Number(v) / 99)) || 0)
      sayStart = clock + 0.06  // pw-play takes a moment to start
      break
    }
    case "hush":
      sayStart = -1
      break
    }
    derive()
  }

  function hide() { conceal(now()); mode = "idle"; derive() }
  function mic(level) { micRaw = Number(level) || 0 }
  function reduceMotion(on) { reduce = !!on; derive() }

  function cursor(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return
    px = Math.max(0, Math.min(100, px))
    py = Math.max(0, Math.min(100, py))
    if (Math.abs(px - cursorX) + Math.abs(py - cursorY) > 0.15) {
      cursorX = px
      cursorY = py
      lastMove = clock
      mouseIdle = false
      bump(0.05)
      derive()
    }
  }

  function eyeTarget() {
    if (conversing()) return [0, -4]
    if (lookOut()) return [34 * Math.cos(lookAngle) + 6 * Math.sin(clock * 5), 26 * Math.sin(lookAngle) + 5 * Math.cos(clock * 4)]
    if (working() && clock - editAt < 1.2) return [-4, 18]
    if (toolOut()) return [0, 0]
    if (working() && mouseIdle) return [wanderX, wanderY]
    return [(cursorX - 50) * 0.5, (cursorY - 50) * 0.5]
  }

  function step(frameTime) {
    if (!visible()) return frame()
    stepping = true
    try { advanceAll(Number.isFinite(frameTime) && frameTime > 0 ? frameTime : 0) } finally { stepping = false }
    return frame()
  }

  function wake() {
    const gap = now() - lastStep
    return visible() && gap >= 0.05 ? step(gap) : frame()
  }

  function advanceAll(raw) {
    wall += raw
    const t = lastStep = now()
    if (hideAt >= 0 && t >= hideAt - 1e-9) { conceal(t); derive() }
    if (fires(decayTimer, raw)) { activity = Math.max(0, activity - 0.05); derive() }
    if (fires(blinkTimer, raw)) { blink(); blinkTimer.seconds = blinkTimer.left = 2.6 + Math.random() * 3.6 }
    if (fires(wanderTimer, raw)) {
      mouseIdle = clock - lastMove > 4
      const a = Math.random() * 2 * Math.PI, d = 22 * (0.3 + Math.random() * 0.7)
      wanderX = Math.cos(a) * d
      wanderY = Math.sin(a) * d
    }

    const dt = Math.min(raw, 0.1)
    clock += dt

    const eye = eyeTarget(), f = 1 - Math.pow(0.9, dt * 60)
    eyeX += (eye[0] - eyeX) * f
    eyeY += (eye[1] - eyeY) * f

    let target = 0
    if (mode === "listening") {
      micMax = Math.max(micMax * Math.pow(0.5, dt / 20), micRaw, 0.02)
      target = Math.min(1.25, micRaw / (micMax * 0.8))
    } else if (sayStart >= 0) {
      const i = Math.floor((clock - sayStart) * sayHz)
      if (i >= 0 && i < sayEnv.length) target = sayEnv[i]
    }
    const before = voice
    voiceFast += (target - voiceFast) * (1 - Math.exp(-dt / 0.03))
    voice += (target - voice) * (1 - Math.exp(-dt / 0.09))
    if (voice >= 0.5 && before < 0.5 && clock - lastOnset >= 0.2) {
      lastOnset = clock
      ping(mode === "listening" ? -1 : 1)
    }

    if (mode === "listening") ringPhase += (14 + 150 * voice) * dt
    else if (mode === "speaking") ringPhase -= (8 + 140 * voice) * dt
    if (clock < rushUntil) ringPhase += 400 * dt
    ringPhase %= 42000

    const flow = pendingChars * (1 - Math.exp(-dt / 0.25))
    pendingChars -= flow
    tokenRate = dt > 0 ? Math.min(1.5, flow / dt / 220) : 0
    if (working() && !reduce) {
      scrollX += 30 * tokenRate * dt
      scrollY += 16 * tokenRate * dt
    }

    const pace = reduce ? 0 : (working() ? 0.2 + tokenRate : 1)
    swellPhase = (swellPhase + 1.57 * pace * dt) % (2 * Math.PI)
    swellDrift = (swellDrift - 10 * pace * dt) % 40

    radarAngle = (radarAngle + 3.6 * dt) % (2 * Math.PI)
    cometAngle = (cometAngle + 7.0 * dt) % (2 * Math.PI)
    flash *= Math.exp(-7 * dt)

    for (let n = 0; n < 4; n++) {
      const x = (clock - pingStart[n]) / 0.8
      pings[n] = x > 0 && x < 1 ? x : 0
    }

    const keep = moons.filter(m => m.back < 0 || clock - m.back < 0.5)
    if (keep.length !== moons.length) {
      moons = keep
      bump(0.3)
      if (mode !== "listening") ping(1)
    }

    derive()

    for (const tw of tweens) advance(tw, raw)
    const bl = lidBlink
    if (!held(bl) && bl.t >= 0) {
      bl.t += raw
      if (bl.t < 0.07) lid = bl.from + (0.08 - bl.from) * inQuad(bl.t / 0.07)
      else if (bl.t < 0.18) lid = 0.08 + 0.92 * outQuad((bl.t - 0.07) / 0.11)
      else { lid = 1; bl.t = -1 }
    }
    if (!visible()) snap()
    for (const lp of [phase, pill, excited]) if (!held(lp) && lp.on) lp.t += raw
  }

  function motionT() {
    const d = motionSeconds[motion] || 4, t = (phase.t % d) / d, s = swing(t), a = amp.v
    switch (reduce ? "still" : motion) {
    case "breathe": return { x: 0, y: 0, rot: 0, sx: 1 + 0.15 * s * a, sy: 1 + 0.15 * s * a }
    case "wobble": { const w = -1 + 2 * s; return { x: 0, y: 0, rot: 5 * w * a, sx: 1 + 0.05 * w * a, sy: 1 + 0.05 * w * a } }
    case "orbit": return { x: 20 * Math.cos(2 * Math.PI * t) * a, y: 20 * Math.sin(2 * Math.PI * t) * a, rot: 0, sx: 1, sy: 1 }
    case "jitter": {
      const pts = [[0, 0], [-2, 2], [2, -2], [-2, -2], [2, 2]]
      const i = Math.min(3, Math.floor(t * 4)), f = t * 4 - i
      return { x: (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f) * a, y: (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f) * a, rot: 0, sx: 1, sy: 1 }
    }
    case "bounce": return { x: 0, y: -24 * s * a, rot: 0, sx: 1 + (0.01 - 0.02 * s) * a, sy: 1 + (-0.01 + 0.02 * s) * a }
    default: return { x: 0, y: 0, rot: 0, sx: 1, sy: 1 }
    }
  }

  function frame() {
    const m = motionT()
    let gx = 1, gy = 1
    if (!reduce) {
      const g = kick(clock - dipAt, 13, 6), e = kick(clock - editAt, 15, 7), v = sayStart >= 0 ? voiceFast : 0
      gx = 1 + 0.008 * v + 0.025 * g + 0.02 * e
      gy = 1 + 0.022 * v - 0.04 * g - 0.03 * e
    }
    const diameter = baseDiameter.v + (mode === "listening" ? 8 : 5) * voice
    const u = {
      primary: color1.v, secondary: color2.v, bg: bg.v,
      itemPx: diameter + 2 * PAD, diameter,
      glowBlur: Math.min(130, baseGlow.v + 80 * voice), glowAlpha: 0.25 + 0.22 * voice,
      pattern: patterns[pattern] !== undefined ? patterns[pattern] : 0,
      pattern2: patterns[prevPattern] !== undefined ? patterns[prevPattern] : 0,
      patMix: patMix.v,
      eye: [eyeX, eyeY],
      lens: (0.62 + 0.06 * voice) * lid,
      lensSize: 30 + energy * 8 + 7 * voice,
      eyeGlow: (0.62 + (sayStart >= 0 ? 0.3 * voice : 0)) * (0.2 + 0.8 * lid),
      scroll: [scrollX, scrollY],
      ringPhase, swellPhase, swellDrift,
      reveal: reveal.v, flash,
      wobble: mode === "listening" && !reduce ? 0.010 * voiceFast : 0,
      wobblePhase: clock,
      radar: 0.36 * radarAmt.v, radarAngle,
      comet: cometAmt.v, cometAngle,
      tide: ctx, workShow: workAlpha.v, tidePhase: clock,
      pings: pings.slice(), pingDir,
      ring: mood !== "excited" || excited.t < 0 ? 0 : excited.t % 1 < 0.75 ? 0.001 + 0.999 * outCubic(excited.t % 1 / 0.75) : 1,
      ticks: Math.min(ticks, TICKS),
      tickFresh: [(ticks - 1) % TICKS, Math.exp(-(clock - tickAt) * 3)],
      pill: [mood === "surprised" ? 1 : 0, swing(pill.t % 1)]
    }
    for (let i = 0; i < MOONS; i++) {
      const o = moons[i]
      if (!o) { u["moon" + i] = [0, 0, 0, 1]; continue }
      const out = smooth((clock - o.born) / 0.7), home = o.back < 0 ? 0 : smooth((clock - o.back) / 0.5)
      const orbit = (diameter / 2 + o.rad * out) * (1 - home) + diameter / 4 * home
      const a = o.ph + o.w * (clock - o.born)
      u["moon" + i] = [Math.cos(a) * orbit, Math.sin(a) * orbit, out, home]
    }
    return {
      visible: visible(), wakeAt: !visible() ? -1 : shown ? hideAt : fadeEnd, shown, listening: shown && mode === "listening",
      opacity: opacity.v, scale: scale.v,
      sx: m.sx * creatureScale.v * gx, sy: m.sy * creatureScale.v * gy, rot: m.rot,
      x: m.x + eyeX * 0.2, y: m.y + eyeY * 0.2,
      size: diameter + 2 * PAD,
      uniforms: u
    }
  }

  return { set, event, hide, mic, cursor, reduceMotion, step, wake, frame }
}
