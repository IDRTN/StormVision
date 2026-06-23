// Generates synthetic sky frames with moving clouds (pure JS, no native deps)

export class MockFrameGenerator {
  private frameCount = 0;

  generate(width: number, height: number): Uint8Array {
    this.frameCount++;
    const pixels = new Uint8Array(width * height * 4);
    const t = this.frameCount * 0.05;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const v = 1 - y / height;
        pixels[idx] = Math.round(200 + 50 * v);      // R
        pixels[idx + 1] = Math.round(180 + 70 * v);  // G
        pixels[idx + 2] = Math.round(135 + 120 * v); // B
        pixels[idx + 3] = 255;                        // A

        // White cloud blobs
        for (let c = 0; c < 6; c++) {
          const cx = (160 + c * 80 + 30 * Math.sin(t + c * 1.2)) % width;
          const cy = 80 + 30 * Math.sin(t * 0.7 + c * 0.9);
          const r = 40 + 10 * Math.sin(t * 0.3 + c);
          const dx = x - cx, dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < r) {
            const b = Math.max(0.3, 1 - dist / r);
            pixels[idx] = Math.min(255, pixels[idx] + Math.round(80 * b));
            pixels[idx+1] = Math.min(255, pixels[idx+1] + Math.round(80 * b));
            pixels[idx+2] = Math.min(255, pixels[idx+2] + Math.round(80 * b));
          }
        }

        // Storm cloud after frame 60
        if (this.frameCount > 60) {
          const scx = width * 0.5 + 40 * Math.sin(t * 0.5);
          const scy = height * 0.3 + 15 * Math.cos(t * 0.7);
          const sdx = x - scx, sdy = y - scy;
          const sd = Math.sqrt(sdx*sdx + sdy*sdy);
          if (sd < 70) {
            const dk = Math.round(60 * (1 - sd/70));
            pixels[idx] = Math.max(0, pixels[idx] - dk);
            pixels[idx+1] = Math.max(0, pixels[idx+1] - dk + 20);
            pixels[idx+2] = Math.max(0, pixels[idx+2] - dk);
          }
        }
      }
    }
    return pixels;
  }
}
