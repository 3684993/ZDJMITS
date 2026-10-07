#!/usr/bin/env bash
# Existing deployment defaults. Private keys/passwords are never stored here.
set -euo pipefail
PORT="${ZDJ_PROXY_SSH_PORT:-22091}"
USER_NAME="${ZDJ_PROXY_USER:-zdjproxy}"
PUB_KEY="${ZDJ_PROXY_PUBLIC_KEY:-ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHoZeh9LOsXbUXRvSJLtotNdJb16fCIeQwBOLTblDllh zdj-trade-proxy}"
CONF="/etc/ssh/sshd_config.d/99-zdj-trade-proxy.conf"
if [[ ${1:-} == --check ]]; then
  /usr/sbin/sshd -t
  /usr/sbin/sshd -T -C "user=$USER_NAME,host=localhost,addr=127.0.0.1" |
    grep -E '^(port|allowtcpforwarding|permitopen|maxsessions|clientaliveinterval|clientalivecountmax|passwordauthentication|pubkeyauthentication) '
  getent ahostsv4 demo-fapi.binance.com
  curl --fail --silent --show-error --connect-timeout 5 --max-time 10 https://demo-fapi.binance.com/fapi/v1/time
  exit 0
fi
[[ ${EUID} -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
[[ $PORT =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || { echo 'Invalid SSH port' >&2; exit 1; }
[[ $USER_NAME =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo 'Invalid user name' >&2; exit 1; }
[[ $PUB_KEY == ssh-ed25519\ * ]] || { echo 'Expected public ED25519 key' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
if ! command -v /usr/sbin/sshd >/dev/null; then
  apt-get update -y; apt-get install -y openssh-server
fi
if ! id "$USER_NAME" >/dev/null 2>&1; then useradd -m -s /bin/bash "$USER_NAME"; fi
passwd -l "$USER_NAME" >/dev/null 2>&1 || true
USER_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
USER_GROUP="$(id -gn "$USER_NAME")"
install -d -m 700 -o "$USER_NAME" -g "$USER_GROUP" "$USER_HOME/.ssh"
AUTH="$USER_HOME/.ssh/authorized_keys"
touch "$AUTH"
# Preserve other existing authorized keys rather than silently replacing them.
if ! grep -Fqx -- "$PUB_KEY" "$AUTH"; then printf '%s\n' "$PUB_KEY" >> "$AUTH"; fi
chown "$USER_NAME:$USER_GROUP" "$AUTH"; chmod 600 "$AUTH"
install -d /etc/ssh/sshd_config.d
TEMP="$(mktemp)"; BACKUP="$(mktemp)"; HAD_CONF=0
trap 'rm -f -- "$TEMP" "$BACKUP"' EXIT
if [[ -f $CONF ]]; then cp -- "$CONF" "$BACKUP"; HAD_CONF=1; fi
cat > "$TEMP" <<EOF
Port 22
Port $PORT

Match User $USER_NAME
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding local
    GatewayPorts no
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTunnel no
    MaxSessions 0
    ClientAliveInterval 30
    ClientAliveCountMax 3
Match all
EOF
if [[ -f $CONF ]] && cmp -s "$TEMP" "$CONF"; then
  /usr/sbin/sshd -t; echo 'CONFIG_UNCHANGED'
else
  install -m 644 "$TEMP" "$CONF"
  if ! /usr/sbin/sshd -t; then
    if ((HAD_CONF)); then cp -- "$BACKUP" "$CONF"; else rm -f -- "$CONF"; fi
    echo 'Invalid config rolled back; SSH service untouched' >&2; exit 1
  fi
  # Reload preserves current admin connections; do not restart unrelated services.
  if systemctl list-unit-files ssh.service --no-legend | grep -q '^ssh.service'; then
    systemctl reload ssh
  else systemctl reload sshd; fi
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then ufw allow "$PORT/tcp" >/dev/null; fi
echo "CONFIGURED SSH_PORT=$PORT USER=$USER_NAME"
echo 'MaxSessions=0 intentionally disallows shell/exec sessions, but permits local/dynamic forwarding.'
echo 'CONFIGURED is not destination health. Run --check on the VPS and the client -Status probe.'
ss -lntp | grep ":$PORT " || { echo 'Requested listener missing' >&2; exit 1; }
