/**
 * Page spectateur : #/watch?g=<id public>
 *
 * Suit une partie listée dans Parcourir, en lecture seule. Le serveur ne donne
 * que l'identifiant public : le code d'un salon Multi privé n'est jamais exposé.
 */
const t = (key, params) => window.i18n?.t(key, params) ?? key;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PIECES = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const MODE_LABEL = { multi: '⚔ Multi', rush: '🔥 Puzzle Rush', mono: '👥 Mono', sandbox: '🧪 Sandbox', problems: '🧩 Problèmes' };

const WatchPage = {
    socket: null,
    board: null,
    id: null,
    state: null,
    flipped: false,
    bound: false,

    init() {
        this.bind();
        const query = (window.location.hash.split('?')[1]) || '';
        const id = new URLSearchParams(query).get('g') || '';
        if (id === this.id && this.socket) return;
        this.stop();
        this.id = id;
        this.state = null;
        this.flipped = false;
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
        document.getElementById('watch-flip')?.addEventListener('click', () => {
            this.flipped = !this.flipped;
            this.render();
        });
        window.addEventListener('resize', () => { if (this.socket) this.board?.resize(); });
        window.addEventListener('languageChanged', () => { if (this.socket || this.state) this.render(); });
    },

    connect() {
        if (typeof io !== 'function') { this.showMessage('watch.notFound'); return; }
        const socket = io({ transports: ['websocket', 'polling'] });
        this.socket = socket;
        socket.on('connect', () => socket.emit('spectate:join', { id: this.id }));
        socket.on('spectate:state', (state) => {
            if (socket !== this.socket || state?.id !== this.id) return;
            this.state = state;
            this.showMessage(null);
            this.render();
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

    /** Coupe le flux (quitter la page) */
    stop(clearId = true) {
        if (this.socket) {
            try { this.socket.emit('spectate:leave'); } catch {}
            this.socket.disconnect();
            this.socket = null;
        }
        if (clearId) this.id = null;
    },

    showMessage(key) {
        const box = document.getElementById('watch-message');
        const layout = document.querySelector('#page-watch .watch__layout');
        if (!box || !layout) return;
        box.hidden = !key;
        layout.hidden = !!key;
        if (key) document.getElementById('watch-message-title').textContent = t(key);
    },

    orientation() {
        const base = this.state?.orientation === 'black' ? 'black' : 'white';
        return this.flipped ? (base === 'white' ? 'black' : 'white') : base;
    },

    render() {
        const s = this.state;
        const el = document.getElementById('watch-board');
        if (!el || typeof Chessboard !== 'function') return;
        const position = s?.fen ? s.fen.split(' ')[0] : 'start';
        if (!this.board) {
            this.board = Chessboard('watch-board', { position, draggable: false, pieceTheme: PIECES, orientation: this.orientation() });
        } else {
            this.board.orientation(this.orientation());
            this.board.position(position, false);
        }
        this.highlight(s?.lastMove);
        this.renderPlayers();
        this.renderStatus(false);
    },

    highlight(move) {
        document.querySelectorAll('#watch-board .watch-last').forEach(sq => sq.classList.remove('watch-last'));
        if (!move) return;
        for (const sq of [move.from, move.to]) {
            if (/^[a-h][1-8]$/.test(sq || '')) document.querySelector(`#watch-board .square-${sq}`)?.classList.add('watch-last');
        }
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
        const top = document.getElementById('watch-top');
        const bottom = document.getElementById('watch-bottom');
        if (!top || !bottom) return;
        // Multi : hôte = Blancs, invité = Noirs. Sinon : la chaîne joue avec son chat.
        const whiteHtml = this.player(s.host, 'white');
        const blackHtml = s.mode === 'multi' ? this.player(s.guest, 'black') : '';
        const flipped = this.orientation() === 'black';
        top.innerHTML = flipped ? whiteHtml : blackHtml;
        bottom.innerHTML = flipped ? blackHtml : whiteHtml;
        top.hidden = !top.innerHTML;
        bottom.hidden = !bottom.innerHTML;
    },

    renderStatus(ended) {
        const s = this.state || {};
        const mode = document.getElementById('watch-mode');
        const status = document.getElementById('watch-status');
        const meta = document.getElementById('watch-meta');
        if (!mode || !status || !meta) return;
        mode.innerHTML = `${esc(MODE_LABEL[s.mode] || s.mode || '')}${s.isPublic === false ? ` <span class="game-card__private">🔒 ${esc(t('browsePage.private'))}</span>` : ''}`;

        let text;
        if (['white', 'black', 'draw'].includes(s.result)) text = t(`watch.result_${s.result}`);
        else if (ended) text = t('watch.ended');
        else if (s.status === 'waiting') text = t('watch.waiting');
        else if (s.fen) text = s.fen.split(' ')[1] === 'b' ? t('watch.blackToPlay') : t('watch.whiteToPlay');
        else text = t('watch.loading');
        status.textContent = text;
        status.classList.toggle('is-over', !!(s.result || ended));

        const rows = [[t('watch.moves'), String(s.moveCount ?? 0)]];
        if (s.players != null) rows.push([t('watch.players'), String(s.players)]);
        meta.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    }
};

export default WatchPage;
