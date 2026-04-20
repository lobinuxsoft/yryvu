// SPDX-License-Identifier: AGPL-3.0-or-later

import { Geometry, Mesh, Program, Renderer } from "ogl";

import type { GraphRow } from "../../ipc";
import { PALETTE, PALETTE_SIZE } from "./palette";

export interface RendererOptions {
  rowHeight: number;
  laneWidth: number;
  nodeRadius: number;
  edgeThickness: number;
}

const DEFAULTS: RendererOptions = {
  rowHeight: 24,
  laneWidth: 14,
  nodeRadius: 5,
  edgeThickness: 2,
};

const NODE_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_quad;          // -1..1 quad
in vec2 a_center_px;     // pixel position of the node
in float a_color_idx;    // palette index

uniform vec2 u_viewport;
uniform float u_radius;
uniform vec3 u_palette[${PALETTE_SIZE}];

out vec2 v_local;
out vec3 v_color;

void main() {
  vec2 offset_px = a_quad * (u_radius + 1.5);
  vec2 pos_px = a_center_px + offset_px;
  vec2 clip = (pos_px / u_viewport) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_local = a_quad * (u_radius + 1.5);
  v_color = u_palette[int(a_color_idx)];
}
`;

const NODE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_local;
in vec3 v_color;
uniform float u_radius;
out vec4 frag_color;

void main() {
  float d = length(v_local) - u_radius;
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  if (alpha < 0.01) discard;
  frag_color = vec4(v_color, alpha);
}
`;

const EDGE_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_pos_px;
in float a_color_idx;
in float a_dist;

uniform vec2 u_viewport;
uniform vec3 u_palette[${PALETTE_SIZE}];

out vec3 v_color;
out float v_dist;

void main() {
  vec2 clip = (a_pos_px / u_viewport) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = u_palette[int(a_color_idx)];
  v_dist = a_dist;
}
`;

const EDGE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_color;
in float v_dist;

uniform float u_stroke_half;

out vec4 frag_color;

void main() {
  float alpha = 1.0 - smoothstep(u_stroke_half - 1.0, u_stroke_half + 1.0, abs(v_dist));
  if (alpha < 0.01) discard;
  frag_color = vec4(v_color, alpha * 0.95);
}
`;

type OGLGL = Renderer["gl"];

export class CommitGraphRenderer {
  private readonly renderer: Renderer;
  private readonly gl: OGLGL;
  private edgeMesh: Mesh | undefined;
  private readonly options: RendererOptions;
  private viewportSize: [number, number] = [0, 0];

  constructor(canvas: HTMLCanvasElement, options: Partial<RendererOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };

    if (!document.createElement("canvas").getContext("webgl2")) {
      throw new Error(
        "WebGL2 is not available in this WebView. The commit graph requires WebGL2.",
      );
    }

