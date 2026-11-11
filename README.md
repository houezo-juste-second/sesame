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
| Stockage SQLite (`node:sqlite`, aucune dépendance) — secrets chiffrés AES-256-GCM | ✅ testé, survit au redémarrage |
| Reçus Nostr signés par la boutique + page publique `/verify/:boutique` (vérification dans le navigateur) | ✅ testé |
| `apps/server/ai` : création de commande depuis une conversation WhatsApp (gratuit, hors ligne) | ✅ testé |
| `apps/web` : application web mobile (PWA) — client, livreur, vendeuse | ✅ parcours complet vérifié dans un navigateur |
| Paiements | 🟡 **simulés** pour l'instant (bandeau « DÉMO » à l'écran) |
| `infra/` : réseau Lightning regtest (bitcoind + 4 nœuds LND) | 🟡 écrit, à valider |
| Adaptateurs LND / NWC (vrais paiements) | ⏳ à venir |

## Lancer la démo (2 minutes, sans Docker)

Prérequis : Node.js 22+.

```bash
npm install
npm run build     # compile l'application web
npm start         # http://127.0.0.1:8080 — mode simulation
```

- Espace vendeuse : http://127.0.0.1:8080/v — boutique de démo `pagnes-de-fifame`, PIN `2026`.
- Créez une commande, ouvrez le lien client, payez avec le « wallet de démo », assignez un livreur, puis libérez avec le sésame.
- Réputation publique vérifiable : http://127.0.0.1:8080/verify/pagnes-de-fifame
- Les données sont dans `data/sesame.sqlite`. Définissez `SESAME_MASTER_KEY` (voir `.env.example`) pour que les secrets chiffrés survivent aux redémarrages.

Développement : `npm run dev:server` et `npm run dev:web` (http://localhost:5173), `npm test`, `npm run typecheck`.

## 100 % gratuit

Toutes les briques sont libres et gratuites, y compris le taux BTC/FCFA (API publique de mempool.space).

**IA, en toute transparence :** par défaut, le remplissage automatique d'une commande utilise des **règles locales** (gratuites, hors ligne), pas un modèle d'IA. Avec une clé gratuite Groq, Sésame utilise **Llama 3.3 70B** (API compatible OpenAI), et revient aux règles locales en cas d'erreur. Les numéros de téléphone sont masqués avant tout envoi, et l'IA ne touche jamais au paiement. Voir `.env.example`.

## Documentation

- [Architecture et protocole](docs/ARCHITECTURE.md)
- [Mise en ligne gratuite (Render ou Oracle Cloud)](docs/DEPLOIEMENT.md)
- [Pitch, vidéo et questions du jury](docs/PITCH.md)

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
- Secrets au repos chiffrés (AES-256-GCM) ; jetons d'accès stockés uniquement hachés ; PIN en scrypt.
- Reçus Nostr sans donnée personnelle (identifiant haché, montant et heure arrondis), vérifiés côté navigateur.

## Licence

MIT
