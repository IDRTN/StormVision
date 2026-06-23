export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), df = mx - mn;
  let h = 0, s = 0, v = mx;
  if (df !== 0) {
    s = df / mx;
    if (mx === rr) h = 60 * (((gg - bb) / df) % 6);
    else if (mx === gg) h = 60 * ((bb - rr) / df + 2);
    else h = 60 * ((rr - gg) / df + 4);
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

export function isCloudPixel(r: number, g: number, b: number): boolean {
  const gray = (r + g + b) / 3;
  if (gray < 160) return false;
  const [, s, v] = rgbToHsv(r, g, b);
  return v > 0.65 && s < 0.35;
}

export function brightness(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
