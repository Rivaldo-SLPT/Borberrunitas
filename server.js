'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const CFG = require('./shared/config.js');

const TILE = { EMPTY: 0, WALL: 1, BLOCK: 2 };
const MAX_INPUT_DT_MS = 100; // clamp to stop speedhacks via inflated dt

// ---------------------------------------------------------------------------
// Map generation
// ---------------------------------------------------------------------------
// fuente unica de verdad para las 4 celdas de spawn reales (deriva del
// mismo calculo que spawnPoints(), mas abajo). isSpawnZone y generateCrossMap
// usaban formulas de offset escritas a mano que no coincidian exactamente
// con esto en 3 de las 4 esquinas -> el jugador podia aparecer encima de
// un bloque solido.
function spawnTileCorners() {
  return spawnPoints().map((p) => ({ row: Math.floor(p.y), col: Math.floor(p.x) }));
}

function isSpawnZone(row, col) {
  return spawnTileCorners().some(({ row: r, col: c }) => {
    if (row === r && col === c) return true; // la celda de spawn misma
    if (row === r && Math.abs(col - c) === 1) return true; // vecino horizontal
    if (col === c && Math.abs(row - r) === 1) return true; // vecino vertical
    return false;
  });
}

function isBorder(row, col) {
  return row === 0 || col === 0 || row === CFG.GRID_ROWS - 1 || col === CFG.GRID_COLS - 1;
}

function isPillar(row, col) {
  return row % 2 === 0 && col % 2 === 0;
}

// --- Clasico: igual que antes, bloques al azar, power-ups 100% al azar.
function generateClassicMap() {
  const grid = [];
  for (let row = 0; row < CFG.GRID_ROWS; row++) {
    const line = [];
    for (let col = 0; col < CFG.GRID_COLS; col++) {
      if (isBorder(row, col)) { line.push(TILE.WALL); continue; }
      if (isSpawnZone(row, col)) { line.push(TILE.EMPTY); continue; } // antes que isPillar: un spawn nunca debe quedar tapado
      if (isPillar(row, col)) { line.push(TILE.WALL); continue; }
      line.push(Math.random() < CFG.DESTRUCTIBLE_DENSITY ? TILE.BLOCK : TILE.EMPTY);
    }
    grid.push(line);
  }
  return { grid, guaranteedPowerups: [] };
}

// --- Nucleo Central: cada spawn queda encerrado por bloques rompibles (el
// jugador tiene que volar su propia jaula para salir); el centro es una
// zona abierta sin ningun bloque, llena de power-ups expuestos desde el
// arranque (no hace falta romper nada para agarrarlos, solo llegar).
function generateCrossMap() {
  const rowCenter = Math.floor(CFG.GRID_ROWS / 2);
  const colCenter = Math.floor(CFG.GRID_COLS / 2);
  const centerRadius = 1; // zona abierta de 3x3 en el medio

  const spawnTiles = spawnTileCorners(); // {row,col} x4, mismo calculo que el spawn real del jugador
  const cageCells = new Set();
  spawnTiles.forEach(({ row: r, col: c }) => {
    [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([rr, cc]) => {
      if (!isBorder(rr, cc)) cageCells.add(`${rr},${cc}`);
    });
  });

  const grid = [];
  for (let row = 0; row < CFG.GRID_ROWS; row++) {
    const line = [];
    for (let col = 0; col < CFG.GRID_COLS; col++) {
      if (isBorder(row, col)) { line.push(TILE.WALL); continue; }

      // estas 3 zonas especiales van antes que isPillar a proposito: un
      // spawn o su jaula no deben poder quedar tapados por un pilar fijo.
      const inCenter = Math.abs(row - rowCenter) <= centerRadius && Math.abs(col - colCenter) <= centerRadius;
      if (inCenter) { line.push(TILE.EMPTY); continue; }

      const isSpawnTile = spawnTiles.some((s) => s.row === row && s.col === col);
      if (isSpawnTile) { line.push(TILE.EMPTY); continue; }

      if (cageCells.has(`${row},${col}`)) { line.push(TILE.BLOCK); continue; }

      if (isPillar(row, col)) { line.push(TILE.WALL); continue; }

      line.push(Math.random() < CFG.DESTRUCTIBLE_DENSITY ? TILE.BLOCK : TILE.EMPTY);
    }
    grid.push(line);
  }

  const exposedPowerups = [];
  for (let row = rowCenter - centerRadius; row <= rowCenter + centerRadius; row++) {
    for (let col = colCenter - centerRadius; col <= colCenter + centerRadius; col++) {
      const type = CFG.POWERUP_TYPES[(row + col) % CFG.POWERUP_TYPES.length];
      exposedPowerups.push({ x: col, y: row, type });
    }
  }

  return { grid, guaranteedPowerups: [], exposedPowerups };
}

