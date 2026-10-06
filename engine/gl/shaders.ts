/** GLSL ES 3.00 sources for the compositor. All colors are premultiplied alpha. */

export const QUAD_VS = `#version 300 es
in vec2 aPos;
uniform mat4 uMVP;
uniform vec4 uUV;
out vec2 vUV;
void main() {
  vUV = mix(uUV.xy, uUV.zw, aPos);
  gl_Position = uMVP * vec4(aPos, 0.0, 1.0);
}`

/** Full-screen pass: aPos 0..1 -> clip -1..1, vUV 0..1 (y up, GL convention). */
export const FULL_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`

export const TEX_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uShade;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUV);
  c.rgb *= uShade;
  o = c * uOpacity;
}`

export const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uScale;
out vec4 o;
void main() { o = texture(uTex, vUV) * uScale; }`

/** Separable gaussian, linear-sampling optimized (taps at fractional offsets). */
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;      // texel step * direction
uniform float uSigma;   // in texels of this pass
out vec4 o;
void main() {
  float sigma = max(uSigma, 0.001);
  int radius = int(min(ceil(sigma * 3.0), 40.0));
  float w0 = 1.0;
  vec4 acc = texture(uTex, vUV);
  float norm = w0;
  for (int i = 1; i <= 40; i += 2) {
    if (i > radius) break;
    float a = float(i);
    float b = a + 1.0;
    float wa = exp(-(a * a) / (2.0 * sigma * sigma));
    float wb = b <= float(radius) ? exp(-(b * b) / (2.0 * sigma * sigma)) : 0.0;
    float w = wa + wb;
    float off = (a * wa + b * wb) / w;
    acc += (texture(uTex, vUV + uDir * off) + texture(uTex, vUV - uDir * off)) * w;
    norm += 2.0 * w;
  }
  o = acc / norm;
}`

/** 13-tap downsample with soft threshold (bloom prefilter when uThreshold >= 0). */
export const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
out vec4 o;
vec3 prefilter(vec3 c) {
  if (uThreshold < 0.0) return c;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = (rq * rq) / (4.0 * uKnee + 1e-4);
  float contrib = max(rq, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uTex, vUV + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(uTex, vUV + t * vec2( 0.0, -2.0)).rgb;
  vec3 c = texture(uTex, vUV + t * vec2( 2.0, -2.0)).rgb;
  vec3 d = texture(uTex, vUV + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(uTex, vUV).rgb;
  vec3 f = texture(uTex, vUV + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(uTex, vUV + t * vec2(-2.0,  2.0)).rgb;
  vec3 h = texture(uTex, vUV + t * vec2( 0.0,  2.0)).rgb;
  vec3 i = texture(uTex, vUV + t * vec2( 2.0,  2.0)).rgb;
  vec3 j = texture(uTex, vUV + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(uTex, vUV + t * vec2( 1.0, -1.0)).rgb;
  vec3 l = texture(uTex, vUV + t * vec2(-1.0,  1.0)).rgb;
  vec3 m = texture(uTex, vUV + t * vec2( 1.0,  1.0)).rgb;
  vec3 res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  o = vec4(prefilter(res), 1.0);
}`

/** 9-tap tent upsample, added onto the destination with blending. */
export const UP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 o;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uTex, vUV).rgb * 4.0;
  s += (texture(uTex, vUV + vec2(-t.x, 0.0)).rgb + texture(uTex, vUV + vec2(t.x, 0.0)).rgb +
        texture(uTex, vUV + vec2(0.0, -t.y)).rgb + texture(uTex, vUV + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(uTex, vUV + vec2(-t.x, -t.y)).rgb + texture(uTex, vUV + vec2(t.x, -t.y)).rgb +
       texture(uTex, vUV + vec2(-t.x, t.y)).rgb + texture(uTex, vUV + vec2(t.x, t.y)).rgb;
  o = vec4(s / 16.0, 1.0);
}`

export const TRANSITION_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uA;   // outgoing scene
uniform sampler2D uB;   // incoming scene
uniform float uP;       // eased progress 0..1
uniform float uRaw;     // linear progress 0..1
uniform int uType;
uniform vec2 uDir;      // unit direction of motion (screen, y up)
uniform vec4 uColor;
uniform vec2 uCenter;   // 0..1 (y up)
uniform float uAspect;  // w / h
uniform float uSeed;
out vec4 o;

vec4 sA(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uA, uv); }
vec4 sB(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uB, uv); }
vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 0.123) * 43758.5453); }

