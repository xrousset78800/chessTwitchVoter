/**
 * Économie par compte Twitch (ticket #16) : XP / niveau et monnaie « pions ».
 *
 * - XP   : ne baisse jamais, donne le niveau. Mesure l'activité.
 * - Pions: se gagnent comme l'XP, se dépensent au magasin. Plafond quotidien sur les
 *          gains répétitifs (coups, puzzles) pour qu'une partie 24/24 laissée tourner
 *          ne remplisse pas la bourse à l'infini ; les gains « événements » (run, bataille,
 *          succès, bonus du jour) ne sont pas plafonnés.
 * Pas d'anti-triche (décision du ticket) : seulement pas de double comptage
 * (chaque gain qui a une clé n'est versé qu'une fois).
 *
 * Toutes les valeurs sont regroupées dans RULES : on règle l'équilibre ici uniquement.
 * Stockage : DATA_DIR/economy.json, { [login]: compte }.
 */
const path = require('path');

const RULES = {
    // Gains par source : xp et pions
    turn:        { xp: 2, coins: 1 },          // coup joué avec au moins un votant
    turnCrowd:   { xp: 1, per: 10, max: 5 },   // +1 xp par tranche de 10 votants, 5 max
    puzzleTurn:  { xp: 3, coins: 1 },          // tour de puzzle avec au moins un votant
    rushRun:     { xpPerPoint: 5, coinsPerPoint: 2 },
    rushRecord:  { xp: 100, coins: 50 },       // record personnel battu dans un mode
    multi:       { win: { xp: 60, coins: 30 }, draw: { xp: 30, coins: 15 }, loss: { xp: 15, coins: 5 } },
    achievement: { B: { xp: 50, coins: 25 }, A: { xp: 150, coins: 75 }, O: { xp: 400, coins: 200 }, P: { xp: 1000, coins: 500 }, S: { xp: 200, coins: 100 } },
    // Bonus de la première activité du jour, + par jour de série (plafonné)
    daily:       { coins: 50, streakBonus: 10, streakMax: 7 },
    // Pronostics sur les parties de tournoi (page /tournament) : coup deviné, série, vainqueur
    predict:     { move: { xp: 8, coins: 2 }, streak: { every: 5, xp: 25, coins: 10 }, winner: { xp: 25, coins: 10 }, winnerDraw: { xp: 40, coins: 20 }, oddsMin: 0.2, oddsMax: 2 },
    dailyCoinCap: 300,                         // pions max par jour venant des coups et puzzles
    // Niveau : passer du niveau n au niveau n+1 coûte base + step × (n − 1) XP
    level:       { base: 100, step: 50, max: 100 },
};

