# Pitch, vidéo et questions du jury

> Conseil : enregistre la vidéo **avec ta propre voix** et adapte les phrases à ta façon de parler. Le jury est humain : une démo vraie et simple vaut mieux qu'un texte parfait.

## Vidéo de 3 minutes

| Temps | À l'écran | Ce que tu dis (à adapter) |
|---|---|---|
| 0:00 – 0:25 | Capture d'une conversation WhatsApp de vente, puis une fausse capture Wave | « À Dakar comme à Cotonou, on achète sur WhatsApp, Instagram, TikTok. Mais personne ne se fait confiance : le client a peur de payer d'avance, la vendeuse a peur des fausses captures et des commandes annulées. Résultat : tout le monde revient au cash à la livraison. » |
| 0:25 – 0:40 | Accueil de Sésame | « Sésame, c'est le paiement à la livraison sans cash et sans fausse capture, grâce à Bitcoin Lightning. » |
| 0:40 – 1:00 | Vendeuse : coller la conversation → commande pré-remplie → « Envoyer sur WhatsApp » | « La vendeuse colle la conversation, Sésame prépare la commande et elle envoie le lien au client. » |
| 1:00 – 1:25 | Client : page de commande → paiement → « Paiement sécurisé » | « Le client paie depuis n'importe quel wallet Lightning. L'argent est bloqué : la vendeuse le voit, mais ne peut pas le prendre. Sésame non plus. » |
| 1:25 – 1:55 | Livreur : scan du sésame → « +1 500 FCFA » ; vendeuse : « Livrée et payée » | « À la livraison, le client vérifie son colis et montre son sésame. Le livreur scanne : la vendeuse et le livreur sont payés à la seconde. Plus de cash dans les poches. » |
| 1:55 – 2:15 | Une 2e commande non livrée → « Vous avez été remboursé » | « Pas de livraison avant l'échéance ? Le client est remboursé automatiquement. Personne n'a besoin de gérer un litige d'argent. » |
| 2:15 – 2:35 | Page /verify : « livraisons prouvées » | « Chaque livraison produit un reçu signé sur Nostr. N'importe qui peut vérifier la réputation d'une vendeuse, sans faire confiance à Sésame. » |
| 2:35 – 3:00 | Diapo : modèle et suite | « Sésame prend 1 % seulement quand la livraison réussit. Prochaines étapes : achat de sats en Mobile Money via un partenaire, conversion en FCFA pour les vendeuses, et le volet diaspora. Tout est open source. » |

## Points clés à faire passer

1. **Problème local et concret** : commerce social, cash à la livraison, fausses captures, livreurs avec du cash.
2. **Bitcoin indispensable** : un séquestre *sans tiers qui garde l'argent* est impossible avec Mobile Money.
3. **Sécurité dès la conception** : le secret est créé sur le téléphone du client ; toute panne mène au remboursement.
4. **Ça marche vraiment** : démo en ligne, testable, installation en une commande.

## Questions probables du jury

**« Comment le client obtient-il des sats ? »**
Aujourd'hui, avec n'importe quel wallet Lightning. Demain, en Mobile Money via une plateforme d'achat de bitcoin partenaire : c'est la prochaine intégration, pas une fonctionnalité déjà faite.

**« Et si le colis est défectueux ? »**
Le client vérifie *avant* de donner son sésame, exactement comme avec le cash aujourd'hui. L'arbitrage après livraison est prévu en V2.

**« Sésame peut-il partir avec l'argent ? »**
Non. Le serveur ne connaît jamais le secret avant la libération et ne détient aucune clé de dépense. Si Sésame disparaît, les fonds bloqués reviennent au client à l'échéance.

**« Pourquoi les vendeuses paieraient-elles 1 % ? »**
Parce qu'aujourd'hui une commande sur quatre en cash est annulée (course du livreur perdue), et une fausse capture fait perdre toute la marchandise. 1 %, seulement en cas de succès, c'est moins cher que ces pertes.

**« Quelle IA utilisez-vous ? »**
Par défaut, des règles locales gratuites et hors ligne. Avec une clé Groq gratuite : Llama 3.3. Les numéros de téléphone sont masqués avant tout envoi, et l'IA ne touche jamais au paiement.

**« Les paiements de la démo sont-ils réels ? »**
À dire honnêtement selon l'état au moment de la soumission : simulés (bandeau « DÉMO ») ou réels sur réseau de test.

## Texte de présentation Devpost (brouillon)

**Sésame — le paiement à la livraison, sans cash et sans fausse capture.**

Au Sénégal comme au Bénin, le commerce passe par WhatsApp, Instagram et TikTok, mais la confiance manque : les clients refusent de payer d'avance, les vendeuses perdent des commandes et subissent les fausses captures de paiement mobile, et les livreurs transportent du cash.

Sésame utilise les factures *hold* de Lightning : le client paie avant la livraison, mais l'argent reste bloqué dans le réseau. Il n'est libéré que lorsque le client, après avoir vérifié son colis, montre son « sésame » au livreur. Sans livraison, il est remboursé automatiquement. Personne ne garde l'argent entre-temps, pas même Sésame. Chaque livraison produit un reçu Nostr signé, qui forme une réputation vérifiable par tous.

Technologies : Bitcoin Lightning (factures hold), Nostr (NIP-78), TypeScript, Preact (PWA ≈ 30 Ko), Fastify, SQLite. Open source (MIT).
