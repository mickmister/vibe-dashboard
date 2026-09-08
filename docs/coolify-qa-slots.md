# Coolify QA slots

This repo has a first-pass fixed-slot QA flow for VK/VD deployments.

## Model

- Use a small number of long-lived Coolify applications named with a shared prefix, for example `vkvd-qa-slot-1`.
- Deploys are manual-slot: pass `--slot 1` or `--slot 2`.
- Slot state that operators need to inspect is stored in the Coolify application name/description, not in container env values.
- Container env values are only for runtime configuration (`VKVD_IMAGE_VERSION`, `CADDY_PORT`, `QA_SLOT_ID`, etc.).
- The intended QA compose is `docker-compose.qa.yaml`, which strips staging-only services and uses explicit slot-scoped named volumes.

## Commands

Run commands from a credentialed container/repo checkout that can unlock the Coolify varlock values:

```bash
npm exec -- varlock run -- npm run coolify:qa -- status
```

Bootstrap or find a slot:

```bash
npm exec -- varlock run -- npm run coolify:qa -- bootstrap \
  --slot 1 \
  --branch vk/add7-vk-bubblewrap \
  --host-port 3101 \
  --image-tag vk-f1bf69f-vd-8150cda \
  --compose-location /docker-compose.qa.yaml
```

Deploy once the GHCR image exists:

```bash
npm exec -- varlock run -- npm run coolify:qa -- deploy \
  --slot 1 \
  --branch vk/add7-vk-bubblewrap \
  --host-port 3101 \
  --image-tag vk-f1bf69f-vd-8150cda \
  --compose-location /docker-compose.qa.yaml \
  --wait-image \
  --confirm
```

## Proven API findings

- Public Git repository Docker Compose apps can be created with `POST /api/v1/applications/public` using `build_pack: dockercompose`.
- `is_auto_deploy_enabled` is rejected by this Coolify instance during create (`422`, field not allowed).
- Coolify auto-detects compose env vars during app creation, so env creation can return `409`. The CLI upserts env keys by trying `POST /envs` and falling back to `PATCH /envs` by key.
- The first test slot app created successfully as UUID `zg44c04o44cosk8o4sgw48c4`.
- For host-port QA access, `ports_exposes` and `ports_mappings` must be set on the Coolify application as well as keeping the compose `ports:` mapping. The first live test became reachable only after patching `ports_exposes=3001` and `ports_mappings=3101:3001`, then restarting the app.
- Coolify rewrote the QA compose's explicit named volumes to resource-scoped names such as `zg44c04o44cosk8o4sgw48c4_vibe-kanban-data`, which avoided the previously suspected raw named-volume overlap across applications.

## Out of scope in this pass

- Credential seeding.
- `--reset-data` volume clearing.
- Deployment cancellation/log tailing.
