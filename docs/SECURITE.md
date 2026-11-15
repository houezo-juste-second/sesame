# Sécurité et modèle de menaces

## Ce qu'on protège

| Bien | Où il vit | Protection |
|---|---|---|
| L'argent du client pendant la livraison | Facture hold Lightning | Ne peut être encaissé qu'avec le sésame P ; annulé automatiquement à l'échéance |
| Le sésame P | Téléphone du client (stockage local), serveur seulement au moment de la libération | Généré sur le téléphone (32 octets aléatoires) ; chiffré au repos s'il est en attente de règlement |
| Jetons d'accès (vendeuse, client, livreur) | Liens WhatsApp, stockage local | 128 bits aléatoires ; seul leur SHA-256 est stocké |
| PIN de la vendeuse | Base | scrypt + sel ; 5 essais par minute |
| Numéros Mobile Money | Base | Chiffrés (AES-256-GCM) ; seuls les 2 derniers chiffres sont affichés |
| Clés Nostr des boutiques | Base | Chiffrées (AES-256-GCM) |
| Code de connexion du wallet de la vendeuse (NWC) | Base | Chiffré (AES-256-GCM), jamais renvoyé par l'API ni journalisé ; 5 essais de connexion par minute |
| Intégrité de l'historique | Journal d'audit | Chaîné par hachage ; toute modification est détectée et signalée à l'administration |

## Qui pourrait attaquer, et comment

| Menace | Parade |
|---|---|
| **Fausse capture de paiement** | Il n'y a pas de capture : la vendeuse voit l'état réel, confirmé par le réseau. |
| **La vendeuse encaisse sans livrer** | Impossible sans le sésame, que seul le client détient. Échéance : remboursement. |
| **Le client nie avoir reçu** | Il a montré son sésame : la libération est la preuve. Il doit vérifier avant de le montrer. |
| **Le livreur garde le colis** | Il n'est payé qu'au scan du sésame du client. |
| **Sésame (ou un pirate du serveur) veut voler** | Le serveur ne connaît pas P avant la libération et ne détient aucune clé capable de dépenser l'argent bloqué. Au pire, il peut empêcher une libération : le client est alors remboursé. |
| **Rejeu d'un sésame** | Une empreinte H n'est acceptée qu'une fois ; un sésame ne libère que sa propre commande. |
| **Deviner un sésame** | 2²⁵⁶ possibilités ; 5 essais par minute et par commande. |
| **Lien WhatsApp transféré** | Un lien client ne donne accès qu'à sa commande ; il ne permet ni d'annuler ni de détourner (le remboursement revient au payeur). |
| **Vol du PIN par essais** | 5 essais par minute par boutique ; PIN haché. |
| **Boutique frauduleuse** | L'administration la suspend : plus de connexion, de commande ni de paiement. Les commandes déjà payées restent protégées. |
| **Injection, entrées malformées** | Toutes les entrées validées (Zod), requêtes SQL paramétrées, corps limité à 16 Ko. |
| **Script injecté (XSS)** | CSP stricte : aucun script externe, aucun script en ligne ; Preact échappe le contenu. |
| **Fuite de données personnelles** | Pas de numéro, de jeton ni de secret dans les journaux (en-tête d'autorisation masqué, paramètres d'URL retirés). Numéros masqués avant tout envoi à l'IA. Reçus Nostr sans donnée personnelle. |
| **Vol du code de connexion du wallet (NWC)** | Chiffré au repos. Il ne permet que les actions autorisées par la vendeuse dans son wallet, **dans la limite du budget** qu'elle y fixe (recommandé à l'écran). Elle peut révoquer la connexion à tout moment depuis son wallet. |
| **Administrateur malveillant** | Aucune route ne permet de libérer, rembourser ou déplacer de l'argent ; aucun secret n'est visible. Ses actions (suspension) sont inscrites dans le journal d'audit. |

## Principes appliqués

- **Moindre privilège :** chaque lien ne donne que les droits de son rôle, sur une seule commande.
- **Sûr par défaut :** toute panne mène au remboursement, jamais à une perte.
- **Bibliothèques éprouvées :** `@noble/hashes` (SHA-256), `nostr-tools` (signatures), crypto de Node.js (AES-GCM, scrypt).
- **Vérifiable par tous :** la réputation d'une boutique est vérifiée dans le navigateur, sans faire confiance au serveur.

## Risques résiduels

- **Mobile Money :** le partenaire de change tient brièvement les fonds à l'entrée et à la sortie ; il doit être agréé.
- **Qui reçoit les sats à la libération :** avec un wallet branché (NWC), la vendeuse elle-même. En Mobile Money, si c'est un nœud Sésame plutôt que le partenaire, Sésame les détient quelques secondes avant le versement.
- **Connexion NWC :** si la vendeuse autorise les paiements (pour payer le livreur), le serveur peut dépenser depuis son wallet dans la limite du budget fixé. Sans budget, ce risque est plus large : l'interface recommande d'en fixer un.
- **Téléphone du client perdu :** le sésame est perdu ; la commande est remboursée à l'échéance (le client peut aussi copier son sésame en sauvegarde).
