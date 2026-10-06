/**
 * Configuracion compartida entre servidor y cliente.
 * Se carga como <script> plano en el navegador (define window.GAME_CONFIG)
 * y via require() en Node (define module.exports).
 */
(function (root) {
  const GAME_CONFIG = {
    // --- Grid / mapa ---
    TILE_SIZE: 48,
    GRID_COLS: 17,
    GRID_ROWS: 15,

    // --- Red ---
    TICK_RATE: 30,              // Hz - frecuencia de simulacion del servidor
    SNAPSHOT_RATE: 20,          // Hz - frecuencia de broadcast de snapshots
    INTERP_DELAY_MS: 100,       // retraso de interpolacion para jugadores remotos
    INPUT_SEND_RATE: 60,        // Hz - frecuencia de envio de input del cliente

    // --- Jugador ---
    PLAYER_BASE_SPEED: 3.4,     // tiles/seg
    PLAYER_SPEED_STEP: 0.6,     // incremento por power-up de velocidad
    PLAYER_MAX_SPEED: 6.4,
    PLAYER_RADIUS: 0.32,        // radio de colision en tiles
    PLAYER_LIVES: 3,
    MAX_PLAYERS: 4,

    // --- Bombas ---
    BOMB_TIMER_MS: 3000,
    BOMB_BASE_COUNT: 1,
    BOMB_MAX_COUNT: 8,
    FLAME_BASE_RANGE: 1,
    FLAME_MAX_RANGE: 8,
    EXPLOSION_DURATION_MS: 500,

    // --- Power-ups ---
    POWERUP_DROP_CHANCE: 0.25,
    POWERUP_TYPES: ['bomb', 'flame', 'speed'],

    // --- Partida ---
    MATCH_TIME_MS: 3 * 60 * 1000,
    DESTRUCTIBLE_DENSITY: 0.75,

    // --- Mapas ---
    // el layout real de cada uno vive en server.js (generateMap); esto es
    // solo metadata para que el lobby pueda mostrar el selector. El primero
    // es el default de una sala nueva.
    MAP_TEMPLATES: [
      { id: 'classic', name: 'Clasico', description: 'Bloques al azar por todo el mapa, power-ups sueltos donde caigan.' },
      { id: 'cross', name: 'Nucleo Central', description: 'Cada spawn queda encerrado en bloques rompibles; el centro esta despejado y lleno de power-ups a la vista, sin romper nada.' },
      { id: 'fortress', name: 'Fortaleza', description: 'Despejado cerca de los spawns, denso y peligroso en el centro.' }
    ],

    // --- Sala ---
    ROOM_CODE_LENGTH: 4,
    ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',

    // --- Personajes disponibles ---
    // spritesheet esperado: N columnas (frames de animacion) x 4 filas
    // (fila 0 = camina hacia abajo, 1 = izquierda, 2 = derecha, 3 = arriba).
    // frameW/frameH/frameCols describen la celda real de cada spritesheet
    // (generadas con tools/build_character_sheet.py); si un personaje no los
    // trae, se usa SPRITE_FRAME_SIZE/SPRITE_FRAME_COLS por defecto.
    CHARACTERS: [
      { id: 'guerrero', name: 'Guerrero Inca', color: '#c0392b', sprite: 'assets/sprites/characters/guerrero.png', icon: 'assets/sprites/icons/guerrero.png', frameW: 69, frameH: 80, frameCols: 3 },
      { id: 'sacerdote', name: 'Sacerdote Inca', color: '#1f8a70', sprite: 'assets/sprites/characters/sacerdote.png', icon: 'assets/sprites/icons/sacerdote.png', frameW: 72, frameH: 85, frameCols: 3 },
      { id: 'chasqui', name: 'Chasqui', color: '#a9846b', sprite: 'assets/sprites/characters/chasqui.png', icon: 'assets/sprites/icons/chasqui.png', frameW: 76, frameH: 92, frameCols: 3 },
      { id: 'wiracocha', name: 'Dios Wiracocha', color: '#5b6ee1', sprite: 'assets/sprites/characters/wiracocha.png', icon: 'assets/sprites/icons/wiracocha.png', frameW: 89, frameH: 120, frameCols: 3 }
    ],
    SPRITE_FRAME_SIZE: 48,
    SPRITE_FRAME_COLS: 4,

    TILE_SPRITES: {
      floor: 'assets/sprites/tiles/floor.png',
      floorVariant: 'assets/sprites/tiles/floor2.png', // opcional: mezclado para variar el piso
      wall: 'assets/sprites/tiles/wall.png',
      block: 'assets/sprites/tiles/block.png',
      bomb: 'assets/sprites/tiles/bomb.png',
      // brazo vertical (arriba/abajo de la bomba) y horizontal (izq/der);
      // la celda central dibuja ambas superpuestas para simular la cruz.
      explosionVertical: 'assets/sprites/tiles/explosion_vertical.png',
      explosionHorizontal: 'assets/sprites/tiles/explosion_horizontal.png'
    },
    // tira de 4 fases (mecha larga -> a punto de estallar), celda 200x179px
    BOMB_SPRITE: { frameW: 200, frameH: 179, frameCols: 4 },
    POWERUP_SPRITES: {
      bomb: 'assets/sprites/powerups/extra_bomb.png',
      flame: 'assets/sprites/powerups/fire_range.png',
      speed: 'assets/sprites/powerups/speed_up.png'
    },

    // --- Audio ---
    AUDIO: {
      sfx: {
        step: 'assets/audio/step.wav',
        bombPlant: 'assets/audio/bomb_plant.wav',
        explosion: 'assets/audio/explosion.wav',
        powerup: 'assets/audio/powerup.wav',
        playerDie: 'assets/audio/player_die.wav',
        blockDestroy: 'assets/audio/block_destroy.wav',
        uiClick: 'assets/audio/ui_click.wav'
      },
      bgm: {
        menu: 'assets/audio/menu_theme.wav',
        battle: 'assets/audio/battle_theme.mp3',
        victory: 'assets/audio/victory.wav',
        gameover: 'assets/audio/gameover.wav'
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GAME_CONFIG;
  } else {
    root.GAME_CONFIG = GAME_CONFIG;
  }
})(typeof window !== 'undefined' ? window : globalThis);
