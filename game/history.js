// Historique des questions jouées : un compteur par identifiant de question.
// Le tirage privilégie toujours les questions les moins jouées, donc rien ne se répète tant qu'il en reste de nouvelles.
export class MemoryHistory {
  constructor(counts = {}) {
    this.counts = new Map(Object.entries(counts).filter(([, n]) => Number.isInteger(n) && n > 0));
  }

  count(id) {
    return this.counts.get(id) ?? 0;
  }

  record(id) {
    this.counts.set(id, this.count(id) + 1);
    this.changed();
  }

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

  // Point d'accroche pour la persistance.
  changed() {}
}
