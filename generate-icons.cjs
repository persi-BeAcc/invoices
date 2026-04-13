#!/usr/bin/env node
// Generates icon-192.png and icon-512.png from scratch using pure Node.js (no deps)
// Design: Concept A — navy rounded square, white document with fold, green paid badge

'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

// ── PNG encoder (RGBA) ────────────────────────────────────────────────────────
function makePNG(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  // Raw scanlines: 1 filter byte (None=0) + RGBA per pixel
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const pi = (y * size + x) * 4;
      const ri = y * (size * 4 + 1) + 1 + x * 4;
      raw[ri] = pixels[pi]; raw[ri + 1] = pixels[pi + 1];
      raw[ri + 2] = pixels[pi + 2]; raw[ri + 3] = pixels[pi + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── Drawing primitives ────────────────────────────────────────────────────────
function makeCanvas(size) {
  const px = new Uint8Array(size * size * 4); // all transparent

  function blend(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    const fa = a / 255, ba = px[i + 3] / 255;
    const oa = fa + ba * (1 - fa);
    if (oa === 0) return;
    px[i]     = Math.round((r * fa + px[i]     * ba * (1 - fa)) / oa);
    px[i + 1] = Math.round((g * fa + px[i + 1] * ba * (1 - fa)) / oa);
    px[i + 2] = Math.round((b * fa + px[i + 2] * ba * (1 - fa)) / oa);
    px[i + 3] = Math.round(oa * 255);
  }

  function set(x, y, r, g, b) { blend(x, y, r, g, b, 255); }

  function fillRoundRect(x1, y1, x2, y2, radius, r, g, b) {
    const rx = Math.round(radius);
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const cx = Math.max(x1 + rx, Math.min(x2 - rx - 1, x));
        const cy = Math.max(y1 + rx, Math.min(y2 - rx - 1, y));
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= rx * rx + rx) set(x, y, r, g, b);
      }
    }
  }

  function fillRect(x1, y1, x2, y2, r, g, b) {
    for (let y = y1; y < y2; y++)
      for (let x = x1; x < x2; x++) set(x, y, r, g, b);
  }

  function fillCircle(cx, cy, radius, r, g, b) {
    const rr = radius * radius;
    for (let y = Math.max(0, cy - radius - 1); y <= Math.min(size - 1, cy + radius + 1); y++) {
      for (let x = Math.max(0, cx - radius - 1); x <= Math.min(size - 1, cx + radius + 1); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= rr) set(x, y, r, g, b);
      }
    }
  }

  // Anti-aliased circle using distance
  function fillCircleAA(cx, cy, radius, r, g, b) {
    for (let y = Math.max(0, cy - radius - 2); y <= Math.min(size - 1, cy + radius + 2); y++) {
      for (let x = Math.max(0, cx - radius - 2); x <= Math.min(size - 1, cx + radius + 2); x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - dist));
        if (alpha > 0) blend(x, y, r, g, b, Math.round(alpha * 255));
      }
    }
  }

  // Draw a thick line segment with round caps
  function drawLine(x1, y1, x2, y2, width, r, g, b) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const nx = -dy / len, ny = dx / len; // normal
    const hw = width / 2;
    const steps = Math.ceil(len) * 2;
    for (let t = 0; t <= steps; t++) {
      const frac = t / steps;
      const px_c = x1 + dx * frac, py_c = y1 + dy * frac;
      for (let w = -hw - 1; w <= hw + 1; w++) {
        const alpha = Math.max(0, Math.min(1, hw + 0.5 - Math.abs(w)));
        if (alpha > 0) blend(Math.round(px_c + nx * w), Math.round(py_c + ny * w), r, g, b, Math.round(alpha * 255));
      }
    }
  }

  return { px, set, blend, fillRoundRect, fillRect, fillCircle, fillCircleAA, drawLine };
}

