#!/usr/bin/env bash
# Installation de Sésame sur une machine Oracle Cloud « Always Free » (Ubuntu 22.04 / 24.04).
# Usage (sur le serveur, en tant qu'utilisateur ubuntu) :
#   curl -fsSL https://raw.githubusercontent.com/houezo-juste-second/sesame/main/deploy/oracle/setup.sh -o setup.sh
#   less setup.sh            # toujours lire un script avant de l'exécuter
#   sudo bash setup.sh <nom-de-domaine>
# Sans nom de domaine, on utilise <ip-publique>.sslip.io (gratuit, HTTPS automatique via Let's Encrypt).
set -euo pipefail

REPO="https://github.com/houezo-juste-second/sesame.git"
APP_DIR="/opt/sesame"
DATA_DIR="/var/lib/sesame"
ENV_FILE="/etc/sesame.env"

if [[ $EUID -ne 0 ]]; then echo "Lancez avec sudo."; exit 1; fi

PUBLIC_IP=$(curl -fsS https://api.ipify.org || true)
DOMAIN="${1:-${PUBLIC_IP//./-}.sslip.io}"
echo "› Domaine : $DOMAIN"

echo "› Paquets système"
apt-get update -y
apt-get install -y ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "› Node.js 22 (dépôt officiel NodeSource)"
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi
node --version

echo "› Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "› Utilisateur et dossiers"
id sesame >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin sesame
mkdir -p "$DATA_DIR"
if [[ -d "$APP_DIR/.git" ]]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
chown -R sesame:sesame "$APP_DIR" "$DATA_DIR"

echo "› Dépendances et compilation"
sudo -u sesame bash -c "cd $APP_DIR && npm ci --include=dev && npm run build"

echo "› Configuration (secrets générés une seule fois)"
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=8080
SESAME_DB_PATH=$DATA_DIR/sesame.sqlite
SESAME_MASTER_KEY=$(openssl rand -hex 32)
SESAME_DEMO_PIN=$(shuf -i 1000-9999 -n 1)
SESAME_AI_BASE_URL=https://api.groq.com/openai/v1
SESAME_AI_MODEL=llama-3.3-70b-versatile
SESAME_AI_API_KEY=
SESAME_NOSTR_RELAYS=
EOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
fi

echo "› Service systemd"
install -m 644 "$APP_DIR/deploy/oracle/sesame.service" /etc/systemd/system/sesame.service
systemctl daemon-reload
systemctl enable --now sesame
systemctl restart sesame

echo "› Caddy → https://$DOMAIN"
sed "s/__DOMAIN__/$DOMAIN/" "$APP_DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "› Pare-feu local (les images Oracle bloquent 80/443 par défaut)"
if command -v iptables >/dev/null; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

echo
echo "✓ Sésame installé : https://$DOMAIN"
echo "  PIN de la boutique de démo : sudo grep SESAME_DEMO_PIN $ENV_FILE"
echo "  Journaux : sudo journalctl -u sesame -f"
echo "  N'oubliez pas d'ouvrir les ports 80 et 443 dans la « Security List » du réseau (console Oracle)."
