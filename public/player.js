import { h, region } from './lib/dom.js';
import { createConnection, loadJson, saveJson } from './lib/net.js';
import { errorMessage } from './lib/messages.js';
import { avatar, teamChip, toast } from './lib/ui.js';
import { fileToSelfie } from './avatar.js';
import { fetchRules, openRulesModal } from './rules.js';
import { keepScreenAwake } from './lib/wakelock.js';
import { TEAM_COLORS } from '../shared/palette.js';
import {
  teamById, playerById, membersOf, chatProposalValue, standing, rankLabel,
  remainingMs, formatSeconds, teamLabel,
} from './lib/model.js';

const SESSION_KEY = 'bluffer.player';
const CHAT_PHASES = ['naming', 'question', 'writing', 'voting'];

const app = document.getElementById('app');
let view = null;
let receivedAt = 0;
let status = 'connecting';
let rulesText = '';
let pendingVote = null;
let joinPhoto = null;
let conn = null;
let resuming = false;

// ---------- éléments persistants (ne sont jamais détruits, pour garder le focus et le texte saisi) ----------

const answerInput = h('input', { id: 'answer-input', type: 'text', maxLength: 80, placeholder: 'Ta fausse réponse…', autocomplete: 'off', enterkeyhint: 'send' });
const nameInput = h('input', { id: 'name-input', type: 'text', maxLength: 24, placeholder: 'Nom d’équipe…', autocomplete: 'off', enterkeyhint: 'send' });
const chatInput = h('input', { id: 'chat-input', type: 'text', maxLength: 300, placeholder: 'Message à l’équipe…', autocomplete: 'off', enterkeyhint: 'send' });
const photoInput = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'hidden-input', id: 'photo-input' });

const barEl = h('header', { id: 'bar', class: 'bar' });
const proposalEl = h('section', { id: 'proposal-banner', class: 'proposal-slot', hidden: true, 'aria-live': 'polite' });
const topEl = h('div', { class: 'top' }, barEl, proposalEl);
const bannerEl = h('div', { id: 'banner', class: 'banner', hidden: true });
const joinEl = h('main', { id: 'join', class: 'screen' });
const mainEl = h('main', { id: 'main', class: 'screen' });
const composerEl = h('section', { id: 'composer', class: 'composer' });
const chatListEl = h('div', { id: 'chat-list', class: 'chat-list' });
const chatEl = h(
  'section',
  { id: 'chat', class: 'card chat', hidden: true },
  h('h3', {}, 'Tchat d’équipe'),
  chatListEl,
  h('form', { class: 'row', onsubmit: sendChat }, chatInput, h('button', { class: 'btn primary', type: 'submit' }, 'Envoyer')),
);
const gameEl = h('div', { id: 'game', hidden: true }, mainEl, composerEl, chatEl);
const footerEl = h('footer', { class: 'footer-hint' }, 'Besoin des règles ? Appuie sur « Règles » en haut de l’écran.');

app.append(topEl, bannerEl, joinEl, gameEl, footerEl, photoInput);

// ---------- actions ----------

async function act(event, payload) {
  const result = await conn.emit(event, payload);
  if (!result.ok) toast(errorMessage(result.error));
  return result;
}

async function sendChat(event) {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  const result = await act('team:chat', { text });
  if (result.ok) chatInput.value = '';
}

function submitText(input, success) {
  return async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    const result = await act('team:propose', { value });
    if (result.ok) {
      input.value = '';
      success?.();
    }
  };
}

function chooseFile() {
  photoInput.click();
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files?.[0];
  photoInput.value = '';
  if (!file) return;
  try {
    const dataUrl = await fileToSelfie(file);
    if (view) {
      const result = await act('player:photo', { photo: dataUrl });
      if (result.ok) toast('Photo mise à jour', 'ok');
    } else {
      joinPhoto = dataUrl;
      renderJoin();
    }
  } catch {
    toast('Impossible de lire cette photo, essaie-en une autre.');
  }
});

async function resume() {
  const session = loadJson(SESSION_KEY);
  if (!session || resuming) return false;
  resuming = true;
  const result = await conn.emit('player:resume', { code: session.code, token: session.token });
  resuming = false;
  if (!result.ok) {
    if (result.error !== 'timeout') {
      saveJson(SESSION_KEY, null);
      view = null;
      toast('Cette partie n’existe plus. Rejoins-en une autre.');
      render();
    }
    return false;
  }
  return true;
}

