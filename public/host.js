import { h, region } from './lib/dom.js';
import { createConnection, loadJson, saveJson } from './lib/net.js';
import { errorMessage } from './lib/messages.js';
import { avatar, avatarStack, teamChip, toast } from './lib/ui.js';
import { fetchRules, createRulesCarousel } from './rules.js';
import { renderScoreboard } from './scoreboard.js';
import { teamById, membersOf, progressText, remainingMs, formatSeconds, teamLabel } from './lib/model.js';

const SESSION_KEY = 'bluffer.host';

const app = document.getElementById('app');
let view = null;
let receivedAt = 0;
let status = 'connecting';
let publicUrl = location.origin;
let conn = null;
let previouslyRevealed = new Set();
let creating = false;

const rulesText = await fetchRules();
const carousel = createRulesCarousel(rulesText, { delai: 30 });
try {
  const config = await (await fetch('/api/config')).json();
  publicUrl = config.publicUrl;
} catch {
  // l'URL de la page sert de repli
}

// ---------- squelette ----------

const headerEl = h('header', { class: 'hbar' });
const stageEl = h('main', { class: 'stage', id: 'stage' });
const hintEl = h('div', { class: 'hint-bar', id: 'hint' });
const reminderEl = h('footer', { class: 'reminder' }, '📱 Un doute sur les règles ? Consulte-les sur ton téléphone (bouton « Règles »).');
app.append(headerEl, stageEl, hintEl, reminderEl);

// Zones du salon d'attente (créées une fois, mises à jour séparément).
const joinCardEl = h('section', { class: 'card join-card' });
const settingsEl = h('section', { class: 'card settings' });
const playersEl = h('section', { class: 'players-zone' });
const actionsEl = h('div', { class: 'actions' });
const lobbyEl = h('div', { class: 'lobby' }, h('div', { class: 'lobby-left' }, joinCardEl, settingsEl), h('div', { class: 'lobby-right' }, carousel.el), playersEl, actionsEl);

// ---------- actions ----------

async function act(event, payload) {
  const result = await conn.emit(event, payload);
  if (!result.ok) toast(errorMessage(result.error));
  return result;
}

async function createRoom() {
  if (creating) return;
  creating = true;
  const result = await conn.emit('host:create', { config: {} });
  creating = false;
  if (!result.ok) return toast(errorMessage(result.error));
  saveJson(SESSION_KEY, { code: result.code, token: result.token });
  return undefined;
}

async function resumeOrCreate() {
  const session = loadJson(SESSION_KEY);
  if (session) {
    const result = await conn.emit('host:resume', session);
    if (result.ok) return;
    if (result.error === 'timeout') return;
    saveJson(SESSION_KEY, null);
  }
  await createRoom();
}

async function newGame() {
  if (view && !confirm('Terminer cette partie et en créer une nouvelle ?')) return;
  await conn.emit('host:end');
  saveJson(SESSION_KEY, null);
  view = null;
  render();
  await createRoom();
}

function advance() {
  if (!view) return;
  if (!['question', 'reveal', 'scoreboard'].includes(view.phase)) return;
  if (view.config.advance === 'phones') return toast(errorMessage('host_disabled'));
  act('host:advance');
}

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  event.preventDefault();
  advance();
});

// ---------- salon d'attente ----------

function renderJoinCard(v) {
  region(joinCardEl, `${v.code}|${publicUrl}`, () => [
    h('h2', {}, 'Rejoignez la partie'),
    h('div', { class: 'join-body' }, h('img', { class: 'qr', src: `/api/qr/${v.code}.svg`, alt: `QR code pour rejoindre la partie ${v.code}` }), h('div', {}, h('div', { class: 'code-label' }, 'Code'), h('div', { class: 'code' }, v.code), h('div', { class: 'url' }, `${publicUrl}/play`))),
    h('p', { class: 'muted' }, 'Scannez le QR code avec votre téléphone, ou ouvrez l’adresse et saisissez le code.'),
  ]);
}