// Objets du magasin (page /shop). price null : jamais en vente, débloqué uniquement par un succès.
// Les ids sont ceux du client (window.unlockedRewards) : js/utils/pieceSet.js (pièces, couleurs,
// matières « mat-* ») et js/components/votePalettes.js (couleurs du tirage « pal-* »).
// Repères : un stream de ~2 h rapporte ~300 pions (coups plafonnés + bonus du jour + Rush).
//   commun 200–300 (≈ 1 stream), rare 400–600 (≈ 2 streams), épique 700–1500 (≈ 3 à 5 streams).
const CATALOG = {
    // Sets de pièces
    flat:   { kind: 'pieces', price: 300 },
    token:  { kind: 'pieces', price: 400 },
    neon:   { kind: 'pieces', price: 600 },
    ice:    { kind: 'pieces', price: 500 },
    ruby:   { kind: 'pieces', price: 500 },
    royal:  { kind: 'pieces', price: 800 },
    synth:  { kind: 'pieces', price: 900 },
    emerald:  { kind: 'pieces', price: 600 },
    obsidian: { kind: 'pieces', price: 700 },
    toxic:    { kind: 'pieces', price: 1000 },
    // Couleurs d'échiquier
    wood:   { kind: 'board', price: 200 },
    green:  { kind: 'board', price: 200 },
    blue:   { kind: 'board', price: 200 },
    orange: { kind: 'board', price: 300 },
    purple: { kind: 'board', price: 300 },
    rose:   { kind: 'board', price: 300 },
    mint:   { kind: 'board', price: 300 },
    sand:   { kind: 'board', price: 300 },
    forest: { kind: 'board', price: 400 },
    petrol: { kind: 'board', price: 400 },
    aurora: { kind: 'board', price: null },
    'board-ice': { kind: 'board', price: 250 },
    night:     { kind: 'board', price: 150 },
    black:     { kind: 'board', price: 150 },
    coral:     { kind: 'board', price: 250 },
    olive:     { kind: 'board', price: 250 },
    coffee:    { kind: 'board', price: 300 },
    bubblegum: { kind: 'board', price: 300 },
    cherry:    { kind: 'board', price: 400 },
    midnight:  { kind: 'board', price: 400 },
    gilded:    { kind: 'board', price: 600 },
    lagoon:    { kind: 'board', price: 250 },
    peach:     { kind: 'board', price: 250 },
    matcha:    { kind: 'board', price: 300 },
    steel:     { kind: 'board', price: 300 },
    wine:      { kind: 'board', price: 400 },
    abyss:     { kind: 'board', price: 450 },
    // Matières d'échiquier (texture posée sur les couleurs)
    'mat-paper':  { kind: 'mat', price: 500 },
    'mat-tile':   { kind: 'mat', price: 500 },
    'mat-felt':   { kind: 'mat', price: 700 },
    'mat-walnut': { kind: 'mat', price: 900 },
    'mat-lava':   { kind: 'mat', price: 1500 },
    'mat-mosaic': { kind: 'mat', price: 400 },
    'mat-frost':  { kind: 'mat', price: 800 },
    'mat-carbon': { kind: 'mat', price: 1000 },
    'mat-marble': { kind: 'mat', price: 1200 },
    'mat-linen':  { kind: 'mat', price: 450 },
    'mat-stone':  { kind: 'mat', price: 700 },
    // Couleurs du tirage (roue, bande, podium des votes)
    'pal-sunset':  { kind: 'palette', price: 300 },
    'pal-woods':   { kind: 'palette', price: 300 },
    'pal-candy':   { kind: 'palette', price: 300 },
    'pal-mono':    { kind: 'palette', price: 300 },
    'pal-rainbow': { kind: 'palette', price: 400 },
    'pal-gold':    { kind: 'palette', price: 600 },
    'pal-autumn':  { kind: 'palette', price: 300 },
    'pal-glacier': { kind: 'palette', price: 300 },
    'pal-retro':   { kind: 'palette', price: 400 },
    'pal-royal':   { kind: 'palette', price: 500 },
    'pal-synth':   { kind: 'palette', price: 700 },
    'pal-pastel':  { kind: 'palette', price: 300 },
    'pal-earth':   { kind: 'palette', price: 300 },
    'pal-neon':    { kind: 'palette', price: 500 },
    // Thèmes du site (fond et cartes de toutes les pages)
    'bg-graphite': { kind: 'theme', price: 200 },
    'bg-mocha': { kind: 'theme', price: 250 },
    'bg-forest': { kind: 'theme', price: 300 },
    'bg-petrol': { kind: 'theme', price: 300 },
    'bg-plum': { kind: 'theme', price: 350 },
    'bg-wine': { kind: 'theme', price: 350 },
    'bg-ink': { kind: 'theme', price: 400 },
    // Titres
    'title-touche-a-tout': { kind: 'title', price: null },
};

// Succes (registre partage avec le client) : stat + goal = debloque cote serveur, sinon par le client
const ACHIEVEMENTS = require('./js/core/achievements.json').list;
const ACH_BY_ID = new Map(ACHIEVEMENTS.map(d => [d.id, d]));
const CLIENT_ACH = new Set(ACHIEVEMENTS.filter(d => !d.stat && !d.requires).map(d => d.id));

const MAX_LOG = 50;          // derniers gains gardés (affichage « historique »)
const MAX_KEYS = 500;        // clés anti double comptage gardées par compte

/** XP totale nécessaire pour atteindre le niveau n (niveau 1 = 0 XP) */
function xpForLevel(n) {
    const { base, step } = RULES.level;
    const k = Math.max(0, n - 1);
    return base * k + step * k * (k - 1) / 2;
}

function levelInfo(xp) {
    let level = 1;
    while (level < RULES.level.max && xp >= xpForLevel(level + 1)) level++;
    const from = xpForLevel(level);
    const to = level < RULES.level.max ? xpForLevel(level + 1) : from;
    return { level, xp, levelXp: xp - from, nextXp: to - from, max: level >= RULES.level.max };
}

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);   // jour UTC
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

