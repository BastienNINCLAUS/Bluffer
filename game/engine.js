import { cleanText, normalizeText } from '../shared/text.js';
import { TEAM_COLORS } from '../shared/palette.js';
import { themeCounts, filterByThemes } from '../shared/themes.js';
import { MemoryHistory } from './history.js';

export { TEAM_COLORS };

export const PHASES = Object.freeze({
  LOBBY: 'lobby',
  NAMING: 'naming',
  QUESTION: 'question',
  WRITING: 'writing',
  VOTING: 'voting',
  REVEAL: 'reveal',
  SCOREBOARD: 'scoreboard',
  FINAL: 'final',
});

export const LIMITS = Object.freeze({
  minTeams: 3,
  maxTeams: 12,
  maxPlayers: 24,
  playerNameMax: 20,
  teamNameMax: 24,
  answerMax: 80,
  chatMax: 300,
  chatHistory: 200,
  graceMin: 5,
  graceMax: 300,
  questionsMax: 30,
  photoMaxChars: 120000,
});

export const DEFAULT_CONFIG = Object.freeze({
  mode: 'teams',
  totalQuestions: 10,
  graceSeconds: 30,
  advance: 'both',
  themes: null,
});

const PHOTO_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
const ADVANCE_MODES = ['both', 'phones', 'host'];
const MODES = ['teams', 'base'];

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const ok = (extra = {}) => ({ ok: true, ...extra });