// --- Fortaleza: despejado cerca de los spawns, cada vez mas denso hacia
// el centro (gradiente radial), sin power-ups garantizados.
function generateFortressMap() {
  const rowCenter = (CFG.GRID_ROWS - 1) / 2;
  const colCenter = (CFG.GRID_COLS - 1) / 2;
  const maxDist = Math.hypot(rowCenter - 1, colCenter - 1);
  const grid = [];
  for (let row = 0; row < CFG.GRID_ROWS; row++) {
    const line = [];
    for (let col = 0; col < CFG.GRID_COLS; col++) {
      if (isBorder(row, col)) { line.push(TILE.WALL); continue; }
      if (isSpawnZone(row, col)) { line.push(TILE.EMPTY); continue; } // antes que isPillar: un spawn nunca debe quedar tapado
      if (isPillar(row, col)) { line.push(TILE.WALL); continue; }
      const dist = Math.hypot(row - rowCenter, col - colCenter);
      const closeness = 1 - Math.min(1, dist / maxDist); // 1 en el centro, 0 en el borde
      const density = 0.25 + 0.65 * closeness;
      line.push(Math.random() < density ? TILE.BLOCK : TILE.EMPTY);
    }
    grid.push(line);
  }
  return { grid, guaranteedPowerups: [] };
}

function generateMap(templateId) {
  if (templateId === 'cross') return generateCrossMap();
  if (templateId === 'fortress') return generateFortressMap();
  return generateClassicMap();
}

function spawnPoints() {
  const c = CFG.GRID_COLS - 1;
  const r = CFG.GRID_ROWS - 1;
  return [
    { x: 1.5, y: 1.5 },
    { x: c - 1.5, y: 1.5 },
    { x: 1.5, y: r - 1.5 },
    { x: c - 1.5, y: r - 1.5 }
  ];
}

