#!/usr/bin/env bash
set -euxo pipefail

SYSBOX_VERSION="${SYSBOX_VERSION:-0.7.1}"
SYSBOX_SHA256_AMD64="9d6d5484f980d0a17f86c492c1262015c2afb66280bdb97215b79fde6a0261c5"
SYSBOX_SHA256_ARM64="04ca894ae0b53f0fa54eaacc173ce40363c9a95ea5450f773716a84ef650a69b"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl jq uidmap

arch="$(dpkg --print-architecture)"
case "$arch" in
  amd64)
    pkg_arch="amd64"
    pkg_sha="$SYSBOX_SHA256_AMD64"
    ;;
  arm64)
    pkg_arch="arm64"
    pkg_sha="$SYSBOX_SHA256_ARM64"
    ;;
  *)
    echo "Unsupported Colima VM architecture for bundled Sysbox install: $arch" >&2
    exit 1
    ;;
esac

if ! dpkg -s sysbox-ce >/dev/null 2>&1; then
  pkg="/tmp/sysbox-ce_${SYSBOX_VERSION}.linux_${pkg_arch}.deb"
  curl -fL -o "$pkg" "https://github.com/nestybox/sysbox/releases/download/v${SYSBOX_VERSION}/sysbox-ce_${SYSBOX_VERSION}.linux_${pkg_arch}.deb"
  echo "${pkg_sha}  ${pkg}" | sha256sum -c -
  if ! apt-get install -y "$pkg"; then
    # Sysbox's postinst restarts Docker. On fresh Colima boots Docker can hit
    # systemd's start-limit during provisioning; clear it and let dpkg finish.
    systemctl reset-failed docker || true
    dpkg --configure -a
  fi
  rm -f "$pkg"
fi

# Colima's Docker provisioning can overwrite daemon.json after VM-level
# provision scripts run. Register Sysbox explicitly and idempotently here too.
mkdir -p /etc/docker
if [ -s /etc/docker/daemon.json ]; then
  jq '.runtimes = (.runtimes // {}) | .runtimes["sysbox-runc"] = {"path":"/usr/bin/sysbox-runc"}' \
    /etc/docker/daemon.json > /etc/docker/daemon.json.tmp
else
  jq -n '{"runtimes":{"sysbox-runc":{"path":"/usr/bin/sysbox-runc"}}}' > /etc/docker/daemon.json.tmp
fi
mv /etc/docker/daemon.json.tmp /etc/docker/daemon.json

systemctl restart sysbox || true
systemctl reset-failed docker || true
systemctl restart docker

docker info | grep -q 'sysbox-runc'
