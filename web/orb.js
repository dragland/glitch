// "../plugin/" resolves to /plugin/ whether web/ is served at / or at /web/: URL
// resolution stops at the root.
import { createOrb, stage, aa } from "../plugin/orb.mjs"

const VERTEX = `#version 300 es
in vec2 corner;
uniform vec2 origin, edgeX, edgeY;
out vec2 qt_TexCoord0;
void main() {
  qt_TexCoord0 = corner;
  gl_Position = vec4(origin + corner.x * edgeX + corner.y * edgeY, 0.0, 1.0);
}`
// Fragment ints default to mediump in GLSL ES, which may be 16 bits; the hash needs 32.
const HEADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 qt_TexCoord0;
out vec4 fragColor;
uniform float qt_Opacity;
`

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}

async function fetchShader() {
  const res = await fetch(new URL("../plugin/orb.glsl", import.meta.url))
  if (!res.ok) throw new Error("orb.glsl: HTTP " + res.status)
  return res.text()
}

export async function createOrbView(canvas, opts = {}) {
  const body = await fetchShader()
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) throw new Error("WebGL2 is not available")
  let prog = null, locs = {}

  function setup() {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX), fs = compile(gl, gl.FRAGMENT_SHADER, HEADER + body)
    prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const at = gl.getAttribLocation(prog, "corner")
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
    locs = {}
  }
  setup()
  const loc = name => name in locs ? locs[name] : (locs[name] = gl.getUniformLocation(prog, name))

  const now = opts.now || (() => performance.now() / 1000)
  const core = createOrb({ now, persist: opts.persist })
  let frame = core.frame(), raf = 0, last = 0, running = false, lost = false, waker = 0, wakeAt = -1

  function uniform(name, v) {
    const l = loc(name)
    if (l === null) return
    if (typeof v === "number") gl.uniform1f(l, v)
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1])
    else gl.uniform4f(l, v[0], v[1], v[2], v[3])
  }

  function render() {
    const W = canvas.clientWidth, H = canvas.clientHeight
    // clientWidth is 0 while the canvas isn't rendered (display: none, detached).
    if (lost || !W || !H) return
    const dpr = opts.dpr || window.devicePixelRatio || 1
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr)
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
    gl.viewport(0, 0, pw, ph)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!frame.visible) return

    const k = opts.scale || W / stage.size, f = frame
    const [ox, oy] = opts.origin ? opts.origin(W, H, k) : [W / 2, H - stage.orbY * k], cx = W / 2, cy = H / 2
    const r = f.rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r)
    const place = (u, v) => {
      const bx = (u - 0.5) * f.size * f.sx, by = (v - 0.5) * f.size * f.sy
      const px = ox + k * (bx * cos - by * sin + f.x), py = oy + k * (bx * sin + by * cos + f.y)
      return [(cx + f.scale * (px - cx)) / W * 2 - 1, 1 - (cy + f.scale * (py - cy)) / H * 2]
    }
    const o = place(0, 0), ex = place(1, 0), ey = place(0, 1)
    uniform("origin", o)
    uniform("edgeX", [ex[0] - o[0], ex[1] - o[1]])
    uniform("edgeY", [ey[0] - o[0], ey[1] - o[1]])
    uniform("qt_Opacity", f.opacity)
    uniform("aa", aa(k, dpr))
    for (const name in f.uniforms) uniform(name, f.uniforms[name])
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function arm() {
    if (frame.wakeAt === wakeAt) return
    clearTimeout(waker)
    wakeAt = frame.wakeAt
    if (wakeAt >= 0) waker = setTimeout(() => { wakeAt = -1; frame = core.wake(); settle() }, Math.max(0, (wakeAt - now()) * 1000))
  }

  function settle() {
    arm()
    if (frame.visible) resume()
    else if (raf) { cancelAnimationFrame(raf); raf = 0; render() }
  }

  function resume() {
    if (running && !raf && !lost && frame.visible) { last = 0; raf = requestAnimationFrame(tick) }
  }

  function tick(t) {
    raf = requestAnimationFrame(tick)
    const dt = last ? (t - last) / 1000 : 0
    last = t
    if (opts.onBeforeStep) opts.onBeforeStep(frame)
    frame = core.step(dt)
    render()
    arm()
    if (!frame.visible) { cancelAnimationFrame(raf); raf = 0 }
  }

  // A browser may drop a WebGL context at any time; without preventDefault it never restores it.
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault()
    lost = true
    cancelAnimationFrame(raf)
    raf = 0
  })
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false
    setup()
    resume()
    if (!raf) render()
  })

  const fresh = () => { frame = core.frame(); settle() }
  return {
    set(json) { core.set(json); fresh() },
    event(line) { core.event(line) },
    mic(level) { core.mic(level) },
    reduceMotion(on) { core.reduceMotion(on); fresh() },
    start() { running = true; resume() },
    stop() { running = false; cancelAnimationFrame(raf); raf = 0 }
  }
}
