import { h, reducedMotion } from './lib/dom.js';
import { rankTeams, barPercents, interpolate } from '../shared/ranking.js';
import { avatarStack } from './lib/ui.js';
import { membersOf } from './lib/model.js';

export const ROW_HEIGHT = 74;
export const ANIMATION_MS = 1800;
// Doivent correspondre à .avatar-md et au chevauchement de .avatar-stack dans style.css.
const AVATAR_PX = 48;
const AVATAR_OVERLAP_PX = 10;

// Modèle pur : positions avant/après et largeurs de barres relatives au leader.
export function buildScoreboardModel(teams) {
  const current = rankTeams(teams, 'score');
  const previous = rankTeams(teams, 'prevScore');
  const previousIndex = new Map(previous.map((entry, i) => [entry.id, i]));
  const byId = new Map(teams.map((t) => [t.id, t]));
  const max = Math.max(0, ...teams.map((t) => t.score));
  const pct = (value) => barPercents([max, value])[1];
  return {
    max,
    rows: current.map((entry, index) => {
      const team = byId.get(entry.id);
      return {
        id: team.id,
        name: team.name,
        color: team.color,
        score: team.score,
        prevScore: team.prevScore,
        gain: team.gain,
        rank: entry.rank,
        index,
        prevIndex: previousIndex.get(team.id),
        pct: pct(team.score),
        prevPct: pct(team.prevScore),
      };
    }),
  };
}

export function renderScoreboard(view, { animate = true } = {}) {
  const model = buildScoreboardModel(view.teams);
  const teamsById = new Map(view.teams.map((t) => [t.id, t]));
  const skip = !animate || reducedMotion();
  const board = h('div', { class: 'scoreboard', vars: { '--rows': model.rows.length, '--row-h': `${ROW_HEIGHT}px` } });
  // Largeur réservée aux avatars de la plus grande équipe, pour que toutes les barres démarrent au même endroit.
  const biggest = Math.max(1, ...view.teams.map((t) => membersOf(view, t).length));
  board.style.setProperty('--stack-w', `${biggest * AVATAR_PX - (biggest - 1) * AVATAR_OVERLAP_PX}px`);
  const parts = [];

  for (const row of model.rows) {
    const counter = h('span', { class: 'sb-score' }, String(skip ? row.score : row.prevScore));
    const fill = h('div', { class: 'sb-fill', vars: { '--team': row.color } });
    fill.style.width = `${skip ? row.pct : row.prevPct}%`;
    const gain = row.gain > 0 ? h('span', { class: skip ? 'sb-gain show' : 'sb-gain' }, `+${row.gain}`) : null;
    const el = h(
      'div',
      { class: 'sb-row', vars: { '--team': row.color } },
      h('span', { class: 'sb-rank' }, String(row.rank)),
      h('span', { class: 'sb-avatars' }, avatarStack(view, teamsById.get(row.id), 'md')),
      h('div', { class: 'sb-main' }, h('div', { class: 'sb-name' }, row.name ?? '—'), h('div', { class: 'sb-track' }, fill)),
      h('div', { class: 'sb-points' }, counter, gain),
    );
    el.style.transform = `translateY(${(skip ? row.index : row.prevIndex) * ROW_HEIGHT}px)`;
    board.append(el);
    parts.push({ row, el, fill, counter, gain });
  }
  board.style.height = `${model.rows.length * ROW_HEIGHT}px`;

  if (!skip) {
    // Départ sur l'ancien état, puis glissement et barres vers le nouveau.
    setTimeout(() => {
      const start = performance.now();
      for (const { row, el, fill, gain } of parts) {
        el.style.transform = `translateY(${row.index * ROW_HEIGHT}px)`;
        fill.style.width = `${row.pct}%`;
        gain?.classList.add('show');
      }
      const tick = (now) => {
        const progress = (now - start) / ANIMATION_MS;
        for (const { row, counter } of parts) counter.textContent = String(Math.round(interpolate(row.prevScore, row.score, progress)));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, 600);
  }
  return board;
}
