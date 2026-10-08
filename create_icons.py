#!/usr/bin/env python3
"""
create_icons.py — Generate extension icons for Live Caption & Translate.
Run this once before loading the extension:  python3 create_icons.py
"""

import os
import struct
import zlib


def make_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    """Create a solid-colour RGBA PNG image."""

    def chunk(name: bytes, data: bytes) -> bytes:
        body = name + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    # Build raw image data (filter byte 0x00 + RGBA pixels per row)
    raw = b""
    for _y in range(height):
        raw += b"\x00"  # filter type: None
        for _x in range(width):
            raw += bytes([r, g, b, 255])

    compressed = zlib.compress(raw, 9)

    # IHDR: width, height, bit depth=8, colour type=6 (RGBA), compression=0, filter=0, interlace=0
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr_data)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    return png


def draw_circle_rgba(size: int, bg_r: int, bg_g: int, bg_b: int,
                     fg_r: int, fg_g: int, fg_b: int) -> bytes:
    """Create a circular icon PNG with foreground circle on background."""

    def chunk(name: bytes, data: bytes) -> bytes:
        body = name + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    cx = cy = size / 2.0
    radius = size / 2.0 - 1

    raw = b""
    for y in range(size):
        raw += b"\x00"
        for x in range(size):
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist <= radius:
                raw += bytes([fg_r, fg_g, fg_b, 255])
            else:
                raw += bytes([bg_r, bg_g, bg_b, 0])  # transparent outside circle

    compressed = zlib.compress(raw, 9)
    ihdr_data = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr_data)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    return png


def main() -> None:
    os.makedirs("assets", exist_ok=True)

    # Deep green circle icon (#1F5E3B = 31, 94, 59)
    for size in (16, 48, 128):
        path = f"assets/icon{size}.png"
        data = draw_circle_rgba(size, 0, 0, 0, 31, 94, 59)
        with open(path, "wb") as f:
            f.write(data)
        print(f"  Created {path}  ({size}x{size})")

    print("Done. Load the extension at chrome://extensions → Load unpacked.")


if __name__ == "__main__":
    main()