async function join(code, name) {
  const result = await conn.emit('player:join', { code: code.trim().toUpperCase(), name: name.trim() });
  if (!result.ok) {
    toast(errorMessage(result.error));
    return;
  }
  saveJson(SESSION_KEY, { code: result.code, token: result.token, playerId: result.playerId });
  if (joinPhoto) await conn.emit('player:photo', { photo: joinPhoto });
  joinPhoto = null;
}

// ---------- écran d'inscription ----------

const codeInput = h('input', { id: 'code-input', type: 'text', maxLength: 4, placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', class: 'code-input' });
const pseudoInput = h('input', { id: 'pseudo-input', type: 'text', maxLength: 20, placeholder: 'Ton pseudo', autocomplete: 'nickname' });
codeInput.value = (new URLSearchParams(location.search).get('code') ?? loadJson(SESSION_KEY)?.code ?? '').toUpperCase();

function renderJoin() {
  const preview = joinPhoto
    ? h('span', { class: 'avatar avatar-xl', vars: { '--team': '#8b5cf6' } }, h('img', { src: joinPhoto, alt: 'Ton selfie' }))
    : h('span', { class: 'avatar avatar-xl', vars: { '--team': '#8b5cf6' } }, h('span', { class: 'avatar-initials' }, '📷'));
  joinEl.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h1', {}, 'Bluffer'),
      h('p', { class: 'muted' }, 'Rejoins la partie affichée sur l’écran.'),
      h(
        'form',
        { class: 'stack', onsubmit: (event) => { event.preventDefault(); join(codeInput.value, pseudoInput.value); } },
        codeInput,
        pseudoInput,
        h('div', { class: 'selfie' }, preview, h('button', { class: 'btn', type: 'button', onclick: chooseFile }, joinPhoto ? 'Reprendre le selfie' : 'Prendre un selfie')),
        h('p', { class: 'muted small' }, 'Ton selfie (facultatif) s’affiche sur l’écran public, dans un rond de la couleur de ton équipe. Il n’est pas enregistré et disparaît à la fin de la partie.'),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Rejoindre'),
      ),
    ),
  );
}

// ---------- composants ----------

const card = (...children) => h('section', { class: 'card' }, ...children);

function countdown(v) {
  if (v.deadlineIn === null) return null;
  return h('div', { class: 'countdown-box' }, 'Plus que ', h('strong', { 'data-countdown': '' }, formatSeconds(remainingMs(v.deadlineIn, receivedAt, Date.now()))), ' s pour les retardataires');
}

function readyButton(v) {
  if (!v.ready.active) return h('p', { class: 'muted center' }, 'L’animateur fait avancer le jeu depuis l’écran.');
  const ready = v.me.ready;
  return h(
    'button',
    { class: ready ? 'btn ready on big' : 'btn primary big', type: 'button', onclick: () => act('player:ready', { ready: !ready }) },
    ready ? `Prêt ✔ (${v.ready.count}/${v.ready.total})` : `Je suis prêt (${v.ready.count}/${v.ready.total})`,
  );
}

// La proposition en cours s'affiche dans l'encart collé en haut de l'écran (voir renderProposal).
function proposalCard(v) {
  const mine = teamById(v, v.team.id);
  if (!mine || mine.memberIds.length < 2 || v.team.proposal) return null;
  return h('div', { class: 'proposal empty' }, 'Pas encore de proposition. Discutez dans le tchat, puis appuyez sur « Proposer ».');
}

function colorPicker(v) {
  const mine = teamById(v, v.me.teamId);
  if (!mine) return null;
  const taken = new Set(v.teams.filter((t) => t.id !== mine.id).map((t) => t.color));
  return h(
    'div',
    { class: 'swatches', role: 'group', 'aria-label': 'Couleur de l’équipe' },
    TEAM_COLORS.map((color) =>
      h('button', { class: color === mine.color ? 'swatch current' : 'swatch', type: 'button', vars: { '--team': color }, disabled: taken.has(color), 'aria-label': `Couleur ${color}`, onclick: () => act('team:color', { color }) }),
    ),
  );
}

// ---------- écrans par phase ----------

