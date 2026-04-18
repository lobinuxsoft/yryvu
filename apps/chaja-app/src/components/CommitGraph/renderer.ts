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

uniform vec2 u_viewport;
uniform vec3 u_palette[${PALETTE_SIZE}];

out vec3 v_color;

void main() {
  vec2 clip = (a_pos_px / u_viewport) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = u_palette[int(a_color_idx)];
}
`;

const EDGE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 frag_color;
void main() { frag_color = vec4(v_color, 0.85); }
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
   */
  draw(rows: GraphRow[], firstRow: number, scrollTop: number) {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (rows.length === 0) return;

    const { rowHeight, laneWidth, nodeRadius, edgeThickness } = this.options;
    const dpr = this.renderer.dpr;
    const viewport = [this.viewportSize[0] * dpr, this.viewportSize[1] * dpr] as const;
    const scrollTopPx = scrollTop * dpr;

    const nodeCount = rows.length;
    const centers = new Float32Array(nodeCount * 2);
    const colors = new Float32Array(nodeCount);

    const edgeSegments: number[] = [];
    const edgeColors: number[] = [];

    rows.forEach((row, i) => {
      const absRow = firstRow + i;
      const cx = (row.lane + 1) * laneWidth * dpr;
      const cy = (absRow + 0.5) * rowHeight * dpr - scrollTopPx;
      centers[i * 2] = cx;
      centers[i * 2 + 1] = cy;
      colors[i] = row.color_idx;

      row.parent_lanes.forEach((parentLane) => {
        const px = (parentLane + 1) * laneWidth * dpr;
        const py = (absRow + 1.5) * rowHeight * dpr - scrollTopPx;
        this.pushEdgeQuad(
          edgeSegments,
          edgeColors,
          cx,
          cy,
          px,
          py,
          edgeThickness * dpr,
          row.color_idx,
        );
      });
    });

    this.drawEdges(new Float32Array(edgeSegments), new Float32Array(edgeColors), viewport);
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
    segments: Float32Array,
    colors: Float32Array,
    viewport: readonly [number, number],
  ) {
    if (segments.length === 0) return;
    const gl: OGLGL = this.gl;

    const geometry = new Geometry(gl, {
      a_pos_px: { size: 2, data: segments },
      a_color_idx: { size: 1, data: colors },
    });

    const program = new Program(gl, {
      vertex: EDGE_VERT,
      fragment: EDGE_FRAG,
      uniforms: {
        u_viewport: { value: [viewport[0], viewport[1]] },
        u_palette: { value: PALETTE },
      },
      transparent: true,
      cullFace: false,
    });

    this.edgeMesh = new Mesh(gl, { geometry, program, mode: gl.TRIANGLES });
    this.renderer.render({ scene: this.edgeMesh, clear: false });
  }

  private pushEdgeQuad(
    segments: number[],
    colors: number[],
    ax: number,
    ay: number,
    bx: number,
    by: number,
    thickness: number,
    colorIdx: number,
  ) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (thickness / 2);
    const ny = (dx / len) * (thickness / 2);

    const p0 = [ax + nx, ay + ny];
    const p1 = [ax - nx, ay - ny];
    const p2 = [bx + nx, by + ny];
    const p3 = [bx - nx, by - ny];

    segments.push(...p0, ...p1, ...p2, ...p2, ...p1, ...p3);
    for (let i = 0; i < 6; i++) colors.push(colorIdx);
  }
}
