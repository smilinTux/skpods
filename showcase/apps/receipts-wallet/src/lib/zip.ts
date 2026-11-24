// Minimal ZIP writer (store method, no compression): enough to hand the user their raw RDF in one file.
// Turtle compresses well but the point of this export is a transparent, dependency free archive.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear())
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

export interface ZipEntry {
  /** Forward slash path inside the archive. */
  path: string
  data: string | Uint8Array
  date?: Date
}

export function makeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true)
  const u32 = (v: DataView, o: number, n: number) => v.setUint32(o, n >>> 0, true)
  for (const e of entries) {
    const name = enc.encode(e.path)
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data
    const crc = crc32(data)
    const { time, date } = dosDateTime(e.date ?? new Date())
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20)
    u16(lv, 6, 0x0800) // UTF-8 names
    u16(lv, 8, 0)
    u16(lv, 10, time)
    u16(lv, 12, date)
    u32(lv, 14, crc)
    u32(lv, 18, data.length)
    u32(lv, 22, data.length)
    u16(lv, 26, name.length)
    u16(lv, 28, 0)
    local.set(name, 30)
    parts.push(local, data)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    u32(cv, 0, 0x02014b50)
    u16(cv, 4, 20)
    u16(cv, 6, 20)
    u16(cv, 8, 0x0800)
    u16(cv, 10, 0)
    u16(cv, 12, time)
    u16(cv, 14, date)
    u32(cv, 16, crc)
    u32(cv, 20, data.length)
    u32(cv, 24, data.length)
    u16(cv, 28, name.length)
    u32(cv, 42, offset)
    cd.set(name, 46)
    central.push(cd)
    offset += local.length + data.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  u32(ev, 0, 0x06054b50)
  u16(ev, 8, entries.length)
  u16(ev, 10, entries.length)
  u32(ev, 12, cdSize)
  u32(ev, 16, offset)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of all) {
    out.set(p, o)
    o += p.length
  }
  return out
}
