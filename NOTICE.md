# Crédits des questions

- **`game/questions.dyk.json`** : questions à trous tirées des anecdotes de la rubrique « Le saviez-vous ? » de [Wikipédia en français](https://fr.wikipedia.org/wiki/Wikip%C3%A9dia:Le_saviez-vous_%3F), publiées sous licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr). Chaque question conserve sa référence dans le champ `source` (page d'archive et identifiant de l'anecdote). Ces questions sont redistribuées sous la même licence.
- **`game/questions.wikidata.json`** : faits extraits de [Wikidata](https://www.wikidata.org), données dédiées au domaine public (CC0).
- **`game/questions.json`** : questions rédigées pour le projet.

Les fichiers sont régénérés avec `node scripts/import-dyk.js` et `node scripts/import-wikidata.js` (les réponses brutes sont mises en cache dans `.cache/`, ignoré par git).
