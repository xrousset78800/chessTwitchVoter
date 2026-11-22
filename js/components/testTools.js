/**
 * Outils de test de la régie (Mono, Multi) : jamais visibles des autres streamers.
 *
 * - Faux viewers : des messages de chat fictifs, injectés dans cette page seulement
 *   (rien ne part sur Twitch). Ils s'inscrivent (join), puis votent quand leur camp a le trait.
 *   Leurs logins commencent par sim_ : ils ne comptent pas dans les stats viewers.
 * - Adversaire fictif : une chaîne sim_adversaire rejoint le salon Multi et joue les Noirs
 *   (coups choisis par le serveur). La purge de sim.js retire ses batailles des stats.
 *
 * Le serveur décide qui y a droit (logins de la régie, H24_REGIE) : la page ne fait qu'afficher.
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
const TICK_MS = 600;
const PIECE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

const TestTools = {
    allowed: null,       // null : pas encore demandé au serveur
    checking: false,
    checkedFor: null,
    running: false,
    count: 8,
    fakes: [],
    voted: new Set(),    // `${clé de position}:${login}`
    turnKey: null,
    candidates: [],
    canBot: false,
    botAsked: false,
    el: null,

    init() {
        window.addEventListener('multiRoomState', (e) => {
            this.canBot = !!e.detail?.canBot;
            if (!this.canBot) this.botAsked = false;
            this.render();
        });
        setInterval(() => this.tick(), TICK_MS);
    },

    /** Page où ces outils servent : un salon Multi, ou une partie avec inscriptions (Mono) */
    relevant() {
        return window.location.hash.startsWith('#/multi/') || lobby.active;
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
        if (!this.relevant()) {
            if (this.running) this.stop();
            if (this.el) this.el.hidden = true;
            return;
        }
        if (this.allowed === null || this.checkedFor !== twitchAuth.user?.login) this.check();
        if (!this.allowed) { if (this.el) this.el.hidden = true; return; }
        this.render();
        if (this.running) this.play();
    },

    // ---------- Faux viewers ----------

    start() {
        const used = new Set();
        this.fakes = Array.from({ length: this.count }, (_, i) => {
            let name;
            do { name = pick(NAMES) + (rand(3) ? rand(99) : ''); } while (used.has(name));
            used.add(name);
            return { login: `sim_${name.toLowerCase()}`, name: `Sim_${name}`, id: `sim-${Date.now()}-${i}`, joinAt: Date.now() + 500 + rand(12000) };
        });
        this.voted.clear();
        this.running = true;
        this.render(true);
    },

    stop() {
        this.running = false;
        this.fakes = [];
        this.render(true);
    },

    say(fake, message) {
        const channel = (twitchAuth.user?.login || twitch.channel || '').toLowerCase();
        if (!channel) return;
        twitch.handleMessage('#' + channel, {
            username: fake.login,
            'display-name': fake.name,
            'user-id': fake.id,
            badges: {},
            subscriber: true,   // passe aussi les filtres abonnés / followers
            mod: false
        }, message);
    },

    play() {
        const now = Date.now();
        // Inscriptions, étalées dans le temps (aussi pendant la partie : inscription tardive)
        if (lobby.active) {
            for (const f of this.fakes) {
                if (!f.joined && now >= f.joinAt && !lobby.players.has(f.login) && !lobby.kicked.has(f.login)) {
                    f.joined = true;
                    this.say(f, Math.random() < 0.5 ? '!join' : 'join');
                }
            }
        }
        // Un peu de bavardage
        if (Math.random() < 0.03 && this.fakes.length) this.say(pick(this.fakes), pick(CHATTER));

        const chess = gameEngine.chess;
        if (!chess || !gameEngine.isRunning || chess.game_over()) return;
        const instant = !gameEngine.config?.timerEnabled;
        if (!voting.isOpen && !instant) return;
        const key = chess.fen();
        if (key !== this.turnKey) {
            this.turnKey = key;
            this.candidates = this.pickCandidates(chess);
        }
        if (!this.candidates.length) return;
        const turn = chess.turn();
        for (const f of this.fakes) {
            if (this.voted.has(key + ':' + f.login)) continue;
            if (lobby.active && !lobby.canVote(f.login, turn)) continue;
            if (Math.random() > (instant ? 0.04 : 0.18)) continue;
            this.voted.add(key + ':' + f.login);
            // La plupart suivent le meilleur coup trouvé, quelques-uns votent autre chose
            const r = Math.random();
            const move = r < 0.55 ? this.candidates[0] : r < 0.9 ? pick(this.candidates) : pick(chess.moves());
            this.say(f, Math.random() < 0.25 ? move.toLowerCase() : move);
            if (instant) break;
        }
    },

    /** Trois coups plausibles : prises et échecs d'abord, un peu de hasard */
    pickCandidates(chess) {
        const scored = chess.moves({ verbose: true }).map(m => ({
            san: m.san,
            score: (m.captured ? PIECE[m.captured] * 2 - PIECE[m.piece] * 0.5 : 0)
                + (m.san.includes('+') ? 1.5 : 0) + (m.san.includes('#') ? 100 : 0)
                + (m.promotion ? 8 : 0) + Math.random() * 2.5
        }));
        return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(m => m.san);
    },

    // ---------- Panneau ----------

    render(force = false) {
        if (!this.allowed) return;
        if (!this.el) {
            this.el = document.createElement('div');
            this.el.className = 'test-tools';
            this.el.addEventListener('click', (e) => {
                const action = e.target.closest('[data-test-action]')?.dataset.testAction;
                if (action === 'fakes') this.running ? this.stop() : this.start();
                if (action === 'bot') this.callBot();
            });
            this.el.addEventListener('change', (e) => {
                if (e.target.matches('[data-test-count]')) {
                    this.count = parseInt(e.target.value) || 8;
                    if (this.running) this.start();
                }
            });
            document.body.appendChild(this.el);
            force = true;
        }
        this.el.hidden = false;
        const joined = this.fakes.filter(f => lobby.players.has(f.login)).length;
        const sig = [this.running, this.count, this.canBot, this.botAsked, joined].join('|');
        if (!force && sig === this.sig) return;
        this.sig = sig;
        this.el.innerHTML = `
            <div class="test-tools__title">🧪 Test (régie)</div>
            <div class="test-tools__row">
                <select data-test-count title="Nombre de faux viewers">
                    ${[3, 8, 15, 30].map(n => `<option value="${n}"${n === this.count ? ' selected' : ''}>${n}</option>`).join('')}
                </select>
                <button type="button" class="btn btn--sm ${this.running ? 'btn--danger' : 'btn--secondary'}" data-test-action="fakes">
                    ${this.running ? 'Arrêter les faux viewers' : 'Faux viewers'}
                </button>
            </div>
            ${this.running ? `<div class="test-tools__info">${joined}/${this.fakes.length} inscrits · ils votent quand leur camp a le trait</div>` : ''}
            ${this.canBot ? `<div class="test-tools__row">
                <button type="button" class="btn btn--sm btn--secondary" data-test-action="bot"${this.botAsked ? ' disabled' : ''}>
                    ${this.botAsked ? 'Adversaire en route…' : 'Adversaire fictif (Noirs)'}
                </button>
            </div>` : ''}`;
    },

    callBot() {
        const socket = window.multiplayerManager?.socket;
        if (!socket || this.botAsked) return;
        this.botAsked = true;
        socket.emit('multi:testBot', { token: twitchAuth.token });
        this.render(true);
    }
};

TestTools.init();
window.TestTools = TestTools;
export default TestTools;
