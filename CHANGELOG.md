# Changelog

Versionnement sémantique. Le numéro de protocole Socket.IO (`shared/protocol.js`) est incrémenté à chaque changement incompatible des événements.

## [Non publié]

### Ajouté
- Partie de test : bouton « 🧪 Partie de test » dans le salon de l'écran hôte. Salon au code fixe `TEST`, 2 questions génériques et 3 robots (`game/testGame.js`) qui se déclarent prêts, répondent et votent seuls ; les joueurs peuvent la rejoindre pour un tour de chauffe. Elle ne compte pas dans les questions jouées. Commande `host:create` : champ facultatif `test` ; la vue contient `test`.

### Modifié
- Révélation automatique : une fois le vote terminé (temps écoulé ou toutes les équipes ont voté), les résultats se dévoilent seuls, sans « Prêt » (3 s avant la première réponse, 4 s entre deux ; `REVEAL_TIMING` dans `game/engine.js`). Ordre : fausses réponses de la moins votée à la plus votée (à égalité, ordre des numéros), puis la vraie réponse. Le classement n'apparaît que lorsque l'animateur passe à la page suivante (bouton ou Espace, qui peut aussi accélérer la révélation, même en mode « phones »). « Prêt » ne s'applique plus qu'aux étapes « Question » et « Classement ».
- Téléphones : les encarts d'étape sont retirés (nom d'équipe, « Invente une fausse réponse… », « Réponse envoyée », « Pas encore de proposition », « L'animateur fait avancer le jeu »). Il reste le bouton « Prêt », le compte à rebours des retardataires et l'encart de proposition en haut.
- Téléphones, vote : un encart rappelle la réponse de l'équipe et son numéro ; la liste n'est plus recopiée (elle est sur l'écran), on vote avec des boutons numérotés. Le numéro de sa propre réponse est grisé.
- Téléphones : quand le clavier s'ouvre (tchat, réponse ou nom d'équipe), la page ne garde que la barre, la proposition en attente, les champs de saisie et le tchat ; le champ du tchat reste en bas, collé au-dessus du clavier (placé d'après la zone visible, avec un clavier supposé tant que le navigateur n'en signale pas), et l'historique occupe la place restante. La carte principale et le pied de page sont masqués le temps de la saisie. Le mode se quitte quand le clavier est replié (même si le champ garde le focus) ou avec le bouton « ✕ » de la barre. `/play?debug=1` affiche les mesures utilisées.
- Une équipe qui n'a pas encore de nom s'affiche « Équipe bleue », « Équipe verte »… (nom de sa couleur) au lieu de « Équipe sans nom ».
- Téléphones, choix du nom d'équipe : l'encart « x/x équipes ont leur nom » est retiré (l'information reste sur l'écran principal).
- Tous les thèmes sont cochés par défaut dans un nouveau salon (« Classique » compris).
- Une équipe qui n'a pas validé à l'échéance du délai garde sa dernière proposition comme réponse ou comme vote, au lieu de ne rien jouer.
- Les téléphones restent allumés pendant la partie : Screen Wake Lock en HTTPS ou localhost, et, en HTTP sur le réseau local (où l'API n'existe pas), repli NoSleep.js (vidéo muette en boucle, démarrée au premier toucher ; `/vendor/nosleep`, CSP `media-src` élargie). L'écran hôte aussi.
- Avant chaque question, l'écran affiche les équipes, les joueurs et leur état « prêt » ; le texte de la question n'apparaît qu'une fois tout le monde prêt (`question.text` est `null` en phase `question`, `players[].ready` ajouté).
- Le texte de la question n'est plus envoyé aux téléphones : il se lit sur l'écran.
- Écran d'équipe : la proposition en attente s'affiche dans un encart compact collé en haut de l'écran, au-dessus du tchat : texte, état de validation de chaque coéquipier et bouton « Valider » / « Retirer ».
- Téléphones : plus de carte « question » ni d'« Avancement » (déjà sur l'écran principal) ; la carte principale est réduite à l'essentiel.
- Classement : les barres partent toutes du même point, quelle que soit la taille des équipes.
- Écran hôte, salon : tout tient dans la hauteur de l'écran, sans défilement de la page. À gauche, le QR code, les « Paramètres de la partie » (repliés par défaut, les règles se masquent quand ils sont dépliés) et les règles ; à droite, les boutons puis les équipes et les joueurs.

## [0.2.0] - 2026-10-26

Protocole Socket.IO : 1 (champs ajoutés, rien de retiré).

### Ajouté
- Thèmes (`tags`) sur chaque question et filtre de thèmes dans les réglages de l'écran hôte, avec le nombre de questions entre parenthèses ; « Classique » est décoché par défaut.
- La partie ne se lance pas (verrouillage des équipes ou « Lancer la partie ») si les thèmes choisis ont moins de questions que demandé : erreur `not_enough_questions`, avertissement sur l'écran.
- Banque de ~1 400 anecdotes insolites en questions à trous, tirées de « Le saviez-vous ? » de Wikipédia FR (`scripts/import-dyk.js`, crédits dans `NOTICE.md`), et ~50 questions rédigées dont Halloween, Noël, Pâques et automobile.
- Compteur de questions jouées (`game/history.js`, `server/history.js`) : chaque question posée est comptée, partagé entre tous les salons et enregistré dans `data/played.json` (volume Docker `bluffer-data`). Le tirage prend toujours les questions les moins jouées, donc rien ne se répète d'un salon à l'autre tant qu'il en reste de nouvelles ; en « Rejouer », les nouvelles passent d'abord. Le salon affiche « dont N jamais jouée(s) » et un bouton « Réinitialiser » (commande `host:resetHistory`). (trou évident, réponse ambiguë, fait périssable, sujet déplacé écartés ; thèmes corrigés) : décisions versionnées dans `scripts/data/dyk-review.json`, appliquées à chaque import ; seules les questions relues sont conservées.
- Les faits Wikidata (`scripts/import-wikidata.js`) passent dans le thème « Classique ».

### Modifié
- La banque est chargée depuis tous les fichiers `game/questions*.json`.

## [0.1.0] - 2026-10-26

Protocole Socket.IO : 1.

### Ajouté
- Initialisation du projet : `package.json` (Node 20), script `npm test`, `git init`.
- Moteur de jeu par équipes (`game/engine.js`) : points, auto-vote interdit, doublons, validation à l'unanimité, délai des retardataires, « Prêt », unicité des noms et couleurs, rejouer avec les mêmes équipes.
- Serveur Express + Socket.IO : salons à code de 4 lettres, inscription avec selfie (en mémoire uniquement), tchat d'équipe confidentiel, reconnexion par jeton, version du protocole vérifiée à la connexion, QR code construit depuis `HOST_IP` et `HOST_PORT`.
- Page joueur (`/play`) : selfie, choix d'équipe et de couleur, tchat, proposition et validation, vote, bouton « Règles » avec fenêtre superposée.
- Écran hôte (`/host`) : règles dans le salon d'attente, bandeau de rappel permanent, avancement par équipe, révélation progressive, classement animé, classement final.
- Banque de 22 questions et règles de l'application (`game/rules.md`).
- Docker : `Dockerfile`, `docker-compose.yml` (port publié `HOST_PORT`, 3417 par défaut, vers le port interne 3000) et `.dockerignore`.
- Tests : moteur, intégration, contrats Socket.IO, données, front, URL publique, Docker (`docker compose config`), parties scénarisées (`tests/scenarios/*.json`) et parcours Playwright (`npm run test:e2e`).