// ---------------------------------------------------------------------------
// Room / Match
// ---------------------------------------------------------------------------
class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map(); // socketId -> player
    this.hostId = null;
    this.state = 'lobby'; // lobby | playing | ended
    this.grid = null;
    this.bombs = new Map(); // bombId -> bomb
    this.powerups = new Map(); // "x,y" -> type
    this.guaranteedPowerups = new Map(); // "x,y" -> type, fijados por el template del mapa
    this.selectedMapId = CFG.MAP_TEMPLATES[0].id;
    this.tickHandle = null;
    this.matchEndsAt = 0;
    this.tickCounter = 0;
  }

  get roomName() {
    return `room:${this.code}`;
  }

  addPlayer(socket, name) {
    const player = {
      id: socket.id,
      name: name || `Jugador${this.players.size + 1}`,
      characterId: null,
      ready: false,
      isHost: this.players.size === 0,
      x: 0, y: 0,
      dirX: 0, dirY: -1,
      moving: false,
      alive: true,
      lives: CFG.PLAYER_LIVES,
      score: 0,
      bombCapacity: CFG.BOMB_BASE_COUNT,
      activeBombs: 0,
      flameRange: CFG.FLAME_BASE_RANGE,
      speed: CFG.PLAYER_BASE_SPEED,
      lastProcessedSeq: 0,
      exemptBombId: null,
      invulnerableUntil: 0,
      spawn: { x: 0, y: 0 }
    };
    if (player.isHost) this.hostId = socket.id;
    this.players.set(socket.id, player);
    return player;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    this.bombs.forEach((bomb, id) => {
      if (bomb.ownerId === socketId) bomb.orphaned = true;
    });
    if (this.hostId === socketId) {
      const next = this.players.keys().next();
      this.hostId = next.done ? null : next.value;
      if (!next.done) this.players.get(this.hostId).isHost = true;
    }
  }

  allReady() {
    if (this.players.size < 1) return false;
    for (const p of this.players.values()) {
      if (!p.characterId) return false;
      if (!p.isHost && !p.ready) return false;
    }
    return true;
  }

  lobbySnapshot() {
    return {
      roomCode: this.code,
      state: this.state,
      hostId: this.hostId,
      mapId: this.selectedMapId,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id, name: p.name, characterId: p.characterId, ready: p.ready, isHost: p.isHost
      }))
    };
  }

  broadcastLobby() {
    this.io.to(this.roomName).emit('roomUpdate', this.lobbySnapshot());
  }

  setMap(mapId) {
    if (!CFG.MAP_TEMPLATES.some((m) => m.id === mapId)) return;
    this.selectedMapId = mapId;
    this.broadcastLobby();
  }

  // -- Match lifecycle ------------------------------------------------------

  startMatch() {
    this.state = 'playing';
    const { grid, guaranteedPowerups, exposedPowerups } = generateMap(this.selectedMapId);
    this.grid = grid;
    this.guaranteedPowerups = new Map(guaranteedPowerups.map((g) => [`${g.x},${g.y}`, g.type]));
    this.bombs.clear();
    this.powerups.clear();
    (exposedPowerups || []).forEach((p) => this.powerups.set(`${p.x},${p.y}`, p.type));
    this.tickCounter = 0;

    const points = spawnPoints();
    let i = 0;
    for (const player of this.players.values()) {
      const sp = points[i % points.length];
      player.x = sp.x;
      player.y = sp.y;
      player.spawn = { x: sp.x, y: sp.y };
      player.alive = true;
      player.lives = CFG.PLAYER_LIVES;
      player.score = 0;
      player.bombCapacity = CFG.BOMB_BASE_COUNT;
      player.activeBombs = 0;
      player.flameRange = CFG.FLAME_BASE_RANGE;
      player.speed = CFG.PLAYER_BASE_SPEED;
      player.lastProcessedSeq = 0;
      player.exemptBombId = null;
      player.invulnerableUntil = 0;
      i++;
    }

    this.matchEndsAt = Date.now() + CFG.MATCH_TIME_MS;

    this.io.to(this.roomName).emit('gameStart', {
      grid: this.grid,
      matchDurationMs: CFG.MATCH_TIME_MS,
      serverTime: Date.now(),
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id, name: p.name, characterId: p.characterId, x: p.x, y: p.y, lives: p.lives
      })),
      powerups: Array.from(this.powerups.entries()).map(([key, type]) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y, type };
      })
    });

    this.tickHandle = setInterval(() => this.tick(), 1000 / CFG.TICK_RATE);
  }

  stopMatch() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  endMatch(winnerId) {
    this.state = 'ended';
    this.stopMatch();
    const standings = Array.from(this.players.values())
      .map((p) => ({ playerId: p.id, name: p.name, score: p.score, lives: p.lives, alive: p.alive }))
      .sort((a, b) => b.score - a.score || b.lives - a.lives);
    this.io.to(this.roomName).emit('matchEnd', { winnerId, standings });
  }

  // -- Input / movement -------------------------------------------------------

  isSolidTile(tx, ty, forPlayer) {
    if (tx < 0 || ty < 0 || ty >= this.grid.length || tx >= this.grid[0].length) return true;
    const cell = this.grid[ty][tx];
    if (cell === TILE.WALL || cell === TILE.BLOCK) return true;
    for (const bomb of this.bombs.values()) {
      if (bomb.tx === tx && bomb.ty === ty) {
        if (forPlayer && forPlayer.exemptBombId === bomb.id) return false;
        return true;
      }
    }
    return false;
  }

  canOccupy(x, y, forPlayer) {
    const r = CFG.PLAYER_RADIUS;
    const corners = [
      [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]
    ];
    for (const [cx, cy] of corners) {
      if (this.isSolidTile(Math.floor(cx), Math.floor(cy), forPlayer)) return false;
    }
    return true;
  }

  // true si el circulo de colision del jugador (no solo su centro) todavia
  // toca la celda (tx,ty). Usa el mismo muestreo de esquinas que canOccupy,
  // para que la exencion de la propia bomba nunca se quite mientras el
  // cuerpo del jugador siga rozando esa celda (si no, quedaba atrapado justo
  // en el borde: el centro ya habia "salido" pero una esquina seguia adentro).
  circleTouchesTile(x, y, tx, ty) {
    const r = CFG.PLAYER_RADIUS;
    const corners = [
      [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]
    ];
    return corners.some(([cx, cy]) => Math.floor(cx) === tx && Math.floor(cy) === ty);
  }

  applyInput(player, input) {
    if (!player.alive || this.state !== 'playing') return;
    let dt = Math.min(Math.max(input.dt || 0, 0), MAX_INPUT_DT_MS) / 1000;
    let dirX = Math.max(-1, Math.min(1, input.dirX || 0));
    let dirY = Math.max(-1, Math.min(1, input.dirY || 0));
    const mag = Math.hypot(dirX, dirY);
    if (mag > 1) { dirX /= mag; dirY /= mag; }

    player.moving = mag > 0.01;
    if (player.moving) {
      player.dirX = dirX;
      player.dirY = dirY;
    }

    const newX = player.x + dirX * player.speed * dt;
    const newY = player.y + dirY * player.speed * dt;

    if (this.canOccupy(newX, player.y, player)) player.x = newX;
    if (this.canOccupy(player.x, newY, player)) player.y = newY;

    const curTx = Math.floor(player.x);
    const curTy = Math.floor(player.y);
    if (player.exemptBombId) {
      const bomb = this.bombs.get(player.exemptBombId);
      if (!bomb || !this.circleTouchesTile(player.x, player.y, bomb.tx, bomb.ty)) player.exemptBombId = null;
    }

    this.collectPowerupAt(player, curTx, curTy);

    if (typeof input.seq === 'number') player.lastProcessedSeq = input.seq;
  }

  plantBomb(player, clientTempId) {
    if (!player.alive || this.state !== 'playing') return;
    if (player.activeBombs >= player.bombCapacity) {
      this.io.to(player.id).emit('bombRejected', { clientTempId });
      return;
    }
    const tx = Math.floor(player.x);
    const ty = Math.floor(player.y);
    for (const bomb of this.bombs.values()) {
      if (bomb.tx === tx && bomb.ty === ty) {
        this.io.to(player.id).emit('bombRejected', { clientTempId });
        return;
      }
    }
    const id = crypto.randomUUID();
    const bomb = {
      id, ownerId: player.id, tx, ty,
      range: player.flameRange,
      plantedAt: Date.now(),
      explodeAt: Date.now() + CFG.BOMB_TIMER_MS
    };
    this.bombs.set(id, bomb);
    player.activeBombs++;
    player.exemptBombId = id;

    this.io.to(this.roomName).emit('bombPlanted', {
      id, ownerId: player.id, tx, ty, range: bomb.range,
      timerMs: CFG.BOMB_TIMER_MS, clientTempId
    });
  }

  // -- Explosions -------------------------------------------------------------

  explodeBomb(bomb, chainQueue, visited) {
    if (visited.has(bomb.id)) return;
    visited.add(bomb.id);
    this.bombs.delete(bomb.id);

    const owner = this.players.get(bomb.ownerId);
    if (owner && !bomb.orphaned) owner.activeBombs = Math.max(0, owner.activeBombs - 1);

    const cells = [{ x: bomb.tx, y: bomb.ty }];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const destroyed = [];

    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= bomb.range; step++) {
        const tx = bomb.tx + dx * step;
        const ty = bomb.ty + dy * step;
        if (tx < 0 || ty < 0 || ty >= this.grid.length || tx >= this.grid[0].length) break;
        const cell = this.grid[ty][tx];
        if (cell === TILE.WALL) break;

        cells.push({ x: tx, y: ty });

        for (const other of this.bombs.values()) {
          if (other.tx === tx && other.ty === ty && !visited.has(other.id)) {
            chainQueue.push(other);
          }
        }

        if (cell === TILE.BLOCK) {
          this.grid[ty][tx] = TILE.EMPTY;
          const key = `${tx},${ty}`;
          let powerup = this.guaranteedPowerups.get(key) || null;
          if (!powerup && Math.random() < CFG.POWERUP_DROP_CHANCE) {
            powerup = CFG.POWERUP_TYPES[Math.floor(Math.random() * CFG.POWERUP_TYPES.length)];
          }
          if (powerup) this.powerups.set(key, powerup);
          destroyed.push({ x: tx, y: ty, powerup });
          break; // flame stops at the first block it destroys
        }
      }
    }

    this.io.to(this.roomName).emit('explosion', {
      bombId: bomb.id, ownerId: bomb.ownerId, cells
    });
    if (destroyed.length) {
      this.io.to(this.roomName).emit('blocksDestroyed', { blocks: destroyed });
    }

    for (const player of this.players.values()) {
      if (!player.alive) continue;
      if (Date.now() < player.invulnerableUntil) continue;
      const ptx = Math.floor(player.x);
      const pty = Math.floor(player.y);
      const hit = cells.some((c) => c.x === ptx && c.y === pty);
      if (hit) this.damagePlayer(player);
    }
  }

  processExplosions() {
    const now = Date.now();
    const due = Array.from(this.bombs.values()).filter((b) => now >= b.explodeAt);
    if (!due.length) return;
    const queue = [...due];
    const visited = new Set();
    while (queue.length) {
      const bomb = queue.shift();
      if (this.bombs.has(bomb.id)) this.explodeBomb(bomb, queue, visited);
    }
  }

  collectPowerupAt(player, tx, ty) {
    const key = `${tx},${ty}`;
    const type = this.powerups.get(key);
    if (!type) return;
    this.powerups.delete(key);
    if (type === 'bomb') player.bombCapacity = Math.min(CFG.BOMB_MAX_COUNT, player.bombCapacity + 1);
    if (type === 'flame') player.flameRange = Math.min(CFG.FLAME_MAX_RANGE, player.flameRange + 1);
    if (type === 'speed') player.speed = Math.min(CFG.PLAYER_MAX_SPEED, player.speed + CFG.PLAYER_SPEED_STEP);
    player.score += 50;
    this.io.to(this.roomName).emit('powerupCollected', { playerId: player.id, x: tx, y: ty, type });
  }

  damagePlayer(player) {
    player.lives -= 1;
    if (player.lives <= 0) {
      player.alive = false;
      this.io.to(this.roomName).emit('playerEliminated', { playerId: player.id });
      this.checkWinCondition();
      return;
    }
    player.invulnerableUntil = Date.now() + 2000;
    player.x = player.spawn.x;
    player.y = player.spawn.y;
    this.io.to(this.roomName).emit('playerDamaged', {
      playerId: player.id, lives: player.lives, respawn: { x: player.x, y: player.y }
    });
  }

  checkWinCondition() {
    const alive = Array.from(this.players.values()).filter((p) => p.alive);
    if (this.players.size > 1 && alive.length <= 1) {
      this.endMatch(alive.length === 1 ? alive[0].id : null);
    }
  }

  // -- Tick loop ---------------------------------------------------------------

  tick() {
    this.tickCounter++;
    this.processExplosions();

    if (Date.now() >= this.matchEndsAt && this.state === 'playing') {
      this.checkWinConditionOnTimeout();
      return;
    }

    if (this.tickCounter % Math.round(CFG.TICK_RATE / CFG.SNAPSHOT_RATE) === 0) {
      this.broadcastSnapshot();
    }
  }

  checkWinConditionOnTimeout() {
    const alive = Array.from(this.players.values()).filter((p) => p.alive);
    alive.sort((a, b) => b.score - a.score || b.lives - a.lives);
    this.endMatch(alive.length ? alive[0].id : null);
  }

  broadcastSnapshot() {
    const snapshot = {
      tick: this.tickCounter,
      serverTime: Date.now(),
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY, moving: p.moving,
        alive: p.alive, lives: p.lives, bombCapacity: p.bombCapacity,
        flameRange: p.flameRange, speed: p.speed, score: p.score,
        lastProcessedSeq: p.lastProcessedSeq
      })),
      bombs: Array.from(this.bombs.values()).map((b) => ({
        id: b.id, tx: b.tx, ty: b.ty, ownerId: b.ownerId, explodeAt: b.explodeAt, range: b.range
      }))
    };
    this.io.to(this.roomName).emit('snapshot', snapshot);
  }
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 5000,
  pingTimeout: 10000
});

