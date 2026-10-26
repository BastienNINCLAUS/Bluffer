# Bluffer – Plan d'implémentation

Adaptation du jeu de société Bluffer (voir [Rules.md](./Rules.md)) en application type Kahoot : un écran partagé, et les joueurs qui jouent depuis leur téléphone.

## 1. Concept

- **Écran hôte** (`/host`), projeté sur grand écran : il joue le rôle du meneur. Il pose la question, affiche les réponses numérotées, les résultats et le classement.
- **Téléphones** (`/play`) : chaque joueur rejoint avec un code de salon ou un QR code. Il propose une fausse réponse, puis vote pour celle qu'il pense vraie.
- **Réseau local** : tout le monde est sur le même WiFi, sans compte à créer.
- **Identité** : chaque joueur s'inscrit avec un pseudo et un selfie. Chaque équipe porte un nom et une couleur. Le joueur est représenté par un rond à la couleur de son équipe, avec sa photo au centre.
- **Règles** : elles s'affichent sur l'écran hôte à la création de la partie. Un rappel permanent indique aux joueurs qu'elles sont consultables sur leur téléphone, à tout moment, via un bouton dédié.
- **Animateur** : il ouvre le salon et lance la partie depuis l'ordinateur de l'écran hôte.

## 2. Choix techniques

- Node.js + Express + Socket.IO
- État des parties en mémoire (un redémarrage efface les salons en cours)
- Docker : `Dockerfile` (Node alpine) et `docker-compose.yml`. Le serveur écoute sur le port interne 3000 du conteneur, publié sur le PC via `HOST_PORT` (défaut **3417**, choisi pour éviter les ports courants comme 3000 ou 8080).
- Fichier `.env` : `HOST_IP` (IP du PC sur le WiFi, par exemple `192.168.1.20`) et `HOST_PORT` (par exemple `3417`). L'application construit `PUBLIC_URL` = `http://HOST_IP:HOST_PORT` pour le QR code. L'URL est aussi affichée en clair sur l'écran hôte.
- Le pare-feu Windows doit autoriser en entrée le port `HOST_PORT` (le port publié, pas le port interne).
- `docker-compose.yml` publie `"${HOST_PORT:-3417}:3000"`. Si le port est déjà utilisé, Docker échoue au démarrage : changer `HOST_PORT` dans `.env`.

## 3. Structure prévue

| Fichier | Rôle |
|---|---|
| `server.js` | Express, Socket.IO, salons à code de 4 lettres, machine à états, timers |
| `game/engine.js` | Logique pure : tirage, mélange, validation, points |
| `game/questions.json`, `game/questions.*.json` | Banque de questions, chacune avec sa vraie réponse et ses thèmes (`tags`) : questions rédigées à la main, anecdotes insolites de Wikipédia (`questions.dyk.json`) et faits classiques de Wikidata (`questions.wikidata.json`, thème « Classique ») |
| `shared/themes.js` | Thèmes : décompte, filtre |
| `game/testGame.js` | Partie de test : code `TEST`, 2 questions génériques, robots |
| `scripts/import-dyk.js`, `scripts/import-wikidata.js` | Génération des banques de questions (`NOTICE.md` : licences) |
| `public/host.html`, `host.js` | Écran hôte |
| `public/player.html`, `player.js` | Page joueur (reconnexion automatique) |
| `package.json`, `CHANGELOG.md` | Scripts (`npm test`, `npm start`), versionnement sémantique |
| `tests/engine.test.js` | Tests du moteur (`node:test`) |
| `tests/integration.test.js` | Tests du serveur réel avec `socket.io-client` (confidentialité, reconnexion, partie complète) |
| `tests/scenarios/*.json` | Parties scénarisées (actions des équipes, scores attendus) rejouées à chaque version |
| `tests/contracts.test.js` | Schémas des événements Socket.IO et version du protocole |
| `tests/data.test.js` | Validation de `questions.json` et présence de `game/rules.md` |
| `tests/e2e/` | Parcours Playwright : un écran et plusieurs téléphones |
| `Dockerfile`, `docker-compose.yml`, `.env` | Déploiement |
| `public/avatar.js` | Selfie : recadrage carré, réduction à environ 256 px en JPEG, envoi au serveur |
| `public/style.css` | Styles communs, dont le rond d'avatar à bordure de la couleur d'équipe |
| `game/rules.md` | Texte des règles adapté à l'application, source unique pour l'écran hôte et les téléphones |
| `public/rules.js` | Affichage des règles : panneau sur l'écran hôte, fenêtre superposée sur le téléphone |
| `public/scoreboard.js` | Classement animé : barres de progression, compteur de points, glissement des lignes |

