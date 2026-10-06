'use strict';

const CFG = window.GAME_CONFIG;
const TILE = { EMPTY: 0, WALL: 1, BLOCK: 2 };

// ===========================================================================
// DOM references
// ===========================================================================
const screens = {
  menu: document.getElementById('screen-menu'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  end: document.getElementById('screen-end')
};

const el = {
  volMaster: document.getElementById('vol-master'),
  volMusic: document.getElementById('vol-music'),
  volSfx: document.getElementById('vol-sfx'),
  btnCreateRoom: document.getElementById('btn-create-room'),
  btnShowJoin: document.getElementById('btn-show-join'),
  joinForm: document.getElementById('join-form'),
  inputRoomCode: document.getElementById('input-room-code'),
  btnConfirmJoin: document.getElementById('btn-confirm-join'),
  inputPlayerName: document.getElementById('input-player-name'),
  menuError: document.getElementById('menu-error'),

  lobbyRoomCode: document.getElementById('lobby-room-code'),
  btnLeaveLobby: document.getElementById('btn-leave-lobby'),
  characterGrid: document.getElementById('character-grid'),
  mapSelectOptions: document.getElementById('map-select-options'),
  playerList: document.getElementById('player-list'),
  btnReady: document.getElementById('btn-ready'),
  btnStartGame: document.getElementById('btn-start-game'),
  lobbyError: document.getElementById('lobby-error'),

  hudRoomCode: document.getElementById('hud-room-code'),
  hudTimer: document.getElementById('hud-timer'),
  hudPlayers: document.getElementById('hud-players'),
  canvas: document.getElementById('game-canvas'),

  endTitle: document.getElementById('end-title'),
  standingsBody: document.getElementById('standings-body'),
  btnBackToLobby: document.getElementById('btn-back-to-lobby')
};

const ctx = el.canvas.getContext('2d');
el.canvas.width = CFG.GRID_COLS * CFG.TILE_SIZE;
el.canvas.height = CFG.GRID_ROWS * CFG.TILE_SIZE;

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ===========================================================================
// Audio
// ===========================================================================
const sound = new SoundManager(CFG);
// arranca a descargar/decodificar los buffers apenas carga la pagina: esto
// no necesita gesto del usuario, solo REPRODUCIR (AudioContext.resume) si
// lo necesita. Si se espera al primer clic para recien empezar a cargar
// ~4MB de audio, cualquier pantalla que pida musica antes de que termine
// (ej. el lobby, que suele abrirse casi al instante) fallaba en silencio
// porque el buffer todavia no existia.
const audioLoadPromise = sound.init();
let audioUnlocked = false;

// espera a que el buffer este cargado antes de reproducirlo: playBgm por
// si sola falla en silencio (sin reintento) si el buffer todavia no existe.
async function playBgmWhenReady(name) {
  await audioLoadPromise;
  sound.playBgm(name);
}

function playScreenBgm() {
  if (screens.menu.classList.contains('active') || screens.lobby.classList.contains('active')) {
    playBgmWhenReady('menu');
  } else if (screens.game.classList.contains('active')) {
    playBgmWhenReady('battle');
  }
}

async function ensureAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  await audioLoadPromise;
  await sound.unlock();
  playScreenBgm();
}
['click', 'keydown', 'touchstart'].forEach((evt) => {
  window.addEventListener(evt, () => ensureAudioUnlocked(), { once: true });
});

// ===========================================================================
// Asset loading (images) with graceful color fallback
// ===========================================================================
const imageCache = new Map();
function loadImage(path) {
  if (imageCache.has(path)) return imageCache.get(path);
  const entry = { img: new Image(), ready: false };
  entry.img.onload = () => { entry.ready = true; };
  entry.img.onerror = () => { entry.ready = false; };
  entry.img.src = path;
  imageCache.set(path, entry);
  return entry;
}

