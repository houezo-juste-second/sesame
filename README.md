# Sésame

**Le paiement à la livraison, sans cash et sans fausse capture d'écran.**

Sésame est un séquestre Lightning **non-custodial** pour le commerce sur WhatsApp, Instagram et TikTok en zone UEMOA (Sénégal, Bénin). Le client paie avant la livraison, mais son argent reste **bloqué dans le réseau Lightning**. Il n'est libéré que lorsque le client remet son *sésame* au livreur. Sans livraison, le client est **remboursé automatiquement**. Personne ne détient l'argent entre-temps, pas même Sésame.

> Projet soumis au **Dakar Bitcoin Hack 2026 by BTrust**.

## Comment ça marche

1. La vendeuse crée une commande et envoie le lien sur WhatsApp.
2. Le téléphone du client génère un secret **P** et n'envoie que son empreinte **H = SHA-256(P)**.
3. Le wallet de la vendeuse émet une **facture hold** liée à H. Le client la paie depuis n'importe quel wallet Lightning, et les fonds sont bloqués.
4. À la livraison, le client montre son QR sésame (qui contient P). Le livreur le scanne, la facture est réglée, et la vendeuse et le livreur sont payés.
5. Si personne ne libère avant l'échéance, la facture est annulée et le client est remboursé.

## État d'avancement

| Composant | État |
|---|---|
| `packages/core` : sésame (P/H), montants FCFA ↔ msat, machine à états | ✅ testé |
| `apps/server/escrow` : moteur de séquestre (verrouillage, libération, remboursement, répartition, reprise) | ✅ testé (wallet simulé) |
| `apps/server/audit` : journal d'audit chaîné par hachage | ✅ testé |
| `infra/` : réseau regtest Docker (bitcoind + 4 nœuds LND) | 🟡 écrit, à valider |
| Adaptateurs LND / NWC, API HTTP, applications web, Nostr, IA | ⏳ à venir |

## Développement

Prérequis : Node.js 22+ ; Docker pour le réseau regtest.

```bash
npm install
npm test            # tests unitaires
npm run typecheck   # vérification TypeScript stricte
```

Réseau Lightning local :

```bash
docker compose -f infra/docker-compose.yml up -d
./infra/scripts/bootstrap.sh
```

## Sécurité, en bref

- **Non-custodial** : le serveur n'a aucune clé capable de dépenser l'argent du client.
- Le sésame P est généré sur le téléphone du client et transmis **une seule fois**, au moment de la libération.
- **Sûr par défaut** : panne, perte du sésame ou absence d'action mènent toujours au remboursement.
- Aucun secret ne peut être écrit dans le journal d'audit, et le code le vérifie.

## Licence

MIT
