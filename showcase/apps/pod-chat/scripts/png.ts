// Tiny PNG encoder (no dependencies) for the demo photo: a child's drawing of a sunny house.
import zlib from 'node:zlib'

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}

export function drawingPng(w = 640, h = 420): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      let c = mix([255, 214, 140], [120, 190, 235], y / (h * 0.7)) // sky
      const dx = x - 500, dy = y - 90
      if (dx * dx + dy * dy < 55 * 55) c = [255, 205, 60] // sun
      if (y > h * 0.7) c = mix([110, 190, 100], [70, 150, 80], (y - h * 0.7) / (h * 0.3)) // grass
      if (x > 170 && x < 400 && y > 190 && y < 330) c = [226, 120, 96] // house
      if (y > 120 && y <= 190 && x > 150 + (190 - y) * -1 * -1 + 0 && Math.abs(x - 285) < (y - 120) * 1.9 + 0 && x > 150 && x < 420) c = [120, 70, 60] // roof
      if (x > 260 && x < 310 && y > 250 && y < 330) c = [255, 240, 200] // door
      if (x > 200 && x < 245 && y > 215 && y < 255) c = [180, 220, 250] // window
      if (x > 330 && x < 375 && y > 215 && y < 255) c = [180, 220, 250]
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
