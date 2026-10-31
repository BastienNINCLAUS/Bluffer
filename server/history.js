import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryHistory } from '../game/history.js';

// Historique persistant (passages et scores) : survit aux redémarrages du serveur (fichier JSON écrit de façon atomique).
export class FileHistory extends MemoryHistory {
  constructor(file, { delayMs = 500, log = console } = {}) {
    super();
    this.file = file;
    this.delayMs = delayMs;
    this.log = log;
    this.timer = null;
    this.dirty = false;
    this.load();
  }

  load() {
    if (!existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const [id, n] of Object.entries(data.counts ?? {})) {
        if (Number.isInteger(n) && n > 0) this.counts.set(id, n);
      }
      for (const [id, n] of Object.entries(data.scores ?? {})) {
        if (Number.isInteger(n) && n !== 0) this.scores.set(id, n);
      }
    } catch (error) {
      this.log.warn?.(`Historique illisible (${this.file}), on repart de zéro : ${error.message}`);
    }
  }

  changed() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ version: 1, counts: this.toJSON(), scores: this.scoresJSON() })}\n`);
      renameSync(temp, this.file);
    } catch (error) {
      this.dirty = true;
      this.log.error?.(`Historique non enregistré (${this.file}) : ${error.message}`);
    }
  }
}