function screenLobby(v) {
  const me = playerById(v, v.me.id);
  const mine = teamById(v, v.me.teamId);
  if (v.config.mode === 'base') {
    return [card(h('h2', {}, 'Tu es dans la partie !'), h('div', { class: 'center' }, avatar(me, mine?.color, v.code, 'xl')), h('p', { class: 'center' }, `${v.players.length} joueur(s) connecté(s). L’animateur va lancer la partie.`), colorPicker(v))];
  }
  const others = v.teams.filter((t) => t.id !== v.me.teamId);
  const alone = mine && mine.memberIds.length === 1;
  return [
    card(
      h('h2', {}, mine ? 'Ton équipe' : 'Choisis ton équipe'),
      mine ? [teamChip(v, mine, { size: 'md' }), colorPicker(v)] : h('p', { class: 'muted' }, 'Rejoins une équipe ou crée la tienne.'),
      !alone ? h('button', { class: 'btn', type: 'button', onclick: () => act('team:create') }, mine ? 'Quitter pour créer une nouvelle équipe' : 'Créer une équipe') : h('p', { class: 'muted small' }, 'Tu es seul·e dans ton équipe : tu joues sans tchat.'),
    ),
    others.length > 0
      ? card(h('h3', {}, 'Autres équipes'), h('ul', { class: 'progress-list' }, others.map((team) => h('li', {}, teamChip(v, team, { size: 'sm' }), h('button', { class: 'btn small', type: 'button', onclick: () => act('team:join', { teamId: team.id }) }, 'Rejoindre')))))
      : null,
    h('p', { class: 'muted center' }, 'L’animateur verrouillera les équipes, puis vous choisirez vos noms.'),
  ];
}

function screenNaming(v) {
  const mine = teamById(v, v.me.teamId);
  const team = v.team;
  const solo = mine.memberIds.length === 1;
  return [
    card(
      h('h2', {}, 'Nom de l’équipe'),
      mine.name ? h('p', { class: 'big-name', vars: { '--team': mine.color } }, mine.name) : h('p', { class: 'muted' }, 'Choisissez un nom ensemble avant la première question.'),
      team.notice === 'name_taken' ? h('p', { class: 'error' }, 'Ce nom a été pris par une autre équipe entre-temps.') : null,
      solo ? h('p', { class: 'muted small' }, 'Tu peux garder ton pseudo ou en choisir un autre.') : null,
      !mine.name ? proposalCard(v) : h('p', { class: 'ok' }, 'Nom adopté ✔'),
    ),
  ];
}

function screenQuestion(v) {
  return [card(h('p', { class: 'muted' }, 'La question s’affichera sur l’écran quand tout le monde sera prêt.'), readyButton(v))];
}

function screenWriting(v) {
  const team = v.team;
  if (team.locked) {
    return [card(h('div', { class: 'sent' }, h('strong', {}, 'Réponse envoyée ✔'), h('p', { class: 'quote' }, `« ${team.answer} »`)), countdown(v))];
  }
  return [card(h('p', { class: 'hint' }, 'Invente une fausse réponse crédible. Si tu connais la vraie, invente-en une autre !'), proposalCard(v), countdown(v))];
}

function screenVoting(v) {
  const team = v.team;
  const mine = teamById(v, team.id);
  const solo = mine.memberIds.length === 1;
  const proposed = team.proposal ? team.proposal.value : null;
  const chosen = team.locked ? team.vote : solo ? pendingVote : proposed;
  const buttons = v.options.map((option) => {
    const own = option.id === team.ownOptionId;
    const classes = ['option'];
    if (own) classes.push('own');
    if (chosen === option.id) classes.push('chosen');
    return h(
      'button',
      {
        class: classes.join(' '),
        type: 'button',
        disabled: team.locked,
        onclick: () => {
          if (own) return toast(errorMessage('own_answer'));
          if (solo) {
            pendingVote = option.id;
            return render();
          }
          return act('team:propose', { value: option.id });
        },
      },
      h('span', { class: 'option-id' }, String(option.id)),
      h('span', { class: 'option-text' }, option.text),
      own ? h('span', { class: 'tag' }, 'Ton équipe') : null,
    );
  });
  const optionText = (id) => v.options.find((o) => o.id === id)?.text ?? '';
  return [
    card(
      h('div', { class: 'options' }, buttons),
      team.locked
        ? h('div', { class: 'sent' }, h('strong', {}, `Vote envoyé ✔ : n°${team.vote}`), h('p', { class: 'quote' }, `« ${optionText(team.vote)} »`))
        : solo
          ? h('button', { class: 'btn primary big', type: 'button', disabled: pendingVote === null, onclick: () => act('team:propose', { value: pendingVote }) }, pendingVote === null ? 'Choisis une réponse' : `Voter pour le n°${pendingVote}`)
          : proposalCard(v),
      countdown(v),
    ),
  ];
}

