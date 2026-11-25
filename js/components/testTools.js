/**
 * Bots Stockfish : faux viewers qui votent dans la partie.
 * - Tous les streamers (une chaîne choisie) : partie, problèmes, Mono (panneau flottant, une fois la partie lancée).
 * - Régie en plus (tests) : rush, Multi, adversaire fictif, bavardage, pseudos variés.
 *
 * - Bots : faux viewers ajoutés un par un, chacun avec un niveau (300 à 2400+). Leurs coups sont ceux de
 *   Stockfish (vendor/stockfish, dans un Worker) bridé à ce niveau. Ils parlent dans un chat fictif,
 *   injecté dans cette page seulement (rien ne part sur Twitch) : inscription (join), votes dans la langue
 *   du chat, un peu de bavardage. Chacun vote une fois par tour, à un moment aléatoire du chrono.
 *   Leurs logins commencent par sim_ : ils ne comptent pas dans les stats viewers.
 * - Adversaire fictif : une chaîne sim_adversaire rejoint le salon Multi et joue les Noirs
 *   (Stockfish au niveau choisi, côté serveur). La purge de sim.js retire ses batailles des stats.
 *
 * Le serveur décide qui a droit aux extras de la régie (logins de la régie, H24_REGIE).
 */
import twitch from '../managers/twitch.js';
import twitchAuth from '../core/twitchAuth.js';
import lobby from '../core/lobby.js';
import voting from '../core/voting.js';
import gameEngine from '../core/gameEngine.js';

const NAMES = ['Pixel', 'Lynx', 'Kappa', 'Fourchette', 'Roquette', 'Zugzwang', 'Pionnier', 'Blitzou',
    'Gambito', 'Matou', 'Cavalier', 'Tourelle', 'Fianchetto', 'Dameblanche', 'Patator', 'Echecsou',
    'Nimzo', 'Sicilia', 'Caro', 'Grunfeld'];
