/**
 * Page spectateur : #/watch?g=<id public>
 *
 * La même fenêtre que les joueurs (coups disponibles, échiquier, minuteur, votes
 * en cours, historique), en lecture seule. Le spectateur est compté par le serveur :
 * les joueurs et les autres spectateurs voient qu'il regarde (avec son pseudo s'il
 * est connecté à Twitch). Le serveur ne donne que l'identifiant public : le code
 * d'un salon Multi privé n'est jamais exposé.
 */
import twitchAuth from '../core/twitchAuth.js';
import { renderSpectatorList, spectatorsLabel } from '../components/spectators.js';
import VotingWheel from '../components/wheel.js';
import WheelBand from '../components/wheelBand.js';

const t = (key, params) => window.i18n?.t(key, params) ?? key;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PIECES = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const MODE_LABEL = { multi: '⚔ Multi', rush: '🔥 Puzzle Rush', mono: '👥 Mono', sandbox: '🧪 Partie libre', problems: '🧩 Problèmes', chatVsChat: '⚔ Multi' };
const VOTE_COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];
const PIECE_ICONS = { w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' }, b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' } };
const $ = (id) => document.getElementById(id);
const clean = (m) => String(m || '').replace(/[+#]/g, '');

const WatchPage = {
    socket: null,
    board: null,
    id: null,
    state: null,
    spectators: null,
    flipped: false,
    bound: false,
    timerEndsAt: null,
    timerId: null,
    wheel: null,
    wheelStyle: null,
    drawSig: null,

    init() {
        this.bind();
        const query = (window.location.hash.split('?')[1]) || '';
        const id = new URLSearchParams(query).get('g') || '';
        if (id === this.id && this.socket) return;
        this.stop();
        this.id = id;
        this.state = null;
        this.spectators = null;
        this.flipped = false;
        this.boardWidth = 0;
        this.drawSig = null;
        this.revealing = false;
        this.hideWheel();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
            this.showMessage('watch.notFound');
            return;
        }
        this.showMessage(null);
        this.render();
        // La page vient d'être affichée : l'échiquier prend sa vraie taille
        requestAnimationFrame(() => this.board?.resize());
        this.connect();
    },

    bind() {
        if (this.bound) return;
        this.bound = true;
        $('watch-flip')?.addEventListener('click', () => {
            this.flipped = !this.flipped;
            this.render();
        });
        window.addEventListener('resize', () => { if (this.socket) this.board?.resize(); });
        window.addEventListener('languageChanged', () => { if (this.socket || this.state) { this.render(); this.renderSpectators(); } });
    },

    connect() {
        if (typeof io !== 'function') { this.showMessage('watch.notFound'); return; }
        const socket = io({ transports: ['websocket', 'polling'] });
        this.socket = socket;
        // Le jeton Twitch ne sert qu'à afficher un pseudo vérifié dans la liste des spectateurs
        socket.on('connect', () => socket.emit('spectate:join', { id: this.id, token: twitchAuth.token || undefined }));
        socket.on('spectate:state', (state) => {
            if (socket !== this.socket || state?.id !== this.id) return;
            this.state = state;
            if (state.spectators) this.spectators = state.spectators;
            this.showMessage(null);
            this.render();
            this.renderSpectators();
        });
        socket.on('spectators', (data) => {
            if (socket !== this.socket || data?.id !== this.id) return;
            this.spectators = data;
            this.renderSpectators();
        });
        socket.on('spectate:ended', ({ reason } = {}) => {
            if (socket !== this.socket) return;
            const over = this.state?.result;
            this.stop(false);
            if (reason === 'over' || over) {
                this.renderStatus(true);
                return;
            }
            this.showMessage(reason === 'notFound' ? 'watch.notFound' : 'watch.ended');
        });
    },

    /** Coupe le flux (quitter la page) : le serveur retire ce spectateur de la liste */
    stop(clearId = true) {
        if (this.socket) {
            try { this.socket.emit('spectate:leave'); } catch {}
            this.socket.disconnect();
            this.socket = null;
        }
        this.setTimer(null);
        if (clearId) this.id = null;
    },

    showMessage(key) {
        const box = $('watch-message');
        const page = document.querySelector('#page-watch .watch');
        if (!box || !page) return;
        box.hidden = !key;
        page.classList.toggle('watch--message', !!key);
        if (key) $('watch-message-title').textContent = t(key);
    },

    orientation() {
        const base = this.state?.orientation === 'black' ? 'black' : 'white';
        return this.flipped ? (base === 'white' ? 'black' : 'white') : base;
    },

    render() {
        const s = this.state;
        const el = $('watch-board');
        if (!el || typeof Chessboard !== 'function') return;
        const position = s?.fen ? s.fen.split(' ')[0] : 'start';
        if (!this.board) {
            this.board = Chessboard('watch-board', { position, draggable: false, pieceTheme: PIECES, orientation: this.orientation() });
        } else {
            this.board.orientation(this.orientation());
            this.board.position(position, false);
        }
        // Créé pendant que la page était masquée : l'échiquier prend la largeur de sa colonne
        const width = el.clientWidth;
        if (width && width !== this.boardWidth) {
            this.boardWidth = width;
            this.board.resize();
        }
        this.highlight(s?.lastMove);
        this.renderHeader();
        this.renderPlayers();
        this.renderBanners();
        this.renderMoves();
        this.renderVotes();
        this.renderHistory();
        this.renderStatus(false);
        this.setTimer(s?.timer || null);
        this.reserveBand();
        this.renderWheel();
    },

    /** Roue ou bande de l'hôte : votes qui arrivent, puis le même tirage que les joueurs */
    ensureWheel(style) {
        const area = $('watch-wheel-area');
        if (!area) return null;
        if (this.wheel && (this.wheelStyle === style || this.wheel.isSpinning)) return this.wheel;
        area.classList.toggle('wheel-area--band', style === 'band');
        const wheel = style === 'band' ? new WheelBand('watch-wheel-area') : new VotingWheel('watch-wheel-area');
        // La liste des votes de la page spectateur est gérée ici, pas par la roue
        wheel.updateVoteList = () => {};
        wheel.highlightWinner = () => {};
        wheel.currentTurn = () => (this.state?.fen?.split(' ')[1] === 'b' ? 'b' : 'w');
        this.wheel = wheel;
        this.wheelStyle = style;
        return wheel;
    },

    setWheelVotes(wheel, votes) {
        wheel.votes = new Map(votes.map(v => [v.m, { count: v.n, voters: new Map() }]));
    },

    hideWheel() {
        const area = $('watch-wheel-area');
        area?.classList.remove('is-visible', 'is-spinning');
    },

    /** Bande de l'hôte : sa place reste réservée pendant la partie, la page ne saute pas à chaque tour */
    reserveBand() {
        const s = this.state || {};
        const area = $('watch-wheel-area');
        if (!area) return;
        const band = s.wheel === 'band' && !s.result;
        area.classList.toggle('is-reserved', band);
        if (band) area.classList.add('wheel-area--band');
    },

    renderWheel() {
        const s = this.state || {};
        const area = $('watch-wheel-area');
        if (!area) return;
        if (s.draw && !s.result) {
            const sig = s.draw.winner + JSON.stringify(s.draw.votes);
            if (sig === this.drawSig || this.wheel?.isSpinning || this.revealing) return;
            const wheel = this.ensureWheel(s.wheel || this.wheelStyle || 'band');
            if (!wheel) return;
            this.drawSig = sig;
            this.setWheelVotes(wheel, s.draw.votes);
            area.classList.add('is-visible', 'is-spinning');
            wheel.draw();
            this.revealing = true;
            wheel.onSpinEnd = () => {
                this.revealing = false;
                area.classList.remove('is-spinning');
                if (!this.state?.wheel || !this.state?.votes?.length) this.hideWheel();
            };
            // Arrivé en plein tirage : il se termine en même temps que chez les joueurs
            wheel.spin(Math.max(400, s.draw.endsIn), s.draw.winner);
            return;
        }
        if (this.wheel?.isSpinning || this.revealing) return;
        if (s.wheel && s.votes?.length && !s.result) {
            const wheel = this.ensureWheel(s.wheel);
            if (!wheel) return;
            this.setWheelVotes(wheel, s.votes);
            area.classList.add('is-visible');
            wheel.draw();
        } else {
            this.hideWheel();
        }
    },

    highlight(move) {
        document.querySelectorAll('#watch-board .watch-last').forEach(sq => sq.classList.remove('watch-last'));
        if (!move) return;
        for (const sq of [move.from, move.to]) {
            if (/^[a-h][1-8]$/.test(sq || '')) document.querySelector(`#watch-board .square-${sq}`)?.classList.add('watch-last');
        }
    },

    renderHeader() {
        const s = this.state || {};
        const title = $('watch-mode');
        if (!title) return;
        const lock = s.isPublic === false ? ` <span class="game-card__private">🔒 ${esc(t('browsePage.private'))}</span>` : '';
        title.innerHTML = `${esc(MODE_LABEL[s.mode] || MODE_LABEL.sandbox)}${lock}`;
    },

    player(name, color) {
        if (!name) return `<span class="watch__dot watch__dot--${color}"></span> <span class="watch__muted">${esc(t('browsePage.openSeat'))}</span>`;
        const login = String(name).toLowerCase();
        return `<span class="watch__dot watch__dot--${color}"></span>
            <a href="#/records?c=${encodeURIComponent(login)}" class="watch__name">${esc(name)}</a>
            <a href="https://twitch.tv/${encodeURIComponent(login)}" target="_blank" rel="noopener" class="watch__twitch" aria-label="Twitch"><i class="fab fa-twitch"></i></a>`;
    },

    renderPlayers() {
        const s = this.state || {};
        const top = $('watch-top');
        const bottom = $('watch-bottom');
        if (!top || !bottom) return;
        // Multi : hôte = Blancs, invité = Noirs. Sinon : la chaîne joue avec son chat.
        const whiteHtml = this.player(s.host, 'white');
        const blackHtml = s.mode === 'multi' ? this.player(s.guest, 'black') : '';
        const flipped = this.orientation() === 'black';
        top.innerHTML = flipped ? whiteHtml : blackHtml;
        bottom.innerHTML = flipped ? blackHtml : whiteHtml;
        // Sans adversaire (Mono, Rush…), la ligne du haut n'existe pas ; sinon elle garde sa place
        top.hidden = s.mode !== 'multi';
        bottom.hidden = false;
    },

    /** Bannières de la fenêtre de jeu : équipes du Multi, score du Puzzle Rush */
    renderBanners() {
        const s = this.state || {};
        const multi = $('watch-multi');
        if (multi) {
            multi.hidden = s.mode !== 'multi';
            const turn = s.fen?.split(' ')[1];
            const team = (id, name, color) => {
                const el = $(id);
                if (!el) return;
                el.textContent = name || t('browsePage.openSeat');
                el.classList.toggle('is-turn', s.status === 'playing' && !s.result && turn === color);
            };
            team('watch-team-white', s.host, 'w');
            team('watch-team-black', s.guest, 'b');
        }
        const rush = $('watch-rush');
        if (rush) {
            const r = s.rush;
            rush.hidden = s.mode !== 'rush' || !r;
            if (r) {
                $('watch-rush-title').textContent = `⏱ ${r.mode === '0' || !r.mode ? '∞' : `${r.mode} s`}`;
                $('watch-rush-score').textContent = String(r.score);
                $('watch-rush-rating').textContent = r.rating ? `~${r.rating}` : '—';
                const lives = Math.max(0, r.maxStrikes - r.strikes);
                $('watch-rush-hearts').innerHTML = Array.from({ length: r.maxStrikes }, (_, i) =>
                    `<span class="rush-heart ${i < lives ? '' : 'rush-heart--lost'}">${i < lives ? '❤️' : '🖤'}</span>`).join('');
            }
        }
    },

    /** Coups disponibles, groupés par pièce comme chez les joueurs ; le plus voté ressort */
    renderMoves() {
        const list = $('watch-moves-list');
        if (!list) return;
        const fen = this.state?.fen;
        let moves = [];
        if (fen && typeof Chess === 'function' && !this.state?.result) {
            try { moves = new Chess(fen).moves(); } catch { moves = []; }
        }
        const turn = fen?.split(' ')[1] === 'b' ? 'b' : 'w';
        const top = clean(this.state?.votes?.[0]?.m);
        const groups = { P: [], N: [], B: [], R: [], Q: [], K: [], O: [] };
        moves.forEach(m => {
            const c = clean(m);
            if (c.startsWith('O-')) groups.O.push(c);
            else if ('KQRBN'.includes(c[0])) groups[c[0]].push(c);
            else groups.P.push(c);
        });
        list.innerHTML = Object.entries(groups).filter(([, g]) => g.length).map(([piece, g]) => `
            <ul class="moves-group"><span class="piece-icon">${piece === 'O' ? '⬚' : PIECE_ICONS[turn][piece]}</span>${
                g.map(m => `<li class="${m === top ? 'most-voted' : ''}"><button type="button" tabindex="-1" disabled>${esc(m)}</button></li>`).join('')
            }</ul>`).join('');
        // Le panneau garde sa place (pas de saut de l'échiquier quand il n'y a plus de coup)
        $('watch-moves').classList.toggle('is-empty', !moves.length);
    },

    renderVotes() {
        const list = $('watch-votes');
        const totalEl = $('watch-vote-total');
        if (!list || !totalEl) return;
        const votes = this.state?.votes || [];
        const total = votes.reduce((n, v) => n + v.n, 0);
        if (!total) {
            list.innerHTML = `<div class="no-votes">${esc(t('watch.noVotes'))}</div>`;
            totalEl.textContent = '';
            return;
        }
        list.innerHTML = votes.map((v, i) => {
            const pct = Math.round(v.n / total * 100);
            const color = VOTE_COLORS[i % VOTE_COLORS.length];
            return `<div class="vote-item" style="--color: ${color}">
                <span class="vote-bar" style="width: ${pct}%; background: ${color}"></span>
                <span class="vote-move">${esc(v.m)}</span>
                <span class="vote-count">${v.n} (${pct}%)</span>
            </div>`;
        }).join('');
        totalEl.textContent = t(total > 1 ? 'watch.totalMany' : 'watch.totalOne', { n: total });
    },

    renderHistory() {
        const box = $('watch-history');
        if (!box) return;
        const h = this.state?.history || [];
        if (!h.length) {
            box.innerHTML = `<div class="empty-state"><p>${esc(t('watch.noHistory'))}</p></div>`;
            return;
        }
        // Plus récent en haut, comme chez les joueurs
        const rows = [];
        for (let i = 0; i < h.length; i += 2) {
            rows.push(`<div class="history-row">
                <span class="history-row__number">${i / 2 + 1}.</span>
                <span class="history-row__move">${esc(h[i])}</span>
                <span class="history-row__move">${esc(h[i + 1] || '')}</span>
            </div>`);
        }
        box.innerHTML = rows.reverse().join('');
    },

    renderSpectators() {
        const d = this.spectators;
        const count = d?.count || 0;
        const badge = $('watch-spectators-badge');
        if (badge) {
            badge.title = count ? spectatorsLabel(count) : '';
            $('watch-spectators-count').textContent = String(count);
        }
        const c = $('watch-spectators-panel-count');
        if (c) c.textContent = count ? String(count) : '';
        renderSpectatorList($('watch-spectators'), d, twitchAuth.session?.login || null);
        const hint = $('watch-login-hint');
        if (hint) hint.hidden = !!twitchAuth.token;
    },

    /** Minuteur du tour : le serveur donne le temps restant, le décompte se fait ici */
    setTimer(timer) {
        clearInterval(this.timerId);
        this.timerId = null;
        const box = $('watch-timer');
        if (!box) return;
        $('watch-wheel-area')?.classList.remove('is-soon');
        if (!timer || this.state?.result) {
            box.hidden = true;
            this.timerEndsAt = null;
            return;
        }
        box.hidden = false;
        box.classList.toggle('is-paused', !!timer.paused);
        const total = Math.max(1, timer.total || 1);
        this.timerEndsAt = timer.paused ? null : Date.now() + timer.endsIn;
        const draw = () => {
            const left = timer.paused ? (timer.left ?? 0) : Math.max(0, Math.ceil((this.timerEndsAt - Date.now()) / 1000));
            $('watch-timer-value').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}${timer.paused ? ' ⏸' : ''}`;
            const arc = $('watch-timer-arc');
            if (arc) arc.style.strokeDasharray = `${Math.min(1, left / total) * 283} 283`;
            box.classList.toggle('is-critical', !timer.paused && left <= 5);
            $('watch-wheel-area')?.classList.toggle('is-soon', !timer.paused && left <= 1);
            if (!timer.paused && left <= 0) { clearInterval(this.timerId); this.timerId = null; }
        };
        draw();
        if (!timer.paused) this.timerId = setInterval(draw, 250);
    },

    renderStatus(ended) {
        const s = this.state || {};
        const status = $('watch-status');
        if (!status) return;
        let text;
        if (['white', 'black', 'draw'].includes(s.result)) text = t(`watch.result_${s.result}`);
        else if (ended) text = t('watch.ended');
        else if (s.status === 'waiting') text = t('watch.waiting');
        else if (s.mode === 'rush') text = t('watch.rushToPlay');
        else if (s.fen) text = s.fen.split(' ')[1] === 'b' ? t('watch.blackToPlay') : t('watch.whiteToPlay');
        else text = t('watch.loading');
        const moves = s.mode === 'rush' ? '' : ` · ${t('watch.movesCount', { n: s.moveCount ?? 0 })}`;
        const players = s.players != null ? ` · ${s.players} ${t('watch.players').toLowerCase()}` : '';
        status.textContent = text + (s.result || ended ? '' : moves + players);
        status.classList.toggle('is-over', !!(s.result || ended));
        if (ended) this.setTimer(null);
    }
};

export default WatchPage;