const tileAssets = {
  floor: loadImage(CFG.TILE_SPRITES.floor),
  floorVariant: loadImage(CFG.TILE_SPRITES.floorVariant),
  wall: loadImage(CFG.TILE_SPRITES.wall),
  block: loadImage(CFG.TILE_SPRITES.block),
  bomb: loadImage(CFG.TILE_SPRITES.bomb),
  explosionVertical: loadImage(CFG.TILE_SPRITES.explosionVertical),
  explosionHorizontal: loadImage(CFG.TILE_SPRITES.explosionHorizontal)
};
const powerupAssets = {
  bomb: loadImage(CFG.POWERUP_SPRITES.bomb),
  flame: loadImage(CFG.POWERUP_SPRITES.flame),
  speed: loadImage(CFG.POWERUP_SPRITES.speed)
};
const characterAssets = new Map(
  CFG.CHARACTERS.map((c) => [c.id, loadImage(c.sprite)])
);
const characterIconAssets = new Map(
  CFG.CHARACTERS.map((c) => [c.id, loadImage(c.icon || c.sprite)])
);
const CHAR_META = new Map(CFG.CHARACTERS.map((c) => [c.id, c]));

// ===========================================================================
// Socket / session state
// ===========================================================================
const socket = io({ autoConnect: true });

const session = {
  roomCode: null,
  playerId: null,
  isHost: false,
  selectedCharacter: null,
  selectedMapId: CFG.MAP_TEMPLATES[0].id,
  playerName: ''
};

// ===========================================================================
// Live game state (populated once a match starts)
// ===========================================================================
const game = {
  grid: [],
  players: new Map(),   // id -> full player record (meta + render state)
  bombs: new Map(),     // id -> {id, tx, ty, ownerId, range, explodeAt}
  powerups: new Map(),  // "x,y" -> type
  explosions: [],        // {cells, expiresAt}
  matchEndsAt: 0,
  serverTimeOffset: 0,
  running: false
};

const local = {
  pos: { x: 0, y: 0 },
  exemptTile: null,     // {tx,ty} of a bomb we just placed and can still walk off
  inputSeq: 0,
  pending: [],           // unacked input commands
  lastInputSentAt: 0
};

const remoteBuffers = new Map(); // id -> [{t,x,y,dirX,dirY,moving}]

const keys = new Set();
let spaceHeld = false;

// ===========================================================================
// Menu screen
// ===========================================================================
function initVolumeControls() {
  el.volMaster.value = sound.volumes.master;
  el.volMusic.value = sound.volumes.music;
  el.volSfx.value = sound.volumes.sfx;
  el.volMaster.addEventListener('input', () => sound.setMasterVolume(parseFloat(el.volMaster.value)));
  el.volMusic.addEventListener('input', () => sound.setMusicVolume(parseFloat(el.volMusic.value)));
  el.volSfx.addEventListener('input', () => sound.setSfxVolume(parseFloat(el.volSfx.value)));
}
initVolumeControls();

function playUiClick() { sound.playSfx('uiClick'); }

el.btnShowJoin.addEventListener('click', () => {
  playUiClick();
  el.joinForm.classList.toggle('hidden');
});

el.btnCreateRoom.addEventListener('click', () => {
  playUiClick();
  session.playerName = el.inputPlayerName.value.trim();
  socket.emit('createRoom', { name: session.playerName }, (res) => {
    if (!res.ok) { el.menuError.textContent = res.error || 'Error al crear la sala.'; return; }
    session.roomCode = res.roomCode;
    session.playerId = res.playerId;
    enterLobby();
  });
});

el.btnConfirmJoin.addEventListener('click', () => {
  playUiClick();
  const code = el.inputRoomCode.value.trim().toUpperCase();
  session.playerName = el.inputPlayerName.value.trim();
  if (!code) return;
  socket.emit('joinRoom', { roomCode: code, name: session.playerName }, (res) => {
    if (!res.ok) { el.menuError.textContent = res.error || 'No se pudo unir a la sala.'; return; }
    session.roomCode = res.roomCode;
    session.playerId = res.playerId;
    enterLobby();
  });
});

// ===========================================================================
// Lobby screen
// ===========================================================================
function enterLobby() {
  el.menuError.textContent = '';
  el.lobbyRoomCode.textContent = session.roomCode;
  renderCharacterGrid([]);
  showScreen('lobby');
  playBgmWhenReady('menu');
}

