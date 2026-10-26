// Détection des thèmes d'une question par mots-clés (texte + réponse, sans accents ni majuscules).
const strip = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’']/g, ' ');

// Un mot-clé court (≤ 4 lettres) doit être un mot entier ; sinon on accepte un début de mot (pluriels, dérivés).
function buildMatcher(words) {
  const parts = words.map((w) => {
    const base = strip(w).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return base.length <= 4 ? `${base}\\b` : base;
  });
  return new RegExp(`\\b(?:${parts.join('|')})`);
}

// Thèmes saisonniers : uniquement des mots sans ambiguïté.
const SEASONAL_RULES = {
  Halloween: ['halloween', 'citrouille', 'vampire', 'zombie', 'momie', 'loup-garou', 'frankenstein', 'dracula', 'revenant', 'sabbat', 'toussaint', 'epouvante', 'hante', 'fantome', 'cimetiere', 'catacombe', 'ossuaire', 'sorciere', 'sorcier', 'squelette', 'cauchemar', 'macabre'],
  'Noël': ['noel', 'sapin de', 'reveillon', 'creche', 'avent', 'buche de', 'traineau', 'houx', 'epiphanie', 'galette des rois', 'saint nicolas', 'pere fouettard', 'rennes du'],
  'Pâques': ['paques', 'cloches de', 'resurrection', 'careme', 'semaine sainte', 'vendredi saint', 'agneau pascal', 'oeufs de'],
};