function select(options, current, onchange) {
  const el = h('select', { onchange: (event) => onchange(event.target.value) }, options.map(([value, label]) => h('option', { value }, label)));
  el.value = current;
  return el;
}

function numberInput(current, min, max, onchange) {
  return h('input', { type: 'number', min, max, value: current, onchange: (event) => onchange(Number(event.target.value)) });
}

function themePicker(v, patch) {
  const selected = new Set(v.selectedThemes);
  const toggle = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    patch({ themes: [...next] });
  };
  const { available, needed, ok } = v.pool;
  return h(
    'fieldset',
    { class: 'themes' },
    h('legend', {}, 'Thèmes des questions'),
    h('div', { class: 'themes-tools' }, h('button', { class: 'btn small', type: 'button', onclick: () => patch({ themes: null }) }, 'Tout cocher'), h('button', { class: 'btn small', type: 'button', onclick: () => patch({ themes: [] }) }, 'Tout décocher')),
    h('div', { class: 'theme-list' }, v.themes.map((theme) => h('label', { class: selected.has(theme.name) ? 'theme on' : 'theme' }, h('input', { type: 'checkbox', checked: selected.has(theme.name), onchange: () => toggle(theme.name) }), `${theme.name} (${theme.count})`))),
    ok
      ? h('p', { class: 'muted small' }, `${available} question(s) disponible(s) pour ${needed} demandée(s).`)
      : h('p', { class: 'error pool-warning' }, `Pas assez de questions : ${available} disponible(s) pour ${needed} demandée(s). Sélectionne d’autres thèmes ou réduis le nombre de questions.`),
  );
}

function renderSettings(v) {
  const patch = (config) => act('host:configure', { config });
  region(settingsEl, JSON.stringify(v.config), () => [
    h('h2', {}, 'Réglages'),
    h('label', { class: 'field' }, 'Mode', select([['teams', 'Équipes (tchat + validation)'], ['base', 'Un joueur = une équipe']], v.config.mode, (mode) => patch({ mode }))),
    h('label', { class: 'field' }, 'Nombre de questions', numberInput(v.config.totalQuestions, 1, 30, (n) => patch({ totalQuestions: n }))),
    h('label', { class: 'field' }, 'Délai accordé aux retardataires (s)', numberInput(v.config.graceSeconds, 5, 300, (n) => patch({ graceSeconds: n }))),
    h('label', { class: 'field' }, 'Faire avancer le jeu avec', select([['both', 'Téléphones ou écran'], ['phones', 'Téléphones (tous prêts)'], ['host', 'Écran uniquement']], v.config.advance, (advanceMode) => patch({ advance: advanceMode }))),
    themePicker(v, patch),
  ]);
  carousel.update({ delai: v.config.graceSeconds });
}

function teamCard(v, team, extra = null) {
  return h(
    'div',
    { class: 'team-card', vars: { '--team': team.color } },
    h('div', { class: 'team-card-head' }, h('strong', {}, team.name ?? 'Équipe sans nom'), extra),
    h('div', { class: 'team-card-members' }, membersOf(v, team).map((member) => h('span', { class: member.connected ? 'member' : 'member off' }, avatar(member, team.color, v.code, 'md'), h('span', {}, member.name), v.phase === 'lobby' ? h('button', { class: 'x', type: 'button', title: `Retirer ${member.name}`, onclick: () => act('host:kick', { playerId: member.id }) }, '×') : null))),
  );
}

function renderPlayers(v) {
  const key = JSON.stringify([v.players, v.teams.map((t) => [t.id, t.name, t.color, t.memberIds]), v.config.mode]);
  region(playersEl, key, () => {
    if (v.players.length === 0) return h('p', { class: 'muted center waiting' }, 'En attente des joueurs…');
    const loose = v.players.filter((p) => !p.teamId);
    return [
      h('h2', {}, `${v.players.length} joueur(s)`),
      h('div', { class: 'team-grid' }, v.teams.map((team) => teamCard(v, team))),
      loose.length > 0 ? h('div', { class: 'loose' }, h('strong', {}, 'Sans équipe : '), loose.map((p) => h('span', { class: 'member' }, avatar(p, '#6b7280', v.code, 'md'), h('span', {}, p.name), h('button', { class: 'x', type: 'button', onclick: () => act('host:kick', { playerId: p.id }) }, '×')))) : null,
    ];
  });
}

