#!/usr/bin/env bash
# Initialise le réseau regtest : finance les nœuds, ouvre les canaux, exporte les accès.
# Usage : ./infra/scripts/bootstrap.sh   (après `docker compose -f infra/docker-compose.yml up -d`)
set -euo pipefail

COMPOSE="docker compose -f $(dirname "$0")/../docker-compose.yml"
BTC="$COMPOSE exec -T bitcoind bitcoin-cli -regtest -rpcuser=sesame -rpcpassword=sesame-regtest-only"
lncli() { local node=$1; shift; $COMPOSE exec -T "lnd-$node" lncli --network=regtest "$@"; }
OUT="$(dirname "$0")/../../.regtest"
mkdir -p "$OUT"

echo "› Attente des nœuds LND…"
for n in client seller courier sesame; do
  until lncli "$n" getinfo >/dev/null 2>&1; do sleep 2; done
done

echo "› Création du portefeuille du mineur et de 101 blocs"
$BTC createwallet miner >/dev/null 2>&1 || $BTC loadwallet miner >/dev/null 2>&1 || true
MINER=$($BTC -rpcwallet=miner getnewaddress)
$BTC generatetoaddress 101 "$MINER" >/dev/null

echo "› Financement des nœuds (1 BTC chacun)"
for n in client seller; do
  ADDR=$(lncli "$n" newaddress p2wkh | sed -n 's/.*"address": "\(.*\)".*/\1/p')
  $BTC -rpcwallet=miner sendtoaddress "$ADDR" 1 >/dev/null
done
$BTC generatetoaddress 6 "$MINER" >/dev/null
sleep 3

pubkey() { lncli "$1" getinfo | sed -n 's/.*"identity_pubkey": "\(.*\)".*/\1/p'; }

open_channel() { # $1=de $2=vers $3=capacité (sats)
  local to_key; to_key=$(pubkey "$2")
  lncli "$1" connect "${to_key}@lnd-$2:9735" >/dev/null 2>&1 || true
  lncli "$1" openchannel --node_key="$to_key" --local_amt="$3" >/dev/null
  echo "  canal $1 → $2 ($3 sats)"
}

echo "› Ouverture des canaux"
open_channel client seller 5000000
open_channel seller courier 2000000
open_channel seller sesame 2000000
$BTC generatetoaddress 6 "$MINER" >/dev/null
sleep 5

echo "› Export des accès (macaroons + certificats) dans .regtest/ (ignoré par git)"
for n in client seller courier sesame; do
  $COMPOSE exec -T "lnd-$n" cat /root/.lnd/tls.cert > "$OUT/$n.tls.cert"
  $COMPOSE exec -T "lnd-$n" xxd -p -c 1000 /root/.lnd/data/chain/bitcoin/regtest/admin.macaroon > "$OUT/$n.macaroon.hex"
done

echo "✓ Réseau regtest prêt."
