/* Gray–Scott reaction–diffusion, adapted from Primordia's reference world.
 * Copyright (c) 2026 The Primordia contributors. MIT; see assets/PRIMORDIA-LICENSE.txt.
 * Fixed simulation resolution keeps the work independent of screen pixel density.
 */
export const SIZE = 160;
const COUNT = SIZE * SIZE;

export class Life {
  constructor(seed) {
    this.u = new Float32Array(COUNT).fill(1);
    this.v = new Float32Array(COUNT);
    this.nextU = new Float32Array(COUNT);
    this.nextV = new Float32Array(COUNT);
    if (seed) {
      if (seed.byteLength !== COUNT * 4) throw new Error('Invalid life seed');
      const data = new DataView(seed);
      for (let i = 0; i < COUNT; i++) {
        this.u[i] = data.getUint16(i * 4, true) / 65535;
        this.v[i] = data.getUint16(i * 4 + 2, true) / 65535;
      }
    }
  }

  plant(x, y, radius = 4) {
    const cx = x * SIZE;
    const cy = y * SIZE;
    for (let py = Math.floor(cy - radius); py <= cy + radius; py++) {
      for (let px = Math.floor(cx - radius); px <= cx + radius; px++) {
        if ((px - cx) ** 2 + (py - cy) ** 2 > radius * radius) continue;
        const i = ((py + SIZE) % SIZE) * SIZE + (px + SIZE) % SIZE;
        this.u[i] = .5;
        this.v[i] = .28 + .03 * Math.sin(px * 17 + py * 31);
      }
    }
  }

  step(iterations = 1) {
    for (let step = 0; step < iterations; step++) {
      const u = this.u, v = this.v, nu = this.nextU, nv = this.nextV;
      for (let y = 0; y < SIZE; y++) {
        const row = y * SIZE;
        const up = ((y + SIZE - 1) % SIZE) * SIZE;
        const down = ((y + 1) % SIZE) * SIZE;
        for (let x = 0; x < SIZE; x++) {
          const i = row + x;
          const left = x === 0 ? SIZE - 1 : x - 1;
          const right = x === SIZE - 1 ? 0 : x + 1;
          const lapU = .2 * (u[row + left] + u[row + right] + u[up + x] + u[down + x])
            + .05 * (u[up + left] + u[up + right] + u[down + left] + u[down + right]) - u[i];
          const lapV = .2 * (v[row + left] + v[row + right] + v[up + x] + v[down + x])
            + .05 * (v[up + left] + v[up + right] + v[down + left] + v[down + right]) - v[i];
          const reaction = u[i] * v[i] * v[i];
          // Primordia's Coral Reef parameters, Du = 1, Dv = .5, dt = 1.
          nu[i] = Math.max(0, Math.min(1, u[i] + lapU - reaction + .0545 * (1 - u[i])));
          nv[i] = Math.max(0, Math.min(1, v[i] + .5 * lapV + reaction - .1165 * v[i]));
        }
      }
      this.u = nu; this.v = nv; this.nextU = u; this.nextV = v;
    }
  }

  paint(pixels) {
    const v = this.v;
    for (let y = 0; y < SIZE; y++) {
      const up = ((y + SIZE - 1) % SIZE) * SIZE;
      const down = ((y + 1) % SIZE) * SIZE;
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const t = Math.min(1, v[i] * 3.2);
        const dx = (x + .5) / SIZE - .5, dy = (y + .5) / SIZE - .5;
        const radius = Math.hypot(dx, dy);
        const fade = Math.max(0, Math.min(1, (.47 - radius) / .065));
        const gradient = v[up + x] - v[down + x];
        const shade = .82 + Math.max(-.3, Math.min(.32, gradient * 3.5));
        const light = t * t * shade;
        const violet = Math.max(0, Math.min(1, .5 + dx * 1.45 + dy * .65));
        const core = Math.max(0, t - .68) * 100;
        pixels[i * 4] = 11 + light * (65 + 105 * violet) + core;
        pixels[i * 4 + 1] = 13 + light * (230 - 90 * violet) + core;
        pixels[i * 4 + 2] = 18 + light * (182 + 52 * violet) + core;
        pixels[i * 4 + 3] = 255 * fade * fade * (3 - 2 * fade);
      }
    }
  }
}
