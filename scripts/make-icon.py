"""Generate an original code-drawn extension icon with no external image dependency."""
from pathlib import Path
import struct
import zlib
size = 128
rows = []
for y in range(size):
    row = bytearray([0])
    for x in range(size):
        green = (18, 62, 53, 255)
        white = (179, 237, 205, 255)
        # A simple window with an inset play mark.
        frame = (24 <= x <= 103 and (28 <= y <= 33 or 94 <= y <= 99)) or (28 <= y <= 99 and (24 <= x <= 29 or 98 <= x <= 103))
        play = 53 <= x <= 79 and abs(y - 63) <= (79 - x) * 0.7
        row.extend(white if frame or play else green)
    rows.append(bytes(row))
def chunk(kind, value):
    return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)
output = Path(__file__).resolve().parents[1] / 'extension' / 'icons' / 'icon128.png'
output.parent.mkdir(exist_ok=True)
output.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b''))
print(output)
