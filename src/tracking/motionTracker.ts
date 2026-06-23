import type { MotionData, TrackedCloud } from '../utils/types';

export class MotionTracker {
  private prevGray: number[][] | null = null;
  private prevMask: number[][] | null = null;
  private nextId = 0;
  private tracks = new Map<number, TrackedCloud>();

  track(gray: number[][], cloudMask: number[][]): { motion: MotionData; tracked: TrackedCloud[] } {
    const motion: MotionData = { averageDx: 0, averageDy: 0, magnitude: 0, direction: 0 };
    const h = gray.length, w = gray[0]?.length || 0;

    if (this.prevGray && h > 0 && w > 0) {
      const bs = 16, sr = 6;
      let tx = 0, ty = 0, n = 0;
      for (let by = 0; by + bs <= h; by += bs)
        for (let bx = 0; bx + bs <= w; bx += bs) {
          let cp = 0;
          for (let dy = 0; dy < bs; dy++)
            for (let dx = 0; dx < bs; dx++)
              if (cloudMask[by+dy]?.[bx+dx] > 0) cp++;
          if (cp < bs*bs*0.2) continue;

          let bestDx = 0, bestDy = 0, bestSsd = Infinity;
          for (let sy = -sr; sy <= sr; sy += 2)
            for (let sx = -sr; sx <= sr; sx += 2) {
              const ry = by+sy, rx = bx+sx;
              if (ry < 0 || ry+bs > h || rx < 0 || rx+bs > w) continue;
              let ssd = 0;
              for (let dy = 0; dy < bs; dy++)
                for (let dx = 0; dx < bs; dx++) {
                  const d = gray[by+dy][bx+dx] - this.prevGray[ry+dy][rx+dx];
                  ssd += d*d;
                }
              if (ssd < bestSsd) { bestSsd = ssd; bestDx = -sx; bestDy = -sy; }
            }
          if (bestSsd < 256*bs*bs) { tx += bestDx; ty += bestDy; n++; }
        }
      if (n > 0) {
        motion.averageDx = tx/n; motion.averageDy = ty/n;
        motion.magnitude = Math.sqrt(motion.averageDx**2 + motion.averageDy**2);
        motion.direction = Math.atan2(motion.averageDy, motion.averageDx);
      }
    }

    this.updateTracks(cloudMask);
    this.prevGray = gray.map(r => [...r]);
    this.prevMask = cloudMask.map(r => [...r]);
    return { motion, tracked: Array.from(this.tracks.values()).filter(c => c.isActive) };
  }

  private updateTracks(cloudMask: number[][]): void {
    const h = cloudMask.length, w = cloudMask[0]?.length || 0;
    const visited = Array.from({ length: h }, () => new Array(w).fill(false));
    const centroids: [number, number][] = [];

    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (cloudMask[y][x] > 0 && !visited[y][x]) {
          const q: [number, number][] = [[y, x]];
          visited[y][x] = true;
          let sx = 0, sy = 0, c = 0;
          while (q.length > 0) {
            const [cy, cx] = q.shift()!;
            sx += cx; sy += cy; c++;
            for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
              const ny = cy+dy, nx = cx+dx;
              if (ny >= 0 && ny < h && nx >= 0 && nx < w && cloudMask[ny][nx] > 0 && !visited[ny][nx]) {
                visited[ny][nx] = true; q.push([ny, nx]);
              }
            }
          }
          if (c >= 4) centroids.push([sx/c, sy/c]);
        }
      }

    const matchedCurr = new Set<number>();
    for (const [id, cloud] of this.tracks) {
      if (!cloud.isActive || cloud.positions.length === 0) continue;
      const last = cloud.positions[cloud.positions.length - 1];
      let bestDist = 60, bestIdx = -1;
      for (let i = 0; i < centroids.length; i++) {
        if (matchedCurr.has(i)) continue;
        const d = Math.sqrt((centroids[i][0]-last[0])**2 + (centroids[i][1]-last[1])**2);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx >= 0) { matchedCurr.add(bestIdx); cloud.positions.push(centroids[bestIdx]); cloud.age++; }
      else cloud.isActive = false;
    }
    for (let i = 0; i < centroids.length; i++) {
      if (!matchedCurr.has(i))
        this.tracks.set(this.nextId++, { id: this.nextId-1, positions: [centroids[i]], age: 1, isActive: true });
    }
    for (const [id, c] of this.tracks) if (!c.isActive) this.tracks.delete(id);
  }

  reset() { this.prevGray = null; this.prevMask = null; this.tracks.clear(); this.nextId = 0; }
}
