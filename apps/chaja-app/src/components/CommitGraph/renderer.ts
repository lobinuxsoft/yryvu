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
  private nodeMesh: Mesh | undefined;
  private edgeMesh: Mesh | undefined;
  private readonly options: RendererOptions;
  private viewportSize: [number, number] = [0, 0];

  constructor(canvas: HTMLCanvasElement, options: Partial<RendererOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.renderer = new Renderer({
      canvas,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      alpha: true,
      premultipliedAlpha: false,
      antialias: false, // we use SDF in the fragment shader
    });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0.08, 0.09, 0.11, 1.0);
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

  private drawNodes(
    centers: Float32Array,
    colors: Float32Array,
    viewport: readonly [number, number],
    radiusPx: number,
  ) {
    const gl: OGLGL = this.gl;
    const quad = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]);

    const geometry = new Geometry(gl, {
      a_quad: { size: 2, data: quad },
      a_center_px: { size: 2, data: centers, instanced: 1 },
      a_color_idx: { size: 1, data: colors, instanced: 1 },
    });

    const program = new Program(gl, {
      vertex: NODE_VERT,
      fragment: NODE_FRAG,
      uniforms: {
        u_viewport: { value: [viewport[0], viewport[1]] },
        u_radius: { value: radiusPx },
        u_palette: { value: PALETTE },
      },
      transparent: true,
    });

    this.nodeMesh = new Mesh(gl, { geometry, program });
    this.renderer.render({ scene: this.nodeMesh });
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
    });

    this.edgeMesh = new Mesh(gl, { geometry, program, mode: gl.TRIANGLES });
    this.renderer.render({ scene: this.edgeMesh });
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
