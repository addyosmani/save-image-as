#!/usr/bin/env python3
"""Generate the extension icons.

Pure stdlib: renders at 8x and box-downsamples for antialiasing, then writes
PNGs by hand with zlib. No image library, no build step, no binary blobs
checked in that nobody can regenerate.

Usage: python3 tools/make-icons.py
"""

import os
import struct
import zlib

SS = 8  # supersample factor
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

# Indigo, matching --accent in ui.css.
TOP = (99, 102, 241)
BOTTOM = (79, 70, 229)
FG = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_rect_hit(x, y, w, h, r):
    """Inside an axis-aligned rounded rectangle spanning (0,0)-(w,h)?

    Clamp the point into the inset rectangle and measure the distance back to
    it: <= r is inside, for the flat edges and the corner arcs alike.
    """
    r = min(r, w / 2, h / 2)
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def render(size):
    n = size * SS
    # Geometry as fractions of the icon box, so every size matches.
    radius = n * 0.225

    shaft_w = n * 0.135
    shaft_top = n * 0.215
    shaft_bot = n * 0.500

    head_half = n * 0.215
    head_top = n * 0.430
    head_tip = n * 0.680

    tray_x0, tray_x1 = n * 0.235, n * 0.765
    tray_y0, tray_y1 = n * 0.755, n * 0.855
    tray_r = (tray_y1 - tray_y0) / 2

    cx = n / 2
    hi_px = []

    for y in range(n):
        row = []
        for x in range(n):
            px, py = x + 0.5, y + 0.5

            if not rounded_rect_hit(px, py, n, n, radius):
                row.append((0, 0, 0, 0))
                continue

            bg = lerp(TOP, BOTTOM, py / n)

            on_fg = False
            # Arrow shaft
            if shaft_top <= py <= shaft_bot and abs(px - cx) <= shaft_w / 2:
                on_fg = True
            # Arrow head: triangle narrowing to a point
            elif head_top <= py <= head_tip:
                t = (py - head_top) / (head_tip - head_top)
                if abs(px - cx) <= head_half * (1 - t):
                    on_fg = True
            # Tray
            elif rounded_rect_hit(px - tray_x0, py - tray_y0, tray_x1 - tray_x0,
                                  tray_y1 - tray_y0, tray_r):
                on_fg = True

            row.append((FG if on_fg else bg) + (255,))
        hi_px.append(row)

    # Box downsample.
    out = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = hi_px[y * SS + dy][x * SS + dx]
                    # Premultiply so transparent corners do not darken the edge.
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a:
                row += bytes((round(r / a), round(g / a), round(b / a), round(a / (SS * SS))))
            else:
                row += b"\x00\x00\x00\x00"
        out.append(bytes(row))
    return out


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, render(size), size)
        print(f"{path}  ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
