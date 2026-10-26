// Importe des questions depuis Wikidata (données CC0) vers game/questions.wikidata.json.
// Usage : node scripts/import-wikidata.js [--only id1,id2] [--refresh] [--seed 1]
// Les réponses brutes de l'API sont mises en cache dans .cache/wikidata pour pouvoir relancer hors ligne.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestions } from '../game/questions.js';
import { normalizeText } from '../shared/text.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'wikidata');
const outFile = join(root, 'game', 'questions.wikidata.json');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'BlufferImport/0.1 (projet personnel de jeu de bluff)';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argValue('--only')?.split(',');
const refresh = args.includes('--refresh');
const seed = Number(argValue('--seed') ?? 1);

const MAX_ANSWER = 60;
const MAX_SUBJECT = 70;
const MAX_SAME_ANSWER_PER_TEMPLATE = 2;
const MAX_SAME_ANSWER_GLOBAL = 6;

// kind : 'entity' (libellé de ?v), 'literal' (texte ?v), 'year' (année ?v).
// pick : 'unique' (le sujet est écarté s'il a plusieurs valeurs distinctes) ou 'min' (valeur minimale, pour les années).
const T = (id, cap, minLinks, body, text, extra = {}) => ({ id, cap, minLinks, body, text, kind: 'entity', pick: 'unique', ...extra });