function renderActions(v) {
  const key = JSON.stringify([v.config.mode, v.canLock, v.canStart, v.unassigned, v.teams.length, v.players.length, v.pool]);
  region(actionsEl, key, () => {
    const poolHint = v.pool.ok ? null : h('p', { class: 'error' }, `Impossible de lancer : ${v.pool.available} question(s) pour ${v.pool.needed} demandée(s). Sélectionne d’autres thèmes ou réduis le nombre de questions.`);
    if (v.config.mode === 'base') {
      return [
        h('button', { class: 'btn primary huge', type: 'button', disabled: !v.canStart, onclick: () => act('host:start') }, 'Lancer la partie'),
        poolHint ?? (v.canStart ? null : h('p', { class: 'muted' }, `Il faut au moins ${v.limits.minTeams} joueurs.`)),
      ];
    }
    let hint = null;
    if (v.unassigned > 0) hint = `${v.unassigned} joueur(s) sans équipe.`;
    else if (v.teams.length < v.limits.minTeams) hint = `Il faut au moins ${v.limits.minTeams} équipes.`;
    return [
      h('button', { class: 'btn huge', type: 'button', disabled: v.players.length < 3, onclick: () => act('host:randomize', {}) }, '🎲 Tirage au sort des équipes'),
      h('button', { class: 'btn primary huge', type: 'button', disabled: !v.canLock, onclick: () => act('host:lockTeams') }, 'Verrouiller les équipes'),
      poolHint ?? (hint ? h('p', { class: 'muted' }, hint) : null),
    ];
  });
}

// ---------- phases ----------

function questionBlock(v) {
  return h('div', { class: 'question-big' }, h('div', { class: 'question-index' }, `Question ${v.question.index} / ${v.question.total}`), h('h1', {}, v.question.text));
}

function progressGrid(v) {
  return h('div', { class: 'progress-grid' }, v.teams.map((team) => h('div', { class: team.progress.locked ? 'progress-card done' : 'progress-card', vars: { '--team': team.color } }, avatarStack(v, team, 'md'), h('div', { class: 'progress-name' }, teamLabel(team)), h('div', { class: 'progress-status' }, team.progress.locked ? '✔ ' : '', progressText(team, v.phase)))));
}

function stageNaming(v) {
  return [
    h('h1', {}, 'Choisissez le nom de votre équipe'),
    h('p', { class: 'muted center' }, 'Discutez dans le tchat de votre téléphone, proposez un nom, et validez-le tous ensemble.'),
    h('div', { class: 'team-grid' }, v.teams.map((team) => teamCard(v, team, h('span', { class: team.name ? 'badge ok' : 'badge' }, team.name ? '✔ Nom adopté' : progressText(team, 'naming'))))),
    h('p', { class: 'center big' }, `${v.teamsNamed.named}/${v.teamsNamed.total} équipes prêtes`),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary huge', type: 'button', disabled: !v.canStart, onclick: () => act('host:start') }, 'Lancer la partie'), h('button', { class: 'btn', type: 'button', onclick: () => act('host:unlockTeams') }, '← Revenir au salon')),
  ];
}

function stageQuestion(v) {
  return [questionBlock(v), h('p', { class: 'center muted' }, 'Préparez-vous à inventer une fausse réponse…')];
}

function stageWriting(v) {
  return [questionBlock(v), h('h2', { class: 'center' }, 'Inventez une fausse réponse crédible !'), progressGrid(v)];
}