// ── Icon drawing ──────────────────────────────────────────────────────────────
function drawIcon(size) {
  const s = size;
  const c = makeCanvas(s);

  // Scale factor helpers
  const sc = v => Math.round(v * s / 512);
  const sf = v => v * s / 512;

  // ── Background: navy rounded square ──
  c.fillRoundRect(0, 0, s, s, sc(90), 0x1B, 0x2B, 0x4B);

  // ── Document shadow ──
  const dSX = sc(106), dSY = sc(86);
  for (let y = dSY; y < dSY + sc(364); y++)
    for (let x = dSX; x < dSX + sc(268); x++)
      c.blend(x, y, 0, 0, 0, 40);

  // ── Document body ──
  // Path: rounded left/bottom corners, fold cut at top-right
  const dX1 = sc(84), dY1 = sc(76);
  const dX2 = sc(364), dY2 = sc(452);
  const foldX = sc(292), foldY = sc(148); // fold corner point
  const docRad = sc(10);

  // Fill document row by row
  for (let y = dY1; y < dY2; y++) {
    for (let x = dX1; x < dX2; x++) {
      // Rounded bottom-left corner
      if (x < dX1 + docRad && y > dY2 - docRad) {
        const dx = x - (dX1 + docRad), dy = y - (dY2 - docRad);
        if (dx * dx + dy * dy > docRad * docRad) continue;
      }
      // Rounded bottom-right corner
      if (x > dX2 - docRad && y > dY2 - docRad) {
        const dx = x - (dX2 - docRad), dy = y - (dY2 - docRad);
        if (dx * dx + dy * dy > docRad * docRad) continue;
      }
      // Fold cut: top-right area
      if (x >= foldX && y <= foldY) {
        // Below the diagonal: draw doc; above: skip
        const fx = x - foldX, fy = y - dY1;
        const fSize = foldY - dY1;
        if (fx + fy < fSize) {
          c.set(x, y, 0xF5, 0xF2, 0xEC);
        }
        // else: nothing (background shows)
        continue;
      }
      c.set(x, y, 0xF5, 0xF2, 0xEC);
    }
  }

  // ── Fold triangle (light gray) ──
  const fSize = foldY - dY1;
  for (let y = dY1; y < foldY; y++) {
    for (let x = foldX; x < dX2; x++) {
      const fx = x - foldX, fy = y - dY1;
      if (fx + fy >= fSize) c.set(x, y, 0xC8, 0xC4, 0xBC);
    }
  }

  // ── Text content lines (dark, low-opacity look via blended gray) ──
  const lineColor = [0x9A, 0xA4, 0xB8]; // blue-gray for lines
  const lineX = sc(108);

  // Header: bold title
  c.fillRect(lineX, sc(116), lineX + sc(130), sc(116) + Math.max(3, sc(14)), 0x6A, 0x78, 0x98);

  // Sub-line (invoice #)
  c.fillRect(lineX, sc(142), lineX + sc(90), sc(142) + Math.max(2, sc(9)), 0xB0, 0xB8, 0xCC);

  // Horizontal rule
  c.fillRect(sc(100), sc(168), sc(348), sc(168) + Math.max(1, sc(2)), 0xD8, 0xD4, 0xCC);

  // Line items (4 rows)
  const rows = [
    [sc(186), sc(155), sc(48)],
    [sc(212), sc(140), sc(48)],
    [sc(238), sc(162), sc(48)],
    [sc(264), sc(148), sc(48)],
  ];
  rows.forEach(([ly, lw, rw]) => {
    const lh = Math.max(2, sc(10));
    c.fillRect(lineX, ly, lineX + lw, ly + lh, ...lineColor);
    c.fillRect(sc(300), ly, sc(300) + rw, ly + lh, ...lineColor);
  });

  // Bottom rule
  c.fillRect(sc(100), sc(292), sc(348), sc(292) + Math.max(1, sc(2)), 0xD0, 0xCC, 0xC4);

  // Total label + amount
  c.fillRect(lineX, sc(312), lineX + sc(68), sc(312) + Math.max(2, sc(11)), 0x8A, 0x94, 0xAC);
  c.fillRect(sc(278), sc(308), sc(278) + sc(70), sc(308) + Math.max(3, sc(18)), 0x7A, 0x84, 0xA0);

  // ── Green paid badge ──
  const gcx = sc(316), gcy = sc(390), gr = sc(56);
  c.fillCircleAA(gcx, gcy, gr, 0x1A, 0x7A, 0x4A);

  // Checkmark: two line segments
  // Left leg: (292,390) -> (308,408)
  // Right leg: (308,408) -> (344,368)
  const stroke = Math.max(2, sf(11));
  c.drawLine(sc(292), sc(390), sc(308), sc(408), stroke, 0xFF, 0xFF, 0xFF);
  c.drawLine(sc(308), sc(408), sc(344), sc(368), stroke, 0xFF, 0xFF, 0xFF);

  return c.px;
}

// ── Generate both sizes ───────────────────────────────────────────────────────
const outDir = path.dirname(new URL('file://' + __filename).pathname);

[192, 512].forEach(size => {
  console.log(`Generating icon-${size}.png...`);
  const pixels = drawIcon(size);
  const png = makePNG(size, pixels);
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`  ✓ ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
});
