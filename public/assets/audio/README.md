# Audio

Todo el set esta completo. Estado actual:

## SFX (sintetizados con `tools/generate_sfx.py`, estilo chiptune)
- `step.wav` — dos pasos cortos en loop mientras el personaje camina
- `bomb_plant.wav` — golpe seco al colocar una bomba
- `explosion.wav` — rumble + ruido de detonacion
- `powerup.wav` — arpegio ascendente al recoger un power-up
- `player_die.wav` — melodia descendente al recibir dano
- `block_destroy.wav` — ruido corto tipo escombros
- `ui_click.wav` — blip corto de interfaz

## Musica (BGM)
- `battle_theme.mp3` — pista real, provista por el equipo (loop, partida en vivo)
- `menu_theme.wav` — pista real, provista por el equipo (loop, menu/lobby)
- `victory.wav` / `gameover.wav` — jingles cortos sintetizados

## Regenerar SFX / jingles

```bash
python tools/generate_sfx.py          # los 7 SFX + victory/gameover
```

`tools/generate_menu_theme.py` queda en el repo por si alguna vez hace
falta un loop ambiental de respaldo, pero ya no se usa (se reemplazo por
una pista real).

Requiere `numpy` (`pip install numpy`). No usan samples externos, todo es
sintesis por formas de onda (seno/triangulo/cuadrada/ruido) + envolventes.

## Notas

- `victory` y `gameover` quedaron en `.wav` (no `.mp3`) porque generarlos
  requeriria un encoder mp3 (`ffmpeg`) que no esta disponible en este
  entorno; `shared/config.js` ya apunta a `.wav` para esos dos. Web Audio
  API los reproduce igual de bien.
- El juego funciona sin estos archivos (el `SoundManager` ignora
  silenciosamente los que falten), pero ya no deberia faltar ninguno.