function renderCharacterGrid(players) {
  el.characterGrid.innerHTML = '';
  CFG.CHARACTERS.forEach((c) => {
    const takenBy = players.find((p) => p.characterId === c.id);
    const card = document.createElement('div');
    card.className = 'character-card';
    if (session.selectedCharacter === c.id) card.classList.add('selected');
    if (takenBy && takenBy.id !== session.playerId) card.classList.add('taken');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = c.color;
    const iconAsset = characterIconAssets.get(c.id);
    if (iconAsset.ready) {
      avatar.style.backgroundImage = `url(${c.icon || c.sprite})`;
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.name;

    card.appendChild(avatar);
    card.appendChild(name);
    card.addEventListener('click', () => {
      if (takenBy && takenBy.id !== session.playerId) return;
      playUiClick();
      session.selectedCharacter = c.id;
      socket.emit('selectCharacter', { characterId: c.id });
    });
    el.characterGrid.appendChild(card);
  });
}

function renderMapSelect(mapId, isHost) {
  session.selectedMapId = mapId;
  el.mapSelectOptions.innerHTML = '';
  CFG.MAP_TEMPLATES.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'map-card' + (m.id === mapId ? ' selected' : '') + (isHost ? '' : ' locked');
    card.innerHTML = `<div class="map-name">${m.name}</div><div class="map-desc">${m.description}</div>`;
    if (isHost) {
      card.addEventListener('click', () => {
        if (m.id === session.selectedMapId) return;
        playUiClick();
        socket.emit('selectMap', { mapId: m.id });
      });
    }
    el.mapSelectOptions.appendChild(card);
  });
}

function renderPlayerList(players) {
  el.playerList.innerHTML = '';
  players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    const label = document.createElement('span');
    label.textContent = p.name + (p.id === session.playerId ? ' (tu)' : '');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (p.isHost ? 'host' : (p.ready ? 'ready' : 'waiting'));
    badge.textContent = p.isHost ? 'HOST' : (p.ready ? 'LISTO' : 'ESPERANDO');
    row.appendChild(label);
    row.appendChild(badge);
    el.playerList.appendChild(row);
  });
}

socket.on('roomUpdate', (data) => {
  session.isHost = data.hostId === session.playerId;
  renderCharacterGrid(data.players);
  renderMapSelect(data.mapId, session.isHost);
  renderPlayerList(data.players);
  el.btnStartGame.classList.toggle('hidden', !session.isHost);
  el.btnReady.classList.toggle('hidden', session.isHost);
  const me = data.players.find((p) => p.id === session.playerId);
  if (me) session.selectedCharacter = me.characterId;
});

el.btnReady.addEventListener('click', () => {
  playUiClick();
  const nowReady = el.btnReady.classList.toggle('active');
  el.btnReady.textContent = nowReady ? 'Cancelar' : 'Listo';
  socket.emit('setReady', { ready: nowReady });
});

el.btnStartGame.addEventListener('click', () => {
  playUiClick();
  el.lobbyError.textContent = '';
  socket.emit('startGame');
});

el.btnLeaveLobby.addEventListener('click', () => {
  playUiClick();
  socket.emit('leaveRoom');
  showScreen('menu');
});

socket.on('errorMsg', (data) => { el.lobbyError.textContent = data.message; });
socket.on('gameStarting', () => { el.lobbyError.textContent = 'La partida comienza...'; });

// ===========================================================================
// Match start / teardown
// ===========================================================================
socket.on('gameStart', (data) => {
  game.grid = data.grid.map((row) => row.slice());
  game.bombs.clear();
  game.powerups.clear();
  (data.powerups || []).forEach((p) => game.powerups.set(`${p.x},${p.y}`, p.type));
  game.explosions = [];
  game.matchEndsAt = Date.now() + data.matchDurationMs;
  game.serverTimeOffset = data.serverTime - Date.now();
  game.players.clear();
  remoteBuffers.clear();

  data.players.forEach((p) => {
    const meta = CFG.CHARACTERS.find((c) => c.id === p.characterId) || CFG.CHARACTERS[0];
    game.players.set(p.id, {
      id: p.id, name: p.name, characterId: p.characterId, colorFallback: meta.color,
      x: p.x, y: p.y, dirX: 0, dirY: 1, moving: false,
      alive: true, lives: p.lives, bombCapacity: CFG.BOMB_BASE_COUNT,
      flameRange: CFG.FLAME_BASE_RANGE, speed: CFG.PLAYER_BASE_SPEED, score: 0
    });
    remoteBuffers.set(p.id, []);
  });

  local.pos.x = 0; local.pos.y = 0;
  const me = game.players.get(session.playerId);
  if (me) { local.pos.x = me.x; local.pos.y = me.y; }
  local.exemptTile = null;
  local.inputSeq = 0;
  local.pending = [];

  game.running = true;
  showScreen('game');
  playBgmWhenReady('battle');
  requestAnimationFrame(loop);
});