function stageVoting(v) {
  return [
    questionBlock(v),
    h('h2', { class: 'center' }, 'Laquelle est la vraie ?'),
    h('ol', { class: 'big-options' }, v.options.map((option) => h('li', { class: 'big-option' }, h('span', { class: 'option-id' }, String(option.id)), h('span', { class: 'option-text' }, option.text)))),
    progressGrid(v),
  ];
}

function stageReveal(v) {
  const rows = v.options.map((option) => {
    const author = option.kind === 'team' ? teamById(v, option.teamId) : null;
    if (!option.revealed) {
      return h('li', { class: 'reveal-card hidden' }, h('span', { class: 'option-id' }, String(option.id)), h('span', { class: 'option-text' }, option.text));
    }
    const fresh = !previouslyRevealed.has(option.id);
    const voters = option.voters.map((id) => teamById(v, id)).filter(Boolean);
    return h(
      'li',
      { class: `reveal-card shown${option.kind === 'truth' ? ' truth' : ''}${fresh ? ' fresh' : ''}`, vars: { '--team': author?.color ?? '#22c55e' } },
      h('span', { class: 'option-id' }, String(option.id)),
      h('div', { class: 'reveal-body' }, h('div', { class: 'option-text' }, option.text), h('div', { class: 'reveal-meta' }, option.kind === 'truth' ? h('strong', { class: 'truth-label' }, '✔ LA VRAIE RÉPONSE') : [h('span', {}, 'Écrite par '), teamChip(v, author, { size: 'md' })]), h('div', { class: 'reveal-voters' }, voters.length === 0 ? h('span', { class: 'muted' }, 'Aucun vote') : [h('span', { class: 'muted' }, 'Votes : '), voters.map((t) => teamChip(v, t, { size: 'sm' }))])),
      h('span', { class: 'points' }, `+${option.points}`),
    );
  });
  previouslyRevealed = new Set(v.options.filter((o) => o.revealed).map((o) => o.id));
  return [questionBlock(v), h('ol', { class: 'reveal-list-big' }, rows)];
}

function stageScoreboard(v) {
  return [h('h1', {}, `Classement après la question ${v.question.index}`), renderScoreboard(v, { animate: true })];
}

function stageFinal(v) {
  const winners = v.winners.map((id) => teamById(v, id)).filter(Boolean);
  return [
    h('h1', { class: 'victory' }, winners.length > 1 ? '🏆 Égalité !' : '🏆 Victoire !'),
    h('div', { class: 'winners' }, winners.map((team) => h('div', { class: 'winner', vars: { '--team': team.color } }, avatarStack(v, team, 'xl'), h('div', { class: 'winner-name' }, teamLabel(team))))),
    renderScoreboard(v, { animate: false }),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary huge', type: 'button', onclick: () => act('host:replay') }, '↻ Rejouer (mêmes équipes)'), h('button', { class: 'btn', type: 'button', onclick: newGame }, 'Nouvelle partie')),
  ];
}

const STAGES = { naming: stageNaming, question: stageQuestion, writing: stageWriting, voting: stageVoting, reveal: stageReveal, scoreboard: stageScoreboard, final: stageFinal };

function stageKey(v) {
  const teams = v.teams.map((t) => [t.id, t.name, t.color, t.score, t.prevScore, t.gain, t.progress, t.memberIds]);
  switch (v.phase) {
    case 'naming': return JSON.stringify([teams, v.teamsNamed, v.canStart, v.players]);
    case 'question': return JSON.stringify([v.question]);
    case 'writing': return JSON.stringify([v.question, teams, v.players]);
    case 'voting': return JSON.stringify([v.question, v.options, teams]);
    case 'reveal': return JSON.stringify([v.question, v.options, v.revealCount]);
    case 'scoreboard': return JSON.stringify([v.question.index, teams]);
    default: return JSON.stringify([v.phase, teams, v.winners]);
  }
}

// ---------- barre d'aide (prêts, délai, bouton suivant) ----------

