/**
 * Page 24/24 : #/24h
 *
 * Une partie permanente tenue par le serveur (station.js) : partie, récap, vote du mode,
 * votes des options, inscription, puis la partie suivante. Tout le monde regarde ;
 * les viewers connectés à Twitch s'inscrivent, votent les coups de leur équipe et les
 * prochains réglages. Les mêmes votes viendront ensuite du chat de la chaîne 24/24.
 */
import twitchAuth from '../core/twitchAuth.js';
import VotingWheel from '../components/wheel.js';
import WheelBand from '../components/wheelBand.js';
import { fillVoteTimer } from '../components/voteTimer.js';
import { renderPodium, renderHistory, paintMoveChips, markPodiumWinner, morphPodiumToWheel, revealWinner, clearWinner } from '../components/voteViews.js';
import { paletteColors } from '../components/votePalettes.js';
import { CamSender, CamPlayer, CAM_QUALITIES, listCameras, camSupported } from '../components/liveCam.js';

const t = (key, params, fallback) => {
    const s = window.i18n?.t(key, params);
    return s && s !== key ? s : (fallback ?? key);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const PIECES = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const STEPS = ['play', 'recap', 'voteMode', 'voteOptions', 'signup'];
const PIECE_ICONS = { w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' }, b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' } };
const clean = (m) => String(m || '').replace(/[+#!?]/g, '');
const COLORS = paletteColors('violet');

/** Libellé d'un choix de vote (mode, durée du tour, décision, niveau) */
function choiceLabel(ballot, c) {
    if (ballot === 'mode') return t(`h24.mode.${c}`, null, c);
    if (ballot === 'turn') return t('h24.seconds', { n: c }, `${c} s`);
    if (ballot === 'decision') return t(`h24.decision.${c}`, null, c);
    if (ballot === 'votes') return t(Number(c) === 1 ? 'h24.votesOne' : 'h24.votesN', { n: c }, `${c} vote(s)`);
    if (ballot === 'anonymity') return t(`h24.anonymity.${c}`, null, c);
    if (ballot === 'spin') return t(`h24.spin.${c}`, null, c);
    return String(c);
}
const CHOICE_ICON = { teams: 'fa-chess', rush: 'fa-bolt', majority: 'fa-check-double', draw: 'fa-dice', none: 'fa-eye', secret: 'fa-eye-slash',
    fast: 'fa-forward', normal: 'fa-play', slow: 'fa-hourglass-half' };
/** « 1, 2 ou 3 » */
const numList = (n) => {
    const nums = Array.from({ length: n }, (_, i) => String(i + 1));
    return nums.length < 2 ? nums.join('') : `${nums.slice(0, -1).join(', ')} ${t('h24.or', null, 'ou')} ${nums[nums.length - 1]}`;
};
const chatHint = (key, params, fallback) => `<p class="h24-chat-hint"><i class="fab fa-twitch"></i> ${esc(t(key, params, fallback))}</p>`;
const myVotes = (me) => Array.isArray(me?.votes) ? me.votes : [];

/** Le Phantom vu de la régie : 'off' (pas en direct), 'ok', 'busy' (pièces en mouvement), 'error' (décroché) */
function phantomStatus(live) {
    const p = window.phantomChessboard;
    if (!live) return 'off';
    if (!p?.isConnected) return 'error';
    return p.isMoving || p.moveQueue?.length ? 'busy' : 'ok';
}
const loadRegie = () => { try { return JSON.parse(localStorage.getItem('h24Regie')) || {}; } catch { return {}; } };
const loadCam = () => { try { return JSON.parse(localStorage.getItem('h24Cam')) || {}; } catch { return {}; } };

const H24Page = {
    socket: null,
    regie: { live: false, channel: loadRegie().channel || '', hidden: !!loadRegie().hidden },
    // Caméra de la régie (émission) et lecteur de la vue réelle (réception)
    cam: { deviceId: loadCam().deviceId || '', quality: CAM_QUALITIES[loadCam().quality] ? loadCam().quality : 'mid', error: '', devices: null },
    camSender: null,
    camPlayer: null,
    camWatching: false,
    liveFolded: (() => { try { return localStorage.getItem('h24LiveFolded') === '1'; } catch { return false; } })(),
    regieFolded: (() => { try { return localStorage.getItem('h24RegieFolded') === '1'; } catch { return false; } })(),
    board: null,
    state: null,
    me: { login: null, team: null, votes: [], maxVotes: 1, ballot: null },
    clock: null,
    boardKey: null,
    // Style du tirage, choisi par chaque viewer : bande sous l'échiquier ou roue à la place du podium
    style: (() => { try { return localStorage.getItem('h24DrawStyle') === 'wheel' ? 'wheel' : 'band'; } catch { return 'band'; } })(),

    init() {
        if (!this.socket) this.connect();
        if (!this._bound) this.bind();
        this.ensureBoard();
        requestAnimationFrame(() => this.board?.resize());
        this.render();
    },

    stop() {
        if (!this.socket) return;
        this.camSender?.stop(true);
        this.camPlayer?.close();
        this.camWatching = false;
        this.socket.emit('h24:leave');
        this.socket.disconnect();
        this.socket = null;
        clearInterval(this.clock);
        this.clock = null;
    },

    token() {
        // Connexions de test en local (le serveur ne les accepte qu'avec STATION_DEV=1)
        try { const dev = localStorage.getItem('h24Dev'); if (dev) return `dev:${dev}`; } catch {}
        return twitchAuth.token || null;
    },

    connect() {
        const socket = io({ transports: ['websocket', 'polling'] });
        this.socket = socket;
        const join = () => socket.emit('h24:join', { token: this.token() });
        socket.on('connect', () => { this.camWatching = false; join(); this.renderLive(); });
        // Vue réelle par la caméra de la régie
        socket.on('h24:cam:cfg', (cfg) => this.camPlayer?.configure(cfg));
        socket.on('h24:cam:chunk', (meta, data) => this.camPlayer?.push(meta, data));
        socket.on('h24:cam:off', () => this.camPlayer?.close());
        socket.on('h24:cam:taken', () => {
            this.camSender?.stop(true);
            this.cam.error = t('h24.regie.camTaken', null, 'Diffusion reprise par un autre onglet');
            this.renderRegie(true);
        });
        socket.on('h24:state', (st) => {
            this.skew = st.now - Date.now();
            this.state = st;
            this.render();
        });
        socket.on('h24:me', (me) => {
            this.me = me || {};
            // La régie se présente (de nouveau après une reconnexion ou un redémarrage du serveur)
            if (this.me.regie && this.regieSent !== socket.id) {
                this.regieSent = socket.id; this.regiePhantom = null; this.sendRegie(true);
                // Chaîne gardée dans ce navigateur mais inconnue du serveur (jamais validée, ou perdue) : envoyée d'office
                if (this.regie.channel && !this.regie.hidden && !this.state?.regie?.channel) socket.emit('h24:regie', { channel: this.regie.channel });
                if (this.camSender?.active) { this.camSender.setSocket(socket); this.camSender.announce(); }   // reconnexion : la caméra reprend
            }
            this.render();
        });
        this.clock = setInterval(() => { this.renderClock(); this.regieTick(); this.camTick(); }, 250);
        if (!this._authBound) {
            this._authBound = true;
            window.addEventListener('twitchAuthChange', () => { if (this.socket?.connected) this.socket.emit('h24:join', { token: this.token() }); });
        }
    },

    bind() {
        this._bound = true;
        const page = $('page-h24');
        page.addEventListener('click', (e) => {
            const choice = e.target.closest('[data-h24-choice]');
            if (choice) { this.socket?.emit('h24:ballot', { choice: choice.dataset.h24Choice }); return; }
            if (e.target.closest('[data-h24-signup]')) { this.socket?.emit('h24:signup'); return; }
            const fp = e.target.closest('[data-h24-force]');
            if (fp) { this.socket?.emit('h24:force', { phase: fp.dataset.h24Force }); return; }
            if (e.target.closest('[data-h24-quit]')) { this.socket?.emit('h24:quit'); return; }
            if (e.target.closest('[data-h24-login]')) { twitchAuth.login?.(); return; }
            const st = e.target.closest('[data-h24-style]');
            if (st) { this.setStyle(st.dataset.h24Style); return; }
            const rg = e.target.closest('[data-h24-regie]');
            if (rg) { this.regieAction(rg.dataset.h24Regie); return; }
            if (e.target.closest('[data-h24-live-toggle]')) { this.foldLive(!this.liveFolded); return; }
            const mv = e.target.closest('[data-h24-move]');
            if (mv && !mv.disabled) this.socket?.emit('h24:vote', { move: mv.dataset.h24Move });
        });
        $('h24-move-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = $('h24-move-input');
            const move = input.value.trim();
            if (move) this.socket?.emit('h24:vote', { move });
            input.value = '';
        });
        window.addEventListener('resize', () => { if (this.socket) this.board?.resize(); });
    },

    // ------------------------------------------------------------------ échiquier
    myTurn() {
        const s = this.state;
        const g = s?.game;
        if (!s || s.phase !== 'play' || !g || g.result || !g.turnEndsAt || !this.me.team) return false;
        if (s.mode === 'rush') return g.puzzle?.status === 'playing' && g.turn === g.puzzle.side;
        // Camp sans joueur : l'autre équipe joue aussi ses coups
        return g.turn === this.me.team || !(s.teams?.[g.turn] || []).length;
    },

    orientation() {
        const s = this.state;
        if (s?.mode === 'rush') return s.game?.puzzle?.side === 'b' ? 'black' : 'white';
        return this.me.team === 'b' ? 'black' : 'white';
    },

    ensureBoard() {
        const el = $('h24-board');
        if (!el || this.board || typeof Chessboard !== 'function') return;
        // Coordonnées en gros autour du plateau, comme sur les autres échiquiers
        window.BoardCoords?.attach('h24-board');
        this.board = Chessboard('h24-board', {
            position: 'start',
            draggable: true,
            pieceTheme: PIECES,
            onDragStart: (src, piece) => this.myTurn() && piece[0] === this.state.game.turn,
            onDrop: (from, to) => {
                const g = this.state?.game;
                if (!g) return 'snapback';
                const chess = new Chess(g.fen);
                const m = chess.move({ from, to, promotion: 'q' });
                if (!m) return 'snapback';
                this.socket?.emit('h24:vote', { move: m.san });
                return 'snapback';
            }
        });
        this.annotations = window.BoardAnnotations?.attach('h24-board', { draggable: false }) || null;
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => {
                const w = el.clientWidth;
                if (w && w !== this.boardWidth && this.board) { this.boardWidth = w; this.board.resize(); }
            }).observe(el);
        }
    },

    renderBoard() {
        this.ensureBoard();
        const g = this.state?.game;
        if (!this.board) return;
        const fen = g?.fen || 'start';
        const orient = this.orientation();
        if (this.board.orientation() !== orient) this.board.orientation(orient);
        // Caméra (filmée côté Blancs) : retournée quand le viewer voit l'échiquier côté Noirs
        document.querySelector('#h24-live-frame .h24-live__cam')?.classList.toggle('is-flipped', orient === 'black');
        const key = fen + orient;
        if (key !== this.boardKey) { this.board.position(fen, this.boardKey != null); this.boardKey = key; }
        $('h24-board-wrap')?.classList.toggle('is-my-turn', this.myTurn());

        // Flèche : coup tiré au sort, sinon coup en tête, sinon dernier coup joué
        let overlay = null;
        if (g && !g.result) {
            const find = (san) => {
                try { const c = new Chess(g.fen); return c.move(san); } catch { return null; }
            };
            if (g.draw) {
                // Rien pendant que la roue tourne : le suspense reste entier
                const m = !this.revealing && find(g.draw.winner);
                if (m) overlay = { kind: 'win', from: m.from, to: m.to, label: g.draw.random ? `🎲 ${m.san}` : m.san };
            } else {
                const m = g.votes?.[0] && find(g.votes[0].move);
                if (m) overlay = { kind: 'lead', from: m.from, to: m.to };
            }
        }
        this.annotations?.setOverlay?.(overlay);
        this.highlightLast(g?.lastMove);
    },

    highlightLast(last) {
        const el = $('h24-board');
        if (!el) return;
        el.querySelectorAll('.h24-last').forEach(sq => sq.classList.remove('h24-last'));
        if (!last) return;
        [last.from, last.to].forEach(sq => el.querySelector(`.square-${sq}`)?.classList.add('h24-last'));
    },

    // ------------------------------------------------------------------ rendu
    render() {
        const page = $('page-h24');
        if (!page?.classList.contains('is-active')) return;
        const s = this.state;
        page.dataset.phase = s?.phase || '';
        page.dataset.mode = s?.mode || '';
        this.renderSteps();
        this.renderTeams();
        this.renderAccount();
        this.renderStage();
        this.renderMoves();
        this.renderStyle();
        this.renderBoard();
        this.renderClock();
        this.renderRegie();
        this.renderLive();
        this.mirror();
    },

    // ------------------------------------------------------------------ régie : Phantom et vue réelle
    saveRegie() {
        try { localStorage.setItem('h24Regie', JSON.stringify({ channel: this.regie.channel, hidden: this.regie.hidden })); } catch {}
    },

    /** Envoie l'état de la régie au serveur (tout, ou seulement le Phantom s'il a changé) */
    sendRegie(all = false) {
        if (!this.me.regie || !this.socket) return;
        const phantom = phantomStatus(this.regie.live);
        if (!all && phantom === this.regiePhantom) return;
        this.regiePhantom = phantom;
        this.socket.emit('h24:regie', { phantom });
    },

    regieTick() {
        if (!this.me.regie) return;
        const before = this.regiePhantom;
        this.sendRegie();
        if (before !== this.regiePhantom) this.renderRegie();
    },

    /** Le vrai échiquier suit la partie : chaque nouvelle position part au Phantom (file d'attente) */
    mirror() {
        const p = window.phantomChessboard;
        const fen = this.state?.game?.fen;
        if (!this.me.regie || !this.regie.live || !p?.isConnected || !fen) return;
        if (fen === this.mirroredFen) return;
        this.mirroredFen = fen;
        p.enabled = true;
        p.syncPosition(fen);
    },

    async regieAction(action) {
        const p = window.phantomChessboard;
        if (action === 'fold') {
            this.regieFolded = !this.regieFolded;
            try { localStorage.setItem('h24RegieFolded', this.regieFolded ? '1' : '0'); } catch {}
            this.renderRegie(true);
            return;
        }
        if (action === 'connect') {
            if (!p) return;
            await p.connect();
            this.mirroredFen = null;
        } else if (action === 'live') {
            this.regie.live = !this.regie.live;
            this.mirroredFen = null;
            this.saveRegie();
        } else if (action === 'sync') {
            this.mirroredFen = null;
            if (p) p.lastFenSent = null;
        } else if (action === 'pause') {
            this.socket?.emit('h24:regie', { paused: !this.state?.regie?.paused });
        } else if (action === 'channel') {
            const input = $('h24-regie-channel');
            this.regie.channel = (input?.value || '').trim();
            this.regie.hidden = false;
            this.saveRegie();
            this.socket?.emit('h24:regie', { channel: this.regie.channel });
        } else if (action === 'cam') {
            await this.toggleCam();
        } else if (action === 'hide') {
            this.regie.hidden = true;
            this.saveRegie();
            this.socket?.emit('h24:regie', { channel: '' });
        } else if (action === 'show') {
            this.regie.hidden = false;
            this.saveRegie();
            this.socket?.emit('h24:regie', { channel: this.regie.channel || '' });
        }
        this.sendRegie();
        this.mirror();
        this.renderRegie(true);
    },

    renderRegie(force = false) {
        const el = $('h24-regie');
        if (!el) return;
        el.hidden = !this.me.regie;
        if (!this.me.regie) return;
        const p = window.phantomChessboard;
        const status = phantomStatus(this.regie.live);
        const server = this.state?.regie || {};
        if (this.cam.devices === null) { this.cam.devices = []; listCameras().then(d => { this.cam.devices = d; this.renderRegie(true); }); }
        const camLive = !!this.camSender?.active;
        const key = [status, !!p?.isConnected, this.regie.live, !!server.paused, server.channel, this.state?.pauseReason, camLive, this.cam.error, this.cam.devices.length, this.regieFolded, !!server.chat].join('|');
        if (!force && key === this.regieKey) return;
        this.regieKey = key;
        const typing = document.activeElement?.id === 'h24-regie-channel';
        const label = {
            off: t('h24.regie.off', null, 'Phantom hors direct'),
            ok: t('h24.regie.ok', null, 'Phantom en direct'),
            busy: t('h24.regie.busy', null, 'Le Phantom déplace les pièces…'),
            error: t('h24.regie.error', null, 'Phantom déconnecté : la station attend')
        }[status];
        const shown = server.channel || '';
        el.innerHTML = `
            <button type="button" class="h24-regie__head" data-h24-regie="fold" aria-expanded="${!this.regieFolded}">
                <i class="fas fa-sliders-h"></i> ${esc(t('h24.regie.title', null, 'Régie'))}
                <span class="h24-regie__dot h24-regie__dot--${status}" title="${esc(label)}"></span>
                <i class="fas fa-chevron-${this.regieFolded ? 'down' : 'up'} h24-regie__chev"></i>
            </button>
            <div class="h24-regie__body"${this.regieFolded ? ' hidden' : ''}>
            <div class="h24-regie__row">
                <span class="h24-regie__dot h24-regie__dot--${status}"></span><span class="h24-regie__status">${esc(label)}</span>
            </div>
            <div class="h24-regie__row">
                ${p?.isConnected ? '' : `<button type="button" class="btn btn--sm" data-h24-regie="connect"><i class="fab fa-bluetooth-b"></i> ${esc(t('h24.regie.connect', null, 'Connecter le Phantom'))}</button>`}
                <button type="button" class="btn btn--sm${this.regie.live ? ' btn--primary' : ''}" data-h24-regie="live"><i class="fas fa-${this.regie.live ? 'link' : 'unlink'}"></i> ${esc(this.regie.live ? t('h24.regie.liveOn', null, 'Suit la partie') : t('h24.regie.liveOff', null, 'Suivre la partie'))}</button>
                ${this.regie.live && p?.isConnected ? `<button type="button" class="btn btn--sm" data-h24-regie="sync" title="${esc(t('h24.regie.syncHint', null, 'Renvoyer la position au Phantom'))}"><i class="fas fa-sync-alt"></i></button>` : ''}
                <button type="button" class="btn btn--sm${server.paused ? ' btn--primary' : ''}" data-h24-regie="pause"><i class="fas fa-${server.paused ? 'play' : 'pause'}"></i> ${esc(server.paused ? t('h24.regie.resume', null, 'Reprendre') : t('h24.regie.pause', null, 'Pause'))}</button>
            </div>
            <form class="h24-regie__row h24-regie__channel" data-h24-regie-form>
                <input type="text" id="h24-regie-channel" maxlength="60" autocomplete="off" placeholder="${esc(t('h24.regie.channelPh', null, 'Chaîne Twitch de la vue réelle'))}" value="${esc(this.regie.channel || '')}">
                <button type="submit" class="btn btn--sm${(this.regie.channel || '').toLowerCase() !== shown ? ' btn--primary' : ''}" title="${esc(t('h24.regie.channelSet', null, 'Afficher cette chaîne'))}"><i class="fas fa-check"></i></button>
                ${shown ? `<button type="button" class="btn btn--sm btn--ghost" data-h24-regie="hide" title="${esc(t('h24.regie.channelHide', null, 'Retirer la vue réelle'))}"><i class="fas fa-eye-slash"></i></button>` : ''}
            </form>
            <div class="h24-regie__hint">${shown ? esc(t('h24.regie.channelOn', { c: shown }, `Vue réelle : twitch.tv/${shown}`)) : esc(t('h24.regie.channelOff', null, 'Pas de vue réelle pour les viewers'))}</div>
            ${shown ? `<div class="h24-regie__hint"><span class="h24-regie__dot h24-regie__dot--${server.chat ? 'ok' : 'error'}"></span> ${esc(t(server.chat ? 'h24.regie.chatOn' : 'h24.regie.chatOff', { c: shown }, ''))}</div>`
                : `<div class="h24-regie__hint h24-regie__hint--warn"><span class="h24-regie__dot h24-regie__dot--error"></span> ${esc(t('h24.regie.chatNone', null, 'Chat Twitch non lu : indique ta chaîne et valide'))}</div>`}
            ${this.camPanelHtml(camLive)}
            </div>`;
        el.querySelectorAll('[data-h24-cam-pref]').forEach(sel => sel.addEventListener('change', () => this.setCamPref(sel.dataset.h24CamPref, sel.value)));
        if (typing) { const i = $('h24-regie-channel'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
        el.querySelector('[data-h24-regie-form]')?.addEventListener('submit', (e) => { e.preventDefault(); this.regieAction('channel'); });
        // Quitter le champ suffit à valider la chaîne
        $('h24-regie-channel')?.addEventListener('change', () => this.regieAction('channel'));
    },

    camPanelHtml(camLive) {
        if (!camSupported.send()) return `<div class="h24-regie__hint">${esc(t('h24.regie.camNoSupport', null, 'Caméra : utilise Chrome ou Edge pour diffuser'))}</div>`;
        const q = { low: t('h24.regie.camLow', null, 'Basse'), mid: t('h24.regie.camMid', null, 'Moyenne'), high: t('h24.regie.camHigh', null, 'Haute') };
        const devs = [{ id: '', label: t('h24.regie.camDefault', null, 'Caméra par défaut') }, ...this.cam.devices];
        const info = this.camSender?.info;
        const hint = this.cam.error ? `<span class="h24-regie__err">${esc(this.cam.error)}</span>`
            : camLive && info ? esc(t('h24.regie.camOn', { w: info.width, h: info.height, fps: info.fps, codec: info.codec }, `Caméra en direct : ${info.width}×${info.height} · ${info.fps} i/s · ${info.codec}`))
            : esc(t('h24.regie.camOff', null, 'Caméra : la vue réelle passe par le site, sans Twitch'));
        return `
            <div class="h24-regie__row h24-regie__cam">
                <select data-h24-cam-pref="deviceId" title="${esc(t('h24.regie.camDevice', null, 'Caméra'))}">
                    ${devs.map(d => `<option value="${esc(d.id)}"${d.id === this.cam.deviceId ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}
                </select>
                <select data-h24-cam-pref="quality" title="${esc(t('h24.regie.camQuality', null, 'Qualité'))}">
                    ${Object.keys(CAM_QUALITIES).map(k => `<option value="${k}"${k === this.cam.quality ? ' selected' : ''}>${esc(q[k])} (${CAM_QUALITIES[k].height}p)</option>`).join('')}
                </select>
                <button type="button" class="btn btn--sm${camLive ? ' btn--primary' : ''}" data-h24-regie="cam"><i class="fas fa-${camLive ? 'stop' : 'camera'}"></i> ${esc(camLive ? t('h24.regie.camStop', null, 'Arrêter la caméra') : t('h24.regie.camStart', null, 'Diffuser ma caméra'))}</button>
            </div>
            <div class="h24-regie__hint">${hint}</div>`;
    },

    setCamPref(name, value) {
        if (name === 'quality' && !CAM_QUALITIES[value]) return;
        this.cam[name] = value;
        try { localStorage.setItem('h24Cam', JSON.stringify({ deviceId: this.cam.deviceId, quality: this.cam.quality })); } catch {}
        if (this.camSender?.active) this.startCam();   // en direct : on relance avec le nouveau réglage
    },

    async toggleCam() {
        if (this.camSender?.active) { this.camSender.stop(); this.cam.error = ''; return; }
        await this.startCam();
    },

    async startCam() {
        if (!this.me.regie || !this.socket) return;
        if (!this.camSender) {
            this.camSender = new CamSender(this.socket, (st) => {
                if (st.error) this.cam.error = st.error;
                this.renderRegie(true);
            });
        }
        this.camSender.setSocket(this.socket);
        this.cam.error = '';
        try {
            await this.camSender.start({ deviceId: this.cam.deviceId, quality: this.cam.quality });
            this.cam.devices = await listCameras();   // les noms des caméras sont visibles une fois l'accès accordé
        } catch (e) {
            this.cam.error = e?.name === 'NotAllowedError' ? t('h24.regie.camDenied', null, 'Accès à la caméra refusé par le navigateur')
                : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? t('h24.regie.camMissing', null, 'Caméra introuvable')
                : String(e?.message || e);
        }
        this.renderRegie(true);
    },

    /** Lecteur de la vue réelle : message tant que la caméra ne donne pas d'image */
    camTick() {
        const msg = $('h24-live-msg');
        if (!msg || !this.camPlayer) return;
        const text = this.camPlayerState === 'unsupported' ? t('h24.camUnsupported', null, 'Ton navigateur ne peut pas lire cette vidéo : mets-le à jour (Chrome, Edge, Firefox ou Safari récents)')
            : this.camPlayer.stalled(5000) ? t('h24.camWaiting', null, 'Connexion à la caméra…') : '';
        if (msg.textContent !== text) { msg.textContent = text; msg.hidden = !text; }
    },

    foldLive(folded) {
        this.liveFolded = folded;
        try { localStorage.setItem('h24LiveFolded', folded ? '1' : '0'); } catch {}
        this.renderLive();
    },

    /** Petit bloc à part : le lecteur Twitch de la chaîne qui filme le vrai échiquier */
    renderLive() {
        const box = $('h24-live');
        if (!box) return;
        const channel = this.state?.regie?.channel || '';
        const camOn = !!this.state?.regie?.cam;   // la caméra de la régie passe avant la chaîne Twitch
        box.hidden = !channel && !camOn;
        box.classList.toggle('is-folded', this.liveFolded);
        const frame = $('h24-live-frame');
        const src = this.liveFolded ? ''
            : camOn ? 'cam'
            : channel ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(location.hostname)}&muted=true&autoplay=true`
            : '';
        if (frame.dataset.src !== src) {
            frame.dataset.src = src;
            this.camPlayer?.close();
            this.camPlayer = null;
            // Nouveau lecteur : on se désabonne puis on redemande le flux (réglages + images depuis la dernière clé)
            if (this.camWatching) this.socket?.emit('h24:cam:watch', { on: false });
            this.camWatching = false;
            if (src === 'cam') {
                frame.innerHTML = `<canvas class="h24-live__cam"></canvas><div class="h24-live__msg" id="h24-live-msg" hidden></div>`;
                this.camPlayerState = 'waiting';
                this.camPlayer = new CamPlayer(frame.querySelector('canvas'), (st) => { this.camPlayerState = st; this.camTick(); });
                frame.querySelector('canvas').classList.toggle('is-flipped', this.orientation() === 'black');
            } else {
                frame.innerHTML = src ? `<iframe src="${esc(src)}" allowfullscreen allow="autoplay; fullscreen" title="${esc(t('h24.liveTitle', null, 'Vue réelle'))}"></iframe>` : '';
            }
        }
        // Le flux de la caméra n'arrive que si on le regarde (bloc déplié)
        const watch = src === 'cam';
        if (watch !== this.camWatching && this.socket?.connected) {
            this.camWatching = watch;
            this.socket.emit('h24:cam:watch', { on: watch });
        }
        const link = $('h24-live-link');
        if (link) {
            if (camOn) { link.textContent = t('h24.camLive', null, 'en direct'); link.removeAttribute('href'); }
            else { link.textContent = channel ? `twitch.tv/${channel}` : ''; link.href = channel ? `https://twitch.tv/${encodeURIComponent(channel)}` : '#'; }
        }
        const tg = $('h24-live-toggle');
        if (tg) {
            tg.innerHTML = `<i class="fas fa-chevron-${this.liveFolded ? 'down' : 'up'}"></i>`;
            tg.title = this.liveFolded ? t('h24.liveShow', null, 'Afficher') : t('h24.liveHide', null, 'Replier');
        }
    },

    remaining(at) {
        if (!at) return null;
        return Math.max(0, Math.ceil((at - (Date.now() + (this.skew || 0))) / 1000));
    },

    /** Barre du bloc de vote : temps du tour en partie, temps de la phase sinon */
    renderClock() {
        const s = this.state;
        const box = $('h24-timer');
        if (!s || !box) return;
        const g = s.game;
        const inPlay = s.phase === 'play' && !!g;
        const at = inPlay ? (g.draw || g.result ? null : g.turnEndsAt) : s.endsAt;
        if (!at && !s.paused) { box.hidden = true; return; }
        box.hidden = false;
        const left = s.paused ? null : this.remaining(at);
        // Durée totale : la plus grande valeur vue pour cette échéance
        const key = `${s.phase}:${at}`;
        if (this.clockKey !== key) { this.clockKey = key; this.clockTotal = left || 1; }
        this.clockTotal = Math.max(this.clockTotal, left || 0);
        $('h24-timer-value').textContent = left == null ? '--'
            : left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : String(left);
        const critical = inPlay && left != null && left <= 5;
        $('h24-timer-label').textContent = s.paused ? (s.pauseReason === 'phantom' ? t('h24.pausePhantom', null, 'Phantom…') : t('timerRing.paused', null, 'pause'))
            : critical ? t('timerRing.hurry', null, 'votez !') : t('timerRing.seconds', null, 'secondes');
        const exact = s.paused || !at ? left : Math.max(0, (at - (Date.now() + (this.skew || 0))) / 1000);
        if (this.clockKey !== this.fillKey) { this.fillKey = this.clockKey; fillVoteTimer(box, 0, 0); }
        fillVoteTimer(box, 1 - (exact || 0) / this.clockTotal, s.paused ? 0 : 0.25);
        box.classList.toggle('is-critical', critical);
        $('h24-wheel-area')?.classList.toggle('is-soon', inPlay && left != null && left <= 1);
    },

    renderSteps() {
        const s = this.state;
        const el = $('h24-steps');
        if (!el) return;
        const cur = STEPS.indexOf(s?.phase);
        // Régie : chaque étape se force au clic (tests)
        const force = (p) => this.me.regie ? ` data-h24-force="${p}" title="${esc(t('h24.forceStep', null, 'Régie : passer à cette étape'))}"` : '';
        el.innerHTML = STEPS.map((p, i) => `<li class="h24-step${i === cur ? ' is-current' : ''}${cur > i ? ' is-done' : ''}"${force(p)}>
            <span class="h24-step__dot">${i + 1}</span><span>${esc(t(`h24.phase.${p}`, null, p))}</span></li>`).join('');
        const title = $('h24-mode');
        if (title) title.textContent = s?.mode ? t(`h24.mode.${s.mode}`, null, s.mode) : '24/24';
        const opts = $('h24-options');
        if (opts) {
            const o = s?.options || {};
            const parts = [];
            if (o.turn) parts.push(choiceLabel('turn', o.turn));
            if (s?.mode === 'teams' && o.decision) parts.push(choiceLabel('decision', o.decision));
            if (s?.mode === 'teams' && o.decision === 'draw' && o.spin) parts.push(choiceLabel('spin', o.spin));
            if (o.votes > 1) parts.push(choiceLabel('votes', o.votes));
            if (o.anonymity === 'secret') parts.push(choiceLabel('anonymity', o.anonymity));
            opts.textContent = parts.join(' · ');
        }
        const viewers = $('h24-viewers');
        if (viewers) viewers.textContent = String(s?.viewers || 0);
    },

    renderTeams() {
        const s = this.state;
        const el = $('h24-teams');
        if (!el) return;
        const teams = s?.teams || { w: [], b: [] };
        const solo = s?.mode === 'rush';
        const list = (side) => {
            const names = teams[side] || [];
            const items = names.slice(0, 40).map(n => `<li class="${n === this.me.login ? 'is-me' : ''}">${esc(n)}</li>`).join('');
            const more = names.length > 40 ? `<li class="h24-team__more">+${names.length - 40}</li>` : '';
            const label = solo ? t('h24.players', null, 'Joueurs') : t(side === 'w' ? 'h24.white' : 'h24.black', null, side === 'w' ? 'Blancs' : 'Noirs');
            const turn = s?.phase === 'play' && s.game?.turn === side && !solo ? ' is-turn' : '';
            return `<div class="h24-team h24-team--${side}${turn}">
                <div class="h24-team__head"><span class="h24-team__swatch"></span>${esc(label)}<span class="h24-team__count">${names.length}</span></div>
                <ul class="h24-team__list">${items || `<li class="h24-team__empty">${esc(t('h24.nobody', null, 'Personne'))}</li>`}${more}</ul>
            </div>`;
        };
        el.innerHTML = solo ? list('w') : list('w') + list('b');
    },

    renderAccount() {
        const el = $('h24-account');
        if (!el) return;
        const s = this.state;
        const login = this.me.login;
        if (!login) {
            el.innerHTML = `<p class="h24-account__hint">${esc(t('h24.loginHint', null, 'Connecte-toi avec Twitch pour t\'inscrire et voter.'))}</p>
                <button type="button" class="btn btn--sm btn--twitch h24-account__btn" data-h24-login><i class="fab fa-twitch"></i> ${esc(t('h24.login', null, 'Se connecter avec Twitch'))}</button>`;
            return;
        }
        const team = this.me.team;
        const canJoin = s && (s.phase === 'signup' || s.phase === 'play');
        if (team) {
            const label = s?.mode === 'rush' ? t('h24.inGame', null, 'Tu joues') : t(team === 'w' ? 'h24.inWhite' : 'h24.inBlack', null, team === 'w' ? 'Tu joues les Blancs' : 'Tu joues les Noirs');
            el.innerHTML = `<p class="h24-account__me h24-account__me--${team}"><strong>${esc(login)}</strong> · ${esc(label)}</p>
                <button type="button" class="btn btn--ghost btn--sm h24-account__btn" data-h24-quit>${esc(t('h24.quit', null, 'Quitter la partie'))}</button>`;
        } else {
            el.innerHTML = `<p class="h24-account__me"><strong>${esc(login)}</strong> · ${esc(t('h24.spectator', null, 'Spectateur'))}</p>
                ${canJoin ? `<button type="button" class="btn btn--sm btn--primary h24-account__btn" data-h24-signup><i class="fas fa-user-plus"></i> ${esc(t('h24.join', null, 'Rejoindre'))}</button>` : `<p class="h24-account__hint">${esc(t('h24.joinLater', null, 'Les inscriptions ouvrent après les votes.'))}</p>`}`;
        }
    },

    /** Entre deux parties : récap, votes ou inscription à la place du podium */
    renderStage() {
        const s = this.state;
        if (!s) return;
        const card = $('h24-card');
        const slot = $('h24-votes-panel');
        const inGame = s.phase === 'play' && !!s.game;
        card.hidden = inGame;
        slot.hidden = !inGame;
        if (inGame) this.renderPlay();
        else {
            card.innerHTML = this.cardHtml();
            const turn = $('h24-turn');
            if (turn) { turn.textContent = ''; turn.className = 'watch__status h24-turn'; }
            $('h24-hint').textContent = t(`h24.phase.${s.phase}`, null, '');
            $('h24-hint').classList.remove('is-active');
            $('h24-move-form').hidden = true;
            $('h24-score').hidden = true;
            this.hideDraw();
        }
    },

    /** Coups disponibles, groupés par pièce comme sur les autres échiquiers ; cliquables quand c'est à toi */
    renderMoves() {
        const list = $('h24-moves-list');
        if (!list) return;
        const g = this.state?.phase === 'play' ? this.state.game : null;
        let moves = [];
        if (g && !g.result && typeof Chess === 'function') {
            try { moves = new Chess(g.fen).moves(); } catch { moves = []; }
        }
        const turn = g?.turn === 'b' ? 'b' : 'w';
        const mine = this.myTurn() && !g?.draw;
        const sig = `${g?.fen}|${mine}|${myVotes(this.me).join(',')}`;
        if (sig !== this.movesSig) {
            this.movesSig = sig;
            const groups = { P: [], N: [], B: [], R: [], Q: [], K: [], O: [] };
            moves.forEach(m => {
                const c = clean(m);
                if (c.startsWith('O-')) groups.O.push(c);
                else if ('KQRBN'.includes(c[0])) groups[c[0]].push(c);
                else groups.P.push(c);
            });
            const picked = myVotes(this.me).map(clean);
            list.innerHTML = Object.entries(groups).filter(([, a]) => a.length).map(([piece, a]) => `
                <ul class="moves-group"><span class="piece-icon">${piece === 'O' ? '⬚' : PIECE_ICONS[turn][piece]}</span>${
                    a.map(m => `<li><button type="button" ${mine ? '' : 'tabindex="-1" disabled'} class="${picked.includes(m) ? 'is-mine' : ''}" data-move="${esc(m)}" data-h24-move="${esc(m)}">${esc(m)}</button></li>`).join('')
                }</ul>`).join('');
        }
        paintMoveChips($('h24-moves'), g?.votes || [], COLORS);
        $('h24-moves').classList.toggle('is-empty', !moves.length);
    },

    // ------------------------------------------------------------------ style du tirage
    setStyle(style) {
        style = style === 'wheel' ? 'wheel' : 'band';
        if (style === this.style) return;
        this.style = style;
        try { localStorage.setItem('h24DrawStyle', style); } catch {}
        this.renderStyle();
    },

    renderStyle() {
        document.querySelectorAll('[data-h24-style]').forEach(b => b.classList.toggle('is-active', b.dataset.h24Style === this.style));
        // Pendant un tirage, on garde l'affichage en cours
        if (this.wheel?.isSpinning || this.revealing) return;
        this.dock(this.style);
        // Bande : sa place reste réservée, l'échiquier garde la même taille d'une phase à l'autre
        $('h24-wheel-area')?.classList.toggle('is-reserved', this.style === 'band');
    },

    /** Bande sous l'échiquier ; roue classique à la place du podium */
    dock(style) {
        const area = $('h24-wheel-area');
        const slot = $('h24-votes-panel');
        if (!area || !slot) return;
        const docked = style !== 'band';
        area.classList.toggle('wheel-area--band', !docked);
        area.classList.toggle('wheel-area--docked', docked);
        slot.classList.toggle('votes-slot--wheel', docked);
        if (docked) {
            if (area.parentElement !== slot) slot.appendChild(area);
        } else {
            const after = document.querySelector('#page-h24 .board-wrapper');
            if (after && area.previousElementSibling !== after) after.after(area);
        }
    },

    hideDraw() {
        if (!this.drawSig) return;
        this.drawSig = null;
        this.revealing = false;
        // Onglet caché : la roue gelée finirait son tour plus tard et réafficherait le coup par-dessus le vote
        if (this.wheel?.isSpinning) this.wheel.abort?.();
        const slot = $('h24-votes-panel');
        slot?.classList.remove('is-drawing');
        $('h24-wheel-area')?.classList.remove('is-visible', 'is-spinning');
        clearWinner(slot);
    },

    cardHtml() {
        const s = this.state;
        const clock = '';
        if (s.phase === 'recap' && s.recap) return clock + this.recapHtml(s.recap);
        if ((s.phase === 'voteMode' || s.phase === 'voteOptions') && s.ballot) {
            const b = s.ballot;
            const counts = Object.fromEntries((b.tally || []).map(x => [x.k, x.n]));
            const mine = this.me.ballot;
            const decided = b.winner !== undefined && b.winner !== null;
            const canVote = !!this.me.login && !decided;
            const chat = s.regie?.chat;
            const buttons = b.choices.map((c, i) => {
                const n = counts[String(c)] || 0;
                const pct = b.total ? Math.round(n * 100 / b.total) : 0;
                const icon = CHOICE_ICON[c] ? `<i class="fas ${CHOICE_ICON[c]}"></i>` : '';
                const won = decided ? (String(b.winner) === String(c) ? ' is-winner' : ' is-loser') : '';
                return `<button type="button" class="h24-choice${String(mine) === String(c) ? ' is-mine' : ''}${won}" data-h24-choice="${esc(c)}" ${canVote ? '' : 'disabled'} style="--pct:${pct}%">
                    <span class="h24-choice__label"><span class="h24-choice__num">${i + 1}</span>${icon}${esc(choiceLabel(b.id, c))}</span>
                    <span class="h24-choice__pct">${pct}%<small>${n}</small></span></button>`;
            }).join('');
            const next = (s.next || []).length ? `<p class="h24-card__next">${esc(t('h24.nextBallots', { n: s.next.length }, `Encore ${s.next.length} vote(s)`))}</p>` : '';
            if (decided) {
                const how = t(`h24.ballotHow.${b.how}`, null, '');
                return `${clock}<h2 class="h24-card__title">${esc(t(`h24.ballot.${b.id}`, null, b.id))}</h2>
                    <div class="h24-ballot-result"><i class="fas fa-check-circle"></i> ${esc(choiceLabel(b.id, b.winner))}${how ? `<small>${esc(how)}</small>` : ''}</div>
                    <div class="h24-choices is-decided">${buttons}</div>
                    <p class="h24-card__total">${esc(t('h24.ballotTotal', { n: b.total }, `${b.total} vote(s)`))}</p>${next}`;
            }
            return `${clock}<h2 class="h24-card__title">${esc(t(`h24.ballot.${b.id}`, null, b.id))}</h2>
                <div class="h24-choices">${buttons}</div>
                ${chat ? chatHint('h24.chatVote', { nums: numList(b.choices.length) }, `Dans le chat Twitch : tape ${numList(b.choices.length)}`) : ''}
                <p class="h24-card__total">${esc(t('h24.ballotTotal', { n: b.total }, `${b.total} vote(s)`))}${canVote ? '' : ' · ' + esc(t('h24.loginToVote', null, 'connecte-toi pour voter'))}</p>${next}`;
        }
        if (s.phase === 'signup') {
            const n = (s.teams.w.length + s.teams.b.length);
            const team = this.me.team;
            let cta;
            if (!this.me.login) cta = `<button type="button" class="btn btn--twitch h24-card__cta" data-h24-login><i class="fab fa-twitch"></i> ${esc(t('h24.login', null, 'Se connecter avec Twitch'))}</button>`;
            else if (team) cta = `<p class="h24-card__ok"><i class="fas fa-check"></i> ${esc(t('h24.registered', null, 'Tu es inscrit !'))}</p>`;
            else cta = `<button type="button" class="btn btn--primary h24-card__cta" data-h24-signup><i class="fas fa-user-plus"></i> ${esc(t('h24.join', null, 'Rejoindre'))}</button>`;
            return `${clock}<h2 class="h24-card__title">${esc(t('h24.signupTitle', null, 'Inscriptions ouvertes'))}</h2>
                <p class="h24-card__sub">${esc(t('h24.signupSub', null, 'La partie démarre à la fin du compte à rebours. Tu pourras aussi rejoindre en cours de route.'))}</p>
                ${cta}${s.regie?.chat ? chatHint('h24.chatJoin', null, 'Dans le chat Twitch : tape join') : ''}<p class="h24-card__total">${esc(t('h24.registeredCount', { n }, `${n} inscrit(s)`))}</p>`;
        }
        return `${clock}<p class="h24-card__sub">${esc(t('h24.loading', null, 'Chargement…'))}</p>`;
    },

    recapHtml(r) {
        const res = r.result || {};
        let headline;
        if (res.kind === 'rush') headline = t('h24.recapRush', { solved: res.solved }, `${res.solved} puzzle(s) résolu(s)`)
            + (res.maxRating ? ` · ${t('h24.maxRating', { r: res.maxRating }, `rating max ${res.maxRating}`)}` : '');
        else if (res.kind === 'mate') headline = t(res.winner === 'w' ? 'h24.whiteWins' : 'h24.blackWins', null, res.winner === 'w' ? 'Victoire des Blancs' : 'Victoire des Noirs');
        else headline = t('h24.drawResult', null, 'Partie nulle') + (res.reason ? ` · ${t(`h24.drawReason.${res.reason}`, null, res.reason)}` : '');
        const mins = Math.max(1, Math.round((r.durationMs || 0) / 60000));
        const tops = ['w', 'b'].filter(side => r.top?.[side]?.length).map(side => `<div class="h24-recap__top h24-recap__top--${side}">
            <span class="h24-team__swatch"></span><ol>${r.top[side].map(p => `<li>${esc(p.login)} <small>${p.n}</small></li>`).join('')}</ol></div>`).join('');
        return `<h2 class="h24-card__title">${esc(t('h24.recapTitle', null, 'Fin de partie'))}</h2>
            <p class="h24-recap__headline">${esc(headline)}</p>
            <div class="h24-recap__stats">
                ${r.mode !== 'rush' ? `<span><strong>${Math.ceil((r.plies || 0) / 2)}</strong> ${esc(t('h24.moves', null, 'coups'))}</span>` : ''}
                <span><strong>${mins}</strong> min</span>
                <span><strong>${(r.players?.w || 0) + (r.players?.b || 0)}</strong> ${esc(t('h24.playersShort', null, 'joueurs'))}</span>
            </div>
            ${tops ? `<p class="h24-recap__label">${esc(t('h24.topVoters', null, 'Plus gros votants'))}</p><div class="h24-recap__tops">${tops}</div>` : ''}
            <p class="h24-card__next">${esc(t('h24.nextSoon', null, 'Vote du prochain mode juste après.'))}</p>`;
    },

    renderPlay() {
        const s = this.state;
        const g = s.game;
        const side = $('h24-turn');
        if (side) {
            side.textContent = s.mode === 'rush'
                ? this.puzzleLabel(g)
                : t(g.turn === 'w' ? 'h24.whiteToPlay' : 'h24.blackToPlay', null, g.turn === 'w' ? 'Aux Blancs de jouer' : 'Aux Noirs de jouer');
            side.className = `watch__status h24-turn h24-turn--${g.turn}`;
        }
        const hint = $('h24-hint');
        if (hint) {
            let msg = '';
            if (!this.me.login) msg = s.regie?.chat
                ? t('h24.chatPlay', null, 'Pour jouer : tape join dans le chat Twitch, puis ton coup (ex. e4, Nf3)')
                : t('h24.watchOnly', null, 'Tu regardes. Connecte-toi pour jouer.');
            else if (!this.me.team) msg = t('h24.joinToVote', null, 'Rejoins une équipe pour voter.');
            else if (this.myTurn() && myVotes(this.me).length) {
                const mv = myVotes(this.me);
                const max = this.me.maxVotes || 1;
                msg = max > 1
                    ? t('h24.yourVotes', { moves: mv.join(', '), n: mv.length, max }, `Tes votes : ${mv.join(', ')} (${mv.length}/${max})`)
                    : t('h24.yourVote', { move: mv[0] }, `Ton vote : ${mv[0]}`);
            }
            else if (this.myTurn() && g.turn !== this.me.team && s.mode === 'teams') msg = t('h24.bothSides', { side: t(g.turn === 'w' ? 'h24.sideW' : 'h24.sideB') }, 'Ton équipe joue aussi ce camp.');
            else if (this.myTurn()) msg = t('h24.clickToVote', null, 'Clique un coup ou déplace une pièce');
            else msg = t('h24.waitTurn', null, 'L\'autre équipe réfléchit…');
            hint.textContent = msg;
            hint.classList.toggle('is-active', this.myTurn());
        }
        $('h24-move-form')?.toggleAttribute('hidden', !this.myTurn());
        // Nouveau tour : le podium repart de zéro (pas de coup fantôme du tour précédent)
        if (!g.votes?.length) $('h24-votes')?.querySelector('.podium')?.remove();
        if (!g.draw) renderPodium($('h24-votes'), $('h24-votes-total'), g.votes || [], { turn: g.turn, colors: COLORS, secret: g.secret, masked: g.masked });
        this.renderDraw(g);
        const first = (g.startFen || '').split(' ')[1] === 'b' ? 'b' : 'w';
        renderHistory($('h24-history'), (g.history || []).map((san, i) => ({ san, v: s.mode === 'teams' ? g.hv?.[i] ?? null : null })), first);
        const score = $('h24-score');
        if (score) {
            score.hidden = s.mode !== 'rush';
            if (g.score) {
                const max = g.score.maxStrikes || 3;
                const lives = Array.from({ length: max }, (_, i) => `<i class="fas fa-heart${i < max - g.score.strikes ? '' : ' is-lost'}"></i>`).join('');
                score.innerHTML = `<span class="h24-score__ok"><i class="fas fa-check"></i> ${g.score.solved}</span><span class="h24-score__lives" title="${esc(t('h24.lives', null, 'Erreurs restantes'))}">${lives}</span>`;
            }
        }
    },

    /** Tirage au sort (ex æquo ou mode tirage) : bande sous l'échiquier ou roue à la place du podium, au choix du viewer */
    renderDraw(g) {
        const slot = $('h24-votes-panel');
        if (!slot) return;
        if (!g.draw || g.result) { this.hideDraw(); return; }
        const sig = `${g.history.length}:${g.draw.winner}`;
        if (sig === this.drawSig) return;
        this.drawSig = sig;
        const votes = g.draw.votes || [];
        const total = votes.reduce((a, v) => a + v.n, 0);
        const left = (g.draw.endsAt || 0) - (Date.now() + (this.skew || 0));
        // Personne n'a voté, un seul coup proposé ou arrivé trop tard : le coup tiré directement
        if (g.draw.random || votes.length < 2 || left < 1500) {
            const n = votes.find(v => v.m === g.draw.winner)?.n || 0;
            markPodiumWinner($('h24-votes'), g.draw.winner);
            revealWinner(slot, { move: g.draw.winner, color: COLORS[0], pct: g.draw.random || !total ? null : Math.round(n * 100 / total), turn: g.turn });
            return;
        }
        const wheel = this.ensureWheel(this.style);
        const area = $('h24-wheel-area');
        wheel.votes = new Map(votes.map(v => [v.m, { count: v.n, voters: new Map() }]));
        area.classList.add('is-visible', 'is-spinning');
        wheel.draw();
        if (area.classList.contains('wheel-area--docked') && !slot.classList.contains('is-drawing')) {
            morphPodiumToWheel(slot, area.querySelector('.wheel-container'));
            slot.classList.add('is-drawing');
        }
        this.revealing = true;
        wheel.onSpinEnd = () => {
            this.revealing = false;
            area.classList.remove('is-spinning');
            this.renderBoard();
        };
        // La roue s'arrête un peu avant que le coup soit joué
        wheel.spin(Math.max(600, left - 1300), g.draw.winner);
    },

    /** Une seule roue à la fois : recréée quand le viewer change de style (hors tirage) */
    ensureWheel(style) {
        if (this.wheel && (this.wheelStyle === style || this.wheel.isSpinning)) return this.wheel;
        this.dock(style);
        const area = $('h24-wheel-area');
        area.innerHTML = '';
        const wheel = style === 'band' ? new WheelBand('h24-wheel-area') : new VotingWheel('h24-wheel-area');
        wheel.updateVoteList = () => {};
        wheel.showResultInside = false;
        wheel.paletteColors = COLORS;
        wheel.currentTurn = () => (this.state?.game?.turn === 'b' ? 'b' : 'w');
        wheel.highlightWinner = () => {
            if (!this.drawSig) return;   // tirage déjà terminé côté serveur
            markPodiumWinner($('h24-votes'), wheel.winner);
            revealWinner($('h24-votes-panel'), { move: wheel.winner, color: wheel.winnerColor, pct: wheel.winnerPct, turn: wheel.currentTurn() });
        };
        // La page tient sans scroll : pas de défilement vers la bande
        if (wheel.container) wheel.container.scrollIntoView = () => {};
        this.wheel = wheel;
        this.wheelStyle = style;
        return wheel;
    },

    puzzleLabel(g) {
        const p = g.puzzle;
        if (!p) return '';
        const head = t('h24.rushN', { i: p.index }, `Puzzle ${p.index}`) + (p.rating ? ` · ${p.rating}` : '');
        if (p.status === 'solved') return `${head} · ${t('h24.solved', null, 'Résolu !')}`;
        if (p.status === 'failed') return `${head} · ${t('h24.failed', null, 'Raté')}`;
        if (p.status === 'timeout') return `${head} · ${t('h24.timeout', null, 'Temps écoulé')}`;
        return `${head} · ${t(p.side === 'b' ? 'h24.findBlack' : 'h24.findWhite', null, p.side === 'b' ? 'Trouve le coup des Noirs' : 'Trouve le coup des Blancs')}`;
    }
};

export default H24Page;

// À la connexion du Phantom depuis le menu, c'est la partie 24/24 qu'il faut poser sur l'échiquier
window.phantomPositionProviders = window.phantomPositionProviders || {};
window.phantomPositionProviders['24h'] = () => (H24Page.me.regie && H24Page.regie.live && H24Page.state?.game?.fen) || null;