## 4. Règles du jeu (d'après Rules.md)

- L'unité de jeu est l'**équipe**. Le mode base est le cas particulier où chaque équipe compte un seul joueur.
- Pour chaque question :
  1. L'écran pose la question à toutes les équipes.
  2. Chaque équipe valide **une** fausse réponse.
  3. L'écran affiche les réponses mélangées avec la vraie, numérotées. Les réponses identiques sont gardées avec des numéros différents.
  4. Chaque équipe valide **un** vote. Elle ne peut pas voter pour sa propre réponse.
  5. Résultats : révélation réponse par réponse (auteur et votes), vraie réponse en dernier.
  6. Classement : les scores sont affichés avec des barres de progression animées avant la question suivante.
- **Points** : +2 par vote reçu sur sa fausse réponse, +1 pour avoir voté la vraie réponse.
- **Structure de partie** : nombre de questions réglable par l'animateur, classement final par équipe.
- Il faut au moins 3 équipes. Avec 2 équipes, le vote est un pile ou face, et l'interface le signale.
- Le bouton « Lancer la partie » reste désactivé tant que moins de 3 équipes ont un nom validé.

## 5. Mode équipes

- **Inscription** : le joueur saisit son pseudo et prend un selfie. Un message indique que les photos s'affichent sur l'écran public. Sans photo, un avatar avec les initiales prend la place.
- **Constitution** : chaque joueur choisit son équipe sur son téléphone, avec un bouton de tirage au sort au besoin. L'animateur verrouille les équipes depuis l'écran hôte, ce qui ouvre le vote des noms.
- **Nom d'équipe** : avant la première question, chaque équipe doit avoir un nom validé.
  - Une fois les équipes verrouillées, tout membre propose un nom avec « Proposer » dans le tchat, validé à l'unanimité comme une réponse (une nouvelle proposition remet les validations à zéro).
  - Un nom déjà pris par une autre équipe est refusé.
  - Une équipe d'un seul joueur saisit directement son nom (par défaut son pseudo), sans vote.
  - La partie démarre quand toutes les équipes ont un nom (« 3/4 équipes prêtes » sur l'écran).
- **Couleur d'équipe** : attribuée automatiquement à la création parmi une palette de 8 à 10 teintes distinctes. L'équipe peut en changer parmi les couleurs encore libres.
- **Tchat d'équipe** (dès 2 joueurs dans l'équipe) :
  - Il est actif pendant l'invention et pendant le vote.
  - Seuls les membres de l'équipe voient les messages, ils ne passent jamais par l'écran ni par les autres équipes.
  - Un bouton « Proposer » sur un message en fait la proposition courante (une réponse en invention, un numéro en vote).
  - L'historique est conservé pendant toute la partie, avec un séparateur à chaque question.
  - Une équipe d'un seul joueur n'a pas de tchat et valide directement.
- **Validation par unanimité** :
  - Chaque membre voit la proposition en cours et appuie sur « Valider ».
  - Quand tous ont validé, la réponse ou le vote est envoyé et verrouillé.
  - Une nouvelle proposition remet les validations à zéro.
  - Tant que la phase est ouverte, un membre peut retirer sa validation.
  - Si le délai expire sans accord, la dernière proposition de l'équipe est retenue (réponse ou vote) ; sans aucune proposition, l'équipe ne marque aucun point pour cette phase.
- **Vote** : un seul vote par équipe, validé collectivement.
- **Avatars** : un rond à bordure de la couleur de l'équipe, avec la photo du joueur au centre. Il apparaît à côté des messages du tchat, dans l'avancement par équipe, dans les résultats et dans le classement.

## 6. Timers

- Il n'y a pas de temps fixe. Dès que la première équipe (ou le premier joueur en mode base) a validé, les autres disposent d'un **délai réglé avant la partie**.
- Ce délai s'applique aux phases d'invention et de vote, y compris en mode base.
- Si tout le monde a validé avant la fin du délai, on passe à la suite immédiatement.
- Une équipe qui n'a rien validé à la fin du délai n'a pas de réponse dans la liste des votes. Si elle n'a pas voté, elle ne marque aucun point pour cette phase.

## 7. Avancement du jeu

Les transitions suivantes sont automatiques :
- Invention → vote : tout le monde a validé, ou le délai est écoulé.
- Vote → résultats : même règle.

Les autres demandent un « Prêt » :
- Question → invention.
- Révélation des résultats, une réponse à la fois.
- Passage des résultats au classement.
- Question suivante, depuis le classement.