export const THEME_RULES = {
  Histoire: ['guerre', 'roi ', 'rois', 'empereur', 'revolution', 'siecle', 'napoleon', 'bataille', 'empire', 'moyen age', 'antiquite', 'romain', 'medieval', 'dynastie', 'croisade', 'reine', 'seigneur', 'chateau', 'armee', 'republique', 'colonie', 'colonial', 'conquete', 'monarchie', 'royaume', 'prehistoire', 'ancien regime', 'resistance', 'occupation', 'explorateur', 'pharaon', 'gaulois', 'vikings', 'trone', 'couronne'],
  Animaux: ['animal', 'oiseau', 'chien', 'chat ', 'chats', 'cheval', 'chevaux', 'poisson', 'insecte', 'espece', 'mammifere', 'requin', 'singe', 'elephant', 'abeille', 'serpent', 'loup', 'ours', 'baleine', 'dauphin', 'grenouille', 'araignee', 'papillon', 'vache', 'mouton', 'cochon', 'rat ', 'souris', 'ane ', 'fourmi', 'escargot', 'tortue', 'crocodile', 'lion', 'tigre', 'girafe', 'pingouin', 'manchot', 'canard', 'cygne', 'hibou', 'chouette', 'aigle', 'perroquet', 'crabe', 'pieuvre', 'meduse', 'koala', 'kangourou', 'lezard', 'moustique', 'mouche', 'scarabee', 'zoo', 'faune', 'poulpe', 'phoque', 'morse', 'loutre', 'castor', 'herisson', 'renard', 'cerf', 'sanglier', 'corbeau', 'pigeon', 'moineau', 'bovin', 'felin', 'rongeur', 'reptile', 'crustace', 'dinosaure'],
  Sciences: ['scientifique', 'physique', 'chimie', 'astronome', 'asteroide', 'planete', 'etoile', 'cellule', 'molecule', 'atome', 'fossile', 'mathematique', 'theoreme', 'mineral', 'laboratoire', 'vaccin', 'cerveau', 'bacterie', 'virus', 'lune', 'satellite', 'comete', 'galaxie', 'astronaute', 'fusee', 'nasa', 'spatial', 'espace', 'geologie', 'biologie', 'genetique', 'particule', 'gravite', 'telescope', 'prix nobel', 'element chimique', 'isotope', 'paleontolog', 'botanique', 'zoologie', 'cristal', 'meteorite', 'sonde'],
  'Cinéma et TV': ['film', 'cinema', 'acteur', 'actrice', 'realisateur', 'serie televisee', 'telefilm', 'oscar', 'hollywood', 'dessin anime', 'disney', 'pixar', 'television', 'emission', 'documentaire', 'sitcom', 'scenariste', 'festival de cannes', 'tournage', 'star wars', 'james bond'],
  Musique: ['chanson', 'album', 'compositeur', 'opera', 'musicien', 'symphonie', 'concert', 'chanteur', 'chanteuse', 'orchestre', 'rock', 'jazz', 'guitare', 'piano', 'violon', 'eurovision', 'hymne', 'musique', 'melodie', 'clavecin', 'trompette', 'saxophone', 'rappeur', 'comedie musicale', 'violoncelle', 'harpe', 'requiem'],
  Sport: ['football', 'rugby', 'tennis', 'cyclisme', 'tour de france', 'jeux olympiques', 'olympique', 'marathon', 'champion', 'ballon', 'coupe du monde', 'basket', 'golf', 'gymnastique', 'athlete', 'footballeur', 'sportif', 'natation', 'ski', 'handball', 'boxe', 'escrime', 'judo', 'cycliste', 'stade', 'tournoi', 'medaille', 'record du monde', 'echecs', 'equitation', 'surf', 'alpinisme', 'hockey', 'baseball', 'petanque'],
  Automobile: ['voiture', 'automobile', 'moto', 'camion', 'formule 1', 'grand prix', 'rallye', 'constructeur', 'peugeot', 'renault', 'citroen', 'ferrari', 'porsche', 'bmw', 'ford', 'mercedes', 'pneu', 'panneau de signalisation', 'permis de conduire', 'autoroute', 'vehicule', 'conducteur', 'circulation routiere', 'code de la route', 'carrosserie', 'tesla', 'fiat', 'volkswagen', 'bugatti', '2cv', 'feu rouge', 'signalisation routiere', 'peage', 'ceinture de securite', '24 heures du mans', 'pilote de course', 'pilote de formule'],
  Transports: ['train', 'avion', 'aeroport', 'gare', 'metro', 'bateau', 'navire', 'paquebot', 'tramway', 'aviation', 'ferroviaire', 'sncf', 'tgv', 'helicoptere', 'montgolfiere', 'dirigeable', 'tunnel sous', 'velo', 'bicyclette', 'sous-marin', 'transatlantique', 'pilote'],
  Gastronomie: ['fromage', 'vin ', 'vins', 'biere', 'cuisine', 'recette', 'gateau', 'chocolat', 'pain', 'legume', 'fruit', 'boisson', 'cafe', 'restaurant', 'dessert', 'soupe', 'pates', 'pizza', 'sucre', 'epice', 'viande', 'bonbon', 'confiserie', 'patisserie', 'biscuit', 'salade', 'sauce', 'champagne', 'whisky', 'cidre', 'cocktail', 'moutarde', 'miel', 'yaourt', 'beurre', 'sandwich', 'hamburger', 'frites', 'michelin', 'aliment', 'nourriture', 'manger', 'saveur'],
  'Géographie': ['pays', 'ville', 'ile ', 'iles', 'fleuve', 'montagne', 'capitale', 'village', 'commune', 'region', 'desert', 'ocean', 'lac ', 'frontiere', 'departement', 'continent', 'volcan', 'archipel', 'peninsule', 'province', 'territoire', 'plage', 'riviere', 'detroit', 'vallee', 'falaise', 'grotte', 'canyon', 'sommet', 'altitude'],
  'Littérature': ['roman', 'ecrivain', 'livre', 'poete', 'poeme', 'auteur', 'bande dessinee', 'herge', 'theatre', 'conte', 'litterature', 'romancier', 'tintin', 'asterix', 'manga', 'dramaturge', 'bibliotheque', 'poesie', 'recueil', 'prix goncourt', 'victor hugo', 'moliere', 'fable', 'biographie', 'autobiograph'],
  Art: ['peintre', 'tableau', 'sculpture', 'sculpteur', 'musee', 'artiste', 'peinture', 'architecture', 'architecte', 'cathedrale', 'exposition', 'fresque', 'gravure', 'photographe', 'photographie', 'monument', 'statue', 'palais', 'eglise', 'chapelle', 'abbaye', 'louvre', 'impressionnis', 'mosaique', 'vitrail', 'tapisserie', 'ceramique'],
  Technologie: ['ordinateur', 'internet', 'informatique', 'logiciel', 'jeu video', 'telephone', 'robot', 'application', 'site web', 'smartphone', 'electrique', 'brevet', 'invention', 'inventeur', 'machine', 'numerique', 'ecran', 'radio', 'camera', 'ampoule', 'batterie', 'ingenieur', 'nintendo', 'playstation', 'console', 'algorithme', 'google', 'apple', 'microsoft', 'electronique', 'laser'],
  'Personnage célèbre': ['president', 'chanteur', 'chanteuse', 'acteur', 'actrice', 'ecrivain', 'peintre', 'celebre', 'empereur', 'footballeur', 'pilote', 'compositeur', 'inventeur', 'astronaute', 'explorateur', 'general', 'pape', 'philosophe', 'prince', 'princesse', 'reine', 'roi ', 'duchesse', 'ministre', 'premier ministre', 'maire', 'sculpteur', 'architecte', 'realisateur', 'humoriste', 'journaliste', 'presentateur', 'dictateur', 'espion', 'pirate', 'bandit', 'criminel'],
  Politique: ['president', 'ministre', 'election', 'assemblee', 'gouvernement', 'parlement', 'senat', 'depute', 'senateur', 'tribunal', 'prefet', 'constitution', 'referendum', 'candidat', 'maire', 'justice', 'police', 'gendarmerie', 'prison', 'proces', 'impot', 'taxe', 'diplomat', 'ambassade', 'union europeenne'],
  'Religion et mythes': ['dieu', 'eglise', 'mythe', 'saint ', 'sainte', 'pape', 'bible', 'religion', 'temple', 'monastere', 'moine', 'mosquee', 'synagogue', 'pretre', 'eveque', 'cardinal', 'mythologie', 'legende', 'paradis', 'deesse', 'pelerinage', 'abbe', 'culte', 'bouddh', 'hindou', 'islam', 'christianisme', 'esoter', 'superstition'],
  Nature: ['foret', 'arbre', 'plante', 'fleur', 'champignon', 'climat', 'jardin', 'meteo', 'orage', 'tempete', 'seisme', 'tremblement de terre', 'glacier', 'ecolog', 'environnement', 'pollution', 'recif', 'corail', 'algue', 'orchidee', 'chene', 'palmier', 'bambou', 'cactus', 'foudre'],
  'Langue et mots': ['mot ', 'mots', 'langue', 'etymolog', 'dictionnaire', 'expression', 'proverbe', 'alphabet', 'orthographe', 'grammaire', 'prononc', 'surnom', 'sobriquet', 'verbe', 'lettre', 'vocabulaire', 'traduction', 'nom de famille', 'prenom', 'toponym', 'devise', 'slogan', 'acronyme', 'sigle', 'dialecte', 'patois'],
  'Santé': ['medecin', 'maladie', 'hopital', 'sante', 'corps humain', 'coeur', 'sang', 'chirurgi', 'epidemie', 'pandemie', 'medicament', 'cancer', 'douleur', 'dent', 'sommeil', 'regime', 'obesite', 'infirmi', 'pharmac', 'peste', 'cholera', 'grippe', 'tuberculose', 'anatomie', 'poumon', 'peau'],
};

const SEASONAL = Object.entries(SEASONAL_RULES).map(([name, words]) => [name, buildMatcher(words)]);
const THEMATIC = Object.entries(THEME_RULES).map(([name, words]) => [name, buildMatcher(words)]);

export const ALL_THEMES = ['Insolite', ...Object.keys(SEASONAL_RULES), ...Object.keys(THEME_RULES)];

// « Insolite » + les thèmes saisonniers trouvés + au plus `max` thèmes thématiques (dans l'ordre des règles).
export function detectTags(text, max = 3) {
  const haystack = ` ${strip(text)} `;
  const seasonal = SEASONAL.filter(([, matcher]) => matcher.test(haystack)).map(([name]) => name);
  const thematic = THEMATIC.filter(([, matcher]) => matcher.test(haystack)).map(([name]) => name);
  return ['Insolite', ...seasonal, ...thematic.slice(0, max)];
}
