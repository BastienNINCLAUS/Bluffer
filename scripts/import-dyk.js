// Convertit les archives « Le saviez-vous ? » de Wikipédia FR en questions à compléter (texte à trous),
// puis remplace chaque texte à trous par sa reformulation en question ouverte (scripts/data/dyk-rewrite.json).
// Usage : node scripts/import-dyk.js [--years 2010-2025] [--target 1000] [--seed 1] [--refresh]
// Sortie : game/questions.dyk.json. Texte des anecdotes : Wikipédia, CC BY-SA 4.0 (voir NOTICE.md).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestions } from '../game/questions.js';
import { normalizeText } from '../shared/text.js';
import { detectTags } from './lib/tags.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'dyk');
const outFile = join(root, 'game', 'questions.dyk.json');
const API = 'https://fr.wikipedia.org/w/api.php';
const USER_AGENT = 'BlufferImport/0.1 (projet personnel de jeu de bluff)';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const [yearFrom, yearTo] = argValue('--years', '2008-2025').split('-').map(Number);
const target = Number(argValue('--target', 3400));
const seed = Number(argValue('--seed', 1));
const refresh = args.includes('--refresh');

const MAX_SENTENCE = 230;
const MAX_ANSWER = 45;
const SEASONAL = ['Halloween', 'Noël', 'Pâques'];

// ---------- récupération ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchYear(year) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${year}.txt`);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  const params = new URLSearchParams({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2',
    titles: `Wikipédia:Le saviez-vous ?/Archives/${year}`,
  });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${API}?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = (await response.json()).query.pages[0];
      const text = page.revisions?.[0]?.slots?.main?.content ?? '';
      writeFileSync(file, text);
      await sleep(1000);
      return text;
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(3000 * attempt);
    }
  }
  return '';
}

// ---------- nettoyage du wikitexte ----------

