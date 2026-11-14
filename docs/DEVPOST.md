# Soumission Devpost

À copier dans le formulaire de soumission. Les sections suivent les champs de Devpost. Le français d'abord, l'anglais ensuite (le jury est francophone, Devpost est international : les deux sont plus sûrs).

**Liens à renseigner**
- Démo en ligne : https://sesame-1j54.onrender.com
- Code source : https://github.com/houezo-juste-second/sesame
- Vidéo (3 min) : *lien YouTube non répertorié, à ajouter*
- « Built with » : `bitcoin`, `lightning-network`, `hold-invoices`, `nostr`, `mobile-money`, `typescript`, `preact`, `fastify`, `sqlite`, `pwa`

---

## Français

### Nom et accroche
**Sésame** — le paiement à la livraison, sans cash et sans fausse capture.

### Inspiration
Au Sénégal comme au Bénin, une grande partie du commerce passe par WhatsApp, Instagram et TikTok. Mais la confiance manque des deux côtés : le client refuse de payer d'avance de peur de ne rien recevoir, la vendeuse reçoit de fausses captures de paiement Mobile Money et des commandes annulées à la porte, et le livreur transporte du cash. Résultat : tout le monde revient au paiement en espèces à la livraison, avec ses risques.

### Ce que fait Sésame
- La vendeuse colle la conversation WhatsApp : la commande se remplit automatiquement, et elle envoie un lien de paiement au client.
- Le client paie **en Mobile Money** (MTN MoMo, Moov, Wave, Orange Money…). L'argent est **bloqué** : la vendeuse le voit mais ne peut pas le prendre.
- À la livraison, le client vérifie son colis et montre son **sésame** (un QR code). Le livreur le scanne : la vendeuse est payée sur son Mobile Money, le livreur reçoit sa course.
- Sans livraison avant l'échéance, le client est **remboursé automatiquement**.
- Chaque livraison produit un **reçu signé (Nostr)** : la réputation d'une vendeuse devient vérifiable par tous.

Seule la vendeuse a un compte. Le client et le livreur reçoivent un simple lien WhatsApp. Une démo guidée permet de jouer les trois rôles en deux minutes, sans compte.

### Comment c'est construit
- **Bitcoin Lightning, factures hold :** le téléphone du client génère un secret P et n'envoie que son empreinte H = SHA-256(P). La facture est liée à H : elle ne peut être encaissée qu'avec P, et elle est annulée automatiquement à l'échéance. Pendant la livraison, personne ne peut prendre l'argent, pas même Sésame.
- **Mobile Money en façade :** un partenaire de change (Banxaas, simulé dans la démo) convertit les FCFA du client en sats et paie la facture, puis verse la part de la vendeuse sur son Mobile Money.
- **Nostr (NIP-78) :** reçus signés par la boutique, vérifiés directement dans le navigateur.
- **Stack 100 % gratuite et open source :** TypeScript, Preact (PWA ≈ 33 Ko de JavaScript compressé, pensée pour la 3G), Fastify, SQLite intégré à Node.js, Zod. IA de remplissage : règles locales, LLM gratuit optionnel.
- **Sécurité dès la conception :** modèle de menaces documenté, jetons hachés, secrets et numéros chiffrés (AES-256-GCM), PIN en scrypt, limitation des essais, CSP stricte, journal d'audit chaîné qui refuse les secrets, aucune donnée personnelle dans les journaux. 114 tests automatisés.
- **Administration** en lecture seule : volume, frais, alertes, vérification du journal d'audit, suspension d'une boutique, sans aucun pouvoir sur l'argent.

### Difficultés rencontrées
- Concilier le **Mobile Money**, que tout le monde utilise, avec la garantie de blocage de **Lightning**, que presque personne n'utilise encore : d'où l'architecture « Mobile Money en façade, Lightning en arrière-plan ».
- Rendre le protocole **sûr par défaut** : toute panne (téléphone perdu, serveur arrêté, livreur absent) doit mener au remboursement, jamais à une perte.
- Une interface lisible sur des téléphones d'entrée de gamme et en faible connexion.

### Ce dont nous sommes fiers
- Un parcours complet qui fonctionne de bout en bout, testable en ligne sans compte.
- Un serveur qui ne peut pas voler l'argent bloqué, même s'il est piraté.
- Une réputation de vendeuse vérifiable sans faire confiance à personne.

