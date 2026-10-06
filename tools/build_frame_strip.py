"""
Limpia una tira de N frames (una sola fila) recortando cada uno por su
bounding box de alfa y re-empacandolos en celdas de tamano uniforme,
anclados por abajo-centro (para animaciones que "crecen" sin saltar,
como la bomba a punto de explotar).

Uso:
    python tools/build_frame_strip.py --in bomba.png --frames 4 --out public/assets/sprites/tiles/bomb.png
"""
import argparse
import numpy as np
from PIL import Image


def bbox_alpha(img):
    arr = np.array(img)
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        return (0, 0, img.width, img.height)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def build(in_path, frame_count, out_path, pad=6):
    im = Image.open(in_path).convert('RGBA')
    w, h = im.size
    slice_w = w / frame_count
    frames = []
    for i in range(frame_count):
        x0 = int(round(i * slice_w))
        x1 = int(round((i + 1) * slice_w))
        slice_im = im.crop((x0, 0, x1, h))
        frames.append(slice_im.crop(bbox_alpha(slice_im)))

    max_w = max(f.width for f in frames)
    max_h = max(f.height for f in frames)
    cell_w, cell_h = max_w + pad, max_h + pad

    sheet = Image.new('RGBA', (cell_w * frame_count, cell_h), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        px = i * cell_w + (cell_w - frame.width) // 2
        py = cell_h - frame.height - pad // 2
        sheet.paste(frame, (px, py), frame)

    sheet.save(out_path)
    print(f'Guardado {out_path} ({sheet.size[0]}x{sheet.size[1]}, celda {cell_w}x{cell_h}, {frame_count} frames)')
    return cell_w, cell_h


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--in', dest='in_path', required=True)
    parser.add_argument('--frames', type=int, required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    build(args.in_path, args.frames, args.out)
