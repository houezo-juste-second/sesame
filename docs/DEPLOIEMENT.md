# Mettre Sésame en ligne (gratuitement)

Sésame a besoin d'un **processus toujours allumé** : il rembourse automatiquement à l'échéance, garde des connexions temps réel ouvertes et écrit dans une base SQLite. C'est pourquoi un hébergement de sites statiques ou de fonctions éphémères (Netlify, Vercel) ne suffit pas.

| | Oracle Cloud « Always Free » | Render (offre gratuite) |
|---|---|---|
| Coût | Gratuit à vie | Gratuit |
| Carte bancaire | Demandée à l'inscription (vérification, aucun débit) | Non |
| Toujours allumé | Oui | Non : veille après 15 min (réveil ≈ 1 min) |
| Données conservées | Oui | Non : effacées à chaque redémarrage |
| Nœud Lightning plus tard | Oui, sur la même machine | Non |
| Mise en place | ≈ 30 min | ≈ 10 min |

**Conseil :** Render pour avoir un lien tout de suite, Oracle pour la version présentée au jury.

---

## Option A — Render (10 minutes, sans carte)

1. Créer un compte sur https://render.com avec GitHub.
2. **New › Blueprint**, choisir le dépôt `sesame`. Render lit `render.yaml`.
3. Renseigner les valeurs demandées :
   - `SESAME_DEMO_PIN` : le code PIN de la boutique de démonstration (4 à 6 chiffres) ;
   - `SESAME_AI_API_KEY` : facultatif, voir « IA » plus bas.
4. Attendre la fin du déploiement. L'adresse ressemble à `https://sesame-xxxx.onrender.com`.
5. Vérifier : `https://…/healthz` doit répondre `{"ok":true,…}`.

> Avant la présentation au jury, ouvrir le site une minute à l'avance pour le « réveiller ».

## Option B — Oracle Cloud « Always Free » (version jury)

### 1. Créer la machine
1. Créer un compte sur https://www.oracle.com/cloud/free/ (choisir une région proche, ex. Marseille, Francfort ou Johannesburg).
2. **Compute › Instances › Create instance** :
   - Image : **Ubuntu 24.04** ;
   - Forme : **VM.Standard.A1.Flex** (ARM, toujours gratuite) avec 1 OCPU et 6 Go, ou **VM.Standard.E2.1.Micro** ;
   - Télécharger la clé SSH proposée.
3. **Networking › Virtual cloud network › Security List** : ajouter deux règles d'entrée TCP depuis `0.0.0.0/0` pour les ports **80** et **443**.

### 2. Installer Sésame
Depuis votre PC (PowerShell) :
```powershell
ssh -i chemin\vers\cle.key ubuntu@<IP-PUBLIQUE>
```
Puis sur le serveur :
```bash
curl -fsSL https://raw.githubusercontent.com/houezo-juste-second/sesame/main/deploy/oracle/setup.sh -o setup.sh
less setup.sh          # lire le script avant de l'exécuter
sudo bash setup.sh     # ou : sudo bash setup.sh mon-domaine.example
```
Le script installe Node.js 22 et Caddy, compile Sésame, génère les secrets dans `/etc/sesame.env` (lisible par root uniquement), crée un service systemd et obtient le certificat HTTPS.

Sans nom de domaine, l'adresse est `https://<ip-avec-tirets>.sslip.io` (service gratuit).

### 3. Commandes utiles
```bash
sudo journalctl -u sesame -f          # journaux
sudo systemctl restart sesame         # redémarrer
sudo grep SESAME_DEMO_PIN /etc/sesame.env
cd /opt/sesame && sudo -u sesame git pull && sudo -u sesame npm ci --include=dev && sudo -u sesame npm run build && sudo systemctl restart sesame   # mise à jour
```

---

## IA (gratuite, facultative)

Sans configuration, Sésame remplit les commandes avec des **règles locales** (gratuites, hors ligne). Pour un vrai modèle de langage gratuit :
1. Créer un compte sur https://console.groq.com et une clé API (offre gratuite).
2. Renseigner `SESAME_AI_API_KEY` (Render : onglet *Environment* ; Oracle : `/etc/sesame.env`, puis `sudo systemctl restart sesame`).

Modèle par défaut : `llama-3.3-70b-versatile` via l'API compatible OpenAI de Groq. En cas d'erreur ou de quota atteint, Sésame revient automatiquement aux règles locales.

## Reçus Nostr sur relais publics (facultatif)

`SESAME_NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol` publie les reçus signés sur ces relais. À n'activer qu'avec de vrais paiements (pas en mode démonstration).