const CHATTER = ['gg', 'pog', 'allez !', 'bien joué', 'hmm', 'non pas ça', 'KEKW', 'on gagne ça', 'fourchette ?', 'easy'];
const TICK_MS = 400;
const MAX_BOTS = 30;
// Remplissage rapide : un mélange de niveaux
const MIX = [1320, 1500, 900, 1800, 600, 2100, 1500, 300, 1320, 2400];
// Seulement une fois la partie lancée (page game : partie libre, problèmes, rush, Mono), pas sur les
// écrans de lancement. Pour tous les streamers, pas de rush (records de chaîne) ni de Multi (bataille
// contre un vrai streamer) : réservés aux tests de la régie.
const PAGES = new Set(['game']);
const PUBLIC_PAGES = new Set(['game']);
const COLLAPSED_KEY = 'sfBotsCollapsed';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const levels = () => window.BotEngine?.LEVELS || [300, 600, 900, 1320, 1500, 1800, 2100, 2400];
const label = (elo) => window.BotEngine?.levelLabel(elo) || String(elo);
const option = (elo) => window.BotEngine?.levelOption(elo) || label(elo);
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TestTools = {
    allowed: null,       // null : pas encore demandé au serveur
    checking: false,
    checkedFor: null,
    level: 1500,
    bots: [],            // { login, name, id, elo, joinAt, joined }
    plans: new Map(),    // login → { key, at, done }
    turnKey: null,
    engine: null,
    canBot: false,
    botAsked: false,
    collapsed: readCollapsed(),
    el: null,

    init() {
        window.addEventListener('multiRoomState', (e) => {
            this.canBot = !!e.detail?.canBot;
            if (!this.canBot) this.botAsked = false;
            this.render();
        });
        setInterval(() => this.tick(), TICK_MS);
    },

    /** Page où ces outils servent : une page de jeu, un salon Multi, ou une partie avec inscriptions */
    relevant() {
        const route = location.hash.startsWith('#/') ? location.hash : '#' + location.pathname + location.search;
        const page = window.AppState?.currentPage;
        if (!this.allowed) {
            // Tout le monde : partie, problèmes, Mono (pas de rush ni de Multi)
            if (route.startsWith('#/multi/') || window.AppState?.gameMode === 'rush') return false;
            return PUBLIC_PAGES.has(page) || lobby.active;
        }
        return route.startsWith('#/multi/') || PAGES.has(page) || lobby.active;
    },

    /** Une chaîne où parler : connecté à Twitch ou chaîne choisie */
    available() {
        return !!(twitchAuth.user?.login || twitch.channel);
    },

    check() {
        const login = twitchAuth.user?.login;
        if (!login || this.checking || this.checkedFor === login || typeof window.io !== 'function') return;
        this.checking = true;
        const socket = window.io({ transports: ['websocket', 'polling'] });
        socket.timeout(8000).emit('tester:check', { token: twitchAuth.token }, (err, ok) => {
            socket.disconnect();
            this.checking = false;
            this.checkedFor = login;
            this.allowed = !err && ok === true;
            this.render();
        });
    },

    tick() {
        const relevant = this.relevant();
        if (relevant && (this.allowed === null || this.checkedFor !== twitchAuth.user?.login)) this.check();
        const available = this.available();
        if (!relevant || !available) {
            if (this.el) this.el.hidden = true;
            return;
        }
        this.render();
        if (this.bots.length) this.play();
    },

    // ---------- Moteur (Stockfish dans un Worker, lancé au premier bot) ----------

    getEngine() {
        if (!this.engine) this.engine = window.BotEngine?.browserEngine() || null;
        return this.engine;
    },

    // ---------- Bots ----------

    addBot(elo = this.level) {
        if (this.bots.length >= MAX_BOTS) return;
        const used = new Set(this.bots.map(b => b.login));
        const level = window.BotEngine?.snapLevel(elo) ?? elo;
        // Régie : des pseudos variés ; sinon « Stockfish1500 », « Stockfish1500b »…
        let name;
        if (this.allowed) {
            do { name = pick(NAMES) + (rand(3) ? rand(99) : ''); } while (used.has(`sim_${name.toLowerCase()}`));
        } else {
            let i = 0;
            do { name = `Stockfish${level}${i ? String.fromCharCode(97 + i) : ''}`; i++; } while (used.has(`sim_${name.toLowerCase()}`));
        }
        this.bots.push({
            login: `sim_${name.toLowerCase()}`, name: this.allowed ? `Sim_${name}` : name, id: `sim-${Date.now()}-${rand(1e6)}`,
            elo: level, joinAt: Date.now() + 300 + rand(lobby.active ? 6000 : 1000)
        });
        this.getEngine();
        this.render(true);
    },

    fill(n = 8) {
        for (let i = 0; i < n; i++) this.addBot(MIX[(this.bots.length) % MIX.length]);
    },

    removeBot(login) {
        this.bots = this.bots.filter(b => b.login !== login);
        this.plans.delete(login);
        this.render(true);
    },

    clear() {
        this.bots = [];
        this.plans.clear();
        this.render(true);
    },

    say(bot, message) {
        const channel = (twitchAuth.user?.login || twitch.channel || '').toLowerCase();
        if (!channel) return;
        twitch.handleMessage('#' + channel, {
            username: bot.login,
            'display-name': bot.name,
            'user-id': bot.id,
            badges: {},
            subscriber: true,   // passe aussi les filtres abonnés / followers
            mod: false
        }, message);
    },

    /**
     * Position où les viewers votent maintenant, ou null.
     * Problèmes / rush : l'échiquier du puzzle, quand c'est au joueur ; sinon la partie, vote ouvert.
     */
    situation() {
        const pm = window.problemsManager;
        const mode = window.AppState?.gameMode;
        if ((mode === 'problems' || mode === 'rush') && pm?.isActive) {
            if (!pm.chess || !pm.votingOpen || pm.attemptIndex % 2 !== 1) return null;
            return { chess: pm.chess, key: `p:${pm.currentProblem?.id || ''}:${pm.attemptIndex}:${pm.chess.fen()}`, instant: false };
        }
        const chess = gameEngine.chess;
        if (!chess || !gameEngine.isRunning || chess.game_over()) return null;
        const instant = !gameEngine.config?.timerEnabled;
        if (!voting.isOpen && !instant) return null;
        return { chess, key: chess.fen(), instant };
    },

    play() {
        const now = Date.now();
        // Inscriptions, étalées dans le temps (aussi pendant la partie : inscription tardive)
        if (lobby.active) {
            for (const b of this.bots) {
                if (!b.joined && now >= b.joinAt && !lobby.players.has(b.login) && !lobby.kicked.has(b.login)) {
                    b.joined = true;
                    this.say(b, Math.random() < 0.5 ? '!join' : 'join');
                }
            }
        }
        // Un peu de bavardage (régie : test du chat)
        if (this.allowed && Math.random() < 0.015) this.say(pick(this.bots), pick(CHATTER));

        const sit = this.situation();
        if (!sit) return;
        const turn = sit.chess.turn();
        // Moment du vote de chaque bot : au hasard dans le chrono (sans chrono : dans les secondes qui suivent)
        const t = window.timer;
        const left = !sit.instant && t?.isRunning && t.remaining > 0 ? t.remaining * 1000 : 6000;
        for (const b of this.bots) {
            let plan = this.plans.get(b.login);
            if (!plan || plan.key !== sit.key) {
                plan = { key: sit.key, at: now + 700 + Math.random() * Math.max(800, left * 0.75 - 700), done: false };
                this.plans.set(b.login, plan);
            }
            if (plan.done || now < plan.at) continue;
            if (lobby.active && !lobby.canVote(b.login, turn)) continue;
            plan.done = true;
            this.vote(b, sit);
        }
    },

    async vote(bot, sit) {
        const fen = sit.chess.fen();
        const BE = window.BotEngine;
        const engine = this.getEngine();
        let san = null;
        try {
            const legal = BE.legalUci(sit.chess);
            const uci = engine ? await engine.botMove(fen, bot.elo, legal) : pick(legal);
            const now = this.situation();
            // Le tour a changé pendant la réflexion : vote perdu
            if (!now || now.key !== sit.key || !this.bots.includes(bot)) return;
            san = BE.uciToSan(now.chess, uci);
        } catch (e) {
            console.warn('🧪 bot :', e);
        }
        if (!san) return;
        // Dans la langue du chat (Cf3 en français), parfois en minuscules
        const text = window.Notation?.local ? window.Notation.local(san) : san;
        this.say(bot, Math.random() < 0.2 ? text.toLowerCase() : text);
    },

    // ---------- Panneau ----------

    /** Boutons du panneau flottant */
    bind(el) {
        el.addEventListener('click', (e) => {
            const a = e.target.closest('[data-test-action]');
            if (!a) return;
            const action = a.dataset.testAction;
            if (action === 'add') this.addBot(this.level);
            if (action === 'fill') this.fill(8);
            if (action === 'clear') this.clear();
            if (action === 'remove') this.removeBot(a.dataset.login);
            if (action === 'bot') this.callBot();
            if (action === 'toggle') {
                this.collapsed = !this.collapsed;
                try { localStorage.setItem(COLLAPSED_KEY, this.collapsed ? '1' : '0'); } catch { /* stockage indisponible */ }
                this.render(true);
            }
        });
        el.addEventListener('change', (e) => {
            if (e.target.matches('[data-test-level]')) this.level = Number(e.target.value) || 1500;
        });
    },

    render(force = false) {
        if (!this.available()) return;
        if (!this.el) {
            this.el = document.createElement('div');
            this.el.className = 'test-tools';
            this.bind(this.el);
            document.body.appendChild(this.el);
            force = true;
        }
        this.el.hidden = !this.relevant();
        const joined = this.bots.filter(b => lobby.players.has(b.login)).length;
        const sig = [this.bots.map(b => b.login).join(), this.canBot, this.botAsked, joined, lobby.active, this.allowed, this.collapsed].join('|');
        if (!force && sig === this.sig) return;
        this.sig = sig;
        this.el.classList.toggle('is-collapsed', !!this.collapsed);
        this.el.innerHTML = this.html(this.allowed ? '🧪 Test (régie)' : '🤖 Bots Stockfish', true);
    },

    html(title, live) {
        const joined = this.bots.filter(b => lobby.players.has(b.login)).length;
        // Panneau flottant repliable (il ne gêne pas le stream)
        const head = live
            ? `<button type="button" class="test-tools__title test-tools__toggle" data-test-action="toggle" title="${this.collapsed ? 'Déplier' : 'Replier'}">${title}${this.bots.length ? ` (${this.bots.length})` : ''} <span>${this.collapsed ? '▸' : '▾'}</span></button>`
            : `<div class="test-tools__title">${title}</div>`;
        if (live && this.collapsed) return head;
        return `
            ${head}
            <div class="test-tools__row">
                <select data-test-level title="Niveau du bot (Stockfish)">
                    ${levels().map(v => `<option value="${v}"${v === this.level ? ' selected' : ''}>${option(v)}</option>`).join('')}
                </select>
                <button type="button" class="btn btn--sm btn--secondary" data-test-action="add" title="Ajouter un bot de ce niveau"${this.bots.length >= MAX_BOTS ? ' disabled' : ''}>+ Bot</button>
                <button type="button" class="btn btn--sm btn--ghost" data-test-action="fill" title="Ajouter 8 bots de niveaux variés"${this.bots.length >= MAX_BOTS ? ' disabled' : ''}>+8</button>
            </div>
            ${this.bots.length ? `<div class="test-tools__bots">${this.bots.map(b =>
                `<span class="test-tools__bot">${this.allowed ? `${esc(b.name.replace(/^Sim_/, ''))} · ${label(b.elo)}` : esc(b.name)}<button type="button" data-test-action="remove" data-login="${esc(b.login)}" title="Retirer ce bot">×</button></span>`).join('')}</div>
            <div class="test-tools__row">
                <button type="button" class="btn btn--sm btn--danger" data-test-action="clear">Retirer les bots</button>
            </div>
            <div class="test-tools__info">${live && lobby.active ? `${joined}/${this.bots.length} inscrits · ` : ''}chacun vote une fois par tour (Stockfish à son niveau)</div>` : (live ? '' : '<div class="test-tools__info">Faux viewers joués par Stockfish : ils votent dans la partie que tu lances.</div>')}
            ${live && this.canBot && this.allowed ? `<div class="test-tools__row">
                <button type="button" class="btn btn--sm btn--secondary" data-test-action="bot"${this.botAsked ? ' disabled' : ''}>
                    ${this.botAsked ? 'Adversaire en route…' : `Adversaire fictif (Noirs, ${label(this.level)})`}
                </button>
            </div>` : ''}`;
    },

    callBot() {
        const socket = window.multiplayerManager?.socket;
        if (!socket || this.botAsked) return;
        this.botAsked = true;
        socket.emit('multi:testBot', { token: twitchAuth.token, elo: this.level });
        this.render(true);
    }
};

TestTools.init();
window.TestTools = TestTools;
export default TestTools;
