export function getPixelData(
  data: Uint8Array, width: number, height: number
): { r: number; g: number; b: number }[][] {
  const pixels: { r: number; g: number; b: number }[][] = [];
  for (let y = 0; y < height; y++) {
    const row: { r: number; g: number; b: number }[] = [];
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      row.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
    pixels.push(row);
  }
  return pixels;
}

export function createGrayscale(pixels: { r: number; g: number; b: number }[][]): number[][] {
  return pixels.map(row =>
    row.map(p => Math.round(0.299 * p.r + 0.587 * p.g + 0.114 * p.b))
  );
}
