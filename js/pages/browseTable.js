/**
 * Parcourir : tableau des parties en cours, filtres et aperçu de la partie choisie
 *
 * Une ligne par partie (mode, chaînes, statut, vote, avancement, inscrits,
 * spectateurs, durée). Le panneau d'aperçu montre l'échiquier, les votes en cours
 * et les joueurs de la ligne choisie, sans compter comme spectateur (game:peek).
 */
import { spectatorsLabel } from '../components/spectators.js';
import { fmtMove } from '../utils/moveMatch.js';
import { go } from '../core/route.js';

const t = (key, params) => window.i18n?.t(key, params) ?? key;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const PIECES = p => window.pieceUrl(p);   // set de pièces choisi
const MODE_ICON = { multi: '⚔', mono: '👥', rush: '🔥', sandbox: '🧪', problems: '🧩', picks: '🎯' };
const MODE_KEY = { multi: 'browsePage.modeMulti', mono: 'browsePage.modeMono', rush: 'browsePage.modeRush', sandbox: 'browsePage.modeSandbox', problems: 'browsePage.modeProblems', picks: 'nav.tournament' };
const MODES = ['multi', 'mono', 'rush', 'sandbox', 'problems', 'picks'];
// Pronos live : vrais matchs de tournoi en direct (/api/tournament/live), une ligne par match
const PICKS = [['1-0', 'white'], ['1/2-1/2', 'draw'], ['0-1', 'black']];
const PICKS_COLORS = { white: '#e8e8e8', draw: '#9a9aa2', black: '#3a3a40' };
const LIVE_MS = 30000;
const picksTotal = v => (v ? PICKS.reduce((a, [k]) => a + (+v[k] || 0), 0) : 0);
const picksHref = g => `/tournament?event=${encodeURIComponent(g.event?.slug || '')}&room=${encodeURIComponent(g.room?.slug || '')}&game=${encodeURIComponent(g.id)}`;
/** Match de tournoi → ligne du tableau (mêmes champs que les parties du site) */
const liveRow = g => ({
    gameId: `picks:${g.room?.slug || ''}:${g.id}`, mode: 'picks', status: 'playing', live: g,
    spectators: picksTotal(g.votes), moveCount: Math.max(0, (+String(g.fen || '').split(' ')[5] || 1) - 1),
    startedAt: g.startAt ? (g.startAt < 1e12 ? g.startAt * 1000 : +g.startAt) || Date.parse(g.startAt) || 0 : 0,
});
const VOTE_COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];
// v2 : tri par défaut « Moins avancées » (les anciens réglages enregistrés sont ignorés)
const STORE = 'browseFilters2';
const PEEK_MS = 2000;