// Supprime [[Fichier:…]] en tenant compte des liens imbriqués dans la légende.
function removeFiles(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i, i + 12).toLowerCase();
    if (text.startsWith('[[', i) && /^\[\[(fichier|file|image):/.test(rest)) {
      let depth = 0;
      let j = i;
      while (j < text.length) {
        if (text.startsWith('[[', j)) { depth += 1; j += 2; }
        else if (text.startsWith(']]', j)) { depth -= 1; j += 2; if (depth === 0) break; }
        else j += 1;
      }
      i = j;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

const PIPE = '\u0003';
const protectPipes = (text) => text.replace(/\[\[([^\]]*)\]\]/g, (m) => m.replace(/\|/g, PIPE));

// Gabarits courants ; un gabarit inconnu fait écarter l'anecdote.
function expandTemplate(inner) {
  const parts = inner.split('|').map((p) => p.trim());
  const name = parts[0].toLowerCase().replace(/\s+/g, ' ');
  const rest = parts.slice(1).filter((p) => !/^(lang|langue)\s*=/.test(p));
  const named = (p) => /^[a-zé-]+\s*=/.test(p);
  const positional = rest.filter((p) => !named(p));
  switch (name) {
    case 'lang': return positional.at(-1) ?? null;
    case 'anglais': case 'latin': case 'allemand': case 'italien': case 'espagnol': case 'langue':
      return positional.at(-1) ?? null;
    case 'nobr': case 'nowrap': case 'lnobr': case 'incise': return positional.join(' ') || null;
    case 'date-': case 'date': return positional.join(' ') || null;
    case 'nombre': case 'unité': case 'unite': case 'formatnum': return positional.join(' ') || null;
    case '1er': return '1er';
    case 'abréviation discrète': case 'abréviation': return positional[0] ?? null;
    case 's-': case 's': return positional[0] ? `${positional[0]}e siècle` : null;
    case 'av jc': return 'av. J.-C.';
    default:
      if (/^\d+e$/.test(name)) return name;
      if (/^nobr romains|^lnobr rom|^rom/.test(name)) return positional[0] ?? null;
      return null;
  }
}

function expandTemplates(text) {
  let current = text;
  for (let guard = 0; guard < 8; guard += 1) {
    let failed = false;
    const next = current.replace(/\{\{([^{}]*)\}\}/g, (match, inner) => {
      const value = expandTemplate(inner);
      if (value === null) failed = true;
      return value ?? '';
    });
    if (failed) return null;
    if (next === current) break;
    current = next;
  }
  return /\{\{|\}\}/.test(current) ? null : current;
}

const POSITIONAL = /\s*''\([^()]*\)''|\s*\(([^()]*)\)/g;
const ILLUSTRATION = /\b(gauche|droite|haut|bas|photo|illustration|image|carte|ci-contre|ci-dessus|ci-dessous|affiche|vue|logo|drapeau ci|à l’arrière-plan|au centre|au premier plan|portrait|statue ci)\b/i;

// Texte brut + liste des liens (position, libellé, gras) d'une ligne d'archive.
function parseEntry(raw) {
  let text = raw.replace(/<!--.*?-->/g, '').replace(/<ref[^>]*\/>|<ref[^>]*>.*?<\/ref>/g, '');
  if (/<(?!\/?(small|sup|sub|br|span|abbr|nowiki)\b)[a-z]/i.test(text) || /\[https?:|__|<math|\{\|/.test(text)) return null;
  text = removeFiles(text);
  text = text.replace(POSITIONAL, (match, plain) => (match.includes("''(") || ILLUSTRATION.test(plain ?? '') ? '' : match));
  text = expandTemplates(protectPipes(text));
  if (text === null) return null;
  text = text.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(small|sup|sub|span|abbr|nowiki)[^>]*>/gi, '');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  const links = [];
  let plain = '';
  let cursor = 0;
  const linkRe = /\[\[([^\]]*)\]\]/g;
  for (let match = linkRe.exec(text); match; match = linkRe.exec(text)) {
    plain += text.slice(cursor, match.index);
    const [target, ...labelParts] = match[1].split(PIPE);
    if (/^(catégorie|category|fichier|file|image|wikipédia|aide):/i.test(target)) return null;
    const label = (labelParts.length > 0 ? labelParts.join('|') : target.replace(/#.*$/, '')).trim();
    const before = text.slice(0, match.index);
    const bold = (before.match(/'''/g) ?? []).length % 2 === 1;
    links.push({ start: plain.length, label, bold });
    plain += label;
    cursor = match.index + match[0].length;
  }
  plain += text.slice(cursor);
  if (/[[\]{}|\u0003]/.test(plain.replace(/'''?/g, ''))) return null;

  // Retire les marques gras/italique en recalculant les positions.
  let clean = '';
  const map = [];
  for (let i = 0; i < plain.length; ) {
    if (plain.startsWith("'''", i)) { i += 3; continue; }
    if (plain.startsWith("''", i)) { i += 2; continue; }
    map[i] = clean.length;
    clean += plain[i];
    i += 1;
  }
  const fixed = links
    .map((l) => ({ ...l, start: map[l.start] ?? clean.length, label: l.label.replace(/'{2,}/g, '') }))
    .filter((l) => clean.startsWith(l.label, l.start));
  return { text: clean.replace(/\s+/g, ' ').trim(), links: fixed.map((l) => ({ ...l })), lead: clean.length - clean.trimStart().length };
}

// ---------- choix du trou ----------

const BAD_TIME = /(?<![\p{L}])(actuellement|à ce jour|récemment|nouvellement|prochainement|cette année|ce mois|aujourd’hui|aujourd'hui|de nos jours|en ce moment|désormais|dernier-né|le plus récent)(?![\p{L}])/iu;
const DETERMINERS = /^(le|la|les|un|une|des|du|de|d’|d'|l’|l'|son|sa|ses|leur|leurs|ce|cet|cette|ces|au|aux|en|dans|sur|par|pour|plus|autre|autres|même|mêmes|premier|première|dernier|dernière|deux|trois|quatre|cinq|ancien|ancienne|grand|grande|petit|petite|nouveau|nouvelle)\b/i;
const STOP_LABELS = new Set(['france', 'français', 'française', 'français', 'années', 'ans', 'siècle', 'monde', 'jour', 'jours', 'nom', 'mot', 'fois', 'pays', 'ville', 'même', 'premier', 'premiers', 'première', 'ensemble', 'fin', 'début']);
const MONTHS = /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)$/i;

function candidatesOf(entry) {
  const found = [];
  entry.links.forEach((link, index) => {
    const label = link.label;
    const words = label.split(' ').filter(Boolean);
    if (label.length < 3 || label.length > MAX_ANSWER || words.length > 4) return;
    if (STOP_LABELS.has(label.toLowerCase()) || MONTHS.test(label) || DETERMINERS.test(label)) return;
    if (/^\d{1,2}$/.test(label)) return;
    const startsUpper = /^[A-ZÀ-ÖØ-Þ0-9«"“(]/.test(label);
    if (!startsUpper && (words.length > 2 || label.length < 5)) return;
    let score = 1;
    if (startsUpper) score += 2;
    if (/\d/.test(label)) score += 1;
    if (words.length >= 2) score += 1;
    if (link.bold) score -= 3;
    score += (index / Math.max(entry.links.length, 1)) * 2;
    found.push({ link, score });
  });
  return found;
}

function makeQuestion(entry, id, rng) {
  if (entry.text.length < 40 || entry.text.length > MAX_SENTENCE) return null;
  if (BAD_TIME.test(entry.text)) return null;
  if (/ci-contre|ci-dessus|ci-dessous|\((?:photo|illustration|image|carte)\)/i.test(entry.text)) return null;
  if (!/[.!?»”)]$/.test(entry.text)) return null;

  const pool = candidatesOf(entry).filter(({ link }) => !link.bold || entry.links.every((l) => l.bold));
  if (pool.length === 0) return null;
  pool.sort((a, b) => b.score - a.score + (rng() - 0.5) * 1.5);
  for (const { link } of pool.slice(0, 3)) {
    const answer = link.label;
    const before = entry.text.slice(0, link.start);
    const after = entry.text.slice(link.start + answer.length);
    const key = normalizeText(answer);
    if (key.length < 3) continue;
    if (normalizeText(before + after).includes(key)) continue;
    const blanked = `${before}____${after}`.replace(/\s+/g, ' ').trim();
    if (blanked.split('____').length !== 2) continue;
    const text = `Quel mot ou quelle expression complète cette anecdote : « ${blanked} » ?`;
    return { id, text, answer, tags: detectTags(`${entry.text}`), source: '' };
  }
  return null;
}

// ---------- programme principal ----------

function rngFrom(seedValue) {
  let a = seedValue >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = rngFrom(seed);
const all = [];
const seenText = new Set();
let rawCount = 0;

for (let year = yearFrom; year <= yearTo; year += 1) {
  let wikitext;
  try {
    wikitext = await fetchYear(year);
  } catch (error) {
    console.error(`✗ ${year} : ${error.message}`);
    continue;
  }
  let kept = 0;
  const lines = wikitext.split('\n').filter((line) => /^\* /.test(line));
  for (const line of lines) {
    rawCount += 1;
    const idMatch = line.match(/<!--@ID_(\d+)-->/);
    if (!idMatch) continue;
    const entry = parseEntry(line.replace(/^\*\s*/, ''));
    if (!entry) continue;
    const question = makeQuestion(entry, `lsv-${idMatch[1]}`, rng);
    if (!question) continue;
    const key = normalizeText(question.text);
    if (seenText.has(key)) continue;
    seenText.add(key);
    question.source = `wikipedia:Le saviez-vous ?/Archives/${year}#ID_${idMatch[1]}`;
    all.push(question);
    kept += 1;
  }
  console.log(`${year} : ${lines.length} anecdotes, ${kept} questions`);
}

// Sélection : thèmes saisonniers (jusqu'à 80 chacun), puis au moins 40 questions par autre thème, puis tirage aléatoire jusqu'à la cible.
const shuffled = [...all].sort(() => rng() - 0.5);
const chosen = new Map();
const themes = [...new Set(all.flatMap((q) => q.tags))].filter((t) => t !== 'Insolite');
for (const theme of themes) {
  const quota = SEASONAL.includes(theme) ? 80 : 40;
  for (const q of shuffled.filter((x) => x.tags.includes(theme)).slice(0, quota)) chosen.set(q.id, q);
}
for (const q of shuffled) {
  if (chosen.size >= target) break;
  chosen.set(q.id, q);
}
const result = [...chosen.values()].sort((a, b) => a.id.localeCompare(b.id));

// Relecture manuelle : scripts/data/dyk-review.json = { remove: { id: raison }, tags: { id: [thèmes] } }.
const reviewFile = join(root, 'scripts', 'data', 'dyk-review.json');
const skipReview = args.includes('--no-review');
const review =
  !skipReview && existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, 'utf8')) : { remove: {}, tags: {}, reviewed: null };
// Si `reviewed` est fourni, seules les questions relues (et non écartées) sont conservées.
const reviewedIds = review.reviewed ? new Set(review.reviewed) : null;
const reviewed = result
  .filter((q) => !(q.id in review.remove) && (!reviewedIds || reviewedIds.has(q.id)))
  .map((q) => (review.tags[q.id] ? { ...q, tags: review.tags[q.id] } : q));
console.log(`Relecture : ${result.length - reviewed.length} questions écartées, ${Object.keys(review.tags).length} thèmes corrigés.`);

// Reformulation : scripts/data/dyk-rewrite.json = { id: { answer, text } }. Elle n'est appliquée que si la réponse
// importée n'a pas changé ; sinon la question garde son texte à trous et il faut la reformuler à nouveau.
const rewriteFile = join(root, 'scripts', 'data', 'dyk-rewrite.json');
const rewrites = existsSync(rewriteFile) ? JSON.parse(readFileSync(rewriteFile, 'utf8')) : {};
const stale = [];
const rewritten = reviewed.map((q) => {
  const rewrite = rewrites[q.id];
  if (rewrite?.answer === q.answer) return { ...q, text: rewrite.text };
  stale.push(q.id);
  return q;
});
console.log(`Reformulation : ${rewritten.length - stale.length} énoncés reformulés, ${stale.length} encore à trous.`);
if (stale.length > 0) console.log(`  À reformuler : ${stale.slice(0, 20).join(', ')}${stale.length > 20 ? '…' : ''}`);
result.length = 0;
result.push(...rewritten);

const problems = validateQuestions(result);
if (problems.length > 0) {
  console.error(problems.slice(0, 20).join('\n'));
  process.exit(1);
}

const counts = new Map();
for (const q of result) for (const tag of q.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', '));
console.log(`${rawCount} anecdotes lues, ${all.length} questions valides, ${result.length} retenues.`);
writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);
console.log(`Écrit : ${outFile}`);