const TEMPLATES = [
  T('film-realisateur', 60, 45, '?x wdt:P31 wd:Q11424; wdt:P57 ?v.', (x) => `Qui a réalisé le film « ${x} » ?`),
  T('livre-auteur', 50, 40, '?x wdt:P31 wd:Q7725634; wdt:P50 ?v.', (x) => `Qui a écrit l’œuvre littéraire « ${x} » ?`),
  T('tableau-peintre', 45, 20, '?x wdt:P31 wd:Q3305213; wdt:P170 ?v.', (x) => `Qui a peint le tableau « ${x} » ?`),
  T('tableau-musee', 45, 20, '?x wdt:P31 wd:Q3305213; wdt:P195 ?v.', (x) => `Dans quel musée ou quelle collection est conservé le tableau « ${x} » ?`),
  T('musique-compositeur', 40, 25, '?x wdt:P31 wd:Q2188189; wdt:P86 ?v.', (x) => `Qui a composé l’œuvre musicale « ${x} » ?`),
  T('album-artiste', 40, 25, '?x wdt:P31 wd:Q482994; wdt:P175 ?v.', (x) => `Quel artiste ou groupe a sorti l’album « ${x} » ?`),
  T('chanson-interprete', 30, 25, '?x wdt:P31 wd:Q7366; wdt:P175 ?v.', (x) => `Qui a interprété à l’origine la chanson « ${x} » ?`),
  T('pays-capitale', 50, 0, '?x wdt:P31 wd:Q6256; wdt:P36 ?v.', (x) => `Quelle est la capitale du pays nommé « ${x} » ?`),
  T('pays-monnaie', 35, 0, '?x wdt:P31 wd:Q6256; wdt:P38 ?v.', (x) => `Quelle est la monnaie officielle du pays nommé « ${x} » ?`),
  T('pays-sommet', 35, 0, '?x wdt:P31 wd:Q6256; wdt:P610 ?v.', (x) => `Quel est le point culminant du pays nommé « ${x} » ?`),
  T('departement-prefecture', 40, 0, '?x wdt:P31 wd:Q6465; wdt:P36 ?v.', (x) => `Quelle est la préfecture du département français nommé « ${x} » ?`),
  T('etat-us-capitale', 30, 0, '?x wdt:P31 wd:Q35657; wdt:P36 ?v.', (x) => `Quelle est la capitale de l’État américain nommé « ${x} » ?`),
  T('ville-pays', 40, 40, '?x wdt:P31 wd:Q515; wdt:P17 ?v.', (x) => `Dans quel pays se trouve la ville nommée « ${x} » ?`),
  T('ile-pays', 30, 30, '?x wdt:P31 wd:Q23442; wdt:P17 ?v.', (x) => `À quel pays appartient l’île nommée « ${x} » ?`),
  T('lac-pays', 30, 30, '?x wdt:P31 wd:Q23397; wdt:P17 ?v.', (x) => `Dans quel pays se trouve le lac nommé « ${x} » ?`),
  T('montagne-pays', 30, 30, '?x wdt:P31 wd:Q8502; wdt:P17 ?v.', (x) => `Dans quel pays se trouve la montagne nommée « ${x} » ?`),
  T('fleuve-embouchure', 35, 25, '?x wdt:P31 wd:Q4022; wdt:P403 ?v.', (x) => `Dans quel cours d’eau, lac ou mer se jette le cours d’eau nommé « ${x} » ?`),
  T('aeroport-ville', 25, 25, '?x wdt:P31 wd:Q1248784; wdt:P931 ?v.', (x) => `Quelle ville dessert l’aéroport « ${x} » ?`),
  T('personne-nom-naissance', 50, 60, '?x wdt:P31 wd:Q5; wdt:P1477 ?v.', (x) => `Quel est le nom de naissance de « ${x} » ?`, { kind: 'literal' }),
  T(
    'film-annee',
    45,
    50,
    '?x wdt:P31 wd:Q11424; p:P577/psv:P577 ?n. ?n wikibase:timeValue ?d; wikibase:timePrecision ?p. FILTER(?p >= 9) BIND(STR(YEAR(?d)) AS ?v)',
    (x) => `En quelle année est sorti pour la première fois le film « ${x} » ?`,
    { kind: 'year', pick: 'min' },
  ),
  T(
    'universite-annee',
    30,
    30,
    '?x wdt:P31 wd:Q3918; p:P571/psv:P571 ?n. ?n wikibase:timeValue ?d; wikibase:timePrecision ?p. FILTER(?p >= 9) BIND(STR(YEAR(?d)) AS ?v)',
    (x) => `En quelle année a été fondée l’université « ${x} » ?`,
    { kind: 'year' },
  ),
  T('societe-fondateur', 40, 40, '?x wdt:P31 wd:Q4830453; wdt:P112 ?v.', (x) => `Qui a fondé l’entreprise « ${x} » ?`),
  T('societe-siege', 35, 50, '?x wdt:P31 wd:Q4830453; wdt:P159 ?v.', (x) => `Dans quelle ville se trouve le siège de l’entreprise « ${x} » ?`),
  T('architecte', 40, 50, '?x wdt:P84 ?v.', (x) => `Quel architecte a conçu « ${x} » ?`),
  T('decouvreur', 45, 50, '?x wdt:P61 ?v.', (x) => `Qui a découvert ou inventé « ${x} » ?`),
  T('jeu-studio', 35, 30, '?x wdt:P31 wd:Q7889; wdt:P178 ?v.', (x) => `Quel studio ou quelle entreprise a développé le jeu vidéo « ${x} » ?`),
  T('serie-createur', 25, 30, '?x wdt:P31 wd:Q5398426; wdt:P170 ?v.', (x) => `Qui a créé la série télévisée « ${x} » ?`),
  T('element-symbole', 25, 0, '?x wdt:P31 wd:Q11344; wdt:P246 ?v.', (x) => `Quel est le symbole chimique de l’élément « ${x} » ?`, { kind: 'literal' }),
];

// ---------- utilitaires ----------

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildQuery(template, limit) {
  const links = template.minLinks > 0 ? `?x wikibase:sitelinks ?s. FILTER(?s >= ${template.minLinks})` : 'OPTIONAL { ?x wikibase:sitelinks ?s. }';
  return `SELECT ?x ?xLabel ?v ?vLabel ?s WHERE { ${template.body} ${links} SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". } } ${template.order === false ? '' : 'ORDER BY DESC(?s)'} LIMIT ${limit}`;
}

