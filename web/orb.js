// The orb on a canvas: plugin/orb.mjs's logic drawn with plugin/orb.glsl in
// WebGL2, the same pair the desktop plugin runs. The imports resolve to
// /plugin/orb.mjs and /plugin/orb.glsl whether web/ is served at / or /web/.
import { createOrb } from "../plugin/orb.mjs"

const STAGE = 760
const VERTEX = `#version 300 es
in vec2 corner;
uniform vec2 origin, edgeX, edgeY;
out vec2 qt_TexCoord0;
void main() {
  qt_TexCoord0 = corner;
  gl_Position = vec4(origin + corner.x * edgeX + corner.y * edgeY, 0.0, 1.0);
}`
const HEADER = `#version 300 es
precision highp float;
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

export async function createOrbView(canvas, opts = {}) {
  const body = opts.shader || await (await fetch(new URL("../plugin/orb.glsl", import.meta.url))).text()
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: !!opts.preserve })
  if (!gl) throw new Error("WebGL2 is not available")
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, HEADER + body))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const at = gl.getAttribLocation(prog, "corner")
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
  const locs = {}
  const loc = name => name in locs ? locs[name] : (locs[name] = gl.getUniformLocation(prog, name))

  const core = createOrb()
  let frame = core.frame(), raf = 0, last = 0

  function uniform(name, v) {
    const l = loc(name)
    if (l === null) return
    if (typeof v === "number") gl.uniform1f(l, v)
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1])
    else gl.uniform4f(l, v[0], v[1], v[2], v[3])
  }

  function render() {
    const dpr = opts.dpr || window.devicePixelRatio || 1
    const W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr)
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
    gl.viewport(0, 0, pw, ph)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!frame.visible) return

    const k = opts.scale || W / STAGE, f = frame
    const [ox, oy] = opts.origin ? opts.origin(W, H, k) : [W / 2, H - 260 * k], cx = W / 2, cy = H / 2
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
    uniform("aa", 1 / (k * dpr))
    for (const name in f.uniforms) uniform(name, f.uniforms[name])
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  function tick(now) {
    raf = requestAnimationFrame(tick)
    const dt = last ? (now - last) / 1000 : 0
    last = now
    if (opts.onBeforeStep) opts.onBeforeStep(frame)
    frame = core.step(dt)
    render()
    if (opts.onFrame) opts.onFrame(frame)
  }

  const fresh = () => { frame = core.frame() }
  return {
    set(json) { core.set(json); fresh() },
    event(line) { core.event(line); fresh() },
    mic(level) { core.mic(level) },
    cursor(x, y) { core.cursor(x, y); fresh() },
    reduceMotion(on) { core.reduceMotion(on); fresh() },
    colors(c) { core.colors(c); fresh() },
    hide() { core.hide(); fresh() },
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(tick) } },
    stop() { cancelAnimationFrame(raf); raf = 0 },
    step(dt) { frame = core.step(dt); return frame },
    render,
    get frame() { return frame },
    destroy() { this.stop(); gl.getExtension("WEBGL_lose_context")?.loseContext() }
  }
}