function advanceLabel(v) {
  if (v.phase === 'question') return 'Commencer';
  if (v.phase === 'reveal') return v.revealCount < v.revealTotal ? 'Dévoiler la suivante' : 'Voir le classement';
  return v.question.index >= v.question.total ? 'Résultat final' : 'Question suivante';
}

function renderHint(v) {
  const key = JSON.stringify([v.phase, v.ready, v.deadlineIn, v.config.advance, v.revealCount]);
  region(hintEl, key, () => {
    const waiting = ['question', 'reveal', 'scoreboard'].includes(v.phase);
    const forcing = ['writing', 'voting'].includes(v.phase);
    if (!waiting && !forcing) return null;
    return [
      v.deadlineIn !== null ? h('span', { class: 'countdown-big' }, '⏱ ', h('strong', { 'data-countdown': '' }, formatSeconds(remainingMs(v.deadlineIn, receivedAt, Date.now()))), ' s pour les retardataires') : null,
      waiting && v.ready.active ? h('span', { class: 'ready-count' }, `Prêts sur téléphone : ${v.ready.count}/${v.ready.total}`) : null,
      waiting && v.config.advance !== 'phones' ? h('button', { class: 'btn primary big', type: 'button', onclick: advance }, `${advanceLabel(v)} (Espace)`) : null,
      forcing ? h('button', { class: 'btn', type: 'button', onclick: () => act('host:advance') }, 'Passer à la suite sans attendre') : null,
    ];
  });
}

// ---------- en-tête ----------

function renderHeader() {
  const key = JSON.stringify([view?.code, view?.phase, status, publicUrl]);
  region(headerEl, key, () => [
    h('span', { class: 'logo' }, 'Bluffer'),
    view && view.phase !== 'lobby' ? h('span', { class: 'join-info' }, `Rejoindre : ${publicUrl}/play · code `, h('strong', {}, view.code)) : null,
    h('span', { class: status === 'connected' ? 'dot-status ok' : 'dot-status', title: status }, ''),
    view ? h('button', { class: 'btn small', type: 'button', onclick: newGame }, 'Nouvelle partie') : null,
  ]);
}

function render() {
  renderHeader();
  if (!view) {
    region(stageEl, 'loading', () => h('p', { class: 'muted center' }, status === 'connected' ? 'Création de la partie…' : 'Connexion au serveur…'));
    region(hintEl, 'none', () => null);
    return;
  }
  stageEl.classList.toggle('is-lobby', view.phase === 'lobby');
  reminderEl.hidden = view.phase === 'lobby';
  if (view.phase === 'lobby') {
    region(stageEl, 'lobby', () => lobbyEl);
    renderJoinCard(view);
    renderSettings(view);
    renderPlayers(view);
    renderActions(view);
    region(hintEl, 'none', () => null);
    return;
  }
  region(stageEl, `${view.phase}|${stageKey(view)}`, () => (STAGES[view.phase] ?? stageFinal)(view));
  renderHint(view);
}

setInterval(() => {
  if (!view || view.deadlineIn === null) return;
  const text = formatSeconds(remainingMs(view.deadlineIn, receivedAt, Date.now()));
  for (const el of document.querySelectorAll('[data-countdown]')) el.textContent = text;
}, 250);

conn = createConnection({
  onState(next) {
    view = next;
    receivedAt = Date.now();
    render();
  },
  onEnded() {
    saveJson(SESSION_KEY, null);
    view = null;
    render();
    resumeOrCreate();
  },
  onStatus(next) {
    status = next;
    render();
  },
  onProtocolMismatch() {
    document.body.append(h('div', { class: 'overlay' }, h('div', { class: 'modal center' }, h('h2', {}, 'Mise à jour disponible'), h('p', {}, 'Recharge la page pour continuer.'), h('button', { class: 'btn primary big', onclick: () => location.reload() }, 'Recharger'))));
  },
  onConnect() {
    resumeOrCreate();
  },
});

render();
