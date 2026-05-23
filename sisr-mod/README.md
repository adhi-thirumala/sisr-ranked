# SISR Match Image

`./gradlew build` produces `build/match-image/`, an OCI image build context containing:

- `Containerfile`
- `entrypoint.sh`
- `mods/sisr-mod.jar`

Build the local match image used by the Agent:

```sh
./gradlew buildMatchImage
```

Defaults:

- Builder: `podman`
- Local image: `localhost/rir-game:latest`
- Minecraft server image: `docker.io/itzg/minecraft-server:java25`

Override with Gradle properties or env vars:

```sh
./gradlew buildMatchImage -PimageBuilder=docker -PmatchImage=localhost/rir-game:dev
```

Push to GHCR after logging in with Podman or Docker:

```sh
./gradlew pushMatchImage -PghcrImage=ghcr.io/<owner>/rir-game
```

Optional properties:

- `-PimageTags=1.0.0,latest`
- `-PextraModUrls="https://example/mod-a.jar https://example/mod-b.jar"`
- `-PminecraftServerImage=docker.io/itzg/minecraft-server:java25`
