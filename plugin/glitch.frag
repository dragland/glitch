#version 440
// The Beep Jev creature (beepjev.replit.app) as one fragment shader: the CSS
// background patterns, the 2px border, inset and outer box-shadow glows, and
// the mix-blend-overlay "eye", all in CSS px so the numbers match the original.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 primary;    // --pattern-primary (color1)
    vec4 secondary;  // --pattern-secondary (color2)
    vec4 bg;         // palette bg
    float itemPx;    // item side in CSS px (creature + glow padding)
    float diameter;  // creature diameter in CSS px
    float glowBlur;  // outer box-shadow blur radius in CSS px
    float pattern;   // 0 rings, 1 checker, 2 waves, 3 dots, 4 stripes, 5 noise
    vec2 eye;        // eye offset from centre, CSS px
    float eyeSize;   // eye diameter, CSS px
    float aa;        // one device pixel in CSS px
    float ring;      // excited: ping ring progress 0..1 (0 = off)
    float focusRing; // focused: inner ring opacity
};

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
vec4 pm(vec4 c, float a) { return vec4(c.rgb * c.a * a, c.a * a); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// feTurbulence fractalNoise, baseFrequency .65, 3 octaves (approximation).
float turbulence(vec2 p) {
    float v = 0.0, a = 0.5, f = 0.65;
    for (int o = 0; o < 3; o++) { v += a * vnoise(p * f); f *= 2.0; a *= 0.5; }
    return v / 0.875;
}

// Linear ramp helpers for CSS colour stops with 1px transitions.
float up(float x, float a, float b) { return clamp((x - a) / max(b - a, 1e-4), 0.0, 1.0); }

vec4 patternColor(vec2 p, vec2 c, float d) {
    int pat = int(pattern + 0.5);
    if (pat == 0) {
        // repeating-radial-gradient(circle at center, transparent 0 13px,
        //   primary 14px 16px, transparent 17px 28px, secondary 29px 31px, transparent 32px 42px)
        float m = mod(d, 42.0);
        float a1 = up(m, 13.0, 14.0) * (1.0 - up(m, 16.0, 17.0));
        float a2 = up(m, 28.0, 29.0) * (1.0 - up(m, 31.0, 32.0));
        return over(pm(primary, a1), pm(secondary, a2));
    }
    if (pat == 1) {
        // conic-gradient checker, 28px tiles: TR primary, BR secondary, BL primary, TL secondary.
        vec2 q = mod(p, 28.0) - 14.0;
        float t = fract(atan(q.x, -q.y) / 6.2831853);
        return (t < 0.25 || (t >= 0.5 && t < 0.75)) ? pm(primary, 1.0) : pm(secondary, 1.0);
    }
    if (pat == 2) {
        // repeating-radial-gradient(circle at 0 0, transparent 0, primary 10px, transparent 11px,
        //   transparent 20px, secondary 30px, transparent 31px, transparent 40px)
        float m = mod(length(p), 40.0);
        float a1 = (m < 10.0) ? m / 10.0 : (m < 11.0 ? 11.0 - m : 0.0);
        float a2 = (m >= 20.0 && m < 30.0) ? (m - 20.0) / 10.0 : (m >= 30.0 && m < 31.0 ? 31.0 - m : 0.0);
        return over(pm(primary, a1), pm(secondary, a2));
    }
    if (pat == 3) {
        // Two 20px dot lattices (radius 20% of 14.14px), the second offset 10px.
        float r = 2.828;
        float d1 = length(mod(p, 20.0) - 10.0);
        float d2 = length(mod(p - 10.0, 20.0) - 10.0);
        float a1 = 1.0 - up(d1, r - aa * 0.5, r + aa * 0.5);
        float a2 = 1.0 - up(d2, r - aa * 0.5, r + aa * 0.5);
        return over(pm(primary, a1), pm(secondary, a2));
    }
    if (pat == 4) {
        // repeating-linear-gradient(45deg, secondary 0 10px, primary 10px 20px)
        float t = mod(dot(c, vec2(0.70710678, -0.70710678)), 20.0);
        float k = up(t, 10.0 - aa * 0.5, 10.0 + aa * 0.5) * (1.0 - up(t, 20.0 - aa, 20.0));
        return mix(pm(secondary, 1.0), pm(primary, 1.0), k);
    }
    // noise: linear-gradient(135deg, primary, secondary) multiplied with turbulence.
    float g = clamp(dot(c / diameter, vec2(0.70710678)) * 0.70710678 + 0.5, 0.0, 1.0);
    vec3 grad = mix(primary.rgb, secondary.rgb, g);
    return vec4(grad * turbulence(p), 1.0);
}

void main() {
    vec2 px = qt_TexCoord0 * itemPx;           // CSS px from item top-left
    vec2 c = px - vec2(itemPx * 0.5);           // from centre
    float R = diameter * 0.5;
    float d = length(c);
    vec2 p = c + vec2(R);                       // from creature top-left (pattern space)

    // Outer box-shadow: 0 0 blur color2 @ 25% (gaussian, sigma = blur / 2).
    float sigma = max(glowBlur * 0.5, 1.0);
    float outside = max(d - R, 0.0);
    vec4 col = pm(secondary, 0.25 * exp(-0.5 * (outside * outside) / (sigma * sigma)));

    // Excited: animate-ping ring (scale to 2x and fade).
    if (ring > 0.0) {
        float rr = R * (1.0 + ring) - 2.0 * (1.0 + ring);
        float w = 4.0 * (1.0 + ring);
        float a = (1.0 - up(abs(d - rr), w * 0.5 - aa, w * 0.5)) * 0.2 * (1.0 - ring);
        col = over(vec4(a), col);
    }

    float inside = 1.0 - up(d, R - aa, R);
    if (inside > 0.0) {
        // Body: bg @ 80% under the pattern.
        vec4 body = over(patternColor(p, c, d), pm(bg, 0.8));
        // Inset box-shadow 0 0 40px color2 @ 25%.
        float edge = R - d;
        body = over(pm(secondary, 0.25 * exp(-0.5 * (edge * edge) / 400.0)), body);
        // Focused: inner ring at 90% scale, white/40.
        if (focusRing > 0.0) {
            float fr = abs(d - R * 0.9);
            body = over(vec4(0.4 * focusRing * (1.0 - up(fr, 0.5, 0.5 + aa))), body);
        }
        // Eye: white disc + 20px color1 glow, composited with mix-blend-mode: overlay.
        float er = eyeSize * 0.5;
        float de = length(c - eye);
        float disc = 1.0 - up(de, er - aa, er);
        float halo = exp(-0.5 * pow(max(de - er, 0.0) / 10.0, 2.0)) * (1.0 - disc);
        vec3 eyeRgb = mix(primary.rgb, vec3(1.0), disc);
        float eyeA = max(disc, halo);
        if (eyeA > 0.0) {
            vec3 b = body.a > 0.0 ? body.rgb / body.a : vec3(0.0);
            vec3 ov = mix(2.0 * b * eyeRgb, 1.0 - 2.0 * (1.0 - b) * (1.0 - eyeRgb), step(0.5, b));
            body.rgb = mix(body.rgb, ov * body.a, eyeA);
        }
        // 2px solid color2 border.
        float border = up(d, R - 2.0 - aa, R - 2.0);
        body = mix(body, pm(secondary, 1.0), border);
        col = mix(col, body, inside);
    }
    fragColor = col * qt_Opacity;
}