module.exports = function setupEconomy({ app, requireTwitch, dataDir, jsonStore }) {
    const store = jsonStore(path.join(dataDir, 'economy.json'), () => ({}));
    for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => store.flush());

    const account = (login) => store.data[login] ||= {
        login, xp: 0, coins: 0, earned: 0, spent: 0,
        owned: [], achievements: {},
        day: null, dayCoins: 0, streak: 0, lastDay: null,
        keys: [], log: [], stats: {},
    };
    const stats = (a) => a.stats ||= {};

    /** Debloque les succes atteints (compteurs, prerequis) ; retourne les ids nouveaux */
    function checkAchievements(login) {
        const a = account(login), st = stats(a), out = [];
        for (let again = true; again;) {
            again = false;
            for (const d of ACHIEVEMENTS) {
                if (a.achievements[d.id]) continue;
                const ok = d.stat ? (st[d.stat] || 0) >= d.goal
                    : d.requires ? d.requires.every(id => a.achievements[id]) : false;
                if (ok && onAchievement(login, d.id)) { out.push(d.id); again = true; }
            }
        }
        return out;
    }

    /**
     * Verse un gain. capped : compte dans le plafond quotidien de pions.
     * key : si fourni, le gain n'est versé qu'une seule fois pour cette clé.
     * Retourne { xp, coins, levelUp, daily } versés (0 si rien).
     */
    function grant(login, source, { xp = 0, coins = 0, capped = false, key = null } = {}) {
        if (!login) return null;
        const a = account(login);
        if (key) {
            if (a.keys.includes(key)) return { xp: 0, coins: 0, duplicate: true };
            a.keys.push(key);
            if (a.keys.length > MAX_KEYS) a.keys.splice(0, a.keys.length - MAX_KEYS);
        }
        const today = day();
        let daily = 0;
        if (a.day !== today) {
            // Première activité du jour : bonus et série
            a.streak = a.lastDay && dayDiff(a.lastDay, today) === 1 ? a.streak + 1 : 1;
            a.lastDay = today;
            a.day = today;
            a.dayCoins = 0;
            const d = RULES.daily;
            daily = d.coins + d.streakBonus * Math.min(a.streak - 1, d.streakMax);
        }
        if (capped) {
            coins = Math.max(0, Math.min(coins, RULES.dailyCoinCap - a.dayCoins));
            a.dayCoins += coins;
        }
        const before = levelInfo(a.xp).level;
        a.xp += xp;
        a.coins += coins + daily;
        a.earned += coins + daily;
        const levelUp = levelInfo(a.xp).level > before;
        if (xp || coins) a.log.push({ at: Date.now(), source, xp, coins });
        if (daily) a.log.push({ at: Date.now(), source: 'daily', xp: 0, coins: daily, streak: a.streak });
        if (a.log.length > MAX_LOG) a.log.splice(0, a.log.length - MAX_LOG);
        store.save();
        return { xp, coins, daily, levelUp };
    }

    // ---------- Sources (appelées par server.js / stats.js) ----------

    /** Coups comptés par /api/stats/votes : liste de { puzzle, voters } */
    function onTurns(login, turns) {
        let xp = 0, coins = 0;
        const st = stats(account(login));
        for (const t of turns) {
            st.turns = (st.turns || 0) + 1;
            st.votes = (st.votes || 0) + (t.voters || 0);
            st.maxVoters = Math.max(st.maxVoters || 0, t.voters || 0);
            const r = t.puzzle ? RULES.puzzleTurn : RULES.turn;
            xp += r.xp + Math.min(RULES.turnCrowd.max, Math.floor(t.voters / RULES.turnCrowd.per)) * RULES.turnCrowd.xp;
            coins += r.coins;
        }
        const gain = xp || coins ? grant(login, 'turns', { xp, coins, capped: true }) : null;
        const achievements = checkAchievements(login);
        return achievements.length ? { ...(gain || { xp: 0, coins: 0 }), achievements } : gain;
    }

    /** Fin de run Puzzle Rush */
    function onRushRun(login, { score, isNewRecord, mode, at }) {
        const r = RULES.rushRun;
        let xp = score * r.xpPerPoint, coins = score * r.coinsPerPoint;
        if (isNewRecord && score > 0) { xp += RULES.rushRecord.xp; coins += RULES.rushRecord.coins; }
        const gain = grant(login, 'rush', { xp, coins, key: `rush:${mode}:${at}` });
        if (gain?.duplicate) return gain;
        const st = stats(account(login));
        st.rushRuns = (st.rushRuns || 0) + 1;
        st.rushPuzzles = (st.rushPuzzles || 0) + score;
        st.rushBest = Math.max(st.rushBest || 0, score);
        const achievements = checkAchievements(login);
        return achievements.length ? { ...gain, achievements } : gain;
    }

    /** Résultat d'une bataille Multi (détecté par le serveur), pour les deux chaînes */
    function onMultiResult(entry) {
        for (const color of ['white', 'black']) {
            const res = entry.result === 'draw' ? 'draw' : entry.result === color ? 'win' : 'loss';
            grant(entry[color], 'multi', { ...RULES.multi[res], key: `multi:${entry.at}:${entry.white}:${entry.black}` });
        }
    }

    /** Succès débloqué (palier B/A/O/P/S et récompense lus dans le registre) */
    function onAchievement(login, id) {
        const def = ACH_BY_ID.get(id);
        if (!def) return null;
        const { tier, reward } = def;
        const a = account(login);
        if (a.achievements[id]) return null;
        a.achievements[id] = Date.now();
        if (reward && !a.owned.includes(reward)) a.owned.push(reward);
        return grant(login, 'achievement', { ...(RULES.achievement[tier] || RULES.achievement.B), key: `ach:${id}` });
    }

    function publicAccount(login) {
        const a = store.data[login];
        const xp = a?.xp || 0;
        return {
            login,
            ...levelInfo(xp),
            coins: a?.coins || 0,
            earned: a?.earned || 0,
            spent: a?.spent || 0,
            streak: a?.streak || 0,
            dayCoins: a?.day === day() ? a.dayCoins : 0,
            dailyCoinCap: RULES.dailyCoinCap,
            owned: a?.owned || [],
            achievements: a?.achievements || {},
            stats: a?.stats || {},
            log: (a?.log || []).slice(-20).reverse(),
        };
    }

    // ---------- API ----------

    app.get('/api/economy/rules', (req, res) => {
        res.json({ rules: RULES, catalog: CATALOG, levels: Array.from({ length: 20 }, (_, i) => xpForLevel(i + 1)) });
    });

    app.get('/api/economy/me', requireTwitch, (req, res) => res.json(publicAccount(req.twitch.login)));

    // Niveau public d'une chaîne (Records, Parcourir)
    app.get('/api/economy/level/:login', (req, res) => {
        const login = String(req.params.login).toLowerCase();
        const a = store.data[login];
        res.json({ login, ...levelInfo(a?.xp || 0) });
    });

    // Succès constatés par le navigateur (premiers pas, coups remarquables) : pas d'anti-triche, cf. ticket #16
    app.post('/api/achievements/unlock', requireTwitch, (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 60).map(String) : [];
        const login = req.twitch.login;
        const unlocked = ids.filter(id => CLIENT_ACH.has(id) && onAchievement(login, id));
        unlocked.push(...checkAchievements(login));
        res.json({ unlocked, account: publicAccount(login) });
    });

    app.post('/api/economy/buy', requireTwitch, (req, res) => {
        const id = String(req.body?.item || '');
        const item = Object.hasOwn(CATALOG, id) ? CATALOG[id] : null;
        if (!item) return res.status(404).json({ error: 'Objet inconnu' });
        if (item.price == null) return res.status(403).json({ error: 'Objet réservé aux succès' });
        const a = account(req.twitch.login);
        if (a.owned.includes(id)) return res.status(409).json({ error: 'Déjà possédé' });
        if (a.coins < item.price) return res.status(402).json({ error: 'Pas assez de pions', missing: item.price - a.coins });
        a.coins -= item.price;
        a.spent += item.price;
        a.owned.push(id);
        a.log.push({ at: Date.now(), source: 'buy', item: id, xp: 0, coins: -item.price });
        if (a.log.length > MAX_LOG) a.log.splice(0, a.log.length - MAX_LOG);
        store.save();
        res.json(publicAccount(a.login));
    });

    return { grant, checkAchievements, onTurns, onRushRun, onMultiResult, onAchievement, levelInfo, xpForLevel, publicAccount, RULES, CATALOG, store };
};
module.exports.RULES = RULES;
module.exports.levelInfo = levelInfo;
module.exports.xpForLevel = xpForLevel;
