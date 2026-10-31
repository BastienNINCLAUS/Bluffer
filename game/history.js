// Historique des questions : nombre de passages et score (likes moins dislikes) par identifiant de question.
// Le tirage privilégie les questions de plus petite priorité (passages − score) : rien ne se répète tant qu'il
// reste des questions nouvelles, sauf les questions appréciées, qui reviennent plus souvent.
export class MemoryHistory {
  constructor(counts = {}, scores = {}) {
    this.counts = new Map(Object.entries(counts).filter(([, n]) => Number.isInteger(n) && n > 0));
    this.scores = new Map(Object.entries(scores).filter(([, n]) => Number.isInteger(n) && n !== 0));
  }

  count(id) {
    return this.counts.get(id) ?? 0;
  }

  record(id) {
    this.counts.set(id, this.count(id) + 1);
    this.changed();
  }

  // Annule un passage (question écartée avant d'être jouée).
  unrecord(id) {
    const n = this.count(id) - 1;
    if (n > 0) this.counts.set(id, n);
    else this.counts.delete(id);
    this.changed();
  }

  score(id) {
    return this.scores.get(id) ?? 0;
  }

  addScore(id, delta) {
    if (delta === 0) return;
    const n = this.score(id) + delta;
    if (n !== 0) this.scores.set(id, n);
    else this.scores.delete(id);
    this.changed();
  }

  priority(id) {
    return this.count(id) - this.score(id);
  }

  // Remet à zéro les passages ; les scores sont conservés.
  reset() {
    this.counts.clear();
    this.changed();
  }

  // Nombre de questions déjà jouées au moins une fois, parmi la liste donnée.
  playedAmong(questions) {
    return questions.filter((q) => this.count(q.id) > 0).length;
  }

  toJSON() {
    return Object.fromEntries(this.counts);
  }

  scoresJSON() {
    return Object.fromEntries(this.scores);
  }

  // Point d'accroche pour la persistance.
  changed() {}
}
