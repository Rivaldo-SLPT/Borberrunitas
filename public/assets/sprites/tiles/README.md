# Sprites del mapa

Referenciados en `shared/config.js` -> `TILE_SPRITES` / `BOMB_SPRITE`:

- `floor.png` — piso base
- `floor2.png` — variante opcional del piso; `game.js` la mezcla en ~1 de
  cada 5 celdas de forma determinista (misma celda = misma variante
  siempre) para romper la repeticion. Si no existe, se usa solo `floor.png`.
- `wall.png` — muro indestructible
- `block.png` — bloque destructible
- `bomb.png` — tira de 4 fases (mecha larga -> a punto de estallar), una
  fila de 200x179px por frame. `game.js` elige el frame segun el tiempo
  restante hasta la detonacion (`BOMB_TIMER_MS` en `shared/config.js`).
- `explosion_vertical.png` — celda de la cruz para el brazo vertical
  (arriba/abajo de la bomba)
- `explosion_horizontal.png` — celda de la cruz para el brazo horizontal
  (izquierda/derecha de la bomba)

La celda donde estaba la bomba (origen de la cruz) dibuja ambas texturas
superpuestas.

Sin estos archivos, cada tile se dibuja con un color plano de respaldo.
