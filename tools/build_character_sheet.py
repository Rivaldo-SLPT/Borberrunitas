"""
Ensambla 4 imagenes sueltas (abajo/izquierda/derecha/arriba, cada una con N
frames de caminata en fila) en el spritesheet unico que game.js espera:
grid de N columnas x 4 filas, celdas de tamano uniforme, pies alineados.

Uso:
    python tools/build_character_sheet.py \
        --down down.png --left left.png --right right.png --up up.png \
        --frames 3 --out public/assets/sprites/characters/<personaje>.png

Cada imagen de entrada debe tener fondo transparente y sus N frames
distribuidos en columnas de ancho igual (no hace falta que esten recortados
ni alineados entre si: el script recorta cada frame por su bounding box de
alfa y lo vuelve a centrar). Si una de las 4 direcciones viene exportada a
una resolucion distinta a las demas (pasa seguido cuando el arte se hizo en
sesiones separadas), el script la reescala para que el personaje mida lo
mismo en las 4 direcciones, usando como referencia la altura mediana de
todos los frames.
"""
import argparse
import numpy as np
from PIL import Image

ROW_ORDER = ['down', 'left', 'right', 'up']  # debe coincidir con DIR_ROW en game.js


def bbox_alpha(img):
    arr = np.array(img)
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        return (0, 0, img.width, img.height)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def slice_frames(path, frame_count):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    slice_w = w / frame_count
    frames = []
    for i in range(frame_count):
        x0 = int(round(i * slice_w))
        x1 = int(round((i + 1) * slice_w))
        slice_im = im.crop((x0, 0, x1, h))
        frames.append(slice_im.crop(bbox_alpha(slice_im)))
    return frames


def normalize_scale(rows):
    heights = [f.height for row in rows for f in row]
    target_h = float(np.median(heights))
    normalized = []
    rescaled_dirs = []
    for direction, row in zip(ROW_ORDER, rows):
        new_row = []
        row_was_rescaled = False
        for frame in row:
            scale = target_h / frame.height
            if abs(scale - 1) > 0.05:
                row_was_rescaled = True
            new_w = max(1, round(frame.width * scale))
            new_h = max(1, round(frame.height * scale))
            new_row.append(frame.resize((new_w, new_h), Image.LANCZOS))
        normalized.append(new_row)
        if row_was_rescaled:
            rescaled_dirs.append(direction)
    return normalized, rescaled_dirs


def build(paths, frame_count, out_path, pad=4):
    rows = [slice_frames(paths[d], frame_count) for d in ROW_ORDER]
    rows, rescaled_dirs = normalize_scale(rows)
    if rescaled_dirs:
        print(f'  (normalizando escala de: {", ".join(rescaled_dirs)} — no coincidia con las demas direcciones)')

    max_w = max(f.width for row in rows for f in row)
    max_h = max(f.height for row in rows for f in row)
    cell_w, cell_h = max_w + pad, max_h + pad

    sheet = Image.new('RGBA', (cell_w * frame_count, cell_h * len(ROW_ORDER)), (0, 0, 0, 0))
    for row_idx, row_frames in enumerate(rows):
        for col_idx, frame in enumerate(row_frames):
            px = col_idx * cell_w + (cell_w - frame.width) // 2
            py = row_idx * cell_h + (cell_h - frame.height) - pad // 2
            sheet.paste(frame, (px, py), frame)

    sheet.save(out_path)
    print(f'Guardado {out_path} ({sheet.size[0]}x{sheet.size[1]}, celda {cell_w}x{cell_h}, {frame_count} frames)')
    return cell_w, cell_h


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--down', required=True)
    parser.add_argument('--left', required=True)
    parser.add_argument('--right', required=True)
    parser.add_argument('--up', required=True)
    parser.add_argument('--frames', type=int, default=3, help='frames de caminata por direccion')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    build(
        {'down': args.down, 'left': args.left, 'right': args.right, 'up': args.up},
        args.frames, args.out
    )