export class Game {
  constructor({ code = 'TEST', questions, config = {}, now = Date.now, rng = Math.random, history = new MemoryHistory() } = {}) {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Une banque de questions non vide est requise.');
    }
    this.code = code;
    this.bank = questions;
    this.history = history;
    this.themeList = themeCounts(questions);
    this.now = now;
    this.rng = rng;
    this.config = { ...DEFAULT_CONFIG };
    this.config.totalQuestions = Math.min(this.config.totalQuestions, questions.length);
    this.players = new Map();
    this.teams = new Map();
    this.phase = PHASES.LOBBY;
    this.nextPlayerId = 1;
    this.nextTeamId = 1;
    this.resetRound();
    const applied = this.configure(config);
    if (!applied.ok) throw new Error(`Configuration invalide : ${applied.error}`);
  }

  // ---------- utilitaires internes ----------

  resetRound() {
    this.order = [];
    this.qIndex = 0;
    this.question = null;
    this.options = [];
    this.revealOrder = [];
    this.revealCount = 0;
    this.deadline = null;
    this.ready = new Set();
  }

  shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  teamOf(playerId) {
    const player = this.players.get(playerId);
    return player && player.teamId ? this.teams.get(player.teamId) : null;
  }

  members(team) {
    return [...this.players.values()].filter((p) => p.teamId === team.id);
  }

  teamList() {
    return [...this.teams.values()];
  }

  freeColor() {
    const used = new Set(this.teamList().map((t) => t.color));
    return TEAM_COLORS.find((c) => !used.has(c)) ?? null;
  }

  newTeam(name = null) {
    const color = this.freeColor();
    if (!color || this.teams.size >= LIMITS.maxTeams) return null;
    const team = {
      id: `t${this.nextTeamId++}`,
      name,
      color,
      score: 0,
      prevScore: 0,
      gain: 0,
      answer: null,
      vote: null,
      proposal: null,
      validations: new Set(),
      locked: name !== null,
      notice: null,
      chat: [],
      nextChatId: 1,
    };
    this.teams.set(team.id, team);
    return team;
  }

  detach(player) {
    if (!player.teamId) return;
    const team = this.teams.get(player.teamId);
    player.teamId = null;
    if (team && this.members(team).length === 0) this.teams.delete(team.id);
  }

  resetSlot(team) {
    team.proposal = null;
    team.validations = new Set();
    team.notice = null;
  }

  resetAllSlots() {
    for (const team of this.teamList()) this.resetSlot(team);
  }

  nameTaken(name, exceptTeamId = null) {
    const wanted = normalizeText(name);
    return this.teamList().some(
      (t) => t.id !== exceptTeamId && t.name !== null && normalizeText(t.name) === wanted,
    );
  }

  pruneDisconnected() {
    for (const player of [...this.players.values()]) {
      if (!player.connected) {
        this.detach(player);
        this.players.delete(player.id);
      }
    }
  }

  slotKind() {
    if (this.phase === PHASES.NAMING) return 'name';
    if (this.phase === PHASES.WRITING) return 'answer';
    if (this.phase === PHASES.VOTING) return 'vote';
    return null;
  }

  // ---------- configuration et salon ----------

  configure(patch = {}) {
    if (this.phase !== PHASES.LOBBY) return fail('wrong_phase');
    const next = { ...this.config };
    if (patch.mode !== undefined) {
      if (!MODES.includes(patch.mode)) return fail('invalid_config');
      next.mode = patch.mode;
    }
    if (patch.totalQuestions !== undefined) {
      const n = Number(patch.totalQuestions);
      if (!Number.isInteger(n) || n < 1 || n > Math.min(LIMITS.questionsMax, this.bank.length)) {
        return fail('invalid_config');
      }
      next.totalQuestions = n;
    }
    if (patch.graceSeconds !== undefined) {
      const n = Number(patch.graceSeconds);
      if (!Number.isInteger(n) || n < LIMITS.graceMin || n > LIMITS.graceMax) return fail('invalid_config');
      next.graceSeconds = n;
    }
    if (patch.advance !== undefined) {
      if (!ADVANCE_MODES.includes(patch.advance)) return fail('invalid_config');
      next.advance = patch.advance;
    }
    if (patch.themes !== undefined) {
      if (patch.themes === null) {
        next.themes = null;
      } else {
        const known = new Set(this.themeList.map((t) => t.name));
        const valid =
          Array.isArray(patch.themes) && patch.themes.every((t) => typeof t === 'string' && known.has(t));
        if (!valid) return fail('invalid_config');
        next.themes = [...new Set(patch.themes)];
      }
    }
    if (next.mode !== this.config.mode) {
      if (next.mode === 'base' && this.players.size > LIMITS.maxTeams) return fail('too_many_for_base');
      this.config = next;
      this.rebuildTeamsForMode();
    } else {
      this.config = next;
    }
    return ok();
  }

  // Questions disponibles pour les thèmes choisis, face au nombre de questions demandé.
  pool() {
    const themed = filterByThemes(this.bank, this.config.themes);
    const available = themed.length;
    const needed = this.config.totalQuestions;
    return { available, needed, ok: available >= needed, fresh: available - this.history.playedAmong(themed) };
  }

  poolError() {
    const { available, needed, ok: enough } = this.pool();
    return enough ? null : fail('not_enough_questions', { available, needed });
  }

  rebuildTeamsForMode() {
    this.teams.clear();
    for (const player of this.players.values()) {
      player.teamId = null;
      if (this.config.mode === 'base') this.makeSoloTeam(player);
    }
  }

  makeSoloTeam(player) {
    const team = this.newTeam(player.name);
    player.teamId = team.id;
    return team;
  }

  addPlayer(rawName) {
    if (this.phase !== PHASES.LOBBY) return fail('game_started');
    const name = cleanText(rawName);
    if (name.length < 1 || name.length > LIMITS.playerNameMax) return fail('invalid_name');
    const wanted = normalizeText(name);
    if (wanted === '') return fail('invalid_name');
    if ([...this.players.values()].some((p) => normalizeText(p.name) === wanted)) return fail('name_taken');
    const cap = this.config.mode === 'base' ? LIMITS.maxTeams : LIMITS.maxPlayers;
    if (this.players.size >= cap) return fail('game_full');
    const player = {
      id: `p${this.nextPlayerId++}`,
      name,
      photo: null,
      photoVersion: 0,
      teamId: null,
      connected: true,
    };
    this.players.set(player.id, player);
    if (this.config.mode === 'base') this.makeSoloTeam(player);
    return ok({ player });
  }

  removePlayer(playerId) {
    if (this.phase !== PHASES.LOBBY) return fail('wrong_phase');
    const player = this.players.get(playerId);
    if (!player) return fail('unknown_player');
    this.detach(player);
    this.players.delete(playerId);
    return ok();
  }

  setPhoto(playerId, photo) {
    const player = this.players.get(playerId);
    if (!player) return fail('unknown_player');
    if (photo !== null) {
      if (typeof photo !== 'string' || photo.length > LIMITS.photoMaxChars || !PHOTO_PATTERN.test(photo)) {
        return fail('invalid_photo');
      }
    }
    player.photo = photo;
    player.photoVersion += 1;
    return ok();
  }

  setConnected(playerId, connected) {
    const player = this.players.get(playerId);
    if (!player) return fail('unknown_player');
    player.connected = Boolean(connected);
    if (!player.connected) {
      const team = this.teamOf(playerId);
      if (team && team.proposal) this.checkLock(team);
      this.checkReady();
    }
    return ok();
  }

  // ---------- équipes ----------

  createTeam(playerId) {
    if (this.phase !== PHASES.LOBBY || this.config.mode !== 'teams') return fail('wrong_phase');
    const player = this.players.get(playerId);
    if (!player) return fail('unknown_player');
    const current = this.teamOf(playerId);
    if (current && this.members(current).length === 1) return ok({ team: current });
    this.detach(player);
    const team = this.newTeam();
    if (!team) return fail('too_many_teams');
    player.teamId = team.id;
    return ok({ team });
  }

  joinTeam(playerId, teamId) {
    if (this.phase !== PHASES.LOBBY || this.config.mode !== 'teams') return fail('wrong_phase');
    const player = this.players.get(playerId);
    if (!player) return fail('unknown_player');
    const team = this.teams.get(teamId);
    if (!team) return fail('unknown_team');
    if (player.teamId === teamId) return ok({ team });
    this.detach(player);
    player.teamId = team.id;
    return ok({ team });
  }

  setTeamColor(playerId, color) {
    if (this.phase !== PHASES.LOBBY && this.phase !== PHASES.NAMING) return fail('wrong_phase');
    const team = this.teamOf(playerId);
    if (!team) return fail('no_team');
    if (!TEAM_COLORS.includes(color)) return fail('invalid_color');
    if (this.teamList().some((t) => t.id !== team.id && t.color === color)) return fail('color_taken');
    team.color = color;
    return ok();
  }

  randomize(teamCount) {
    if (this.phase !== PHASES.LOBBY || this.config.mode !== 'teams') return fail('wrong_phase');
    const n = this.players.size;
    if (n < LIMITS.minTeams) return fail('not_enough_players');
    const wanted = teamCount ?? Math.max(LIMITS.minTeams, Math.round(n / 3));
    const k = Math.min(Math.max(Number(wanted) || 0, LIMITS.minTeams), n, LIMITS.maxTeams);
    this.teams.clear();
    const teams = [];
    for (let i = 0; i < k; i += 1) teams.push(this.newTeam());
    this.shuffle([...this.players.values()]).forEach((player, i) => {
      player.teamId = teams[i % k].id;
    });
    return ok({ teams: k });
  }

  lockTeams() {
    if (this.phase !== PHASES.LOBBY || this.config.mode !== 'teams') return fail('wrong_phase');
    const connectedWithoutTeam = [...this.players.values()].filter((p) => p.connected && !p.teamId);
    if (connectedWithoutTeam.length > 0) {
      return fail('players_without_team', { count: connectedWithoutTeam.length });
    }
    this.pruneDisconnected();
    if (this.teams.size < LIMITS.minTeams) return fail('not_enough_teams');
    const poolError = this.poolError();
    if (poolError) return poolError;
    for (const team of this.teamList()) {
      this.resetSlot(team);
      const members = this.members(team);
      team.name = members.length === 1 ? members[0].name : null;
      team.locked = team.name !== null;
    }
    this.phase = PHASES.NAMING;
    return ok();
  }

  unlockTeams() {
    if (this.phase !== PHASES.NAMING) return fail('wrong_phase');
    for (const team of this.teamList()) {
      team.name = null;
      team.locked = false;
      this.resetSlot(team);
    }
    this.phase = PHASES.LOBBY;
    return ok();
  }

  teamsReady() {
    return this.teamList().filter((t) => t.name !== null).length;
  }

  start() {
    if (this.config.mode === 'base') {
      if (this.phase !== PHASES.LOBBY) return fail('wrong_phase');
      this.pruneDisconnected();
      if (this.teams.size < LIMITS.minTeams) return fail('not_enough_teams');
    } else {
      if (this.phase !== PHASES.NAMING) return fail('wrong_phase');
      if (this.teamsReady() < this.teams.size || this.teams.size < LIMITS.minTeams) {
        return fail('teams_not_ready');
      }
    }
    const poolError = this.poolError();
    if (poolError) return poolError;
    this.beginGame();
    return ok();
  }

  beginGame() {
    for (const team of this.teamList()) {
      team.score = 0;
      team.prevScore = 0;
      team.gain = 0;
      team.chat = [];
    }
    this.resetRound();
    this.order = this.pickQuestions(this.config.totalQuestions);
    this.enterQuestion();
  }

  pickQuestions(count) {
    const themed = filterByThemes(this.bank, this.config.themes);
    // Mélange puis tri stable par nombre de passages : les questions les moins jouées passent d'abord.
    const ranked = this.shuffle(themed)
      .map((question) => ({ question, played: this.history.count(question.id) }))
      .sort((a, b) => a.played - b.played);
    return this.shuffle(ranked.slice(0, count).map((entry) => entry.question));
  }

  resetHistory() {
    if (this.phase !== PHASES.LOBBY) return fail('wrong_phase');
    this.history.reset();
    return ok();
  }

  replay() {
    if (this.phase !== PHASES.FINAL) return fail('wrong_phase');
    this.beginGame();
    return ok();
  }

  // ---------- déroulement d'une question ----------

  enterQuestion() {
    this.question = this.order[this.qIndex];
    this.history.record(this.question.id);
    this.phase = PHASES.QUESTION;
    this.options = [];
    this.revealOrder = [];
    this.revealCount = 0;
    this.deadline = null;
    this.ready = new Set();
    for (const team of this.teamList()) {
      team.answer = null;
      team.vote = null;
      team.gain = 0;
      team.locked = false;
      this.resetSlot(team);
      if (this.members(team).length >= 2) team.chat.push({ type: 'separator', qIndex: this.qIndex });
    }
  }

  enterWriting() {
    this.phase = PHASES.WRITING;
    this.deadline = null;
    this.ready = new Set();
    for (const team of this.teamList()) {
      team.locked = false;
      this.resetSlot(team);
    }
  }

  enterVoting() {
    const answers = this.teamList()
      .filter((t) => t.answer !== null)
      .map((t) => ({ kind: 'team', text: t.answer, teamId: t.id }));
    const all = [{ kind: 'truth', text: this.question.answer, teamId: null }, ...answers];
    this.options = this.shuffle(all).map((option, i) => ({ ...option, id: i + 1, voters: [] }));
    this.phase = PHASES.VOTING;
    this.deadline = null;
    this.ready = new Set();
    for (const team of this.teamList()) {
      team.vote = null;
      team.locked = false;
      this.resetSlot(team);
    }
  }

  enterReveal() {
    for (const team of this.teamList()) {
      team.gain = 0;
    }
    for (const team of this.teamList()) {
      if (team.vote === null) continue;
      const option = this.options.find((o) => o.id === team.vote);
      option.voters.push(team.id);
      if (option.kind === 'truth') team.gain += 1;
    }
    for (const option of this.options) {
      if (option.kind === 'team') this.teams.get(option.teamId).gain += 2 * option.voters.length;
    }
    const fakes = this.options.filter((o) => o.kind === 'team').map((o) => o.id);
    const truth = this.options.find((o) => o.kind === 'truth').id;
    this.revealOrder = [...fakes, truth];
    this.revealCount = 0;
    this.phase = PHASES.REVEAL;
    this.deadline = null;
    this.ready = new Set();
  }

  enterScoreboard() {
    for (const team of this.teamList()) {
      team.prevScore = team.score;
      team.score += team.gain;
    }
    this.phase = PHASES.SCOREBOARD;
    this.ready = new Set();
  }

  advanceStep() {
    this.ready = new Set();
    switch (this.phase) {
      case PHASES.QUESTION:
        this.enterWriting();
        break;
      case PHASES.REVEAL:
        if (this.revealCount < this.revealOrder.length) this.revealCount += 1;
        else this.enterScoreboard();
        break;
      case PHASES.SCOREBOARD:
        if (this.qIndex + 1 >= this.order.length) {
          this.phase = PHASES.FINAL;
        } else {
          this.qIndex += 1;
          this.enterQuestion();
        }
        break;
      default:
        break;
    }
  }

  // Les équipes qui n'ont pas validé à la fin du délai gardent leur dernière proposition.
  finishPhase() {
    if (this.phase !== PHASES.WRITING && this.phase !== PHASES.VOTING) return;
    for (const team of this.teamList()) {
      if (team.locked || !team.proposal) continue;
      if (this.phase === PHASES.WRITING) team.answer = team.proposal.value;
      else team.vote = team.proposal.value;
      team.locked = true;
    }
    if (this.phase === PHASES.WRITING) this.enterVoting();
    else this.enterReveal();
  }

  // ---------- propositions, validation à l'unanimité ----------

  propose(playerId, value) {
    const team = this.teamOf(playerId);
    const kind = this.slotKind();
    if (!team) return fail('no_team');
    if (!kind) return fail('wrong_phase');
    const solo = this.members(team).length === 1;
    if (team.locked && !(kind === 'name' && solo)) return fail('already_locked');

    let cleaned;
    if (kind === 'vote') {
      cleaned = Number(value);
      const option = this.options.find((o) => o.id === cleaned);
      if (!Number.isInteger(cleaned) || !option) return fail('invalid_vote');
      if (option.kind === 'team' && option.teamId === team.id) return fail('own_answer');
    } else {
      cleaned = cleanText(value);
      const max = kind === 'name' ? LIMITS.teamNameMax : LIMITS.answerMax;
      if (cleaned.length < 1 || cleaned.length > max || normalizeText(cleaned) === '') return fail('invalid_text');
      if (kind === 'name' && this.nameTaken(cleaned, team.id)) return fail('name_taken');
      if (kind === 'answer' && normalizeText(cleaned) === normalizeText(this.question.answer)) {
        return fail('is_truth');
      }
    }

    team.proposal = { value: cleaned, by: playerId };
    team.validations = new Set();
    team.notice = null;
    if (solo) team.validations.add(playerId);
    this.checkLock(team);
    return ok();
  }

  validate(playerId) {
    const team = this.teamOf(playerId);
    if (!team) return fail('no_team');
    if (!this.slotKind()) return fail('wrong_phase');
    if (!team.proposal) return fail('no_proposal');
    if (team.locked) return fail('already_locked');
    team.validations.add(playerId);
    this.checkLock(team);
    return ok();
  }

  unvalidate(playerId) {
    const team = this.teamOf(playerId);
    if (!team) return fail('no_team');
    if (!this.slotKind()) return fail('wrong_phase');
    if (team.locked) return fail('already_locked');
    team.validations.delete(playerId);
    return ok();
  }

  // Unanimité des membres connectés ; un membre qui se déconnecte ne bloque pas l'équipe.
  checkLock(team) {
    const kind = this.slotKind();
    if (!kind || !team.proposal) return;
    if (team.locked && !(kind === 'name' && this.members(team).length === 1)) return;
    const connected = this.members(team).filter((p) => p.connected);
    if (connected.length === 0) return;
    if (!connected.every((p) => team.validations.has(p.id))) return;

    const { value } = team.proposal;
    if (kind === 'name') {
      if (this.nameTaken(value, team.id)) {
        this.resetSlot(team);
        team.notice = 'name_taken';
        return;
      }
      team.name = value;
    } else if (kind === 'answer') {
      team.answer = value;
    } else if (kind === 'vote') {
      team.vote = value;
    }
    team.locked = true;
    if (kind === 'name') return;

    if (this.deadline === null) this.deadline = this.now() + this.config.graceSeconds * 1000;
    if (this.teamList().every((t) => t.locked)) this.finishPhase();
  }

  // ---------- chat ----------

  chat(playerId, text) {
    const team = this.teamOf(playerId);
    if (!team) return fail('no_team');
    if (![PHASES.NAMING, PHASES.QUESTION, PHASES.WRITING, PHASES.VOTING].includes(this.phase)) {
      return fail('wrong_phase');
    }
    if (this.members(team).length < 2) return fail('no_chat');
    const cleaned = cleanText(text);
    if (cleaned.length < 1 || cleaned.length > LIMITS.chatMax) return fail('invalid_text');
    team.chat.push({ type: 'message', id: team.nextChatId++, playerId, text: cleaned, at: this.now() });
    if (team.chat.length > LIMITS.chatHistory) team.chat.splice(0, team.chat.length - LIMITS.chatHistory);
    return ok();
  }

  // ---------- « Prêt » et avancement ----------

  readyPhase() {
    return [PHASES.QUESTION, PHASES.REVEAL, PHASES.SCOREBOARD].includes(this.phase);
  }

  setReady(playerId, value = true) {
    if (!this.players.has(playerId)) return fail('unknown_player');
    if (!this.readyPhase()) return fail('wrong_phase');
    if (this.config.advance === 'host') return fail('ready_disabled');
    if (value) this.ready.add(playerId);
    else this.ready.delete(playerId);
    this.checkReady();
    return ok();
  }

  readyCount() {
    const connected = [...this.players.values()].filter((p) => p.connected);
    return { count: connected.filter((p) => this.ready.has(p.id)).length, total: connected.length };
  }

  checkReady() {
    if (!this.readyPhase() || this.config.advance === 'host') return;
    const { count, total } = this.readyCount();
    if (total > 0 && count === total) this.advanceStep();
  }

  hostAdvance() {
    if (this.phase === PHASES.WRITING || this.phase === PHASES.VOTING) {
      this.finishPhase();
      return ok();
    }
    if (!this.readyPhase()) return fail('wrong_phase');
    if (this.config.advance === 'phones') return fail('host_disabled');
    this.advanceStep();
    return ok();
  }

  // Applique les délais expirés ; renvoie true si l'état a changé.
  tick() {
    if (this.deadline !== null && this.now() >= this.deadline) {
      if (this.phase === PHASES.WRITING || this.phase === PHASES.VOTING) {
        this.finishPhase();
        return true;
      }
    }
    return false;
  }
}