const BrowseTable = {
    games: [],
    filters: { q: '', mode: 'all', status: 'all', sort: 'moves' },
    selected: null,
    peek: null,
    board: null,
    boardWidth: 0,
    socket: null,
    joinHref: () => null,
    bound: false,
    peekTimer: null,
    live: [],          // lignes Pronos live
    liveAt: 0,
    liveBusy: false,

    /** Parties du site + matchs Pronos live */
    all() {
        return this.games.concat(this.live);
    },

    async loadLive(force = false) {
        if (this.liveBusy || (!force && Date.now() - this.liveAt < LIVE_MS)) return;
        this.liveBusy = true;
        try {
            const r = await fetch('/api/tournament/live');
            if (r.ok) {
                const d = await r.json();
                this.live = (Array.isArray(d.games) ? d.games : []).map(liveRow);
                this.liveAt = Date.now();
                this.renderToolbar();
                this.render();
            }
        } catch { /* nouvel essai au prochain tour */ }
        this.liveBusy = false;
    },

    /** Ouvre le match sur la page Pronos live */
    openPicks(id) {
        const g = this.live.find(x => x.gameId === id)?.live;
        if (!g) return;
        go('/tournament');
        setTimeout(() => window.tournamentPredict?.openLiveGame?.(g), 0);
    },

    /** socket : celui de Parcourir ; joinHref(game) : lien Rejoindre d'un salon Multi */
    setup(socket, joinHref) {
        this.socket = socket;
        this.joinHref = joinHref;
        if (this.bound) return;
        this.bound = true;
        try { Object.assign(this.filters, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
        this.bindToolbar();
        window.addEventListener('languageChanged', () => { this.renderToolbar(); this.render(); this.renderPreview(); });
        window.addEventListener('resize', () => this.resizeBoard());
        // Aperçu rafraîchi tant que Parcourir est affiché ; matchs Pronos live relus toutes les 30 s
        this.peekTimer = setInterval(() => { if (this.visible()) { this.fetchPeek(); this.loadLive(); } }, PEEK_MS);
        // Pronostiquer : ouvre le match sur place (clic simple), lien normal sinon
        document.addEventListener('click', (e) => {
            const a = e.target.closest('[data-picks-open]');
            if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
            e.preventDefault();
            this.openPicks(a.dataset.picksOpen);
        });
        this.loadLive(true);
    },

    visible() {
        return !!$('games-list')?.offsetParent && document.visibilityState !== 'hidden';
    },

    saveFilters() {
        try { localStorage.setItem(STORE, JSON.stringify(this.filters)); } catch {}
    },

    // ==================== Barre de filtres ====================

    bindToolbar() {
        const search = $('browse-search');
        if (search) {
            search.value = this.filters.q || '';
            search.addEventListener('input', () => { this.filters.q = search.value; this.saveFilters(); this.render(); });
        }
        $('browse-modes')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mode]');
            if (!btn) return;
            this.filters.mode = btn.dataset.mode;
            this.saveFilters();
            this.renderToolbar();
            this.render();
        });
        for (const key of ['status', 'sort']) {
            const sel = $('browse-' + key);
            if (!sel) continue;
            sel.value = this.filters[key];
            sel.addEventListener('change', () => { this.filters[key] = sel.value; this.saveFilters(); this.render(); });
        }
        $('games-list')?.addEventListener('click', (e) => {
            if (e.target.closest('a, button')) return;
            const row = e.target.closest('[data-game-id]');
            if (row) this.select(row.dataset.gameId, true);
        });
        $('games-list')?.addEventListener('keydown', (e) => {
            const row = e.target.closest('[data-game-id]');
            if (!row) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(row.dataset.gameId, true); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
                if (next?.dataset.gameId) { next.focus(); this.select(next.dataset.gameId, true); }
            }
        });
        this.renderToolbar();
    },

    /** Puces de mode, avec le nombre de parties de chaque mode */
    renderToolbar() {
        const box = $('browse-modes');
        if (!box) return;
        const counts = {};
        const all = this.all();
        for (const g of all) counts[g.mode || 'multi'] = (counts[g.mode || 'multi'] || 0) + 1;
        const chip = (mode, label, n) => `<button type="button" class="browse-chip${this.filters.mode === mode ? ' is-active' : ''}" data-mode="${mode}" aria-pressed="${this.filters.mode === mode}">${label}<span class="browse-chip__count">${n}</span></button>`;
        box.innerHTML = chip('all', esc(t('browsePage.all')), all.length)
            + MODES.map(m => chip(m, `${MODE_ICON[m]} ${esc(t(MODE_KEY[m]))}`, counts[m] || 0)).join('');
    },

    // ==================== Tableau ====================

    setGames(games) {
        this.games = (games || []).filter(g => g.status !== 'ended');
        this.renderToolbar();
        this.render();
    },

    filtered() {
        const f = this.filters;
        const q = (f.q || '').trim().toLowerCase();
        const list = this.all().filter(g => {
            if (f.mode !== 'all' && (g.mode || 'multi') !== f.mode) return false;
            if (f.status === 'playing' && g.status !== 'playing') return false;
            if (f.status === 'waiting' && g.status === 'playing') return false;
            if (f.status === 'open' && !g.join) return false;
            const who = g.live ? `${g.live.white?.name || ''} ${g.live.black?.name || ''} ${g.live.event?.name || ''} ${g.live.room?.name || ''}` : `${g.host || ''} ${g.guest || ''}`;
            if (q && !who.toLowerCase().includes(q)) return false;
            return true;
        });
        const by = {
            // À spectateurs égaux : les parties les moins avancées d'abord
            spectators: (a, b) => (b.spectators || 0) - (a.spectators || 0) || (a.moveCount || 0) - (b.moveCount || 0),
            // Moins de coups d'abord (parties qui commencent)
            moves:      (a, b) => (a.moveCount || 0) - (b.moveCount || 0),
            players:    (a, b) => (b.players || 0) - (a.players || 0) || (a.moveCount || 0) - (b.moveCount || 0),
            recent:     (a, b) => (b.startedAt || 0) - (a.startedAt || 0)
        }[f.sort] || (() => 0);
        return list.sort(by);
    },

    duration(ms) {
        if (!ms) return '—';
        const min = Math.max(0, Math.floor((Date.now() - ms) / 60000));
        return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
    },

    progress(g) {
        const n = g.moveCount || 0;
        return g.mode === 'rush' ? t(n > 1 ? 'browsePage.puzzlesMany' : 'browsePage.puzzlesOne', { n })
            : t(n > 1 ? 'browsePage.movesMany' : 'browsePage.movesOne', { n });
    },

    voteLabel(g) {
        const parts = [];
        if (g.draw === 'band') parts.push(`<i class="fas fa-grip-lines"></i> ${esc(t('browsePage.drawBand'))}`);
        else if (g.draw === 'classic') parts.push(`<i class="fas fa-dharmachakra"></i> ${esc(t('browsePage.drawWheel'))}`);
        else if (g.settings?.majorityMode) parts.push(`<i class="fas fa-poll"></i> ${esc(t('browsePage.drawMajority'))}`);
        if (g.turn) parts.push(`${g.turn} s`);
        return parts.length ? parts.join(' · ') : '<span class="games-table__muted">—</span>';
    },

    channel(login) {
        return login
            ? `<a href="/records?c=${encodeURIComponent(login)}" class="games-table__channel">${esc(login)}</a>`
            : `<span class="games-table__muted">${esc(t('browsePage.anonymous'))}</span>`;
    },

    /** Joueur d'un match de tournoi : titre, nom, Elo */
    livePlayer(p = {}, side) {
        return `<span class="games-table__player"><span class="watch__dot watch__dot--${side}"></span>${p.title ? `<span class="player-title">${esc(p.title)}</span> ` : ''}<span class="games-table__pname">${esc(p.name || '?')}</span>${p.elo ? ` <span class="games-table__muted">${esc(p.elo)}</span>` : ''}</span>`;
    },

    liveEvent(g) {
        const e = g.event?.name || '', r = g.room?.name || '';
        return r && r !== e ? `${e} · ${r}` : e || r;
    },

    /** Bouton Pronostiquer : icône seule dans le tableau, avec le texte dans l'aperçu */
    pickBtn(g, cls, label = false) {
        const txt = esc(t('home.picks.cta'));
        return `<a class="btn btn--sm ${cls}" data-picks-open="${esc(g.gameId)}" href="${esc(picksHref(g.live))}" title="${txt}"><i class="fas fa-crosshairs"></i>${label ? ` <span>${txt}</span>` : `<span class="visually-hidden">${txt}</span>`}</a>`;
    },

    liveRowHtml(g) {
        const m = g.live, n = g.spectators || 0;
        return `
            <tr class="game-row${this.selected === g.gameId ? ' is-selected' : ''}" data-game-id="${esc(g.gameId)}" tabindex="0">
                <td class="games-table__mode"><span class="mode-pill mode-pill--picks">${MODE_ICON.picks} ${esc(t(MODE_KEY.picks))}</span></td>
                <td class="games-table__channels"><span class="games-table__duo">${this.livePlayer(m.white, 'white')}${this.livePlayer(m.black, 'black')}</span></td>
                <td><span class="status-dot status-dot--playing"></span>${esc(t('browsePage.statusPlaying'))}</td>
                <td class="games-table__vote col-md"><span class="games-table__event">${esc(this.liveEvent(m))}</span></td>
                <td class="games-table__num">${esc(this.progress(g))}</td>
                <td class="games-table__num col-md"><span class="games-table__muted">—</span></td>
                <td class="games-table__num"><span class="game-row__spectators" title="${esc(t('predict.votes', { n }))}"><i class="fas fa-crosshairs"></i> ${n}</span></td>
                <td class="games-table__num col-lg">${this.duration(g.startedAt)}</td>
                <td class="games-table__actions">${this.pickBtn(g, 'btn--primary')}</td>
            </tr>`;
    },

    row(g) {
        if (g.live) return this.liveRowHtml(g);
        const mode = g.mode || 'multi';
        const playing = g.status === 'playing';
        const channels = mode === 'multi'
            ? `${this.channel(g.host)} <span class="games-table__vs">⚔</span> ${g.guest ? this.channel(g.guest) : `<span class="games-table__open">${esc(t('browsePage.openSeat'))}</span>`}`
            : this.channel(g.host);
        const priv = g.isPublic === false ? ` <span class="game-row__private" title="${esc(t('browsePage.private'))}">🔒</span>` : '';
        const join = g.join ? this.joinHref(g) : null;
        return `
            <tr class="game-row${this.selected === g.gameId ? ' is-selected' : ''}" data-game-id="${esc(g.gameId)}" tabindex="0">
                <td class="games-table__mode"><span class="mode-pill mode-pill--${mode}">${MODE_ICON[mode] || '♟'} ${esc(t(MODE_KEY[mode] || 'browsePage.modeSandbox'))}</span>${priv}</td>
                <td class="games-table__channels">${channels}</td>
                <td><span class="status-dot status-dot--${playing ? 'playing' : 'waiting'}"></span>${esc(t(playing ? 'browsePage.statusPlaying' : 'browsePage.statusWaiting'))}</td>
                <td class="games-table__vote col-md">${this.voteLabel(g)}</td>
                <td class="games-table__num">${esc(this.progress(g))}</td>
                <td class="games-table__num col-md">${g.players != null ? g.players : '<span class="games-table__muted">—</span>'}</td>
                <td class="games-table__num"><span class="game-row__spectators" title="${esc(spectatorsLabel(g.spectators || 0))}"><i class="fas fa-eye"></i> ${g.spectators || 0}</span></td>
                <td class="games-table__num col-lg">${this.duration(g.startedAt)}</td>
                <td class="games-table__actions">
                    ${join ? `<a class="btn btn--sm btn--primary" data-join href="${esc(join)}"><i class="fas fa-sign-in-alt"></i> <span class="col-lg-inline">${esc(t('browsePage.join'))}</span></a>` : ''}
                    <a class="btn btn--sm btn--ghost" data-watch href="/watch?g=${encodeURIComponent(g.gameId)}" title="${esc(t('browsePage.watch'))}"><i class="fas fa-eye"></i> <span class="col-lg-inline">${esc(t('browsePage.watch'))}</span></a>
                </td>
            </tr>`;
    },

    render() {
        const container = $('games-list');
        if (!container) return;
        const list = this.filtered();
        const count = $('browse-count');
        if (count) count.textContent = t(list.length > 1 ? 'browsePage.countMany' : 'browsePage.countOne', { n: list.length });

        if (!this.all().length || !list.length) {
            const none = !this.all().length;
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state__icon">${none ? '⚔' : '🔍'}</div>
                    <p class="empty-state__title">${esc(t(none ? 'browsePage.noGames' : 'browsePage.noMatch'))}</p>
                    <p class="empty-state__desc">${esc(t(none ? 'browsePage.empty' : 'browsePage.noMatchHint'))}</p>
                </div>`;
            this.select(null);
            return;
        }

        // Sur grand écran, la première ligne est prévisualisée d'office
        if (!list.some(g => g.gameId === this.selected)) this.selected = window.innerWidth > 1100 ? list[0].gameId : null;

        const th = (key, cls = '') => `<th class="${cls}">${esc(t(key))}</th>`;
        container.innerHTML = `
            <table class="games-table">
                <thead><tr>
                    ${th('browsePage.colMode')}${th('browsePage.colChannels')}${th('browsePage.colStatus')}
                    ${th('browsePage.colVote', 'col-md')}${th('browsePage.colProgress', 'games-table__num')}
                    ${th('browsePage.colPlayers', 'games-table__num col-md')}
                    <th class="games-table__num" title="${esc(t('spectators.title'))}"><i class="fas fa-eye"></i></th>
                    ${th('browsePage.colTime', 'games-table__num col-lg')}<th></th>
                </tr></thead>
                <tbody>${list.map(g => this.row(g)).join('')}</tbody>
            </table>`;
        this.select(this.selected);
    },

    // ==================== Aperçu ====================

    select(id, user = false) {
        const changed = id !== this.selected;
        this.selected = id;
        document.querySelectorAll('#games-list .game-row').forEach(r => r.classList.toggle('is-selected', r.dataset.gameId === id));
        if (changed) this.peek = null;
        this.renderPreview();
        if (id && (changed || !this.peek)) this.fetchPeek();
        // Petit écran : l'aperçu est sous le tableau
        if (user && changed && window.innerWidth <= 1100) $('browse-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    fetchPeek() {
        const id = this.selected;
        if (!id || String(id).startsWith('picks:') || !this.socket?.connected) return;
        this.socket.timeout(4000).emit('game:peek', id, (err, state) => {
            if (err || id !== this.selected) return;
            this.peek = state || null;
            this.renderPreview();
        });
    },

    renderPreview() {
        const box = $('browse-preview');
        if (!box) return;
        const g = this.all().find(x => x.gameId === this.selected);
        box.hidden = !g;
        if (!g) return;
        if (g.live) return this.renderLivePreview(g);
        const s = this.peek;
        const mode = g.mode || 'multi';
        $('browse-preview-mode').innerHTML = `${MODE_ICON[mode] || '♟'} ${esc(t(MODE_KEY[mode] || 'browsePage.modeSandbox'))}${g.isPublic === false ? ` <span class="game-row__private">🔒 ${esc(t('browsePage.private'))}</span>` : ''}`;

        // Joueurs
        const players = mode === 'multi'
            ? `<div class="browse-preview__team"><span class="watch__dot watch__dot--white"></span>${this.channel(g.host)}</div>
               <div class="browse-preview__team"><span class="watch__dot watch__dot--black"></span>${g.guest ? this.channel(g.guest) : `<span class="games-table__open">${esc(t('browsePage.openSeat'))}</span>`}</div>`
            : `<div class="browse-preview__team">${this.channel(g.host)}${g.players != null ? ` <span class="games-table__muted">· ${g.players} ${esc(t('browsePage.players'))}</span>` : ''}</div>`;
        $('browse-preview-players').innerHTML = players;

        // Infos
        const turn = s?.fen ? (s.fen.split(' ')[1] === 'b' ? t('browsePage.blackToPlay') : t('browsePage.whiteToPlay')) : null;
        const facts = [
            [t('browsePage.colStatus'), t(g.status === 'playing' ? 'browsePage.statusPlaying' : 'browsePage.statusWaiting') + (turn && g.status === 'playing' ? ' · ' + turn : '')],
            [t('browsePage.colProgress'), this.progress(g)],
            [t('browsePage.colVote'), null, this.voteLabel(g)],
            [t('spectators.title'), String(g.spectators || 0)],
            [t('browsePage.colTime'), this.duration(g.startedAt)]
        ];
        if (s?.rush) facts.splice(2, 0, ['Score', `${s.rush.score} · ${'❤'.repeat(Math.max(0, s.rush.maxStrikes - s.rush.strikes))}${'🖤'.repeat(Math.min(s.rush.strikes, s.rush.maxStrikes))}`]);
        $('browse-preview-facts').innerHTML = facts.map(([k, v, html]) => `<dt>${esc(k)}</dt><dd>${html ?? esc(v)}</dd>`).join('');

        // Votes en cours
        const votes = s?.draw?.votes?.length ? s.draw.votes : (s?.votes || []);
        const total = votes.reduce((a, v) => a + v.n, 0);
        $('browse-preview-votes').innerHTML = votes.length
            ? votes.slice(0, 5).map((v, i) => {
                const pct = total ? Math.round(v.n * 100 / total) : 0;
                const win = s?.draw && v.m === s.draw.winner && !s.draw.endsIn;
                return `<div class="browse-preview__vote${win ? ' is-winner' : ''}"><span class="browse-preview__vote-bar" style="width:${pct}%;background:${VOTE_COLORS[i % VOTE_COLORS.length]}33"></span><span class="browse-preview__vote-move">${esc(fmtMove(v.m))}</span><span class="browse-preview__vote-n">${v.n} · ${pct}%</span></div>`;
            }).join('')
            : `<p class="browse-preview__empty">${esc(t(g.status === 'playing' ? 'watch.noVotes' : 'browsePage.notStarted'))}</p>`;

        // Actions
        const join = g.join ? this.joinHref(g) : null;
        $('browse-preview-actions').innerHTML = `
            ${join ? `<a class="btn btn--primary btn--sm" data-preview-join href="${esc(join)}"><i class="fas fa-sign-in-alt"></i> ${esc(t('browsePage.join'))}</a>` : ''}
            <a class="btn ${join ? 'btn--ghost' : 'btn--primary'} btn--sm" data-preview-watch href="/watch?g=${encodeURIComponent(g.gameId)}"><i class="fas fa-eye"></i> ${esc(t('browsePage.watch'))}</a>`;

        this.renderBoard(s);
    },

    /** Aperçu d'un match Pronos live : position, joueurs, tournoi, pronostics du vainqueur */
    renderLivePreview(g) {
        const m = g.live;
        $('browse-preview-mode').innerHTML = `${MODE_ICON.picks} ${esc(t(MODE_KEY.picks))}`;
        $('browse-preview-players').innerHTML = `<div class="browse-preview__team">${this.livePlayer(m.white, 'white')}</div><div class="browse-preview__team">${this.livePlayer(m.black, 'black')}</div>`;
        const turn = String(m.fen || '').split(' ')[1] === 'b' ? t('browsePage.blackToPlay') : t('browsePage.whiteToPlay');
        const n = g.spectators || 0;
        $('browse-preview-facts').innerHTML = [
            [t('browsePage.event'), this.liveEvent(m)],
            [t('browsePage.colStatus'), `${t('browsePage.statusPlaying')} · ${turn}`],
            [t('browsePage.colProgress'), this.progress(g)],
            [t('browsePage.colTime'), this.duration(g.startedAt)],
        ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
        const v = m.votes || {};
        $('browse-preview-votes').innerHTML = `<p class="browse-preview__sub">${esc(t('browsePage.winnerPicks'))}</p>` + (n
            ? PICKS.map(([k, c]) => {
                const pct = Math.round((+v[k] || 0) * 100 / n);
                return `<div class="browse-preview__vote"><span class="browse-preview__vote-bar" style="width:${pct}%;background:${PICKS_COLORS[c]}33"></span><span class="browse-preview__vote-move">${esc(t('predict.' + c))}</span><span class="browse-preview__vote-n">${+v[k] || 0} · ${pct}%</span></div>`;
            }).join('')
            : `<p class="browse-preview__empty">${esc(t('tlive.noVotes'))}</p>`);
        $('browse-preview-actions').innerHTML = this.pickBtn(g, 'btn--primary', true);
        this.renderBoard({ fen: m.fen });
    },

    renderBoard(s) {
        const el = $('browse-preview-board');
        if (!el || typeof Chessboard !== 'function') return;
        const position = s?.fen ? s.fen.split(' ')[0] : 'start';
        const orientation = s?.orientation === 'black' ? 'black' : 'white';
        if (!this.board) {
            this.board = Chessboard('browse-preview-board', { position, draggable: false, pieceTheme: PIECES, orientation, showNotation: false });
        } else {
            this.board.orientation(orientation);
            this.board.position(position, false);
        }
        this.resizeBoard();
        el.querySelectorAll('.preview-last').forEach(x => x.classList.remove('preview-last'));
        if (s?.lastMove) for (const sq of [s.lastMove.from, s.lastMove.to]) el.querySelector(`.square-${sq}`)?.classList.add('preview-last');
        $('browse-preview-board-wrap')?.classList.toggle('is-idle', !s?.fen);
    },

    resizeBoard() {
        const el = $('browse-preview-board');
        if (!el || !this.board) return;
        const w = el.clientWidth;
        if (w && w !== this.boardWidth) {
            this.boardWidth = w;
            this.board.resize();
            const s = this.peek;
            if (s?.lastMove) for (const sq of [s.lastMove.from, s.lastMove.to]) el.querySelector(`.square-${sq}`)?.classList.add('preview-last');
        }
    }
};

export default BrowseTable;