### Ce que nous avons appris
- Le frein principal n'est pas la technologie, c'est l'habitude : il faut que Bitcoin soit invisible pour l'utilisateur.
- Les factures hold de Lightning sont un outil de séquestre remarquable et encore peu exploité.

### La suite
1. Vrais paiements Lightning sur réseau de test (adaptateur LND).
2. Intégration Banxaas pour le Mobile Money réel ; ouverture du Bénin avec un partenaire local.
3. Pilote avec 20 vendeuses à Dakar et Cotonou ; indicateurs : taux de paiement, taux de livraison réussie, délai de libération.
4. Volet diaspora : payer depuis l'étranger pour une livraison au pays.

### Ce qui est simulé (transparence)
Les paiements de la démo sont simulés et signalés à l'écran : le paiement Mobile Money (en attendant l'API partenaire) et le wallet Lightning qui détient la facture hold.

---

## English

### Name and tagline
**Sésame** — cash on delivery, without the cash and without fake payment screenshots.

### Inspiration
In Senegal and Benin, a large share of retail happens on WhatsApp, Instagram and TikTok. But trust is missing on both sides: buyers won't pay upfront for fear of receiving nothing, sellers get fake Mobile Money screenshots and orders cancelled at the door, and couriers carry cash. So everyone falls back to cash on delivery, with all its risks.

### What it does
- The seller pastes the WhatsApp conversation: the order fills itself in, and she sends a payment link to the buyer.
- The buyer pays **with Mobile Money** (MTN MoMo, Moov, Wave, Orange Money…). The money is **locked**: the seller can see it but cannot take it.
- On delivery, the buyer checks the parcel and shows their **sésame** (a QR code). The courier scans it: the seller is paid to her Mobile Money and the courier gets his fee.
- If nothing is delivered before the deadline, the buyer is **refunded automatically**.
- Every delivery produces a **signed Nostr receipt**, so a seller's reputation can be verified by anyone.

Only the seller has an account. Buyer and courier just get a WhatsApp link. A guided demo lets anyone play all three roles in two minutes, with no account.

### How we built it
- **Bitcoin Lightning hold invoices:** the buyer's phone generates a secret P and only sends its hash H = SHA-256(P). The invoice is tied to H: it can only be settled with P, and it is cancelled automatically at the deadline. During delivery, nobody can take the money, not even Sésame.
- **Mobile Money on the front:** an exchange partner (Banxaas, simulated in the demo) converts the buyer's CFA francs to sats and pays the invoice, then pays the seller's share out to her Mobile Money.
- **Nostr (NIP-78):** receipts signed by the shop and verified in the browser.
- **100% free and open-source stack:** TypeScript, Preact (PWA, about 33 KB of gzipped JavaScript, built for 3G), Fastify, Node's built-in SQLite, Zod. Order autofill: local rules, optional free LLM.
- **Security by design:** documented threat model, hashed tokens, encrypted secrets and phone numbers (AES-256-GCM), scrypt PINs, rate limits, strict CSP, hash-chained audit log that rejects secrets, no personal data in logs. 114 automated tests.
- **Admin dashboard,** read-only: volume, fees, alerts, audit-log verification and shop suspension, with no power over funds.

### Challenges
- Combining **Mobile Money**, which everyone uses, with the locking guarantee of **Lightning**, which almost nobody uses yet: hence "Mobile Money on the front, Lightning underneath".
- Making the protocol **safe by default**: any failure (lost phone, server down, no-show courier) must end in a refund, never a loss.
- A clear interface on entry-level phones and slow connections.

### Accomplishments
- A complete end-to-end flow, testable online without an account.
- A server that cannot steal locked funds, even if compromised.
- Seller reputation that anyone can verify without trusting us.

### What we learned
- The main barrier is habit, not technology: Bitcoin has to be invisible to the user.
- Lightning hold invoices are a remarkable, under-used escrow primitive.

### What's next
1. Real Lightning payments on a test network (LND adapter).
2. Banxaas integration for real Mobile Money; opening Benin with a local partner.
3. A pilot with 20 sellers in Dakar and Cotonou, tracking payment rate, successful-delivery rate and release time.
4. Diaspora: pay from abroad for a delivery back home.

### What is simulated (transparency)
Payments in the demo are simulated and labelled on screen: the Mobile Money payment (pending the partner API) and the Lightning wallet holding the hold invoice.