async function sparql(query, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(75_000),
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} : ${(await response.text()).slice(0, 200)}`);
      return (await response.json()).results.bindings;
    } catch (error) {
      if (attempt === tries) throw error;
      await sleep(4000 * attempt);
    }
  }
  return [];
}

async function fetchRows(template) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${template.id}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const limit = template.cap * 12;
  const rows = await sparql(buildQuery(template, limit));
  writeFileSync(file, JSON.stringify(rows));
  await sleep(2000);
  return rows;
}

const isQid = (text) => /^Q\d+$/.test(text);
const labelOf = (binding, field) => binding?.[field]?.value?.trim() ?? '';

// Regroupe les lignes par sujet, écarte les sujets ambigus et construit les candidats.
function candidates(template, rows) {
  const bySubject = new Map();
  for (const row of rows) {
    const uri = row.x?.value ?? '';
    const qid = uri.slice(uri.lastIndexOf('/') + 1);
    const subject = labelOf(row, 'xLabel');
    const answer = template.kind === 'entity' ? labelOf(row, 'vLabel') : labelOf(row, 'v');
    if (!/^Q\d+$/.test(qid) || !subject || isQid(subject) || !answer || isQid(answer)) continue;
    const entry = bySubject.get(qid) ?? { qid, subject, answers: new Set(), links: Number(row.s?.value ?? 0) };
    entry.answers.add(answer);
    bySubject.set(qid, entry);
  }

  const labelCount = new Map();
  for (const entry of bySubject.values()) labelCount.set(normalizeText(entry.subject), (labelCount.get(normalizeText(entry.subject)) ?? 0) + 1);

  const list = [];
  for (const entry of bySubject.values()) {
    let answer;
    if (template.pick === 'min') answer = [...entry.answers].sort((a, b) => Number(a) - Number(b))[0];
    else if (entry.answers.size === 1) [answer] = entry.answers;
    else continue;

    const subject = entry.subject;
    if (labelCount.get(normalizeText(subject)) > 1) continue;
    if (subject.length > MAX_SUBJECT || answer.length > MAX_ANSWER) continue;
    if (/[^\p{L}\p{N}\s'’.,:;!?&()«»"°\-–/+]/u.test(subject + answer)) continue;
    if (template.kind === 'year' && !/^\d{3,4}$/.test(answer)) continue;
    const a = normalizeText(answer);
    const s = normalizeText(subject);
    if (a === '' || a === s || s.includes(a) || a.includes(s)) continue;
    list.push({ id: `wd-${template.id}-${entry.qid}`, text: template.text(subject), answer, links: entry.links, source: `wikidata:${entry.qid}` });
  }
  return list;
}

function pick(template, list, rng, globalAnswers) {
  const top = [...list].sort((a, b) => b.links - a.links).slice(0, template.cap * 3);
  for (let i = top.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [top[i], top[j]] = [top[j], top[i]];
  }
  const chosen = [];
  const local = new Map();
  for (const item of top) {
    if (chosen.length >= template.cap) break;
    const key = normalizeText(item.answer);
    if ((local.get(key) ?? 0) >= MAX_SAME_ANSWER_PER_TEMPLATE) continue;
    if ((globalAnswers.get(key) ?? 0) >= MAX_SAME_ANSWER_GLOBAL) continue;
    local.set(key, (local.get(key) ?? 0) + 1);
    globalAnswers.set(key, (globalAnswers.get(key) ?? 0) + 1);
    chosen.push(item);
  }
  return chosen;
}

// ---------- programme principal ----------

const rng = rngFrom(seed);
const globalAnswers = new Map();
const result = [];
const seenText = new Set();

for (const template of TEMPLATES) {
  if (only && !only.includes(template.id)) continue;
  let rows;
  try {
    rows = await fetchRows(template);
  } catch (error) {
    console.error(`✗ ${template.id} : ${error.message}`);
    continue;
  }
  const list = candidates(template, rows);
  const chosen = pick(template, list, rng, globalAnswers).filter((q) => {
    const key = q.text.toLowerCase();
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });
  console.log(`${chosen.length >= template.cap ? '✓' : '·'} ${template.id.padEnd(24)} ${String(chosen.length).padStart(3)}/${template.cap}  (${rows.length} lignes, ${list.length} candidats)`);
  for (const { links, ...question } of chosen) result.push({ ...question, tags: ['Classique'] });
}

const problems = validateQuestions(result);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

if (only) {
  console.log(`${result.length} questions (mode --only : fichier non écrit).`);
} else {
  writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${result.length} questions écrites dans ${outFile}`);
}