function screenReveal(v) {
  const rows = v.options.filter((o) => o.revealed);
  const mine = teamById(v, v.me.teamId);
  const allRevealed = v.revealCount >= v.revealTotal;
  const myOption = v.options.find((o) => o.kind === 'team' && o.teamId === v.me.teamId);
  return [
    card(
      h('h2', {}, 'Résultats'),
      rows.length === 0 ? h('p', { class: 'muted center' }, 'Regarde l’écran…') : h('ul', { class: 'reveal-list' }, rows.map((option) => revealRow(v, option))),
      allRevealed && myOption ? h('p', { class: 'center' }, `Ta réponse a piégé ${myOption.voters.length} équipe(s) : +${myOption.points} pt(s).`) : null,
      allRevealed && mine && v.options.find((o) => o.kind === 'truth')?.voters.includes(mine.id) ? h('p', { class: 'center ok' }, 'Tu as trouvé la vraie réponse : +1 pt !') : null,
      readyButton(v),
    ),
  ];
}

function revealRow(v, option) {
  const author = option.kind === 'team' ? teamById(v, option.teamId) : null;
  return h(
    'li',
    { class: option.kind === 'truth' ? 'reveal truth' : 'reveal', vars: { '--team': author?.color ?? '#22c55e' } },
    h('span', { class: 'option-id' }, String(option.id)),
    h('div', { class: 'reveal-main' }, h('div', { class: 'option-text' }, option.text), h('div', { class: 'muted small' }, option.kind === 'truth' ? '✔ Vraie réponse' : `Écrite par ${teamLabel(author)}`), h('div', { class: 'muted small' }, `${option.voters.length} vote(s) · +${option.points} pt(s)`)),
  );
}

function screenScoreboard(v) {
  const info = standing(v, v.me.teamId);
  return [
    card(
      h('h2', {}, 'Classement'),
      h('p', { class: 'rank' }, rankLabel(info.rank, info.tied)),
      h('p', { class: 'center' }, `${info.score} point(s)`, info.gain > 0 ? h('strong', { class: 'gain' }, ` +${info.gain}`) : null),
      h('p', { class: 'muted center small' }, `sur ${info.total} équipes · classement complet sur l’écran`),
      readyButton(v),
    ),
  ];
}

function screenFinal(v) {
  const info = standing(v, v.me.teamId);
  const won = v.winners.includes(v.me.teamId);
  return [card(h('h2', {}, 'Partie terminée !'), h('p', { class: 'rank' }, won ? '🏆 Victoire !' : rankLabel(info.rank, info.tied)), h('p', { class: 'center' }, `${info.score} point(s)`), h('p', { class: 'muted center' }, 'L’animateur peut lancer une nouvelle partie.'))];
}

const SCREENS = {
  lobby: screenLobby,
  naming: screenNaming,
  question: screenQuestion,
  writing: screenWriting,
  voting: screenVoting,
  reveal: screenReveal,
  scoreboard: screenScoreboard,
  final: screenFinal,
};

// ---------- barre, composeur, tchat ----------

function renderBar() {
  const mine = view ? teamById(view, view.me.teamId) : null;
  const me = view ? playerById(view, view.me.id) : null;
  const key = JSON.stringify([view && [view.me.name, mine?.name, mine?.color, me?.photoVersion, me?.hasPhoto], status]);
  region(barEl, key, () => [
    me ? h('button', { class: 'bar-me', type: 'button', onclick: chooseFile, title: 'Changer ma photo' }, avatar(me, mine?.color, view.code, 'sm'), h('span', { class: 'bar-name' }, view.me.name), mine ? h('span', { class: 'bar-team', vars: { '--team': mine.color } }, teamLabel(mine)) : null) : h('span', { class: 'bar-title' }, 'Bluffer'),
    h('span', { class: status === 'connected' ? 'dot-status ok' : 'dot-status' }, ''),
    h('button', { class: 'btn small close-typing', type: 'button', 'aria-label': 'Fermer le clavier', onclick: () => leaveTyping() }, '✕'),
    h('button', { class: 'btn small', type: 'button', onclick: () => openRulesModal(rulesText, { delai: view?.config.graceSeconds ?? 30 }) }, 'Règles'),
  ]);
}

