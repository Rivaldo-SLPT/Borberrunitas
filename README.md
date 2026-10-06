# Inca Bomberman — Multijugador en tiempo real

Bomberman 2D multijugador (hasta 4 jugadores) con tematica Inca, servidor
autoritativo en Node.js/Socket.io, prediccion de cliente + reconciliacion +
interpolacion para latencia imperceptible, y sistema de audio completo con
Web Audio API.

## Estructura del proyecto

```
server.js                 Servidor autoritativo (salas, fisica, bombas, explosiones)
shared/config.js           Constantes compartidas cliente/servidor (grid, red, audio)
public/index.html          Pantallas: menu, lobby, juego, fin de partida
public/style.css           Estilos (tema Inca)
public/js/game.js          Canvas, netcode de cliente (prediccion/reconciliacion/lerp)
public/js/soundManager.js  SFX y musica (Web Audio API)
public/assets/sprites/     Spritesheets de personajes, tiles y power-ups
public/assets/audio/       SFX y BGM (ver README en esa carpeta)
Dockerfile                 Imagen lista para EC2 / App Runner
```

## Ejecutar en local

```bash
npm install
npm start
```

Abre `http://localhost:3000` en 2+ pestañas/dispositivos para probar el
multijugador.

## Arquitectura de red (resumen)

- **Servidor autoritativo**: toda posicion, bomba, explosion, power-up y
  colision final la decide `server.js`. Los clientes nunca son la fuente
  de verdad.
- **Prediccion en cliente** (`public/js/game.js`): el jugador local se mueve
  de inmediato usando la misma funcion de simulacion que el servidor
  (`simulateStep`), sin esperar respuesta de red.
- **Reconciliacion**: cada `snapshot` del servidor trae `lastProcessedSeq`
  por jugador. El cliente descarta los inputs ya confirmados y vuelve a
  aplicar (`replay`) los pendientes sobre la posicion autoritativa recibida.
- **Interpolacion**: los jugadores remotos se renderizan con un buffer de
  snapshots retrasado `INTERP_DELAY_MS` (100ms por defecto) e interpolacion
  lineal entre los dos snapshots mas cercanos al tiempo objetivo.
- **Tick rate**: simulacion a 30Hz, snapshots a 20Hz, input del cliente a
  60Hz (ajustable en `shared/config.js`).

## Despliegue en AWS

### Opcion A — AWS App Runner (mas simple)

1. Sube este repo a GitHub/CodeCommit o construye y publica la imagen en
   Amazon ECR:
   ```bash
   docker build -t inca-bomberman .
   aws ecr create-repository --repository-name inca-bomberman
   aws ecr get-login-password | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
   docker tag inca-bomberman:latest <account-id>.dkr.ecr.<region>.amazonaws.com/inca-bomberman:latest
   docker push <account-id>.dkr.ecr.<region>.amazonaws.com/inca-bomberman:latest
   ```
2. En la consola de App Runner, crea un servicio apuntando a la imagen de
   ECR (o al repo de GitHub con build automatico usando este `Dockerfile`).
3. Puerto del contenedor: `3000`. Variable de entorno `PORT=3000`.
4. **Importante (WebSockets)**: App Runner soporta conexiones WebSocket de
   larga duracion; asegurate de que el *health check* apunte a `/` (HTTP)
   y no interrumpa las conexiones `ws`/socket.io.
5. Si vas a escalar a mas de 1 instancia, necesitas *sticky sessions* o un
   adaptador de Socket.io con Redis (`@socket.io/redis-adapter`), porque el
   estado de las salas vive en memoria de una sola instancia.

### Opcion B — AWS EC2

1. Lanza una instancia (Amazon Linux 2023 o Ubuntu), abre el puerto 80/443
   (o 3000 para pruebas) en el Security Group.
2. Instala Docker y ejecuta:
   ```bash
   docker build -t inca-bomberman .
   docker run -d --restart unless-stopped -p 80:3000 --name bomberman inca-bomberman
   ```
   O sin Docker, directamente con Node 20+:
   ```bash
   npm install --omit=dev
   PORT=80 npm start
   ```
3. (Recomendado) Pon Nginx o un Application Load Balancer delante para
   TLS (wss://) — los navegadores exigen HTTPS/WSS si el sitio se sirve
   por HTTPS.
4. Para alta disponibilidad con varias instancias EC2 detras de un ALB,
   habilita *sticky sessions* (cookie-based) en el target group, ya que
   cada sala vive en memoria de un solo proceso.

### Variables de entorno

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT`   | `3000`  | Puerto HTTP/WebSocket del servidor |

## Assets pendientes

El juego es jugable de inmediato con formas/colores de respaldo. Para el
arte y audio finales, sigue los `README.md` dentro de cada subcarpeta de
`public/assets/`.