    this.renderer = new Renderer({
      canvas,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    this.gl = this.renderer.gl;
    if (!(this.gl instanceof WebGL2RenderingContext)) {
      throw new Error("ogl fell back to WebGL1; shaders require WebGL2 (#version 300 es)");
    }
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(widthPx: number, heightPx: number) {
    this.renderer.setSize(widthPx, heightPx);
    this.viewportSize = [widthPx, heightPx];
  }

  /**
   * Upload the rows currently in the visible window + margin and issue a draw.
   * `firstRow` is the absolute index of `rows[0]` in the full graph (so we can
   * position nodes relative to the scrollTop passed in).
   *
   * `shaToRow` is the full sha→absRow map built from all streamed rows, used
   * to anchor edges to their actual parent row regardless of topological gaps.
   */
  draw(
    rows: GraphRow[],
    firstRow: number,
    scrollTop: number,
    shaToRow: Map<string, number>,
  ) {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (rows.length === 0) return;

    const { rowHeight, laneWidth, nodeRadius, edgeThickness } = this.options;
    const dpr = this.renderer.dpr;
    const viewport = [this.viewportSize[0] * dpr, this.viewportSize[1] * dpr] as const;
    const scrollTopPx = scrollTop * dpr;

    const nodeCount = rows.length;
    const centers = new Float32Array(nodeCount * 2);
    const colors = new Float32Array(nodeCount);

    const edgePositions: number[] = [];
    const edgeColors: number[] = [];
    const edgeDists: number[] = [];
    const halfStrokePx = (edgeThickness * dpr) / 2;
    const halfWidthPx = halfStrokePx + 1.5; // stroke half + AA feather

    rows.forEach((row, i) => {
      const absRow = firstRow + i;
      const cx = (row.lane + 1) * laneWidth * dpr;
      const cy = (absRow + 0.5) * rowHeight * dpr - scrollTopPx;
      centers[i * 2] = cx;
      centers[i * 2 + 1] = cy;
      colors[i] = row.color_idx;

      row.parent_lanes.forEach((parentLane, pi) => {
        const px = (parentLane + 1) * laneWidth * dpr;
        if (parentLane === row.lane) {
          // Same-lane continuation: long straight stroke to the parent's real
          // row. This forms the continuous "pipe" for the lane even when the
          // parent lives several rows below the child.
          const parentSha = row.parent_shas[pi];
          const parentAbsRow = parentSha !== undefined
            ? shaToRow.get(parentSha) ?? absRow + 1
            : absRow + 1;
          const py = (parentAbsRow + 0.5) * rowHeight * dpr - scrollTopPx;
          this.pushStraightQuad(
            edgePositions,
            edgeColors,
            edgeDists,
            cx,
            cy,
            px,
            py,
            halfWidthPx,
            row.color_idx,
          );
        } else {
          // Cross-lane transition: short curve that peels off to the adjacent
          // row on the parent's lane. The rest of the distance to the parent's
          // actual row is covered by the target lane's own same-lane pipe.
          const py = (absRow + 1.5) * rowHeight * dpr - scrollTopPx;
          this.pushBezierStrip(
            edgePositions,
            edgeColors,
            edgeDists,
            cx,
            cy,
            px,
            py,
            rowHeight * dpr,
            halfWidthPx,
            row.color_idx,
          );
        }
      });
    });

    this.drawEdges(
      new Float32Array(edgePositions),
      new Float32Array(edgeColors),
      new Float32Array(edgeDists),
      viewport,
      halfStrokePx,
    );
    this.drawNodes(centers, colors, viewport, nodeRadius * dpr);
  }

  private nodeProgram: WebGLProgram | null = null;
  private nodeLocs: { a_quad: number; a_center: number; a_color: number; u_viewport: WebGLUniformLocation | null; u_radius: WebGLUniformLocation | null; u_palette: WebGLUniformLocation | null } | null = null;
  private nodeQuadBuf: WebGLBuffer | null = null;
  private nodeCenterBuf: WebGLBuffer | null = null;
  private nodeColorBuf: WebGLBuffer | null = null;
  private nodeVAO: WebGLVertexArrayObject | null = null;

  private drawNodes(
    centers: Float32Array,
    colors: Float32Array,
    viewport: readonly [number, number],
    radiusPx: number,
  ) {
    const gl = this.gl as WebGL2RenderingContext;

    if (!this.nodeProgram) {
      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vs, NODE_VERT);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        console.error("[nodes] vs:", gl.getShaderInfoLog(vs));
        return;
      }
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fs, NODE_FRAG);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        console.error("[nodes] fs:", gl.getShaderInfoLog(fs));
        return;
      }
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("[nodes] link:", gl.getProgramInfoLog(prog));
        return;
      }
      this.nodeProgram = prog;
      this.nodeLocs = {
        a_quad: gl.getAttribLocation(prog, "a_quad"),
        a_center: gl.getAttribLocation(prog, "a_center_px"),
        a_color: gl.getAttribLocation(prog, "a_color_idx"),
        u_viewport: gl.getUniformLocation(prog, "u_viewport"),
        u_radius: gl.getUniformLocation(prog, "u_radius"),
        u_palette: gl.getUniformLocation(prog, "u_palette[0]"),
      };

      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      this.nodeQuadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeQuadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      this.nodeCenterBuf = gl.createBuffer();
      this.nodeColorBuf = gl.createBuffer();
      this.nodeVAO = gl.createVertexArray();

      gl.bindVertexArray(this.nodeVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeQuadBuf);
      gl.enableVertexAttribArray(this.nodeLocs.a_quad);
      gl.vertexAttribPointer(this.nodeLocs.a_quad, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(this.nodeLocs.a_quad, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeCenterBuf);
      gl.enableVertexAttribArray(this.nodeLocs.a_center);
      gl.vertexAttribPointer(this.nodeLocs.a_center, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(this.nodeLocs.a_center, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeColorBuf);
      gl.enableVertexAttribArray(this.nodeLocs.a_color);
      gl.vertexAttribPointer(this.nodeLocs.a_color, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(this.nodeLocs.a_color, 1);
      gl.bindVertexArray(null);
    }

    gl.useProgram(this.nodeProgram);
    gl.bindVertexArray(this.nodeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeCenterBuf);
    gl.bufferData(gl.ARRAY_BUFFER, centers, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

    gl.uniform2f(this.nodeLocs!.u_viewport, viewport[0], viewport[1]);
    gl.uniform1f(this.nodeLocs!.u_radius, radiusPx);
    gl.uniform3fv(this.nodeLocs!.u_palette, PALETTE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE); // critical: our shader flips y, which reverses winding
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, centers.length / 2);
    gl.bindVertexArray(null);
  }

  private drawEdges(
    positions: Float32Array,
    colors: Float32Array,
    dists: Float32Array,
    viewport: readonly [number, number],
    strokeHalf: number,
  ) {
    if (positions.length === 0) return;
    const gl: OGLGL = this.gl;

    const geometry = new Geometry(gl, {
      a_pos_px: { size: 2, data: positions },
      a_color_idx: { size: 1, data: colors },
      a_dist: { size: 1, data: dists },
    });

    const program = new Program(gl, {
      vertex: EDGE_VERT,
      fragment: EDGE_FRAG,
      uniforms: {
        u_viewport: { value: [viewport[0], viewport[1]] },
        u_palette: { value: PALETTE },
        u_stroke_half: { value: strokeHalf },
      },
      transparent: true,
      cullFace: false,
    });

    this.edgeMesh = new Mesh(gl, { geometry, program, mode: gl.TRIANGLES });
    this.renderer.render({ scene: this.edgeMesh, clear: false });
  }

  private pushStraightQuad(
    positions: number[],
    colors: number[],
    dists: number[],
    ax: number,
    ay: number,
    bx: number,
    by: number,
    halfW: number,
    colorIdx: number,
  ) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;

    const lA = [ax + nx, ay + ny];
    const rA = [ax - nx, ay - ny];
    const lB = [bx + nx, by + ny];
    const rB = [bx - nx, by - ny];

    positions.push(...lA, ...rA, ...lB, ...lB, ...rA, ...rB);
    for (let i = 0; i < 6; i++) colors.push(colorIdx);
    dists.push(halfW, -halfW, halfW, halfW, -halfW, -halfW);
  }

  private pushBezierStrip(
    positions: number[],
    colors: number[],
    dists: number[],
    ax: number,
    ay: number,
    bx: number,
    by: number,
    rowHeightPx: number,
    halfW: number,
    colorIdx: number,
  ) {
    const SEGMENTS = 14;
    const p0x = ax;
    const p0y = ay;
    const p3x = bx;
    const p3y = by;
    // Vertical tangents: control points sit rowHeight/2 above/below the anchors.
    const p1x = p0x;
    const p1y = p0y + rowHeightPx * 0.5;
    const p2x = p3x;
    const p2y = p3y - rowHeightPx * 0.5;

    // Pre-sample left/right offset points once so each segment shares vertices
    // with its neighbors (miter-joined via analytic tangent — curvature is low
    // enough that miter spikes are not a concern at SEGMENTS=14).
    const lxs = new Float64Array(SEGMENTS + 1);
    const lys = new Float64Array(SEGMENTS + 1);
    const rxs = new Float64Array(SEGMENTS + 1);
    const rys = new Float64Array(SEGMENTS + 1);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const omt = 1 - t;
      // Cubic Bézier position.
      const bx_ = omt * omt * omt * p0x + 3 * omt * omt * t * p1x + 3 * omt * t * t * p2x + t * t * t * p3x;
      const by_ = omt * omt * omt * p0y + 3 * omt * omt * t * p1y + 3 * omt * t * t * p2y + t * t * t * p3y;
      // Analytic tangent dB/dt.
      const tx = 3 * omt * omt * (p1x - p0x) + 6 * omt * t * (p2x - p1x) + 3 * t * t * (p3x - p2x);
      const ty = 3 * omt * omt * (p1y - p0y) + 6 * omt * t * (p2y - p1y) + 3 * t * t * (p3y - p2y);
      const tlen = Math.hypot(tx, ty) || 1;
      const nx = (-ty / tlen) * halfW;
      const ny = (tx / tlen) * halfW;
      lxs[i] = bx_ + nx;
      lys[i] = by_ + ny;
      rxs[i] = bx_ - nx;
      rys[i] = by_ - ny;
    }

    for (let i = 0; i < SEGMENTS; i++) {
      const lA = [lxs[i], lys[i]];
      const rA = [rxs[i], rys[i]];
      const lB = [lxs[i + 1], lys[i + 1]];
      const rB = [rxs[i + 1], rys[i + 1]];
      positions.push(...lA, ...rA, ...lB, ...lB, ...rA, ...rB);
      for (let k = 0; k < 6; k++) colors.push(colorIdx);
      dists.push(halfW, -halfW, halfW, halfW, -halfW, -halfW);
    }
  }
}