Le « Prêt » se règle au début de la partie :
- **Téléphones** : chaque joueur appuie sur « Prêt », avec un compteur « 3/5 prêts » sur l'écran.
- **Écran hôte** : un bouton ou la touche Espace sur l'ordinateur qui projette.
- **Les deux** : on avance dès que l'un des deux se produit.

## 8. Réglages de début de partie

- Mode : « base » (une équipe par joueur, sans tchat ni constitution d'équipes) ou « équipes »
- Nombre total de questions
- **Thèmes** : l'animateur coche les thèmes utilisés (Insolite, Histoire, Automobile, Halloween, Noël, Pâques, personnages célèbres…). Chaque thème affiche son nombre de questions entre parenthèses, « Classique » est coché comme les autres par défaut. Si les thèmes cochés contiennent moins de questions que le nombre demandé, la partie ne se lance pas (verrouillage des équipes ou « Lancer la partie » refusé) et l'écran invite à choisir d'autres thèmes ou à réduire le nombre de questions.
- Délai accordé aux retardataires, en secondes
- Mode d'avancement : téléphones, écran, ou les deux (défaut : les deux)

**Valeurs par défaut** :
- Délai accordé aux retardataires : 30 s.
- Nombre de questions : 10.
- Limites : 3 à 12 équipes, 24 joueurs maximum.
- Palette : 10 couleurs distinctes.
- Identité du joueur : jeton stocké sur le téléphone pour la reconnexion, sans compte.
- Interface en français.

## 9. Écran hôte

- Affiche la question, les réponses numérotées, les résultats et le classement.
- Affiche le QR code et l'URL de connexion.
- Affiche l'avancement par équipe (nom, couleur, ronds avec photos des membres, par exemple « Les Lions : 2/3 ont validé ») sans révéler le contenu des échanges.
- Dans les résultats, l'auteur de chaque réponse est identifié par le nom et la couleur de son équipe, avec son avatar (photo ou initiales).
- **Classement entre les questions** : une barre horizontale par équipe, à la couleur de l'équipe, avec son nom, son avatar et son score. La longueur est proportionnelle au score du leader. L'animation (environ 2 s) étire chaque barre de l'ancien au nouveau score, avec un compteur et le gain de la question (« +3 »). Si le classement change, les lignes glissent à leur nouvelle position. Désactivée si l'appareil demande moins de mouvement.
- Sur téléphone, le classement se limite au rang de l'équipe et aux points gagnés sur la question.
- **Partie de test** : le bouton « 🧪 Partie de test » du salon crée un salon au code fixe `TEST`, avec 2 questions génériques (aucune question préparée) et 3 robots qui jouent seuls (prêt, réponse, vote, avec un petit délai). Les joueurs peuvent la rejoindre pour s'entraîner. Elle n'alimente pas le compteur de questions jouées, et en relancer une remplace la précédente.
- Fin de partie : classement final, équipe gagnante, et bouton « Rejouer » qui conserve les équipes, les noms et les couleurs.

## 9 bis. Règles du jeu dans l'application

**Contenu** (`game/rules.md`, rédigé pour l'app) :
- Déroulement d'une question : fausse réponse, vote, résultats.
- Points : +2 par vote reçu sur sa fausse réponse, +1 pour avoir voté la vraie réponse.
- Interdit de voter pour sa propre réponse.
- Équipes : tchat, bouton « Proposer », validation à l'unanimité.
- Délai accordé aux retardataires, avec la valeur réglée pour la partie en cours.
- Conseils : les vraies réponses sont déjà étonnantes, les fausses les plus plausibles piègent le mieux.
- Classement : les scores s'affichent après chaque question.

**Écran hôte**
- À la création de la partie (salon d'attente), les règles occupent un panneau à côté du QR code. Elles défilent par étapes courtes pour rester lisibles de loin.
- Pendant toute la partie, un bandeau discret en bas de l'écran rappelle : « Un doute sur les règles ? Consulte-les sur ton téléphone (bouton Règles) ». Il ne masque jamais la question ni les réponses.

**Téléphone**
- Un bouton « Règles » est visible en permanence dans la barre du haut, sur toutes les pages : inscription, constitution des équipes, tchat, validation, vote, résultats.
- Il ouvre une fenêtre plein écran superposée. La fermer ramène exactement là où le joueur était, sans perdre le tchat, la proposition en cours ni les validations.
- Consulter les règles ne bloque pas le jeu : le joueur n'est pas considéré comme absent, et ses états « Prêt » ou « Validé » restent inchangés.
- Le texte est chargé au démarrage de la page, il reste consultable même si le WiFi se coupe un instant.

## 9 ter. Tests et non-régression

- **Moteur** (`node:test`, horloge injectable) : points, auto-vote interdit, doublons, unanimité (reset et retrait), délai des retardataires, équipe sans validation, unicité des noms et couleurs, transitions de la machine à états, logique du « Prêt ».
- **Intégration** (serveur réel + `socket.io-client`) : partie complète multi-équipes ; la vraie réponse n'est jamais envoyée avant la révélation ; les messages du tchat ne sortent pas de l'équipe ; reconnexion en pleine phase ; déconnexion pendant la validation.
- **Non-régression** : parties scénarisées en JSON rejouées à chaque version ; schémas des événements Socket.IO testés ; numéro de version du protocole vérifié à la connexion ; validation de `questions.json` et présence de `game/rules.md`.
- **Front et bout en bout** : fonctions pures testées à part (recadrage photo, échelle des barres, tri stable) ; un parcours Playwright léger avec un écran et plusieurs téléphones.
- **Qualité** : `npm test` lance tout, avec seuil de couverture sur le moteur ; `docker compose config` vérifie `HOST_PORT` ; `git init` et `CHANGELOG.md` en versionnement sémantique.
- **Règle de travail** : chaque étape de la section 10 est livrée avec ses tests, et aucune étape ne démarre si `npm test` échoue.

## 10. Étapes d'implémentation

Chaque étape est livrée avec ses tests, et on ne passe à la suivante que si `npm test` est vert.

0. Initialisation : `package.json` (Node 20), `git init`, `CHANGELOG.md`, script `npm test`.
1. Moteur par équipes avec tests : points, auto-vote interdit, doublons, unanimité (annulation et reprise de la validation), délai des retardataires, unicité des noms et couleurs, transitions de la machine à états, logique du « Prêt ».
2. Serveur avec tests d'intégration : salons, inscription avec photo, équipes (nom, couleur), tchat par équipe, délai des retardataires, mécanisme « Prêt », confidentialité de la vraie réponse et du tchat, reconnexion, version du protocole.
3. Page joueur avec tests des fonctions pures : selfie, choix d'équipe, vote du nom, tchat, proposition, validation, vote, bouton « Règles » avec fenêtre superposée.
4. Écran hôte avec tests des fonctions pures (échelle des barres, tri stable) : règles dans le salon d'attente, bandeau de rappel permanent, question, avancement, vote, résultats, classement animé entre les questions, classement final.
5. Docker avec port publié configurable (`HOST_PORT`), QR code construit depuis `HOST_IP` et `HOST_PORT`, banque de 20 questions d'exemple validée par `tests/data.test.js`, test `docker compose config`.
6. Parties scénarisées en JSON, parcours Playwright et test manuel avec plusieurs téléphones sur le WiFi.

## 11. Points de vigilance

- Les questions de la banque doivent être originales.
- `Rules.pdf` n'a pas pu être lu : le plan s'appuie sur `Rules.md`.
- La reconnexion d'un joueur (téléphone verrouillé, WiFi coupé) doit restaurer son équipe et l'état de la phase en cours.
- Le tchat et la validation doivent rester cohérents si un membre se déconnecte pendant l'unanimité.
- **Selfie sans HTTPS** : `getUserMedia` exige HTTPS, ce qui est inutilisable sur un réseau local en `http://192.168.x.x`. On utilise donc `<input type="file" accept="image/*" capture="user">`, qui ouvre l'appareil photo du téléphone sans certificat.
- **Photos** : conservées en mémoire uniquement, supprimées à la fin de la partie, jamais écrites sur disque. Elles ne sont pas obligatoires.
- **Couleurs et noms** : unicité à contrôler côté moteur, y compris en cas de choix simultané par deux équipes.
- **Règles** : le bandeau de rappel doit rester visible de loin mais ne jamais empiéter sur la question ou les réponses. Le bouton « Règles » doit rester atteignable d'une main sur petit écran, sans recouvrir le tchat ni les boutons de validation.
- **Conflit de port** : vérifier avant le premier lancement qu'aucun autre conteneur n'utilise `HOST_PORT` (`docker ps` pour les ports publiés, `netstat -ano | findstr :3417` pour tout le PC). Le QR code doit toujours utiliser le port publié, jamais le port interne.
- **Classement animé** : l'échelle des barres suit le score du leader pour rester lisible en début de partie (scores à 0) et en cas d'égalité. Prévoir l'ordre stable des équipes à égalité de points, pour éviter des sauts visuels.