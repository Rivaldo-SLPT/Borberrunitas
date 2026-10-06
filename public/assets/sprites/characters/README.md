# Spritesheets de personajes

Ya completos para los 4 personajes (generados con
`tools/build_character_sheet.py` a partir de las carpetas
`Abajo/Arriba/Izquierda/Derecha` que entrega el equipo de arte):

- `guerrero.png` — Guerrero Inca (celda 69x80, 3 frames)
- `sacerdote.png` — Sacerdote Inca (celda 72x85, 3 frames)
- `chasqui.png` — Chasqui (celda 76x92, 3 frames)
- `wiracocha.png` — Dios Wiracocha (celda 89x120, 3 frames)

Cada tamano de celda esta declarado en `shared/config.js` -> `CHARACTERS`
(`frameW`/`frameH`/`frameCols` por personaje), asi que no hace falta que
todos compartan el mismo tamano.

## Formato esperado (para agregar/actualizar un personaje)

Grid de **N columnas (frames de caminata) x 4 filas**:

| Fila | Direccion   |
|------|-------------|
| 0    | abajo (down)|
| 1    | izquierda   |
| 2    | derecha     |
| 3    | arriba (up) |

Para regenerar un spritesheet a partir de 4 imagenes sueltas
(`Abajo.png`, `Izquierda.png`, `Derecha.png`, `Arriba.png`, cada una con
sus N frames en fila, fondo transparente):

```bash
python tools/build_character_sheet.py \
  --down Abajo.png --left Izquierda.png --right Derecha.png --up Arriba.png \
  --frames 3 --out public/assets/sprites/characters/<id>.png
```

El script recorta cada frame por su bounding box de alfa y **normaliza la
escala** si alguna direccion viene exportada a otra resolucion que las
demas (le paso a `shared/config.js` el `frameW`/`frameH`/`frameCols` que
imprime al terminar).

Si un sprite no carga o no existe, el juego dibuja automaticamente un
circulo de color como reemplazo, por lo que siempre es jugable/testeable
sin arte final.
