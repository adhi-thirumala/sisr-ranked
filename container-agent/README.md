# SISR Container Agent

Small VPS-side HTTP service that starts and stops one rootless Podman container per match.

## Endpoints

- `POST /match/start` with `{ matchId, players, targetItem, worldSeed, viewDistance, simulationDistance, jvmFlags }`
- `POST /match/stop` with `{ matchId }`
- `GET /health`

`/match/start` and `/match/stop` require `Authorization: Bearer $AGENT_SERVICE_TOKEN` when that env var is set.

## Required Environment

- `PODMAN_HOST` or `DOCKER_HOST`: defaults to `unix://$XDG_RUNTIME_DIR/podman/podman.sock`, then `unix:///run/podman/podman.sock`.
- `MATCH_IMAGE`: default `rir-game:latest`.
- `PODMAN_NETWORK`: default `rir-net`.
- `WORKER_API_BASE`: Worker origin used by match containers and exit callbacks.
- `AGENT_SERVICE_TOKEN`: token expected from the Worker and used as fallback callback token.
- `GAME_API_TOKEN` or `SERVICE_API_TOKEN`: token passed into match containers as `API_TOKEN`.

## Resource Defaults

- Memory: `MATCH_MEMORY=768m`, `MATCH_MEMORY_SWAP=768m`
- CPU: `MATCH_CPUS=1.5` or `MATCH_CPU_QUOTA=150000` with `MATCH_CPU_PERIOD=100000`
- Timeout: `MATCH_TIMEOUT=15m`, `STOP_GRACE=30s`
- Minecraft: `VIEW_DISTANCE=6`, `SIMULATION_DISTANCE=4`, `PREGEN_RADIUS=12`
