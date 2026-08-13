# Colima Sysbox profile

This directory contains a repeatable macOS setup for running the Vibe Dashboard
Docker app with Sysbox-backed Docker-in-Docker.

## Setup

```bash
brew install colima docker
./scripts/colima/setup-sysbox.sh
```

The setup script creates/updates the Colima profile `vd-sysbox`, switches Docker
to context `colima-vd-sysbox`, installs Sysbox in the Linux VM, and verifies that
`sysbox-runc` can launch a container.

Override the profile name if needed:

```bash
COLIMA_SYSBOX_PROFILE=my-profile ./scripts/colima/setup-sysbox.sh
```

## Verify

```bash
./scripts/colima/check-sysbox.sh
./scripts/smoke-sysbox-dind.sh
```

## Use with compose

```bash
DOCKER_CONTEXT=colima-vd-sysbox docker compose up -d code-vibe
```

## Switch back to OrbStack

```bash
docker context use orbstack
```