let lastProposalId = null;

function proposalText(value) {
  if (view.phase === 'voting') return `n°${value} · « ${view.options.find((o) => o.id === value)?.text ?? ''} »`;
  return `« ${value} »`;
}

// Encart collé en haut de l'écran, au-dessus du tchat, tant qu'une proposition attend la validation de l'équipe.
function renderProposal() {
  const team = view?.team;
  const mine = team ? teamById(view, team.id) : null;
  const active = Boolean(mine) && mine.memberIds.length >= 2 && !team.locked && team.proposal !== null && ['naming', 'writing', 'voting'].includes(view.phase);
  proposalEl.hidden = !active;
  if (!active) {
    lastProposalId = null;
    proposalEl.dataset.key = '';
    proposalEl.replaceChildren();
    return;
  }
  const { value, by } = team.proposal;
  const proposalId = JSON.stringify([view.phase, value, by]);
  const validated = team.validations.includes(view.me.id);
  const key = JSON.stringify([proposalId, team.validations, mine.memberIds]);
  region(proposalEl, key, () => {
    const fresh = proposalId !== lastProposalId;
    lastProposalId = proposalId;
    const author = playerById(view, by);
    return h(
      'div',
      { class: ['proposal-banner', validated ? 'validated' : '', fresh ? 'fresh' : ''].join(' ').trim(), vars: { '--team': mine.color } },
      h(
        'div',
        { class: 'pb-text' },
        h('div', { class: 'pb-value' }, proposalText(value)),
        h(
          'div',
          { class: 'pb-meta' },
          `💡 ${by === view.me.id ? 'Toi' : (author?.name ?? 'Équipe')} · `,
          membersOf(view, mine).map((member) => h('span', { class: team.validations.includes(member.id) ? 'pb-member ok' : 'pb-member' }, `${member.id === view.me.id ? 'Toi' : member.name} ${team.validations.includes(member.id) ? '✔' : '…'}`)),
        ),
      ),
      validated
        ? h('button', { class: 'btn small', type: 'button', onclick: () => act('team:unvalidate') }, 'Retirer')
        : h('button', { class: 'btn primary', type: 'button', onclick: () => act('team:validate') }, 'Valider'),
    );
  });
}

function renderComposer() {
  const team = view?.team;
  const mine = team ? teamById(view, team.id) : null;
  let mode = null;
  if (team && mine) {
    const solo = mine.memberIds.length === 1;
    if (view.phase === 'writing' && !team.locked) mode = solo ? 'answer-solo' : 'answer-team';
    if (view.phase === 'naming' && (solo || !mine.name)) mode = solo ? 'name-solo' : 'name-team';
  }
  region(composerEl, `${mode}`, () => {
    if (!mode) return null;
    const isAnswer = mode.startsWith('answer');
    const input = isAnswer ? answerInput : nameInput;
    const label = mode.endsWith('solo') ? (isAnswer ? 'Envoyer' : 'Renommer') : isAnswer ? 'Proposer' : 'Proposer ce nom';
    return h('form', { class: 'card row', onsubmit: submitText(input) }, input, h('button', { class: 'btn primary', type: 'submit' }, label));
  });
}

function renderChat() {
  const team = view?.team;
  const visible = Boolean(team?.hasChat) && CHAT_PHASES.includes(view.phase);
  chatEl.hidden = !visible;
  if (!visible) return;
  const last = team.chat.at(-1);
  const key = JSON.stringify([team.chat.length, last?.id, last?.qIndex, view.phase, team.locked, team.proposal?.value]);
  if (chatListEl.dataset.key === key) return;
  chatListEl.dataset.key = key;
  const nearBottom = chatListEl.scrollHeight - chatListEl.scrollTop - chatListEl.clientHeight < 60;
  const mine = teamById(view, team.id);
  chatListEl.replaceChildren(
    ...team.chat.map((entry) => {
      if (entry.type === 'separator') return h('div', { class: 'chat-sep' }, `Question ${entry.qIndex + 1}`);
      const author = playerById(view, entry.playerId);
      const value = !team.locked ? chatProposalValue(entry.text, view.phase, view.options) : null;
      return h(
        'div',
        { class: entry.playerId === view.me.id ? 'msg mine' : 'msg' },
        author ? avatar(author, mine.color, view.code, 'sm') : null,
        h('div', { class: 'bubble' }, h('div', { class: 'msg-author' }, author?.name ?? '?'), h('div', { class: 'msg-text' }, entry.text), value !== null ? h('button', { class: 'btn small', type: 'button', onclick: () => act('team:propose', { value }) }, 'Proposer') : null),
      );
    }),
  );
  if (nearBottom) chatListEl.scrollTop = chatListEl.scrollHeight;
}

