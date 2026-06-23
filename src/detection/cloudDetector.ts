import type { CloudDetectionResult } from '../utils/types';
import { isCloudPixel, brightness } from '../utils/colors';
import { createGrayscale } from './imageProcessing';

function sobelEdgeDetect(gray: number[][]): number[][] {
  const h = gray.length, w = gray[0]?.length || 0;
  const res: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const gx = -gray[y-1][x-1] + gray[y-1][x+1] - 2*gray[y][x-1] + 2*gray[y][x+1] - gray[y+1][x-1] + gray[y+1][x+1];
      const gy = -gray[y-1][x-1] - 2*gray[y-1][x] - gray[y-1][x+1] + gray[y+1][x-1] + 2*gray[y+1][x] + gray[y+1][x+1];
      res[y][x] = Math.min(255, Math.sqrt(gx*gx + gy*gy));
    }
  return res;
}

function connectedComponents(binary: number[][]): { labels: number[][]; counts: number[] } {
  const h = binary.length, w = binary[0].length;
  const labels = Array.from({ length: h }, () => new Array(w).fill(0));
  const counts: number[] = [0];
  let nextLabel = 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (binary[y][x] > 0 && labels[y][x] === 0) {
        const q: [number, number][] = [[y, x]];
        labels[y][x] = nextLabel;
        let c = 0;
        while (q.length > 0) {
          const [cy, cx] = q.shift()!;
          c++;
          for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const ny = cy+dy, nx = cx+dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w && binary[ny][nx] > 0 && labels[ny][nx] === 0) {
              labels[ny][nx] = nextLabel;
              q.push([ny, nx]);
            }
          }
        }
        counts.push(c);
        nextLabel++;
      }
    }
  return { labels, counts };
}

export function detectClouds(
  pixelData: { r: number; g: number; b: number }[][],
  method: 'color' | 'edge' | 'hybrid' = 'hybrid',
  minCloudArea = 4
): CloudDetectionResult {
  const h = pixelData.length, w = pixelData[0]?.length || 0;
  if (!h || !w) return { cloudMask: [], cloudCount: 0, cloudCoverRatio: 0, meanBrightness: 0, dominantColor: [0,0,0], timestamp: Date.now() };

  let cloudMap: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  if (method === 'color' || method === 'hybrid') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = pixelData[y][x];
        cloudMap[y][x] = isCloudPixel(p.r, p.g, p.b) ? 255 : 0;
      }
  }

  if (method === 'edge' || method === 'hybrid') {
    const gray = createGrayscale(pixelData);
    const edges = sobelEdgeDetect(gray);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (edges[y][x] > 40) cloudMap[y][x] = 255;
  }

  const { labels, counts } = connectedComponents(cloudMap);
  const validSet = new Set<number>();
  for (let i = 1; i < counts.length; i++) if (counts[i] >= minCloudArea) validSet.add(i);

  const finalMask: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
  let cloudPixels = 0, sumR = 0, sumG = 0, sumB = 0, sumBri = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (validSet.has(labels[y][x])) {
        finalMask[y][x] = 255;
        cloudPixels++;
        const p = pixelData[y][x];
        sumR += p.r; sumG += p.g; sumB += p.b;
        sumBri += brightness(p.r, p.g, p.b);
      }
    }

  return {
    cloudMask: finalMask,
    cloudCount: validSet.size,
    cloudCoverRatio: cloudPixels / (h * w),
    meanBrightness: cloudPixels > 0 ? sumBri / cloudPixels : 0,
    dominantColor: cloudPixels > 0 ? [Math.round(sumR/cloudPixels), Math.round(sumG/cloudPixels), Math.round(sumB/cloudPixels)] : [0,0,0],
    timestamp: Date.now(),
  };
}
