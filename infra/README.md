# VPS Infra

`compose.yaml` runs the static VPS services from the architecture: the container Agent, Velocity, and Cloudflare Tunnel. Dynamic match containers are not in Compose; the Agent creates them on the same `rir-net` Podman network.

## Prerequisites

1. Rootless Podman is installed for the deploy user.
2. The Podman socket is enabled: `systemctl --user enable --now podman.socket`.
3. `XDG_RUNTIME_DIR` is set for the deploy user, normally `/run/user/$UID`.
4. The match image exists as `MATCH_IMAGE`, default `localhost/rir-game:latest`.
5. The Velocity image exists as `VELOCITY_IMAGE`, default `localhost/sisr-velocity:latest`.

## Run

Copy `.env.example` to `.env` outside the repo or fill equivalent environment variables in your deploy system, then run from `infra/`:

```sh
podman-compose up -d
```

The Agent listens only inside the Compose network on port `8080`; Cloudflare Tunnel is the private ingress path from the Worker VPC service binding. Do not configure a public tunnel hostname for the Agent.