function renderBanner() {
  const message = status === 'disconnected' ? 'Connexion perdue, reconnexion en cours…' : null;
  bannerEl.hidden = !message;
  bannerEl.textContent = message ?? '';
}

function render() {
  renderBanner();
  renderBar();
  const inGame = view !== null;
  joinEl.hidden = inGame;
  gameEl.hidden = !inGame;
  footerEl.hidden = !inGame;
  if (!inGame) {
    proposalEl.hidden = true;
    if (!joinEl.firstChild) renderJoin();
    return;
  }
  if (view.phase !== 'voting') pendingVote = null;
  const slice = { ...view, team: view.team ? { ...view.team, chat: undefined } : null };
  region(mainEl, JSON.stringify([slice, pendingVote]), () => (SCREENS[view.phase] ?? screenLobby)(view));
  renderComposer();
  renderProposal();
  renderChat();
}

setInterval(() => {
  if (!view || view.deadlineIn === null) return;
  const text = formatSeconds(remainingMs(view.deadlineIn, receivedAt, Date.now()));
  for (const el of document.querySelectorAll('[data-countdown]')) el.textContent = text;
}, 250);

// ---------- saisie au clavier ----------

// Pendant la saisie, la page ne garde que la barre, la proposition en attente, les champs de saisie et un tchat réduit,
// tous en haut de la page : le champ reste visible quel que soit le clavier, sans mesurer sa hauteur.
const typingInputs = [chatInput, answerInput, nameInput];
const viewport = window.visualViewport;

// Hauteur visible sans clavier : sert à détecter que le clavier a été replié.
let baseHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
let typingSince = 0;

function setTyping(on) {
  if (document.body.classList.contains('typing') === on) return;
  document.body.classList.toggle('typing', on);
  if (on) typingSince = Date.now();
  window.scrollTo(0, 0);
  if (on) requestAnimationFrame(() => { chatListEl.scrollTop = chatListEl.scrollHeight; });
}

// Le clavier replié ne retire pas toujours le focus du champ : on le retire nous-mêmes.
function leaveTyping() {
  document.activeElement?.blur();
  setTyping(false);
}

for (const input of typingInputs) {
  input.addEventListener('focus', () => setTyping(true));
  input.addEventListener('blur', () => setTimeout(() => setTyping(typingInputs.includes(document.activeElement)), 0));
}
if (viewport) {
  const onViewportChange = () => {
    if (!document.body.classList.contains('typing')) {
      baseHeight = Math.max(window.innerHeight, viewport.height);
      return;
    }
    if (viewport.height >= baseHeight - 80 && Date.now() - typingSince > 400) leaveTyping();
  };
  viewport.addEventListener('resize', onViewportChange);
  viewport.addEventListener('scroll', onViewportChange);
}

// ---------- démarrage ----------

function fatal(title, message, label = 'Recharger', action = () => location.reload()) {
  const overlay = h('div', { class: 'overlay' }, h('div', { class: 'modal center' }, h('h2', {}, title), h('p', {}, message), h('button', { class: 'btn primary big', type: 'button', onclick: action }, label)));
  document.body.append(overlay);
}

conn = createConnection({
  onState(next) {
    view = next;
    receivedAt = Date.now();
    render();
  },
  onEnded({ reason }) {
    saveJson(SESSION_KEY, null);
    view = null;
    fatal(reason === 'kicked' ? 'Tu as été retiré de la partie' : 'La partie est terminée', 'Merci d’avoir joué !', 'Rejoindre une autre partie', () => { location.href = '/play'; });
  },
  onStatus(next) {
    status = next;
    render();
  },
  onProtocolMismatch() {
    fatal('Mise à jour disponible', 'Cette page est trop ancienne pour le jeu. Recharge-la pour continuer.');
  },
  onConnect() {
    resume();
  },
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !conn.socket.connected) conn.socket.connect();
});

fetchRules().then((text) => {
  rulesText = text;
});
keepScreenAwake();
render();
