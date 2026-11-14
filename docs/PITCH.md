# Pitch, vidéo et questions du jury

> Enregistre la vidéo **avec ta propre voix** et adapte les phrases à ta façon de parler. Le jury est humain : une démo vraie et simple vaut mieux qu'un texte parfait. Durée imposée : **3 minutes**, dans l'ordre problème → solution → impact → suite.

## Avant d'enregistrer

- Ouvre https://sesame-1j54.onrender.com une minute avant (réveil du serveur gratuit).
- Téléphone en mode avion pour les notifications, luminosité au maximum, ou Chrome sur PC avec la vue mobile (F12, Ctrl+Maj+M).
- Outil gratuit : OBS Studio (écran + micro). Mettre la vidéo sur YouTube en « non répertoriée ».
- Utilise le bouton **« Essayer les 3 rôles en 2 minutes »** : toute la démo se fait sur un seul écran.

## Vidéo de 3 minutes

| Temps | À l'écran | Ce que tu dis (à adapter) |
|---|---|---|
| 0:00 – 0:25 | Une conversation WhatsApp de vente | « À Dakar comme à Cotonou, on achète sur WhatsApp, Instagram, TikTok. Mais personne ne se fait confiance : le client a peur de payer d'avance, la vendeuse a peur des fausses captures et des commandes annulées à la porte, et le livreur se promène avec du cash. » |
| 0:25 – 0:40 | Accueil de Sésame | « Sésame, c'est le paiement à la livraison sans cash et sans fausse capture. Le client paie en Mobile Money, comme d'habitude. » |
| 0:40 – 1:00 | Démo, rôle Vendeuse : la commande, l'aperçu du message WhatsApp | « La vendeuse colle la conversation, la commande se remplit seule, elle envoie le lien au client sur WhatsApp. » |
| 1:00 – 1:30 | Rôle Cliente : ticket de commande, Mobile Money, MTN MoMo, validation | « Le client paie en MTN MoMo, Wave ou Orange Money. Mais l'argent n'arrive pas chez la vendeuse : il est bloqué. Elle le voit, elle ne peut pas le prendre. Sésame non plus. » |
| 1:30 – 2:00 | Rôle Livreur : « Votre course 1 500 FCFA », scan, « Livraison confirmée » | « À la livraison, le client vérifie son colis et montre son sésame. Le livreur scanne : la vendeuse est payée sur son Mobile Money, le livreur reçoit sa course. Plus de cash. » |
| 2:00 – 2:15 | Rôle Vendeuse : « Livrée et payée, versé sur votre MTN MoMo » | « Et si personne ne livre avant l'échéance ? Le client est remboursé automatiquement sur son Mobile Money. » |
| 2:15 – 2:35 | Page de réputation, puis un mot sur Bitcoin | « En arrière-plan, c'est le réseau Bitcoin Lightning qui bloque l'argent, avec une règle que personne ne peut contourner. Chaque livraison produit un reçu signé : la réputation d'une vendeuse devient vérifiable par tous. » |
| 2:35 – 3:00 | README : indicateurs, prochaine itération | « Sésame prend 1 % seulement quand la livraison réussit. Prochaines étapes : de vrais paiements avec notre partenaire de change Mobile Money, un pilote avec 20 vendeuses à Dakar et Cotonou, puis la diaspora. Tout est open source. » |

## Points clés à faire passer

1. **Problème local et concret :** commerce social, cash à la livraison, fausses captures, livreurs avec du cash.
2. **Aucun changement d'habitude :** le client et la vendeuse ne voient que du Mobile Money et WhatsApp.
3. **Bitcoin indispensable en arrière-plan :** bloquer de l'argent sans que personne ne puisse le prendre, c'est impossible avec le Mobile Money seul.
4. **Sécurité dès la conception :** le sésame est créé sur le téléphone du client ; toute panne mène au remboursement.
5. **Ça marche vraiment :** démo en ligne, testable sans compte, installation en une commande.

## Questions probables du jury

**« Pourquoi Bitcoin, si tout le monde paie en Mobile Money ? »**
Avec le Mobile Money seul, il faut qu'un intermédiaire garde l'argent pendant la livraison : il lui faut un agrément, et il peut bloquer, perdre ou détourner les fonds. Avec une facture hold Lightning, l'argent est bloqué par une règle mathématique : personne ne peut le prendre, et le remboursement est automatique. Bonus : la diaspora peut payer depuis l'étranger.

**« Comment se fait la conversion Mobile Money ↔ bitcoin ? »**
Par un partenaire de change agréé, comme Banxaas, qui fait déjà le pont entre Mobile Money et Lightning dans plusieurs pays d'Afrique de l'Ouest. Dans la démo, cette étape est simulée ; l'intégration réelle dépend de leur API partenaire. Le Bénin n'est pas encore couvert par Banxaas : c'est un point à ouvrir avec eux ou avec un autre partenaire.

**« Pendant la livraison, l'argent est dans le wallet de qui ? »**
De personne : il est bloqué en transit sur le réseau Lightning. Le partenaire qui a payé ne peut pas le récupérer avant l'échéance, et celui qui reçoit ne peut l'encaisser qu'avec le sésame du client.

**« Et si le colis est défectueux ? »**
Le client vérifie *avant* de donner son sésame, exactement comme avec le cash aujourd'hui. L'arbitrage après livraison est prévu en V2.

**« Sésame peut-il partir avec l'argent ? »**
Pas pendant la livraison : le serveur ne connaît pas le sésame avant la libération et ne détient aucune clé capable de dépenser l'argent bloqué. Si Sésame disparaît, les fonds bloqués reviennent au client à l'échéance.

**« Pourquoi les vendeuses paieraient-elles 1 % ? »**
Parce qu'elles ne paient que si la livraison réussit, et que les commandes annulées à la porte et les fausses captures leur coûtent déjà de l'argent. *À appuyer avec les chiffres de tes entretiens avec de vraies vendeuses* (combien de commandes annulées par semaine, combien de fausses captures reçues).

**« Quelle IA utilisez-vous ? »**
Par défaut, des règles locales gratuites et hors ligne. Avec une clé gratuite, un LLM (Llama 3.3 via Groq, ou Gemini). Les numéros de téléphone sont masqués avant tout envoi, et l'IA ne touche jamais au paiement.

**« Les paiements de la démo sont-ils réels ? »**
À dire honnêtement selon l'état au moment de la soumission : simulés (bandeau « Démonstration »), ou réels sur réseau de test pour la partie Lightning.

## Texte de présentation

Voir [DEVPOST.md](DEVPOST.md) (français et anglais).
