# Changelog

Versionnement sémantique. Le numéro de protocole Socket.IO (`shared/protocol.js`) est incrémenté à chaque changement incompatible des événements.

## [0.2.0] - 2026-10-26

Protocole Socket.IO : 1 (champs ajoutés, rien de retiré).

### Ajouté
- Thèmes (`tags`) sur chaque question et filtre de thèmes dans les réglages de l'écran hôte, avec le nombre de questions entre parenthèses ; « Classique » est décoché par défaut.
- La partie ne se lance pas (verrouillage des équipes ou « Lancer la partie ») si les thèmes choisis ont moins de questions que demandé : erreur `not_enough_questions`, avertissement sur l'écran.
- Banque de ~1 400 anecdotes insolites en questions à trous, tirées de « Le saviez-vous ? » de Wikipédia FR (`scripts/import-dyk.js`, crédits dans `NOTICE.md`), et ~50 questions rédigées dont Halloween, Noël, Pâques et automobile.
- Relecture des 3 400 candidats (trou évident, réponse ambiguë, fait périssable, sujet déplacé écartés ; thèmes corrigés) : décisions versionnées dans `scripts/data/dyk-review.json`, appliquées à chaque import ; seules les questions relues sont conservées.
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