vec4 dirBlurA(vec2 uv, vec2 d, float amt) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 16; i++) { float k = (float(i) / 15.0 - 0.5) * amt; acc += sA(uv + d * k); }
  return acc / 16.0;
}
vec4 dirBlurB(vec2 uv, vec2 d, float amt) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 16; i++) { float k = (float(i) / 15.0 - 0.5) * amt; acc += sB(uv + d * k); }
  return acc / 16.0;
}
vec4 zoomBlurA(vec2 uv, vec2 c, float scale, float amt) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 16; i++) { float s = scale * (1.0 + amt * float(i) / 15.0); acc += sA(c + (uv - c) / s); }
  return acc / 16.0;
}
vec4 zoomBlurB(vec2 uv, vec2 c, float scale, float amt) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 16; i++) { float s = scale * (1.0 + amt * float(i) / 15.0); acc += sB(c + (uv - c) / s); }
  return acc / 16.0;
}

void main() {
  vec2 uv = vUV;
  float p = uP;
  vec4 a = sA(uv);
  vec4 b = sB(uv);
  if (uType == 1) { // fade
    o = mix(a, b, p);
  } else if (uType == 2) { // dip to color
    o = p < 0.5 ? mix(a, uColor, p * 2.0) : mix(uColor, b, p * 2.0 - 1.0);
  } else if (uType == 3) { // slide: incoming slides over, outgoing parallaxes and dims
    vec4 bb = sB(uv + uDir * (1.0 - p));
    vec4 aa = sA(uv - uDir * p * 0.28) * (1.0 - 0.45 * p);
    o = over(bb, aa);
  } else if (uType == 4) { // push
    o = over(sB(uv + uDir * (1.0 - p)), sA(uv - uDir * p));
  } else if (uType == 5) { // zoom through
    vec2 c = uCenter;
    float k = sin(3.14159 * uRaw);
    vec4 aa = zoomBlurA(uv, c, 1.0 + p * 2.2, 0.25 * k);
    vec4 bb = zoomBlurB(uv, c, mix(0.55, 1.0, p), 0.2 * k);
    float m = smoothstep(0.35, 0.65, uRaw);
    o = mix(aa, bb, m);
  } else if (uType == 6) { // soft wipe, edge travels in the motion direction
    vec2 d = normalize(uDir);
    float e = dot(uv - 0.5, -d) / (abs(d.x) + abs(d.y)) + 0.5;
    float w = 0.06;
    float th = 1.0 - p * (1.0 + 2.0 * w) + w;
    float m = smoothstep(th - w, th + w, e);
    o = mix(a, b, m);
  } else if (uType == 7) { // iris
    vec2 q = (uv - uCenter) * vec2(uAspect, 1.0);
    float maxd = length(vec2(max(uCenter.x, 1.0 - uCenter.x) * uAspect, max(uCenter.y, 1.0 - uCenter.y)));
    float r = p * maxd * 1.02;
    float m = 1.0 - smoothstep(r - 0.006, r + 0.006, length(q));
    o = mix(a, b, m);
  } else if (uType == 8) { // blur cross-dissolve (inputs pre-blurred on the CPU side via mip bias)
    float k = sin(3.14159 * uRaw);
    vec4 aa = textureLod(uA, uv, k * 6.0);
    vec4 bb = textureLod(uB, uv, k * 6.0);
    o = mix(aa, bb, smoothstep(0.2, 0.8, uRaw));
  } else if (uType == 9) { // glitch
    float band = floor(uv.y * 24.0);
    float n = hash(vec2(band, floor(uRaw * 18.0)));
    float k = sin(3.14159 * uRaw);
    float shift = (n - 0.5) * 0.12 * k * step(0.55, n);
    vec2 g = uv + vec2(shift, 0.0);
    float split = 0.012 * k;
    vec4 src0 = uRaw < 0.5 ? sA(g) : sB(g);
    float r = (uRaw < 0.5 ? sA(g + vec2(split, 0.0)) : sB(g + vec2(split, 0.0))).r;
    float bl = (uRaw < 0.5 ? sA(g - vec2(split, 0.0)) : sB(g - vec2(split, 0.0))).b;
    vec4 c = vec4(r, src0.g, bl, src0.a);
    float scan = 1.0 - 0.18 * k * step(0.5, fract(uv.y * 270.0));
    float flicker = hash(vec2(floor(uRaw * 30.0), 3.0)) < 0.15 ? 1.0 + k * 0.6 : 1.0;
    o = vec4(c.rgb * scan * flicker, c.a);
  } else if (uType == 10) { // whip pan: push with directional blur
    float k = sin(3.14159 * uRaw);
    vec4 aa = dirBlurA(uv - uDir * p, uDir, 0.35 * k);
    vec4 bb = dirBlurB(uv + uDir * (1.0 - p), uDir, 0.35 * k);
    o = over(bb, aa);
  } else {
    o = uRaw < 0.5 ? a : b;
  }
}`

export const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uNoise;    // 256x256 RGBA white noise (repeat, nearest)
uniform float uScale;        // 1 / accumulated samples
uniform float uBloomStrength;
uniform vec2 uRes;           // output px
uniform float uUnit;         // output px per 1080p px
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uLift;
uniform float uVignette;
uniform float uVignetteSoft;
uniform float uAberration;
uniform float uGrain;
uniform float uGrainSize;
uniform vec2 uNoiseOffset;   // changes every frame (animated grain), deterministic
uniform float uFlipY;
uniform vec4 uBackground;
out vec4 o;

void main() {
  vec2 uv = vUV;
  if (uFlipY > 0.5) uv.y = 1.0 - uv.y;
  vec2 d = uv - 0.5;
  vec4 base = texture(uScene, uv) * uScale;
  vec3 col = base.rgb;
  if (uAberration > 0.0) {
    vec2 off = d * dot(d, d) * 4.0 * uAberration * uUnit / uRes;
    col.r = texture(uScene, uv + off).r * uScale;
    col.b = texture(uScene, uv - off).b * uScale;
  }
  // composite over the background (scenes normally paint their own)
  col += uBackground.rgb * (1.0 - clamp(base.a, 0.0, 1.0));
  if (uBloomStrength > 0.0) col += texture(uBloom, uv).rgb * uBloomStrength;
  col *= exp2(uExposure);
  col *= vec3(1.0 + uTemperature * 0.08 + uTint * 0.03, 1.0 - uTint * 0.05, 1.0 - uTemperature * 0.08 + uTint * 0.03);
  col = (col - 0.5) * uContrast + 0.5;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = col + uLift * (1.0 - col);
  if (uVignette > 0.0) {
    vec2 vd = d * vec2(uRes.x / uRes.y, 1.0);
    float v = smoothstep(0.85, 0.85 - uVignetteSoft, length(vd) * 1.1);
    col *= mix(1.0 - uVignette, 1.0, v);
  }
  col = clamp(col, 0.0, 1.0);
  vec4 nz = texture(uNoise, (gl_FragCoord.xy + uNoiseOffset) / 256.0);
  if (uGrain > 0.0) {
    vec4 g = texture(uNoise, (floor(gl_FragCoord.xy / max(1.0, uGrainSize * uUnit)) + uNoiseOffset.yx) / 256.0);
    float n = g.r + g.g - 1.0;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col += n * uGrain * (0.6 + 0.4 * (1.0 - l)) * 0.5;
  }
  // triangular dither: no banding in dark gradients after 8-bit / yuv420 encoding
  col += (nz.b + nz.a - 1.0) / 255.0;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

/** |A - B| for adaptive motion-blur sampling (rendered into a tiny target). */
export const DIFF_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec4 acc = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 q = vUV + vec2(float(x), float(y)) * uTexel;
    acc += abs(texture(uA, q) - texture(uB, q));
  }
  o = vec4(acc.rgb / 9.0, 1.0);
}`
