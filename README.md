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
| `apps/server` : moteur de séquestre, API HTTP, temps réel (SSE), journal d'audit | ✅ testé |
| `apps/server/ai` : création de commande depuis une conversation WhatsApp (gratuit, hors ligne) | ✅ testé |
| `apps/web` : application web mobile (PWA) — client, livreur, vendeuse | ✅ parcours complet vérifié dans un navigateur |
| Paiements | 🟡 **simulés** pour l'instant (bandeau « DÉMO » à l'écran) |
| `infra/` : réseau Lightning regtest (bitcoind + 4 nœuds LND) | 🟡 écrit, à valider |
| Adaptateurs LND / NWC (vrais paiements), reçus Nostr | ⏳ à venir |

## Lancer la démo (2 minutes, sans Docker)

Prérequis : Node.js 22+.

```bash
npm install
npm run build     # compile l'application web
npm start         # http://127.0.0.1:8080 — mode simulation
```

- Espace vendeuse : http://127.0.0.1:8080/v — boutique de démo `pagnes-de-fifame`, PIN `2026`.
- Créez une commande, ouvrez le lien client, payez avec le « wallet de démo », assignez un livreur, puis libérez avec le sésame.

Développement : `npm run dev:server` et `npm run dev:web` (http://localhost:5173), `npm test`, `npm run typecheck`.

## 100 % gratuit

Toutes les briques sont libres et gratuites. L'IA fonctionne **sans aucune clé** : une extraction heuristique hors ligne remplit la commande. En option, on peut brancher un modèle en offre gratuite (Groq, Google Gemini) ou local (Ollama) : voir `.env.example`. Le taux BTC/FCFA vient de l'API publique gratuite de mempool.space.

## Réseau Lightning local (à venir)

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