socket.on('snapshot', (data) => {
  game.serverTimeOffset = data.serverTime - Date.now();

  data.players.forEach((sp) => {
    const p = game.players.get(sp.id);
    if (!p) return;
    p.alive = sp.alive;
    p.lives = sp.lives;
    p.bombCapacity = sp.bombCapacity;
    p.flameRange = sp.flameRange;
    p.speed = sp.speed;
    p.score = sp.score;
    p.dirX = sp.dirX;
    p.dirY = sp.dirY;
    p.moving = sp.moving;

    if (sp.id === session.playerId) {
      local.pos.x = sp.x;
      local.pos.y = sp.y;
      local.pending = local.pending.filter((cmd) => cmd.seq > sp.lastProcessedSeq);
      local.pending.forEach((cmd) => {
        local.pos = simulateStep(local.pos, cmd.dirX, cmd.dirY, p.speed, cmd.dt / 1000, local.exemptTile);
      });
      p.x = local.pos.x;
      p.y = local.pos.y;
    } else {
      const buf = remoteBuffers.get(sp.id) || [];
      buf.push({ t: data.serverTime, x: sp.x, y: sp.y, dirX: sp.dirX, dirY: sp.dirY, moving: sp.moving });
      while (buf.length > 12) buf.shift();
      remoteBuffers.set(sp.id, buf);
    }
  });

  game.bombs.clear();
  data.bombs.forEach((b) => game.bombs.set(b.id, b));

  updateHud();
});

socket.on('bombPlanted', (data) => {
  game.bombs.set(data.id, { id: data.id, tx: data.tx, ty: data.ty, ownerId: data.ownerId, range: data.range, explodeAt: Date.now() + game.serverTimeOffset + data.timerMs });
  sound.playSfx('bombPlant');
});

socket.on('bombRejected', () => { /* prediction simply had no local ghost bomb to remove */ });

socket.on('explosion', (data) => {
  game.bombs.delete(data.bombId);
  game.explosions.push({ cells: data.cells, expiresAt: Date.now() + CFG.EXPLOSION_DURATION_MS });
  sound.playSfx('explosion');
});

socket.on('blocksDestroyed', (data) => {
  data.blocks.forEach((b) => {
    if (game.grid[b.y]) game.grid[b.y][b.x] = TILE.EMPTY;
    if (b.powerup) game.powerups.set(`${b.x},${b.y}`, b.powerup);
  });
  sound.playSfx('blockDestroy');
});

socket.on('powerupCollected', (data) => {
  game.powerups.delete(`${data.x},${data.y}`);
  sound.playSfx('powerup');
});

socket.on('playerDamaged', (data) => {
  const p = game.players.get(data.playerId);
  if (p) { p.lives = data.lives; p.x = data.respawn.x; p.y = data.respawn.y; }
  if (data.playerId === session.playerId) {
    local.pos.x = data.respawn.x; local.pos.y = data.respawn.y; local.pending = [];
  }
  sound.playSfx('playerDie');
});

socket.on('playerEliminated', (data) => {
  const p = game.players.get(data.playerId);
  if (p) p.alive = false;
  sound.playSfx('playerDie');
});