const rooms = new Map(); // code -> Room

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: CFG.ROOM_CODE_LENGTH }, () =>
      CFG.ROOM_CODE_ALPHABET[Math.floor(Math.random() * CFG.ROOM_CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function socketRoom(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}

io.on('connection', (socket) => {
  socket.on('createRoom', (payload, ack) => {
    const code = generateRoomCode();
    const room = new Room(code, io);
    rooms.set(code, room);
    socket.join(room.roomName);
    socket.data.roomCode = code;
    room.addPlayer(socket, payload && payload.name);
    room.broadcastLobby();
    if (typeof ack === 'function') ack({ ok: true, roomCode: code, playerId: socket.id });
  });

  socket.on('joinRoom', (payload, ack) => {
    const code = (payload && payload.roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Sala no encontrada.' });
      return;
    }
    if (room.state !== 'lobby') {
      if (typeof ack === 'function') ack({ ok: false, error: 'La partida ya comenzo.' });
      return;
    }
    if (room.players.size >= CFG.MAX_PLAYERS) {
      if (typeof ack === 'function') ack({ ok: false, error: 'La sala esta llena.' });
      return;
    }
    socket.join(room.roomName);
    socket.data.roomCode = code;
    room.addPlayer(socket, payload && payload.name);
    room.broadcastLobby();
    if (typeof ack === 'function') ack({ ok: true, roomCode: code, playerId: socket.id });
  });

  socket.on('selectCharacter', (payload) => {
    const room = socketRoom(socket);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    const characterId = payload && payload.characterId;
    if (!CFG.CHARACTERS.some((c) => c.id === characterId)) return;
    const taken = Array.from(room.players.values()).some((p) => p.id !== player.id && p.characterId === characterId);
    if (taken) return;
    player.characterId = characterId;
    room.broadcastLobby();
  });

  socket.on('selectMap', (payload) => {
    const room = socketRoom(socket);
    if (!room || room.state !== 'lobby') return;
    if (room.hostId !== socket.id) return;
    room.setMap(payload && payload.mapId);
  });

  socket.on('setReady', (payload) => {
    const room = socketRoom(socket);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (!player || player.isHost) return;
    player.ready = !!(payload && payload.ready);
    room.broadcastLobby();
  });

  socket.on('startGame', () => {
    const room = socketRoom(socket);
    if (!room || room.state !== 'lobby') return;
    if (room.hostId !== socket.id) return;
    if (!room.allReady()) {
      socket.emit('errorMsg', { message: 'Todos los jugadores deben elegir personaje y estar listos.' });
      return;
    }
    room.io.to(room.roomName).emit('gameStarting', { countdownMs: 3000 });
    setTimeout(() => {
      if (rooms.get(room.code) === room && room.state === 'lobby') room.startMatch();
    }, 3000);
  });

  socket.on('input', (payload) => {
    const room = socketRoom(socket);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    room.applyInput(player, payload || {});
  });

  socket.on('plantBomb', (payload) => {
    const room = socketRoom(socket);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    room.plantBomb(player, payload && payload.clientTempId);
  });

  socket.on('leaveRoom', () => handleLeave(socket));
  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket) {
  const room = socketRoom(socket);
  if (!room) return;
  room.removePlayer(socket.id);
  socket.leave(room.roomName);
  socket.data.roomCode = null;
  if (room.players.size === 0) {
    room.stopMatch();
    rooms.delete(room.code);
    return;
  }
  if (room.state === 'playing') room.checkWinCondition();
  room.broadcastLobby();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Inca Bomberman server listening on port ${PORT}`);
});
