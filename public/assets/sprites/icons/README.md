# Iconos de retrato (seleccion de personaje)

Usados en la tarjeta de personaje del lobby (`game.js` -> `renderCharacterGrid`),
separados del spritesheet de caminata para poder mostrar un retrato limpio
en vez de recortar un frame del grid de animacion.

- `guerrero.png`
- `sacerdote.png`
- `chasqui.png`
- `wiracocha.png`

Cualquier imagen cuadrada/rectangular sirve (se recorta con `background-size: cover`).
Si falta el archivo, la tarjeta cae de vuelta al color solido del personaje
(`shared/config.js` -> `CHARACTERS[].color`).