socket.on('matchEnd', (data) => {
  game.running = false;
  sound.stopStepLoop();
  const won = data.winnerId === session.playerId;
  sound.playJingle(won ? 'victory' : 'gameover');
  el.endTitle.textContent = data.winnerId
    ? (won ? 'Victoria!' : `Gano ${nameOf(data.winnerId)}`)
    : 'Empate';
  el.standingsBody.innerHTML = '';
  data.standings.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${s.name}</td><td>${s.score}</td><td>${s.lives}</td>`;
    el.standingsBody.appendChild(tr);
  });
  showScreen('end');
});

function nameOf(id) {
  const p = game.players.get(id);
  return p ? p.name : 'Jugador';
}

el.btnBackToLobby.addEventListener('click', () => {
  playUiClick();
  showScreen('lobby');
  playBgmWhenReady('menu');
});

// ===========================================================================
// Shared movement simulation (mirrors server.js Room#applyInput)
// ===========================================================================
function isSolidTileClient(tx, ty, exemptTile) {
  if (!game.grid.length) return true;
  if (tx < 0 || ty < 0 || ty >= game.grid.length || tx >= game.grid[0].length) return true;
  const cell = game.grid[ty][tx];
  if (cell === TILE.WALL || cell === TILE.BLOCK) return true;
  for (const bomb of game.bombs.values()) {
    if (bomb.tx === tx && bomb.ty === ty) {
      if (exemptTile && exemptTile.tx === tx && exemptTile.ty === ty) return false;
      return true;
    }
  }
  return false;
}

function canOccupyClient(x, y, exemptTile) {
  const r = CFG.PLAYER_RADIUS;
  const corners = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
  for (const [cx, cy] of corners) {
    if (isSolidTileClient(Math.floor(cx), Math.floor(cy), exemptTile)) return false;
  }
  return true;
}

// espejo de Room#circleTouchesTile en server.js: la excepcion de la propia
// bomba solo se suelta cuando NINGUNA esquina del circulo de colision sigue
// tocando esa celda (si se usara solo el centro, quedaba atrapado justo en
// el borde del tile).
function circleTouchesTileClient(x, y, tx, ty) {
  const r = CFG.PLAYER_RADIUS;
  const corners = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
  return corners.some(([cx, cy]) => Math.floor(cx) === tx && Math.floor(cy) === ty);
}

function simulateStep(pos, dirX, dirY, speed, dt, exemptTile) {
  const mag = Math.hypot(dirX, dirY);
  if (mag > 1) { dirX /= mag; dirY /= mag; }
  const newX = pos.x + dirX * speed * dt;
  const newY = pos.y + dirY * speed * dt;
  const next = { x: pos.x, y: pos.y };
  if (canOccupyClient(newX, pos.y, exemptTile)) next.x = newX;
  if (canOccupyClient(next.x, newY, exemptTile)) next.y = newY;
  return next;
}

// ===========================================================================
// Input handling
// ===========================================================================
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.has(k)) keys.add(k);
  if (k === ' ' || k === 'spacebar') {
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; requestPlantBomb(); }
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === ' ' || k === 'spacebar') spaceHeld = false;
});

function currentDirection() {
  let dirX = 0, dirY = 0;
  if (keys.has('w') || keys.has('arrowup')) dirY -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dirY += 1;
  if (keys.has('a') || keys.has('arrowleft')) dirX -= 1;
  if (keys.has('d') || keys.has('arrowright')) dirX += 1;
  return { dirX, dirY };
}

function requestPlantBomb() {
  if (!game.running) return;
  // exime la celda actual de la colision local de inmediato (prediccion
  // optimista) para que no se sienta "encerrado" mientras llega la
  // confirmacion del servidor; si el servidor rechaza la bomba no hay
  // bomba real en esa celda, asi que esto no tiene efecto de todas formas.
  local.exemptTile = { tx: Math.floor(local.pos.x), ty: Math.floor(local.pos.y) };
  socket.emit('plantBomb', {});
}

// ===========================================================================
// Game loop: sample input, predict locally, send to server, render
// ===========================================================================
let lastFrameTime = performance.now();
let lastInputTime = performance.now();
const INPUT_INTERVAL_MS = 1000 / CFG.INPUT_SEND_RATE;

function loop(now) {
  if (!game.running) return;
  const frameDt = now - lastFrameTime;
  lastFrameTime = now;

  const me = game.players.get(session.playerId);
  if (me && me.alive) {
    const { dirX, dirY } = currentDirection();
    const moving = dirX !== 0 || dirY !== 0;

    if (now - lastInputTime >= INPUT_INTERVAL_MS) {
      const dt = now - lastInputTime;
      lastInputTime = now;
      const cmd = { seq: ++local.inputSeq, dirX, dirY, dt };
      local.pending.push(cmd);
      socket.emit('input', cmd);

      local.pos = simulateStep(local.pos, dirX, dirY, me.speed, dt / 1000, local.exemptTile);
      if (local.exemptTile && !circleTouchesTileClient(local.pos.x, local.pos.y, local.exemptTile.tx, local.exemptTile.ty)) {
        local.exemptTile = null;
      }
      me.x = local.pos.x;
      me.y = local.pos.y;
      if (moving) { me.dirX = dirX; me.dirY = dirY; }
      me.moving = moving;
    }

    if (moving) sound.startStepLoop(); else sound.stopStepLoop();
  } else {
    sound.stopStepLoop();
  }

  updateRemoteInterpolation();
  updateTimerDisplay();
  render();

  requestAnimationFrame(loop);
}

function updateRemoteInterpolation() {
  const renderTime = Date.now() + game.serverTimeOffset - CFG.INTERP_DELAY_MS;
  for (const [id, buf] of remoteBuffers.entries()) {
    if (id === session.playerId || buf.length === 0) continue;
    const p = game.players.get(id);
    if (!p) continue;

    let a = null, b = null;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) { a = buf[i]; b = buf[i + 1]; break; }
    }
    if (a && b) {
      const span = b.t - a.t || 1;
      const t = Math.min(1, Math.max(0, (renderTime - a.t) / span));
      p.x = a.x + (b.x - a.x) * t;
      p.y = a.y + (b.y - a.y) * t;
    } else {
      const last = buf[buf.length - 1];
      p.x = last.x; p.y = last.y;
    }
  }
}

// ===========================================================================
// Rendering
// ===========================================================================
const DIR_ROW = { down: 0, left: 1, right: 2, up: 3 };
function directionRow(dirX, dirY) {
  if (Math.abs(dirX) > Math.abs(dirY)) return dirX < 0 ? DIR_ROW.left : DIR_ROW.right;
  return dirY < 0 ? DIR_ROW.up : DIR_ROW.down;
}

function drawTileSprite(asset, fallbackColor, x, y, size) {
  if (asset.ready) {
    ctx.drawImage(asset.img, x, y, size, size);
  } else {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(x, y, size, size);
  }
}

function render() {
  const T = CFG.TILE_SIZE;
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

  for (let row = 0; row < game.grid.length; row++) {
    for (let col = 0; col < game.grid[row].length; col++) {
      const cell = game.grid[row][col];
      // mezcla determinista de piso (misma celda = misma variante siempre)
      // para romper la repeticion sin que titile entre frames.
      const useVariant = tileAssets.floorVariant.ready && (row * 13 + col * 7) % 5 === 0;
      drawTileSprite(useVariant ? tileAssets.floorVariant : tileAssets.floor, '#4a3b28', col * T, row * T, T);
      if (cell === TILE.WALL) drawTileSprite(tileAssets.wall, '#6b5d4a', col * T, row * T, T);
      if (cell === TILE.BLOCK) drawTileSprite(tileAssets.block, '#b5651d', col * T, row * T, T);
    }
  }

  for (const [key, type] of game.powerups.entries()) {
    const [px, py] = key.split(',').map(Number);
    const asset = powerupAssets[type];
    const cx = px * T + T / 2, cy = py * T + T / 2;
    if (asset.ready) {
      ctx.drawImage(asset.img, px * T + 6, py * T + 6, T - 12, T - 12);
    } else {
      ctx.fillStyle = type === 'bomb' ? '#333' : type === 'flame' ? '#e08b2a' : '#4fd0e0';
      ctx.beginPath();
      ctx.arc(cx, cy, T * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const nowServer = Date.now() + game.serverTimeOffset;
  const bombSprite = CFG.BOMB_SPRITE;
  for (const bomb of game.bombs.values()) {
    const remaining = Math.max(0, bomb.explodeAt - nowServer);
    const progress = 1 - remaining / CFG.BOMB_TIMER_MS;
    // 4 fases: mecha larga -> a punto de estallar (ver BOMB_SPRITE en shared/config.js)
    const frameIdx = Math.min(bombSprite.frameCols - 1, Math.max(0, Math.floor(progress * bombSprite.frameCols)));
    const urgent = remaining < 500;
    const pulse = urgent ? 1 + 0.12 * Math.sin(nowServer / 45) : 1;
    const shakeX = urgent ? (Math.random() - 0.5) * 2 : 0;
    const shakeY = urgent ? (Math.random() - 0.5) * 2 : 0;
    const cx = bomb.tx * T + T / 2 + shakeX, cy = bomb.ty * T + T / 2 + shakeY;

    if (tileAssets.bomb.ready) {
      const drawH = T * 0.85 * pulse;
      const drawW = drawH * (bombSprite.frameW / bombSprite.frameH);
      ctx.drawImage(
        tileAssets.bomb.img,
        frameIdx * bombSprite.frameW, 0, bombSprite.frameW, bombSprite.frameH,
        cx - drawW / 2, cy - drawH / 2, drawW, drawH
      );
    } else {
      const size = T * 0.7 * pulse;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  game.explosions = game.explosions.filter((ex) => ex.expiresAt > Date.now());
  for (const ex of game.explosions) {
    ctx.fillStyle = 'rgba(255,180,60,0.75)';
    const origin = ex.cells[0];
    ex.cells.forEach((c) => {
      const onVerticalArm = c.x === origin.x;
      const onHorizontalArm = c.y === origin.y;
      const vAsset = tileAssets.explosionVertical;
      const hAsset = tileAssets.explosionHorizontal;
      let drew = false;
      // la celda de la bomba esta en ambos brazos a la vez -> se dibujan
      // superpuestas para formar la cruz del estallido.
      if (onVerticalArm && vAsset.ready) { ctx.drawImage(vAsset.img, c.x * T, c.y * T, T, T); drew = true; }
      if (onHorizontalArm && hAsset.ready) { ctx.drawImage(hAsset.img, c.x * T, c.y * T, T, T); drew = true; }
      if (!drew) {
        ctx.fillRect(c.x * T + 4, c.y * T + 4, T - 8, T - 8);
      }
    });
  }

  for (const p of game.players.values()) {
    if (!p.alive) continue;
    drawPlayer(p);
  }
}

function drawPlayer(p) {
  const T = CFG.TILE_SIZE;
  const asset = characterAssets.get(p.characterId);
  const meta = CHAR_META.get(p.characterId) || {};
  const cx = p.x * T, cy = p.y * T;
  let labelY = cy - T * 0.65;

  if (asset && asset.ready) {
    const row = directionRow(p.dirX, p.dirY);
    const frameCols = meta.frameCols || CFG.SPRITE_FRAME_COLS;
    const frameW = meta.frameW || CFG.SPRITE_FRAME_SIZE;
    const frameH = meta.frameH || CFG.SPRITE_FRAME_SIZE;
    const frame = p.moving ? Math.floor(performance.now() / 140) % frameCols : 0;

    // el sprite puede ser mas alto que un tile (tocados/efectos que sobresalen);
    // se ancla por los pies cerca del centro del tile y se escala preservando
    // la relacion de aspecto real de cada spritesheet.
    const drawHeight = T * 1.9;
    const drawWidth = frameW * (drawHeight / frameH);
    const drawX = cx - drawWidth / 2;
    const drawY = cy + T * 0.42 - drawHeight;

    ctx.drawImage(
      asset.img,
      frame * frameW, row * frameH, frameW, frameH,
      drawX, drawY, drawWidth, drawHeight
    );
    labelY = drawY - 4;
  } else {
    ctx.fillStyle = p.colorFallback || '#e0b23d';
    ctx.beginPath();
    ctx.arc(cx, cy, T * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }

  ctx.fillStyle = '#f3e6c8';
  ctx.font = '11px Verdana';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, cx, labelY);
}

// ===========================================================================
// HUD
// ===========================================================================
function heartsMarkup(lives) {
  let out = '';
  for (let i = 0; i < CFG.PLAYER_LIVES; i++) {
    out += i < lives ? '❤' : '<span class="empty">❤</span>';
  }
  return out;
}

function updateHud() {
  el.hudRoomCode.textContent = session.roomCode;
  el.hudPlayers.innerHTML = '';
  for (const p of game.players.values()) {
    const card = document.createElement('div');
    card.className = 'stat-card'
      + (p.alive ? '' : ' dead')
      + (p.id === session.playerId ? ' you' : '');

    card.innerHTML = `
      <div class="stat-card-header">
        <span class="dot" style="background:${p.colorFallback || '#e0b23d'}"></span>
        <span class="stat-name">${p.name}</span>
      </div>
      <div class="stat-hearts">${heartsMarkup(p.lives)}</div>
      <div class="stat-icons">
        <span class="stat-icon-group" title="Bombas"><img src="${CFG.POWERUP_SPRITES.bomb}" alt="bombas"><span>${p.bombCapacity}</span></span>
        <span class="stat-icon-group" title="Alcance de llama"><img src="${CFG.POWERUP_SPRITES.flame}" alt="llama"><span>${p.flameRange}</span></span>
        <span class="stat-icon-group" title="Velocidad"><img src="${CFG.POWERUP_SPRITES.speed}" alt="velocidad"><span>${p.speed.toFixed(1)}</span></span>
      </div>
    `;
    el.hudPlayers.appendChild(card);
  }
}

function updateTimerDisplay() {
  const remainingMs = Math.max(0, game.matchEndsAt - Date.now());
  const totalSec = Math.ceil(remainingMs / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  el.hudTimer.textContent = `${m}:${s}`;
}

showScreen('menu');
