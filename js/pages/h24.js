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
import { renderHistory, paintMoveChips, clearWinner, nameColor, renderPodium, markPodiumWinner, pieceOf } from '../components/voteViews.js';
import { PALETTES, PALETTE_IDS, isPalette } from '../components/votePalettes.js';
import { fmtMove } from '../utils/moveMatch.js';
import { CamSender, CamPlayer, CAM_QUALITIES, CAM_ZOOM, listCameras, camSupported } from '../components/liveCam.js';

const t = (key, params, fallback) => {
    const s = window.i18n?.t(key, params);
    return s && s !== key ? s : (fallback ?? key);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
// Sons des coups, comme sur les autres échiquiers
const SOUNDS = { move: 'mp3/move.mp3', capture: 'mp3/take.mp3', check: 'mp3/check.mp3', end: 'mp3/end.wav' };
const PIECES = p => window.pieceUrl(p);   // set de pièces choisi
// Ordre d'affichage du cycle : on choisit (mode, options), on s'inscrit, on joue, puis le récap avant le tour suivant
const STEPS = ['voteMode', 'voteOptions', 'signup', 'play', 'recap'];

/** Nombre de cases dont le contenu diffère entre deux positions (FEN ou 'start') */
function squaresChanged(a, b) {
    const grid = (fen) => (fen === 'start' ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR' : String(fen).split(' ')[0])
        .replace(/\d/g, (n) => '.'.repeat(Number(n))).replace(/\//g, '');
    const x = grid(a), y = grid(b);
    if (x.length !== 64 || y.length !== 64) return 64;
    let n = 0;
    for (let i = 0; i < 64; i++) if (x[i] !== y[i]) n++;
    return n;
}
const PIECE_ICONS = { w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' }, b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' } };
const clean = (m) => String(m || '').replace(/[+#!?]/g, '');
// Couleurs du tirage (roue, bande, podium, puces des coups) : au choix du viewer, gardées dans son navigateur
const loadPalette = () => { try { const id = localStorage.getItem('h24Palette'); return isPalette(id) ? id : 'violet'; } catch { return 'violet'; } };
let COLORS = PALETTES[loadPalette()];

/** Libellé d'un choix de vote (mode, durée du tour, décision, niveau) */
function choiceLabel(ballot, c) {
    if (ballot === 'mode') return t(`h24.mode.${c}`, null, c);
    if (ballot === 'turn') return t('h24.seconds', { n: c }, `${c} s`);
    if (ballot === 'decision') return t(`h24.decision.${c}`, null, c);
    if (ballot === 'votes') return t(Number(c) === 1 ? 'h24.votesOne' : 'h24.votesN', { n: c }, `${c} vote(s)`);
    if (ballot === 'anonymity') return t(`h24.anonymity.${c}`, null, c);
    if (ballot === 'spin') return t(`h24.spin.${c}`, null, c);
    if (ballot === 'elo') return Number(c) >= 2400 ? '2400+' : String(c);
    return String(c);
}
const CHOICE_ICON = { teams: 'fa-chess', rush: 'fa-bolt', bot: 'fa-robot', majority: 'fa-check-double', draw: 'fa-dice', none: 'fa-eye', secret: 'fa-eye-slash',
    fast: 'fa-forward', normal: 'fa-play', slow: 'fa-hourglass-half' };
/** « 1, 2 ou 3 » */
const numList = (n) => {
    const nums = Array.from({ length: n }, (_, i) => String(i + 1));
    return nums.length < 2 ? nums.join('') : `${nums.slice(0, -1).join(', ')} ${t('h24.or', null, 'ou')} ${nums[nums.length - 1]}`;
};
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
    cam: { deviceId: loadCam().deviceId || '', quality: CAM_QUALITIES[loadCam().quality] ? loadCam().quality : 'mid', zoom: Math.min(CAM_ZOOM.max, Math.max(CAM_ZOOM.min, Number(loadCam().zoom) || 1)), error: '', devices: null },
    camSender: null,
    camPlayer: null,
    camWatching: false,
    liveFolded: (() => { try { return localStorage.getItem('h24LiveFolded') === '1'; } catch { return false; } })(),
    regieFolded: (() => { try { return localStorage.getItem('h24RegieFolded') === '1'; } catch { return false; } })(),
    // Panneaux Équipes / Historique repliés (retenu par navigateur)
    folds: (() => { try { return JSON.parse(localStorage.getItem('h24Fold') || '{}') || {}; } catch { return {}; } })(),
    // Son : volume 0..1 et coupure, retenus par navigateur
    volume: (() => { try { const v = parseFloat(localStorage.getItem('h24Volume')); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6; } catch { return 0.6; } })(),
    muted: (() => { try { return localStorage.getItem('h24Muted') === '1'; } catch { return false; } })(),
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
            const prev = this.state?.game;
            this.state = st;
            // Fin de partie : carillon (mat, nulle ou fin du rush) ; sinon un coup vient d'être joué : son du coup
            const h = st.game?.history;
            if (prev && st.game?.result && !prev.result) this.playSound('end');
            else if (st.phase === 'play' && prev && h && h.length === (prev.history?.length || 0) + 1) this.playMoveSound(h[h.length - 1]);
            this.render();
        });
        socket.on('h24:me', (me) => {
            this.me = me || {};
            // La régie se présente (de nouveau après une reconnexion ou un redémarrage du serveur)
            if (this.me.regie && this.regieSent !== socket.id) {
                this.regieSent = socket.id; this.regiePhantom = null; this.sendRegie(true);
                // Chaîne gardée dans ce navigateur mais inconnue du serveur (jamais validée, ou perdue) : envoyée d'office
                const own = this.regie.channel || this.me.login;
                if (own && !this.regie.hidden && !this.state?.regie?.channel) socket.emit('h24:regie', { channel: own });
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
            if (choice) { this.socket?.emit(this.me.regie ? 'h24:pick' : 'h24:ballot', { choice: choice.dataset.h24Choice }); return; }
            if (e.target.closest('[data-h24-signup]')) { this.socket?.emit('h24:signup'); return; }
            const fp = e.target.closest('[data-h24-force]');
            if (fp) { this.socket?.emit('h24:force', { phase: fp.dataset.h24Force }); return; }
            if (e.target.closest('[data-h24-quit]')) { this.socket?.emit('h24:quit'); return; }
            if (e.target.closest('[data-h24-login]')) { twitchAuth.login?.(); return; }
            const st = e.target.closest('[data-h24-style]');
            if (st) { this.setStyle(st.dataset.h24Style); return; }
            const bg = e.target.closest('[data-h24-bg]');
            if (bg) { this.setBg(bg.dataset.h24Bg); return; }
            if (e.target.closest('[data-h24-settings]')) { this.toggleSettings(); return; }
            const pal = e.target.closest('[data-h24-palette]');
            if (pal) { this.setPalette(pal.dataset.h24Palette); return; }
            const rg = e.target.closest('[data-h24-regie]');
            if (rg) { this.regieAction(rg.dataset.h24Regie); return; }
            if (e.target.closest('[data-h24-live-toggle]')) { this.foldLive(!this.liveFolded); return; }
            if (e.target.closest('[data-h24-mute]')) { this.setVolume(this.muted && !this.volume ? 0.6 : this.volume, !this.muted); return; }
            if (e.target.closest('[data-h24-bot-add]')) { this.socket?.emit('h24:regie', { addBot: this.botLevel || 1500 }); return; }
            const rb = e.target.closest('[data-h24-bot-remove]');
            if (rb) { this.socket?.emit('h24:regie', { removeBot: rb.dataset.h24BotRemove }); return; }
            if (e.target.closest('[data-h24-bots-off]')) { this.socket?.emit('h24:regie', { bots: 0 }); return; }
            const fd = e.target.closest('[data-h24-fold]');
            if (fd) { this.toggleFold(fd.dataset.h24Fold); return; }
            const mv = e.target.closest('[data-h24-move]');
            if (mv && !mv.disabled) this.socket?.emit('h24:vote', { move: mv.dataset.h24Move });
        });
        // Survol d'un coup cliquable : flèche d'aperçu sur l'échiquier
        const movesList = $('h24-moves-list');
        movesList?.addEventListener('pointerover', (e) => {
            const btn = e.target.closest('[data-h24-move]');
            const g = this.state?.game;
            let m = null;
            if (btn && !btn.disabled && g?.fen) { try { m = new Chess(g.fen).move(btn.dataset.h24Move); } catch {} }
            this.annotations?.setHover?.(m);
        });
        movesList?.addEventListener('pointerleave', () => this.annotations?.setHover?.(null));
        $('h24-move-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = $('h24-move-input');
            const move = input.value.trim();
            if (move) this.socket?.emit('h24:vote', { move, lang: window.i18n?.currentLang || 'fr' });
            input.value = '';
        });
        window.addEventListener('resize', () => { if (this.socket) this.board?.resize(); });
        this.applyFolds();
        this.bindTicker();
        $('h24-volume')?.addEventListener('input', (e) => this.setVolume(Number(e.target.value) / 100, Number(e.target.value) === 0));
        this.renderVolume();
        // Panneau des paramètres : se ferme au clic ailleurs ou avec Échap
        // (chemin du clic figé au départ : un bouton redessiné pendant le clic compte toujours comme « dedans »)
        document.addEventListener('click', (e) => { if (!e.composedPath().some(n => n.classList?.contains('h24-settings'))) this.toggleSettings(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.toggleSettings(false); });
        window.addEventListener('languageChanged', () => this.renderPalettes());
        this.renderPalettes();
        this.renderBgs();
        for (const ev of ['siteThemeChanged', 'economyChanged', 'languageChanged']) window.addEventListener(ev, () => this.renderBgs());
    },

    // ------------------------------------------------------------------ paramètres du viewer
    toggleSettings(open) {
        const pop = $('h24-settings');
        if (!pop) return;
        open = open ?? pop.hidden;
        if (open === !pop.hidden) return;
        pop.hidden = !open;
        document.querySelector('[data-h24-settings]')?.setAttribute('aria-expanded', String(open));
    },

    renderPalettes() {
        const box = $('h24-palettes');
        if (!box) return;
        const cur = loadPalette();
        box.innerHTML = PALETTE_IDS.map(id => `<button type="button" class="h24-palette${id === cur ? ' is-active' : ''}" data-h24-palette="${id}" aria-pressed="${id === cur}">
            <span class="h24-palette__dots">${PALETTES[id].slice(0, 5).map(c => `<i style="background:${c}"></i>`).join('')}</span>
            <span class="h24-palette__name">${esc(t(`palette.${id}`, null, id))}</span>
        </button>`).join('');
    },

    setPalette(id) {
        if (!isPalette(id)) return;
        try { localStorage.setItem('h24Palette', id); } catch {}
        COLORS = PALETTES[id];
        this.renderPalettes();
        // Tout ce qui est déjà coloré se repeint : roue ou bande, podium, puces des coups
        if (this.wheel) {
            this.wheel.paletteColors = COLORS;
            if (!this.wheel.isSpinning) this.wheel.draw?.();
        }
        this.liveSig = null;
        $('h24-votes')?.querySelector('.podium')?.remove();
        this.render();
    },

    // ------------------------------------------------------------------ son
    setVolume(v, muted) {
        this.volume = Math.max(0, Math.min(1, v));
        this.muted = !!muted;
        try { localStorage.setItem('h24Volume', String(this.volume)); localStorage.setItem('h24Muted', this.muted ? '1' : '0'); } catch {}
        this.renderVolume();
    },

    renderVolume() {
        const range = $('h24-volume');
        const vol = this.muted ? 0 : this.volume;
        if (range) {
            range.value = String(Math.round(vol * 100));
            range.style.setProperty('--v', `${Math.round(vol * 100)}%`);
        }
        const btn = document.querySelector('[data-h24-mute]');
        if (btn) btn.title = t('h24.mute', null, 'Couper / remettre le son');
        if (range) range.title = `${t('h24.volume', null, 'Volume')} ${Math.round(vol * 100)} %`;
        const icon = btn?.querySelector('i');
        if (icon) icon.className = `fas fa-volume-${!vol ? 'mute' : vol < 0.4 ? 'down' : 'up'}`;
    },

    playMoveSound(san) {
        if (!san) return;
        this.playSound(san.includes('#') ? 'end' : san.includes('+') ? 'check' : san.includes('x') ? 'capture' : 'move');
    },

    playSound(kind) {
        const vol = this.muted ? 0 : this.volume;
        if (!vol || !SOUNDS[kind]) return;
        try {
            const a = new Audio(SOUNDS[kind]);
            a.volume = vol * (kind === 'end' ? 0.6 : 0.8);
            a.play().catch(() => {});   // pas encore de clic sur la page : le navigateur refuse, tant pis
        } catch {}
    },

    toggleFold(name) {
        this.folds[name] = !this.folds[name];
        try { localStorage.setItem('h24Fold', JSON.stringify(this.folds)); } catch {}
        this.applyFolds();
    },

    /** Coup retenu (majorité, ou tiré au sort une fois la roue arrêtée), en attente d'être joué */
    nextMoveOf(g) {
        if (!g || g.result) return null;
        if (g.draw && !this.revealing && g.draw.winner) {
            const votes = g.draw.votes || [];
            const total = votes.reduce((a, v) => a + (v.n || 0), 0);
            const n = votes.find(v => v.m === g.draw.winner)?.n || 0;
            return { san: g.draw.winner, pct: g.draw.random || !total ? null : g.draw.pct ?? Math.round(n * 100 / total), random: !!g.draw.random || !total, voter: g.draw.voter, via: g.draw.via };
        }
        if (g.chosen?.move) return { san: g.chosen.move, pct: g.chosen.pct ?? null, voter: g.chosen.voter, via: g.chosen.via };
        return null;
    },

    /** Le coup retenu s'affiche dans le guide en haut (plus de carte en bas de l'historique) */
    renderNextMove() {
        $('h24-history')?.closest('.panel__content')?.querySelector('.h24-next')?.remove();
        this.renderGuide();
    },

    /** Fondu enchaîné : la carte du coup retenu rejoint sa case dans l'historique */
    flyIntoHistory(card, from) {
        const cell = $('h24-history')?.querySelector('.hist-move.is-last');
        if (!cell || !document.body.contains(cell) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const to = cell.getBoundingClientRect();
        if (!to.width) return;
        const ghost = card.cloneNode(true);
        ghost.classList.remove('is-in');
        ghost.classList.add('is-ghost');
        Object.assign(ghost.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, margin: 0, zIndex: 50, pointerEvents: 'none', transformOrigin: '0 0' });
        document.body.appendChild(ghost);
        const dx = to.left - from.left, dy = to.top - from.top;
        const sx = to.width / from.width, sy = to.height / from.height;
        const ease = 'cubic-bezier(0.5, 0, 0.2, 1)';
        ghost.animate([
            { transform: 'none', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0 }
        ], { duration: 650, easing: ease, fill: 'forwards' }).finished.finally(() => ghost.remove());
        // La case apparaît pendant que la carte s'y fond, puis un éclat confirme le coup
        cell.animate([
            { opacity: 0, transform: `translate(${-dx * 0.25}px, ${-dy * 0.25}px) scale(1.4)` },
            { opacity: 0, offset: 0.35 },
            { opacity: 1, transform: 'none' }
        ], { duration: 650, easing: ease });
        cell.animate([
            { boxShadow: 'inset 0 0 0 1px rgba(250, 204, 21, 0.55), 0 0 0 0 rgba(250, 204, 21, 0.8)' },
            { boxShadow: 'inset 0 0 0 1px rgba(250, 204, 21, 0.55), 0 0 14px 3px rgba(250, 204, 21, 0.45)', offset: 0.4 },
            { boxShadow: 'inset 0 0 0 1px rgba(250, 204, 21, 0.55), 0 0 0 0 rgba(250, 204, 21, 0)' }
        ], { duration: 900, delay: 550, easing: 'ease-out' });
    },

    /** Défile l'historique jusqu'au dernier coup (le panneau défile, pas la liste) */
    historyToBottom() {
        const sc = $('h24-history')?.closest('.panel__content');
        if (sc) sc.scrollTop = sc.scrollHeight;
    },

    applyFolds() {
        document.querySelectorAll('#page-h24 [data-h24-panel]').forEach(p => {
            const folded = !!this.folds[p.dataset.h24Panel];
            p.classList.toggle('is-folded', folded);
            p.querySelector('[data-h24-fold]')?.setAttribute('aria-expanded', String(!folded));
            const chev = p.querySelector('.h24-fold__chev');
            if (chev) chev.className = `fas fa-chevron-${folded ? 'down' : 'up'} h24-fold__chev`;
        });
        this.historyToBottom();
    },

    // ------------------------------------------------------------------ bandeau des votes (sous l'échiquier)
    bindTicker() {
        const track = $('h24-ticker-track');
        if (!track || track.dataset.wheelBound) return;
        track.dataset.wheelBound = '1';
        // Une seule ligne : la molette fait défiler les votes à l'horizontale
        track.addEventListener('wheel', (e) => {
            if (track.scrollWidth <= track.clientWidth) return;
            const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
            if (!d) return;
            e.preventDefault();
            track.scrollLeft += d;
        }, { passive: false });
    },

    /** Derniers votes du tour, le plus récent à gauche ; seuls les nouveaux s'animent */
    renderTicker() {
        const box = $('h24-ticker');
        const track = $('h24-ticker-track');
        if (!box || !track) return;
        const s = this.state;
        const g = s?.phase === 'play' ? s.game : null;
        // Hors partie : rien (les votes du mode et des options s'affichent dans la fenêtre)
        const b = null;
        const key = g ? g.fen : b ? `ballot:${s.phase}:${b.id}` : '';
        if (key !== this.tickerKey) {
            this.tickerKey = key;
            this.tickerN = 0;
            track.innerHTML = '';
        }
        const recent = g ? g.recent || [] : b ? (b.recent || []).map(r => ({ ...r, m: choiceLabel(b.id, r.c), choice: true })) : [];
        const total = g ? g.recentN ?? recent.length : b ? b.recentN ?? recent.length : 0;
        const fresh = Math.min(Math.max(0, total - (this.tickerN || 0)), recent.length);
        this.tickerN = total;
        const voted = t('anonymity.voted', null, 'a voté');
        // Photo Twitch, provenance (#chaîne, site ou bot) et pseudo, puis le coup
        const site = t('h24.viaSite', null, 'site');
        const pic = r => r.p ? `<img class="vote-ticker__pic" src="${esc(r.p)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : `<span class="vote-ticker__pic" style="background:${nameColor(r.u)}">${r.v === 'bot' ? '<i class="fas fa-robot"></i>' : esc((r.u || '?')[0].toUpperCase())}</span>`;
        recent.slice(recent.length - fresh).forEach(r => {
            const item = document.createElement('span');
            item.className = 'vote-ticker__item vote-ticker__item--who';
            item.dataset.u = r.u;
            item.innerHTML = `${pic(r)}<span class="vote-ticker__who"><span class="vote-ticker__user" style="color:${nameColor(r.u)}">${esc(r.u)}</span><span class="vote-ticker__via">${esc(r.v === 'bot' ? 'bot' : r.v === 'chat' ? 'chat' : r.v || site)}</span></span><span class="vote-ticker__move${r.m ? '' : ' is-hidden'}${r.choice ? ' is-choice' : ''}">${esc(r.m ? (r.choice ? r.m : fmtMove(r.m)) : voted)}</span>`;
            if (r.p) item.dataset.pic = '1';
            track.prepend(item);
        });
        // Photos arrivées après coup : on complète les votes déjà affichés
        const pics = new Map(recent.filter(r => r.p).map(r => [r.u, r.p]));
        track.querySelectorAll('.vote-ticker__item--who:not([data-pic])').forEach(item => {
            const p = pics.get(item.dataset.u);
            if (!p) return;
            item.dataset.pic = '1';
            item.querySelector('.vote-ticker__pic')?.replaceWith(Object.assign(document.createElement('img'), { className: 'vote-ticker__pic', src: p, alt: '', referrerPolicy: 'no-referrer' }));
        });
        while (track.children.length > 20) track.lastElementChild.remove();
        if (fresh) track.scrollLeft = 0;
        box.classList.toggle('has-votes', track.children.length > 0);
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
        // Contre Stockfish : toujours du côté des viewers
        if (s?.mode === 'bot') return s.vs?.side === 'b' ? 'black' : 'white';
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
        if (key !== this.boardKey) {
            // Animer seulement un coup joué (au plus 4 cases changent : roque) ; un nouveau puzzle ou une
            // nouvelle partie remplace la position sans faire voyager les pièces à travers l'échiquier
            this.board.position(fen, this.boardFen != null && squaresChanged(this.boardFen, fen) <= 4);
            this.boardKey = key;
            this.boardFen = fen;
        }
        $('h24-board-wrap')?.classList.toggle('is-my-turn', this.myTurn());

        // Flèche : coup tiré au sort, sinon coup en tête, sinon dernier coup joué
        let overlay = null;
        if (g && !g.result) {
            const find = (san) => {
                try { const c = new Chess(g.fen); return c.move(san); } catch { return null; }
            };
            // Étiquette du coup retenu : coup · part des votes, puis le viewer tiré parmi ceux qui l'ont voté (photo, pseudo, chaîne)
            const label = (san, pct) => [fmtMove(san), pct != null ? `${pct} %` : null].filter(Boolean).join(' · ');
            const who = (o) => o?.voter ? { name: o.voter, via: o.via || null, pic: o.pic || null } : null;
            if (g.draw) {
                // Rien pendant que la roue tourne : le suspense reste entier
                const m = !this.revealing && find(g.draw.winner);
                const votes = g.draw.votes || [];
                const total = votes.reduce((a, v) => a + (v.n || 0), 0);
                const n = votes.find(v => v.m === g.draw.winner)?.n || 0;
                if (m) overlay = { kind: 'win', from: m.from, to: m.to, who: g.draw.random ? null : who(g.draw),
                    label: g.draw.random ? `🎲 ${fmtMove(m.san)}` : label(m.san, g.draw.pct ?? (total ? Math.round(n / total * 100) : null)) };
            } else if (g.chosen) {
                const m = find(g.chosen.move);
                if (m) overlay = { kind: 'win', from: m.from, to: m.to, label: label(m.san, g.chosen.pct), who: who(g.chosen) };
            } else {
                const top = g.votes?.[0]?.count || 0;
                const moves = top ? g.votes.filter(v => v.count === top).map(v => find(v.move)).filter(Boolean) : [];
                if (moves.length) overlay = { kind: 'lead', moves };
            }
        }
        this.annotations?.setOverlay?.(overlay);
        this.highlightLast(g?.lastMove);
        this.renderEnd(g);
    },

    /** Issue de la partie en clair : icône, titre, détail, couleur */
    resultInfo(res) {
        if (!res) return null;
        if (res.kind === 'rush') return {
            tone: 'rush', icon: 'fa-flag-checkered',
            title: t('h24.endRush', null, 'Fin du rush'),
            sub: t('h24.recapRush', { solved: res.solved }, `${res.solved} puzzle(s) résolu(s)`)
                + (res.maxRating ? ` · ${t('h24.maxRating', { r: res.maxRating }, `rating max ${res.maxRating}`)}` : '')
        };
        if (res.kind === 'mate') return {
            tone: res.winner, icon: 'fa-crown',
            title: t('h24.checkmate', null, 'Échec et mat'),
            sub: t(res.winner === 'w' ? 'h24.whiteWins' : 'h24.blackWins', null, res.winner === 'w' ? 'Victoire des Blancs' : 'Victoire des Noirs')
        };
        const reason = res.reason && res.reason !== 'draw' ? t(`h24.drawReason.${res.reason}`, null, res.reason) : '';
        return {
            tone: 'draw', icon: 'fa-handshake',
            title: t('h24.drawResult', null, 'Partie nulle'),
            sub: reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : ''
        };
    },

    renderEnd(g) {
        const wrap = $('h24-board-wrap');
        if (!wrap) return;
        const res = g?.result;
        let el = $('h24-end');
        const board = $('h24-board');
        board?.querySelectorAll('.h24-mated, .h24-winner').forEach(sq => sq.classList.remove('h24-mated', 'h24-winner'));
        if (!res) { if (el) el.remove(); this.endKey = null; return; }
        // Rois : le maté en rouge, le vainqueur en doré
        if (res.kind === 'mate' && board && typeof Chess === 'function') {
            try {
                new Chess(g.fen).board().forEach((row, r) => row.forEach((p, f) => {
                    if (p?.type === 'k') board.querySelector(`.square-${'abcdefgh'[f]}${8 - r}`)?.classList.add(p.color === res.winner ? 'h24-winner' : 'h24-mated');
                }));
            } catch {}
        }
        const info = this.resultInfo(res);
        const key = JSON.stringify(res) + (g.fen || '');
        if (!el) {
            el = document.createElement('div');
            el.id = 'h24-end';
            wrap.appendChild(el);
        }
        el.className = `h24-end h24-end--${info.tone}`;
        if (key === this.endKey) return;
        this.endKey = key;
        el.innerHTML = `<div class="h24-end__card">
            <i class="fas ${info.icon} h24-end__icon"></i>
            <div class="h24-end__title">${esc(info.title)}</div>
            ${info.sub ? `<div class="h24-end__sub">${esc(info.sub)}</div>` : ''}
        </div>`;
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
        this.renderTicker();
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
        window.PhantomOwner ? window.PhantomOwner.sync('h24', fen) : p.syncPosition(fen);
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
            if (this.regie.live) window.PhantomOwner?.claim('h24');
            this.mirroredFen = null;
            this.saveRegie();
        } else if (action === 'sync') {
            window.PhantomOwner?.claim('h24');
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
            this.socket?.emit('h24:regie', { channel: this.regie.channel || this.me.login || '' });
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
        const key = [status, !!p?.isConnected, this.regie.live, !!server.paused, server.channel, this.state?.pauseReason, camLive, this.cam.error, this.cam.devices.length, this.regieFolded, !!this.me.chat, (this.state?.botList || []).map(b => b.l + b.elo).join()].join('|');
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
            ${p?.isConnected ? `<div class="h24-regie__row">
                <span class="h24-regie__status"><i class="fas fa-tachometer-alt"></i> ${esc(t('setup.phantomSpeed', null, 'Vitesse'))}</span>
                <div class="ph-speed" data-ph-speed role="group" aria-label="${esc(t('setup.phantomSpeed', null, 'Vitesse'))}">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-speed="${v}"${v === p.currentSpeed ? ' class="is-active"' : ''}>${v}</button>`).join('')}</div>
            </div>
            <div class="h24-regie__row" title="${esc(t('setup.autoRecalTitle', null, 'Recalibre la mécanique tous les N coups joués par le Phantom (entre deux coups), pour éviter que les pièces se décalent peu à peu'))}">
                <span class="h24-regie__status"><i class="fas fa-tools"></i> ${esc(t('setup.autoRecal', null, 'Recalibration auto (coups)'))}</span>
                <select class="ph-autorecal" data-ph-autorecal aria-label="${esc(t('setup.autoRecal', null, 'Recalibration auto (coups)'))}">${[0, 20, 40, 60, 100].map(v => `<option value="${v}"${v === (p.autoRecalEvery || 0) ? ' selected' : ''}>${v ? v : esc(t('setup.autoRecalOff', null, 'Jamais'))}</option>`).join('')}</select>
            </div>` : ''}
            <form class="h24-regie__row h24-regie__channel" data-h24-regie-form>
                <input type="text" id="h24-regie-channel" maxlength="60" autocomplete="off" placeholder="${esc(t('h24.regie.channelPh', null, 'Chaîne Twitch de la vue réelle'))}" value="${esc(this.regie.channel || shown || this.me.login || '')}">
                <button type="submit" class="btn btn--sm${(this.regie.channel || '').toLowerCase() !== shown ? ' btn--primary' : ''}" title="${esc(t('h24.regie.channelSet', null, 'Afficher cette chaîne'))}"><i class="fas fa-check"></i></button>
                ${shown ? `<button type="button" class="btn btn--sm btn--ghost" data-h24-regie="hide" title="${esc(t('h24.regie.channelHide', null, 'Retirer la vue réelle'))}"><i class="fas fa-eye-slash"></i></button>` : ''}
            </form>
            <div class="h24-regie__hint">${shown ? esc(t('h24.regie.channelOn', { c: shown }, `Vue réelle : twitch.tv/${shown}`)) : esc(t('h24.regie.channelOff', null, 'Pas de vue réelle pour les viewers'))}</div>
            <div class="h24-regie__hint"><span class="h24-regie__dot h24-regie__dot--${this.me.chat ? 'ok' : 'error'}"></span> ${esc(t(this.me.chat ? 'h24.regie.chatOn' : 'h24.regie.chatOff', { c: this.me.login || '' }, ''))}</div>
            ${this.camPanelHtml(camLive)}
            <div class="h24-regie__row h24-regie__bots">
                <span class="h24-regie__status"><i class="fas fa-robot"></i> ${esc(t('h24.regie.bots', { n: this.state?.bots || 0 }, `Bots de test : ${this.state?.bots || 0}`))}</span>
                <select class="input input--sm" data-h24-bot-level title="${esc(t('h24.regie.botsMore', null, 'Ajouter un bot de ce niveau'))}">
                    ${(window.BotEngine?.LEVELS || [300, 600, 900, 1320, 1500, 1800, 2100, 2400]).map(v => `<option value="${v}"${v === (this.botLevel || 1500) ? ' selected' : ''}>${window.BotEngine?.levelOption(v) || v}</option>`).join('')}
                </select>
                <button type="button" class="btn btn--sm" data-h24-bot-add title="${esc(t('h24.regie.botsMore', null, 'Ajouter un bot de ce niveau'))}"><i class="fas fa-plus"></i></button>
                ${this.state?.bots ? `<button type="button" class="btn btn--sm btn--ghost" data-h24-bots-off><i class="fas fa-times"></i> ${esc(t('h24.botsOff', null, 'Retirer les bots'))}</button>` : ''}
            </div>
            ${(this.state?.botList || []).length ? `<div class="h24-regie__botlist">${this.state.botList.map(b => `<span class="h24-regie__bot">${esc(b.l.replace(/^bot_/, ''))} · ${b.elo >= 2400 ? '2400+' : b.elo}<button type="button" data-h24-bot-remove="${esc(b.l)}" title="${esc(t('h24.regie.botsLess', null, 'Retirer ce bot'))}">×</button></span>`).join('')}</div>` : ''}
            </div>`;
        el.querySelectorAll('[data-h24-cam-pref]').forEach(sel => sel.addEventListener('change', () => this.setCamPref(sel.dataset.h24CamPref, sel.value)));
        el.querySelector('[data-h24-bot-level]')?.addEventListener('change', (e) => { this.botLevel = Number(e.target.value) || 1500; });
        // Zoom : appliqué en direct pendant qu'on fait glisser, enregistré au relâchement
        const zoom = el.querySelector('[data-h24-cam-zoom]');
        zoom?.addEventListener('input', () => this.setCamZoom(zoom.value, false));
        zoom?.addEventListener('change', () => this.setCamZoom(zoom.value, true));
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
                <label class="h24-regie__zoom" title="${esc(t('h24.regie.camZoom', null, 'Zoom'))}">
                    <i class="fas fa-search-plus"></i>
                    <input type="range" data-h24-cam-zoom min="${CAM_ZOOM.min}" max="${CAM_ZOOM.max}" step="${CAM_ZOOM.step}" value="${this.cam.zoom}">
                    <span data-h24-cam-zoom-val>${this.zoomLabel()}</span>
                </label>
                <button type="button" class="btn btn--sm${camLive ? ' btn--primary' : ''}" data-h24-regie="cam"><i class="fas fa-${camLive ? 'stop' : 'camera'}"></i> ${esc(camLive ? t('h24.regie.camStop', null, 'Arrêter la caméra') : t('h24.regie.camStart', null, 'Diffuser ma caméra'))}</button>
            </div>
            <div class="h24-regie__hint">${hint}</div>`;
    },

    zoomLabel() {
        const z = this.cam.zoom;
        const optical = this.camSender?.active && this.camSender.info?.zoom?.optical;
        return `${z.toFixed(1).replace(/\.0$/, '')}×${optical ? ' ' + t('h24.regie.camZoomOptical', null, 'optique') : ''}`;
    },

    async setCamZoom(value, save) {
        this.cam.zoom = Math.min(CAM_ZOOM.max, Math.max(CAM_ZOOM.min, Number(value) || 1));
        if (save) this.saveCam();
        const lbl = document.querySelector('[data-h24-cam-zoom-val]');
        if (lbl) lbl.textContent = this.zoomLabel();
        if (this.camSender?.active) {
            await this.camSender.setZoom(this.cam.zoom);
            if (lbl) lbl.textContent = this.zoomLabel();
        }
    },

    saveCam() {
        try { localStorage.setItem('h24Cam', JSON.stringify({ deviceId: this.cam.deviceId, quality: this.cam.quality, zoom: this.cam.zoom })); } catch {}
    },

    setCamPref(name, value) {
        if (name === 'quality' && !CAM_QUALITIES[value]) return;
        this.cam[name] = value;
        this.saveCam();
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
            await this.camSender.start({ deviceId: this.cam.deviceId, quality: this.cam.quality, zoom: this.cam.zoom });
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

    /** Guide en haut au centre : l'action en cours, à tout moment (partie, votes, inscription, récap ; rafraîchi avec le chrono) */
    renderGuide() {
        const hint = $('h24-hint');
        const s = this.state, g = s?.game;
        if (!hint || !s) return;
        if (s.phase !== 'play' || !g) return this.setGuide(hint, ...this.stageGuide());
        const hist = g.history || [];
        const last = hist.length ? t('h24.flowLast', { move: fmtMove(hist[hist.length - 1]) }, `Dernier coup : ${hist[hist.length - 1]}`) : '';
        const mine = this.myTurn();
        const side = t(g.turn === 'w' ? 'h24.sideW' : 'h24.sideB');
        let msg, html = '';
        const next = !s.paused && this.nextMoveOf(g);
        if (s.paused) msg = s.pauseReason === 'phantom' ? t('h24.pausePhantom', null, 'Phantom…') : t('timerRing.paused', null, 'pause');
        else if (g.result) msg = this.resultInfo(g.result)?.title || last;
        else if (next) {
            // Coup retenu : pièce, coup, score (ou dé si tiré au hasard) et votant
            const piece = pieceOf(next.san);
            const score = next.random ? '🎲' : next.pct != null ? `${next.pct}%` : '';
            msg = t('h24.flowChosen', { move: fmtMove(next.san) }, `Coup retenu : ${next.san}`);
            html = `${piece ? `<img class="h24-guide__piece" src="${window.pieceUrl((g.turn === 'b' ? 'b' : 'w') + piece)}" alt="">` : ''}`
                + `${esc(t('h24.nextMove', null, 'Coup retenu'))} <b class="h24-guide__san">${esc(fmtMove(next.san))}</b>`
                + `${score ? ` <span class="h24-guide__pct">${score}</span>` : ''}`
                + `${next.voter ? ` <span class="h24-guide__voter">@${esc(next.voter)}${next.via ? ' ' + esc(next.via.startsWith('#') ? next.via : '#' + next.via) : ''}</span>` : ''}`;
        } else if (g.draw) msg = t('h24.flowDrawing', null, 'Tirage au sort…');
        else if (g.settle) {
            const n = Math.max(1, this.remaining(s.endsAt) ?? 1);
            msg = [last, t('h24.flowNextIn', { n }, `Vote dans ${n} s`)].filter(Boolean).join(' · ');
        } else if (s.vs?.thinking) msg = t('h24.botThinking', null, 'Stockfish réfléchit…');
        else if (!g.turnEndsAt) msg = last;
        else if (!this.me.login) msg = t('h24.watchOnly', null, 'Tu regardes. Connecte-toi pour jouer.');
        else if (!this.me.team) msg = t('h24.joinToVote', null, 'Rejoins une équipe pour voter.');
        else if (mine && myVotes(this.me).length) {
            const mv = myVotes(this.me);
            const max = this.me.maxVotes || 1;
            msg = max > 1
                ? t('h24.yourVotes', { moves: mv.join(', '), n: mv.length, max }, `Tes votes : ${mv.join(', ')} (${mv.length}/${max})`)
                : t('h24.yourVote', { move: mv[0] }, `Ton vote : ${mv[0]}`);
        }
        else if (mine && g.turn !== this.me.team && s.mode === 'teams') msg = t('h24.bothSides', { side }, 'Ton équipe joue aussi ce camp.');
        else if (mine) msg = t('h24.clickToVote', null, 'Clique un coup ou déplace une pièce');
        else if (s.mode === 'teams') msg = t('h24.flowVoteOf', { side }, g.turn === 'w' ? 'Vote des Blancs' : 'Vote des Noirs');
        else msg = last;
        // Chat Twitch relié : les viewers votent aussi
        if (this.me.chat && mine && !s.paused && !g.draw && !g.chosen) msg += ' · ' + t('h24.guideViewersMove', null, 'tes viewers votent aussi dans ton chat (ex. e4)');
        this.setGuide(hint, msg, mine && !s.paused && !g.draw && !g.chosen, html);
    },

    /** Entre deux parties : vote du mode et des options, inscription, récap → [message, à toi d'agir] */
    stageGuide() {
        const s = this.state;
        const n = s.endsAt && !s.paused ? Math.max(1, this.remaining(s.endsAt) ?? 1) : null;
        const b = s.ballot;
        if (s.paused) return [s.pauseReason === 'phantom' ? t('h24.pausePhantom', null, 'Phantom…') : t('timerRing.paused', null, 'pause'), false];
        if ((s.phase === 'voteMode' || s.phase === 'voteOptions') && b) {
            if (b.winner != null) return [t('h24.guideDecided', { choice: choiceLabel(b.id, b.winner) }, `Choix retenu : ${choiceLabel(b.id, b.winner)}`), false];
            const nums = numList(b.choices.length);
            const viewers = this.me.chat ? ' · ' + t('h24.guideViewersVote', { nums }, `tes viewers tapent ${nums} dans ton chat`) : '';
            if (this.me.ballot != null) return [t('h24.yourVote', { move: choiceLabel(b.id, this.me.ballot) }, `Ton vote : ${choiceLabel(b.id, this.me.ballot)}`) + viewers, false];
            if (this.me.login) return [t('h24.guideClickOption', null, 'Clique une option pour voter') + viewers, true];
            return [t('h24.guideLoginVote', null, 'Connecte-toi avec Twitch pour voter'), false];
        }
        if (s.phase === 'signup') {
            const start = n ? ' · ' + t('h24.guideStartIn', { n }, `Départ dans ${n} s`) : '';
            const viewers = this.me.chat ? ' · ' + t('h24.guideViewersJoin', null, 'tes viewers tapent join dans ton chat') : '';
            if (this.me.team) return [t('h24.registered', null, 'Tu es inscrit !') + viewers + start, false];
            if (this.me.login) return [t('h24.guideJoin', null, 'Clique sur Rejoindre pour entrer dans la partie') + viewers + start, true];
            return [t('h24.watchOnly', null, 'Tu regardes. Connecte-toi pour jouer.') + start, false];
        }
        if (s.phase === 'recap') {
            const end = this.resultInfo(s.recap?.result || s.game?.result);
            return [[end?.title || t('h24.recapTitle', null, 'Fin de partie'), n ? t('h24.flowNextIn', { n }, `Vote dans ${n} s`) : ''].filter(Boolean).join(' · '), false];
        }
        return ['', false];
    },

    setGuide(hint, msg, go, html = '') {
        const key = html || msg;
        if (key !== this.guideKey) {
            this.guideKey = key;
            if (html) hint.innerHTML = html; else hint.textContent = msg;
            hint.title = msg;
            // Nouvelle action : petit rebond pour attirer l'œil (pas à chaque seconde du décompte)
            const kind = key.replace(/\d+/g, '');
            if (kind !== this.guideKind) {
                this.guideKind = kind;
                hint.classList.remove('is-new');
                void hint.offsetWidth;
                hint.classList.add('is-new');
            }
        }
        hint.classList.toggle('is-active', go);
    },

    /** Chrono : anneau en tête de la barre d'outils (contre le coin haut droit de l'échiquier) pendant la partie, barre de la fenêtre centrale entre deux parties */
    renderClock() {
        const s = this.state;
        const box = $('h24-timer');
        if (!s || !box) return;
        const g = s.game;
        const inPlay = s.phase === 'play' && !!g;
        const at = inPlay ? (g.draw || g.result ? null : g.turnEndsAt) : s.endsAt;
        const area = $('h24-wheel-area');
        // Pendant la partie : pendules au bout des bandeaux des deux camps
        this.renderGuide();
        if (inPlay) {
            box.hidden = true;
            area?.classList.toggle('is-soon', !!at && !s.paused && (this.remaining(at) ?? 99) <= 1);
            this.paintPclocks();
            return;
        }
        cancelAnimationFrame(this.pclockRaf); this.pclockRaf = 0;
        if (!at && !s.paused) {
            box.hidden = true;
            area?.classList.remove('is-soon');
            return;
        }
        box.hidden = false;
        const left = s.paused ? null : this.remaining(at);
        // Durée totale : la plus grande valeur vue pour cette échéance
        const key = `${s.phase}:${at}`;
        if (this.clockKey !== key) { this.clockKey = key; this.clockTotal = left || 1; }
        this.clockTotal = Math.max(this.clockTotal, left || 0);
        const txt = left == null ? '--'
            : left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : String(left);
        const critical = inPlay && left != null && left <= 5;
        $('h24-timer-value').textContent = txt;
        $('h24-timer-label').textContent = s.paused ? (s.pauseReason === 'phantom' ? t('h24.pausePhantom', null, 'Phantom…') : t('timerRing.paused', null, 'pause'))
            : critical ? t('timerRing.hurry', null, 'votez !') : t('timerRing.seconds', null, 'secondes');
        const exact = s.paused || !at ? left : Math.max(0, (at - (Date.now() + (this.skew || 0))) / 1000);
        if (this.clockKey !== this.fillKey) { this.fillKey = this.clockKey; fillVoteTimer(box, 0, 0); }
        fillVoteTimer(box, 1 - (exact || 0) / this.clockTotal, s.paused ? 0 : 0.25);
        box.classList.toggle('is-critical', critical);
        $('h24-wheel-area')?.classList.toggle('is-soon', inPlay && left != null && left <= 1);
    },

    /**
     * Pendules des bandeaux : le camp au trait décompte (blanc, dixièmes sous 10 s, rouge à 5 s),
     * l'autre attend en gris avec la durée d'un tour. Rafraîchies à chaque image pour un défilement régulier.
     */
    paintPclocks() {
        const s = this.state, g = s?.game;
        const els = document.querySelectorAll('#page-h24 [data-pclock]');
        if (!g || s.phase !== 'play' || !els.length) { cancelAnimationFrame(this.pclockRaf); this.pclockRaf = 0; return; }
        const at = g.draw || g.result ? null : g.turnEndsAt;
        const fmt = (sec) => sec < 10 ? `0:0${(Math.floor(sec * 10) / 10).toFixed(1)}`
            : `${Math.floor(Math.ceil(sec) / 60)}:${String(Math.ceil(sec) % 60).padStart(2, '0')}`;
        const full = fmt(Number(s.options?.turn) || 30);
        let running = false;
        for (const el of els) {
            const side = el.dataset.pclock;
            const active = !g.result && (side === 'all' || g.turn === side);
            let html = full, critical = false;
            if (active && s.paused) html = '<i class="fas fa-pause"></i>';
            else if (active && at) {
                const sec = Math.max(0, (at - (Date.now() + (this.skew || 0))) / 1000);
                html = fmt(sec); critical = sec <= 5; running = sec > 0;
            } else if (active) html = g.settle ? full : '–';
            if (el.innerHTML !== html) el.innerHTML = html;
            el.classList.toggle('is-active', active);
            el.classList.toggle('is-paused', active && !!s.paused);
            el.classList.toggle('is-critical', critical && !s.paused);
        }
        if (!running) { cancelAnimationFrame(this.pclockRaf); this.pclockRaf = 0; }
        else if (!this.pclockRaf) this.pclockRaf = requestAnimationFrame(() => { this.pclockRaf = 0; this.paintPclocks(); });
    },

    renderSteps() {
        const s = this.state;
        const el = $('h24-steps');
        if (!el) return;
        const cur = STEPS.indexOf(s?.phase);
        // Régie : chaque étape se force au clic (tests)
        const force = (p) => this.me.regie ? ` data-h24-force="${p}"` : '';
        el.innerHTML = STEPS.map((p, i) => {
            const name = esc(t(`h24.phase.${p}`, null, p));
            return `<li class="h24-step${i === cur ? ' is-current' : ''}${cur > i ? ' is-done' : ''}" title="${name}" aria-label="${i + 1}. ${name}"${i === cur ? ' aria-current="step"' : ''}${force(p)}>${i + 1}</li>`;
        }).join('');
        // Pendant les votes, le bloc se vide puis se remplit au fil des résultats : mode, puis chaque option
        const b = s?.ballot;
        const voting = s?.phase === 'voteMode' || s?.phase === 'voteOptions';
        const pending = new Set(voting ? [...(s?.next || []), ...(b && b.winner == null ? [b.id] : [])] : []);
        if (s?.phase === 'voteMode') ['elo', 'turn', 'decision', 'spin', 'votes', 'anonymity'].forEach(k => pending.add(k));
        const mode = s?.phase === 'voteMode' ? (b?.winner != null ? b.winner : null) : s?.mode;
        const title = $('h24-mode');
        if (title) {
            const txt = mode ? t(`h24.mode.${mode}`, null, mode) : t('h24.modeVoting', null, 'Mode au vote…');
            if (title.textContent !== txt) {
                title.textContent = txt;
                if (voting) this.animate(title, mode ? 'is-new' : 'is-reset', mode ? 1500 : 600);
            }
            title.classList.toggle('is-pending', !mode);
        }
        const opts = $('h24-options');
        if (opts) {
            // Récap des options : une ligne par option (intitulé, valeur, icône). Pendant les votes, chaque valeur
            // repart à « … » (remise à zéro visible), l'option en cours de vote clignote, puis le résultat se dévoile.
            const o = { ...(s?.options || {}) };
            if (b?.winner != null && b.id !== 'mode') o[b.id] = b.winner;   // résultat montré dès qu'il est connu
            const defs = {
                elo: [t('h24.opt.elo', null, 'Niveau'), () => `Stockfish ${choiceLabel('elo', o.elo)}`, () => 'fa-robot'],
                turn: [t('h24.opt.turn', null, 'Tour'), () => choiceLabel('turn', o.turn), () => 'fa-stopwatch'],
                decision: [t('h24.opt.decision', null, 'Décision'), () => choiceLabel('decision', o.decision), () => CHOICE_ICON[o.decision] || 'fa-check'],
                spin: [t('h24.opt.spin', null, 'Tirage'), () => choiceLabel('spin', o.spin), () => CHOICE_ICON[o.spin] || 'fa-play'],
                votes: [t('h24.opt.votes', null, 'Votes'), () => t('h24.opt.perTurn', { n: o.votes }, `${o.votes} / tour`), () => 'fa-hand-pointer'],
                anonymity: [t('h24.opt.anonymity', null, 'Visibilité'), () => t(`h24.opt.anon.${o.anonymity}`, null, o.anonymity), () => CHOICE_ICON[o.anonymity] || 'fa-eye']
            };
            // Options du mode (toutes tant que le mode n'est pas choisi)
            const keys = Object.keys(defs).filter(k => (!mode || (k === 'elo' ? mode === 'bot' : mode !== 'rush' || (k !== 'decision' && k !== 'spin'))) && (o[k] != null || pending.has(k)));
            const live = voting && b && b.winner == null ? b.id : null;
            const shown = s?.mode || voting ? keys : [];
            const els = new Map([...opts.querySelectorAll('[data-opt]')].map(e => [e.dataset.opt, e]));
            els.forEach((e, k) => { if (!shown.includes(k)) e.remove(); });
            shown.forEach((k, i) => {
                const [label, value, icon] = defs[k];
                const wait = pending.has(k);
                const val = wait ? '…' : value();
                let e = els.get(k);
                if (!e) {
                    e = document.createElement('div');
                    e.className = 'h24-opt';
                    e.dataset.opt = k;
                    e.innerHTML = `<i class="fas"></i><span class="h24-opt__label">${esc(label)}</span><span class="h24-opt__value"></span>`;
                    e.dataset.val = '';
                }
                if (opts.children[i] !== e) opts.insertBefore(e, opts.children[i] || null);
                e.classList.toggle('is-pending', wait);
                e.classList.toggle('is-live', live === k);
                e.querySelector('i').className = `fas ${wait ? 'fa-question' : icon()}`;
                if (e.dataset.val !== val) {
                    const was = e.dataset.val;
                    e.dataset.val = val;
                    e.querySelector('.h24-opt__value').textContent = val;
                    // Remise à zéro : la valeur s'efface ; résultat d'un vote : il se dévoile (en décalé pour un départ groupé)
                    if (voting && was && wait) this.animate(e, 'is-reset', 600, i * 70);
                    else if (voting && was === '…' && !wait) this.animate(e, 'is-new', 1500);
                }
            });
        }
        const viewers = $('h24-viewers');
        if (viewers) viewers.textContent = String(s?.viewers || 0);
    },

    /** Petite entrée animée (option tout juste votée) */
    popIn(el) { this.animate(el, 'is-new', 1500); },

    /** Rejoue une animation CSS (classe posée puis retirée), avec un délai éventuel */
    animate(el, cls, ms, delay = 0) {
        el.classList.remove('is-new', 'is-reset');
        el.style.animationDelay = delay ? `${delay}ms` : '';
        void el.offsetWidth;
        el.classList.add(cls);
        clearTimeout(el._anim);
        el._anim = setTimeout(() => { el.classList.remove(cls); el.style.animationDelay = ''; }, ms + delay);
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
        el.innerHTML = solo ? list('w') : s?.mode === 'bot' ? list(s.vs?.side || 'w') : list('w') + list('b');
        this.renderSides();
    },

    /** Pendant la partie : équipe adverse au-dessus de l'échiquier, la sienne (ou les Blancs) en dessous */
    renderSides() {
        const s = this.state;
        const top = $('h24-side-top'), bottom = $('h24-side-bottom');
        if (!top || !bottom) return;
        const on = s?.phase === 'play' && !!s.game;
        top.hidden = bottom.hidden = !on;
        if (!on) return;
        const solo = s.mode === 'rush';
        const low = this.orientation() === 'black' ? 'b' : 'w';
        const login = this.me.login, team = this.me.team;
        const action = !login
            ? `<button type="button" class="btn btn--sm btn--twitch" data-h24-login><i class="fab fa-twitch"></i> ${esc(t('h24.login', null, 'Se connecter avec Twitch'))}</button>`
            : !team ? `<button type="button" class="btn btn--sm btn--primary" data-h24-signup><i class="fas fa-user-plus"></i> ${esc(t('h24.join', null, 'Rejoindre'))}</button>`
            : `<button type="button" class="h24-side__quit" data-h24-quit>${esc(t('h24.quit', null, 'Quitter la partie'))}</button>`;
        const pclock = (side) => `<span class="h24-pclock" data-pclock="${side}"></span>`;
        const fill = (el, pos, side, withAction) => {
            // Contre Stockfish : la bande du moteur (niveau, « réfléchit… »)
            if (s.mode === 'bot' && side !== s.vs?.side) {
                const turn = s.game.turn === side;
                el.className = `h24-side h24-side--${pos} h24-side--${side} h24-side--engine${turn ? ' is-turn' : ''}`;
                el.innerHTML = `${pclock(side)}<span class="h24-side__spacer"></span><span class="h24-side__team h24-team--${side}"><span class="h24-team__swatch"></span><i class="fas fa-robot"></i> Stockfish ${esc(choiceLabel('elo', s.vs?.elo))}</span>
                    ${turn && s.vs?.thinking ? `<span class="h24-side__turn">${esc(t('h24.botThinking', null, 'Stockfish réfléchit…'))}</span>` : ''}
                    `;
                return;
            }
            const n = (s.teams?.[side] || []).length;
            const label = solo ? t('h24.players', null, 'Joueurs') : t(side === 'w' ? 'h24.white' : 'h24.black', null, side === 'w' ? 'Blancs' : 'Noirs');
            const turn = !solo && s.game.turn === side;
            const mine = !!team && (solo || team === side);
            el.className = `h24-side h24-side--${pos} h24-side--${side}${turn ? ' is-turn' : ''}${mine ? ' is-mine' : ''}`;
            el.innerHTML = `${pclock(solo ? 'all' : side)}<span class="h24-side__spacer"></span><span class="h24-side__team h24-team--${side}"><span class="h24-team__swatch"></span>${esc(label)}</span>
                <span class="h24-side__count" title="${esc(t('h24.players', null, 'Joueurs'))}"><i class="fas fa-user"></i> ${n}</span>
                ${mine ? `<span class="h24-side__mine">${esc(t('h24.yourTeam', null, 'Votre équipe'))}</span>` : ''}
                ${withAction ? action : ''}`;
        };
        if (solo) { top.hidden = true; fill(bottom, 'bottom', 'w', true); }
        else {
            fill(top, 'top', low === 'w' ? 'b' : 'w', false);
            fill(bottom, 'bottom', low, true);
        }
        // Les bandes viennent d'être réécrites : le chrono y reprend sa place tout de suite
        this.renderClock();
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
        const modal = $('h24-modal');
        if (modal) modal.hidden = inGame;
        $('page-h24')?.classList.toggle('has-h24-modal', !inGame);
        slot.hidden = !inGame;
        if (inGame) this.renderPlay();
        else {
            card.innerHTML = this.cardHtml();
            const turn = $('h24-turn');
            const end = this.resultInfo(s.game?.result);
            if (turn) {
                turn.textContent = end ? [end.title, end.sub].filter(Boolean).join(' · ') : '';
                turn.className = `watch__status h24-turn${end ? ` h24-turn--end h24-turn--end-${end.tone}` : ''}`;
            }
            this.renderGuide();
            $('h24-move-form').hidden = true;
            $('h24-score').hidden = true;
            this.hideDraw();
            this.clearLive();
            this.podiumKey = null;
            $('h24-votes')?.querySelector('.podium')?.remove();
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
            this.annotations?.setHover?.(null);
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
                    a.map(m => `<li><button type="button" ${mine ? '' : 'tabindex="-1" disabled'} class="${picked.includes(m) ? 'is-mine' : ''}" data-move="${esc(m)}" data-h24-move="${esc(m)}">${esc(fmtMove(m))}</button></li>`).join('')
                }</ul>`).join('');
        }
        paintMoveChips($('h24-moves'), g?.votes || [], COLORS);
        const panel = $('h24-moves');
        panel.classList.toggle('is-empty', !moves.length);
        // À toi de jouer : le bloc passe au premier plan (avec un éclat au début du tour) ; sinon il s'efface un peu
        const live = !!g && !g.result;
        panel.classList.toggle('is-turn', live && mine);
        panel.classList.toggle('is-idle', live && !mine);
        const wake = live && mine ? `${g.fen}` : null;
        if (wake && wake !== this.wakeKey && this.wakeKey !== undefined) this.animate(panel, 'is-wake', 1700);
        this.wakeKey = wake;
    },

    // ------------------------------------------------------------------ style du tirage
    /** Thème du site (js/utils/pieceSet.js) : gratuits et achetés à la Boutique */
    setBg(bg) {
        window.setSiteTheme?.(bg);
        this.renderBgs();
    },

    renderBgs() {
        const pc = window.pieceCatalog;
        const box = document.querySelector('[data-h24-bgs]');
        if (!pc || !box) return;
        const cur = pc.theme().id;
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        box.innerHTML = pc.themes.filter(pc.unlocked).map(x => `<button type="button" class="btn btn--sm${x.id === cur ? ' is-active' : ''}" data-h24-bg="${x.id}"><span class="h24-bg-dot" style="background:${x.bg}"></span> <span>${esc(pc.themeLabel(x))}</span></button>`).join('');
    },

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
        const g = this.state?.phase === 'play' ? this.state.game : null;
        if (g) { this.liveSig = null; this.liveWheel(g); }
    },

    /** Majorité (et rush) : podium des coups en tête ; roue ou bande seulement pour départager une égalité */
    podiumMode() {
        const s = this.state;
        return s?.mode === 'rush' || (s?.options?.decision || 'majority') === 'majority';
    },

    /** Tirage au sort : roue ou bande toujours affichée pendant la partie, remplie au fil des votes, puis elle tourne */
    liveWheel(g) {
        const slot = $('h24-votes-panel');
        const area = $('h24-wheel-area');
        if (!slot || !area || g.draw || g.result) return;
        if (this.wheel?.isSpinning || this.revealing) return;
        if (this.podiumMode()) {
            if (slot.classList.contains('is-live')) { this.clearLive(); this.wheel = null; area.innerHTML = ''; }
            const list = $('h24-votes');
            // Nouveau tour : le podium repart de zéro (pas de coup fantôme du tour précédent)
            if (this.podiumKey !== g.fen) { this.podiumKey = g.fen; list?.querySelector('.podium')?.remove(); }
            renderPodium(list, $('h24-votes-total'), g.votes || [], { turn: g.turn, colors: COLORS, secret: g.secret, masked: g.masked });
            this.tickerTotal((g.votes || []).reduce((a, v) => a + (v.count || 0), 0) || (typeof g.secret === 'number' ? g.secret : 0));
            return;
        }
        $('h24-votes')?.querySelector('.podium')?.remove();
        // Nouveau coup à jouer : roue neuve (plus de coup gagnant affiché au centre)
        if (this.liveKey !== g.fen) {
            this.liveKey = g.fen;
            this.liveSig = null;
            if (this.wheel) this.wheel = null;
        }
        const wheel = this.ensureWheel(this.style);
        // Vote secret : des parts anonymes, mais qui grossissent quand même
        const entries = g.secret !== false && Array.isArray(g.masked)
            ? g.masked.filter(n => n > 0).map((n, i) => ['?' + '\u200b'.repeat(i), n])
            : (g.votes || []).filter(v => v.count > 0).map(v => [v.move, v.count]);
        slot.classList.add('is-live');
        area.classList.add('is-visible', 'is-live');
        const sig = `${this.style}|${JSON.stringify(entries)}`;
        if (sig === this.liveSig) return;
        this.liveSig = sig;
        wheel.votes = new Map(entries.map(([m, n]) => [m, { count: n, voters: new Map() }]));
        wheel.draw();
        const total = entries.reduce((a, [, n]) => a + n, 0) || (typeof g.secret === 'number' ? g.secret : 0);
        const tot = $('h24-votes-total');
        if (tot) tot.textContent = total ? t(total > 1 ? 'watch.totalMany' : 'watch.totalOne', { n: total }, `${total} vote${total > 1 ? 's' : ''}`) : t('wheelStyle.waiting', null, '');
        this.tickerTotal(total);
    },

    /** Mode bande : le total des votes du tour dans l'étiquette « Votes » (et plus en bas de la colonne de droite) */
    tickerTotal(total) {
        const band = this.style === 'band';
        $('h24-votes-panel')?.classList.toggle('is-band', band);
        const cnt = $('h24-ticker-count');
        if (cnt) cnt.textContent = band && total ? String(total) : '';
    },

    clearLive() {
        this.liveKey = null;
        this.liveSig = null;
        const cnt = $('h24-ticker-count');
        if (cnt) cnt.textContent = '';
        $('h24-votes-panel')?.classList.remove('is-band');
        $('h24-votes-panel')?.classList.remove('is-live');
        $('h24-wheel-area')?.classList.remove('is-visible', 'is-live');
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
            // Bande sous le bandeau des votes, lui-même collé sous l'échiquier
            const after = $('h24-ticker') || document.querySelector('#page-h24 .board-wrapper');
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

    /** Jauge des réglages : le mode (déjà choisi), puis chaque option du mode, faite / en cours / à venir */
    gaugeHtml(b, decided) {
        const s = this.state;
        if (s.phase !== 'voteOptions' || !s.plan?.length) return '';
        const steps = ['mode', ...s.plan];
        const at = steps.indexOf(b.id);
        if (at < 0) return '';
        const value = id => choiceLabel(id, id === 'mode' ? s.mode : s.options?.[id]);
        const bar = steps.map((id, i) => {
            const cls = i < at || (i === at && decided) ? 'is-done' : i === at ? 'is-now' : '';
            const tip = t(`h24.ballot.${id}`, null, id) + (i < at ? ` ${value(id)}` : '');
            return `<i class="${cls}" title="${esc(tip)}"></i>`;
        }).join('');
        const done = steps.slice(0, at).map(value).join(' · ');
        return `<div class="h24-gauge"><div class="h24-gauge__bar">${bar}</div>
            <div class="h24-gauge__txt"><span>${esc(t('h24.stepOf', { n: at + 1, total: steps.length }, `Réglage ${at + 1} / ${steps.length}`))}</span><span class="h24-gauge__done">${esc(done)}</span></div></div>`;
    },

    /** Derniers votes du scrutin (le plus récent en premier) : photo, pseudo, choix */
    ballotVotesHtml(b) {
        const recent = (b.recent || []).slice(-8).reverse();
        if (!recent.length) return '';
        const voted = t('anonymity.voted', null, 'a voté');
        return `<ul class="h24-card__votes">${recent.map(r => {
            const pic = r.p ? `<img class="vote-ticker__pic" src="${esc(r.p)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : `<span class="vote-ticker__pic" style="background:${nameColor(r.u)}">${r.v === 'bot' ? '<i class="fas fa-robot"></i>' : esc((r.u || '?')[0].toUpperCase())}</span>`;
            return `<li>${pic}<b style="color:${nameColor(r.u)}">${esc(r.u)}</b><span class="h24-card__vc">${esc(r.c != null ? choiceLabel(b.id, r.c) : voted)}</span></li>`;
        }).join('')}</ul>`;
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
            const buttons = b.choices.map((c, i) => {
                const n = counts[String(c)] || 0;
                const pct = b.total ? Math.round(n * 100 / b.total) : 0;
                const icon = CHOICE_ICON[c] ? `<i class="fas ${CHOICE_ICON[c]}"></i>` : '';
                const won = decided ? (String(b.winner) === String(c) ? ' is-winner' : ' is-loser') : '';
                return `<button type="button" class="h24-choice${String(mine) === String(c) ? ' is-mine' : ''}${won}" data-h24-choice="${esc(c)}" ${canVote ? '' : 'disabled'} style="--pct:${pct}%">
                    <span class="h24-choice__label"><span class="h24-choice__num">${i + 1}</span>${icon}${esc(choiceLabel(b.id, c))}</span>
                    <span class="h24-choice__pct">${pct}%<small>${n}</small></span></button>`;
            }).join('');
            const gauge = this.gaugeHtml(b, decided);
            const next = gauge || !(s.next || []).length ? '' : `<p class="h24-card__next">${esc(t('h24.nextBallots', { n: s.next.length }, `Encore ${s.next.length} vote(s)`))}</p>`;
            const votes = this.ballotVotesHtml(b);
            if (decided) {
                const how = t(`h24.ballotHow.${b.how}`, null, '');
                return `${clock}${gauge}<h2 class="h24-card__title">${esc(t(`h24.ballot.${b.id}`, null, b.id))}</h2>
                    <div class="h24-choices is-decided">${buttons}</div>${votes}
                    <p class="h24-card__total">${esc(t('h24.ballotTotal', { n: b.total }, `${b.total} vote(s)`))}${how ? ' · ' + esc(how) : ''}</p>${next}`;
            }
            return `${clock}${gauge}<h2 class="h24-card__title">${esc(t(`h24.ballot.${b.id}`, null, b.id))}</h2>
                <div class="h24-choices">${buttons}</div>${votes}
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
                ${cta}<p class="h24-card__total">${esc(t('h24.registeredCount', { n }, `${n} inscrit(s)`))}</p>`;
        }
        return `${clock}<p class="h24-card__sub">${esc(t('h24.loading', null, 'Chargement…'))}</p>`;
    },

    /** Récap : MVP (le plus de coups retenus) et coup du match (le plus disputé) */
    recapHighlights(r) {
        const items = [];
        if (r.mvp) items.push(`<div class="h24-recap__hl">
            <span class="h24-recap__hl-k"><i class="fas fa-crown"></i> ${esc(t('h24.mvp', null, 'MVP'))}</span>
            <span class="h24-recap__hl-v">${r.mvp.side ? `<span class="h24-team__swatch h24-recap__sw--${r.mvp.side}"></span>` : ''}${esc(r.mvp.login)}</span>
            <small>${esc(t('h24.mvpLine', { n: r.mvp.n, v: r.mvp.votes }, `${r.mvp.n} coup(s) retenu(s) sur ${r.mvp.votes} vote(s)`))}</small></div>`);
        if (r.key) {
            const num = `${Math.floor(r.key.ply / 2) + 1}${r.key.side === 'b' ? '…' : '.'}`;
            items.push(`<div class="h24-recap__hl">
            <span class="h24-recap__hl-k"><i class="fas fa-bolt"></i> ${esc(t('h24.keyMove', null, 'Coup du match'))}</span>
            <span class="h24-recap__hl-v"><span class="h24-team__swatch h24-recap__sw--${r.key.side}"></span><span class="h24-recap__san">${esc(num)} ${esc(r.key.san)}</span></span>
            <small>${esc(t('h24.keyMoveLine', { pct: r.key.pct, n: r.key.total }, `le plus disputé : ${r.key.pct} % des ${r.key.total} votes`))}</small></div>`);
        }
        return items.length ? `<div class="h24-recap__hls">${items.join('')}</div>` : '';
    },

    recapHtml(r) {
        const info = this.resultInfo(r.result || { kind: 'draw' });
        const headline = [info.title, info.sub].filter(Boolean).join(' · ');
        const mins = Math.max(1, Math.round((r.durationMs || 0) / 60000));
        const tops = ['w', 'b'].filter(side => r.top?.[side]?.length).map(side => `<div class="h24-recap__top h24-recap__top--${side}">
            <span class="h24-team__swatch"></span><ol>${r.top[side].map(p => `<li>${esc(p.login)} <small>${p.n}</small></li>`).join('')}</ol></div>`).join('');
        return `<h2 class="h24-card__title">${esc(t('h24.recapTitle', null, 'Fin de partie'))}</h2>
            <p class="h24-recap__headline h24-recap__headline--${info.tone}"><i class="fas ${info.icon}"></i> ${esc(headline)}</p>
            <div class="h24-recap__stats">
                ${r.mode !== 'rush' ? `<span><strong>${Math.ceil((r.plies || 0) / 2)}</strong> ${esc(t('h24.moves', null, 'coups'))}</span>` : ''}
                <span><strong>${mins}</strong> min</span>
                <span><strong>${(r.players?.w || 0) + (r.players?.b || 0)}</strong> ${esc(t('h24.playersShort', null, 'joueurs'))}</span>
            </div>
            ${this.recapHighlights(r)}
            ${tops ? `<p class="h24-recap__label">${esc(t('h24.topVoters', null, 'Plus gros votants'))}</p><div class="h24-recap__tops">${tops}</div>` : ''}
            <p class="h24-card__next">${esc(t('h24.nextSoon', null, 'Vote du prochain mode juste après.'))}</p>`;
    },

    renderPlay() {
        const s = this.state;
        const g = s.game;
        const side = $('h24-turn');
        if (side) {
            // Le trait se lit déjà dans les bandeaux d'équipe autour de l'échiquier : rien ici hors puzzle rush
            side.textContent = s.mode === 'rush' ? this.puzzleLabel(g) : '';
            side.className = `watch__status h24-turn h24-turn--${g.turn}`;
        }
        this.renderGuide();
        $('h24-move-form')?.toggleAttribute('hidden', !this.myTurn());
        this.renderDraw(g);
        this.liveWheel(g);
        const first = (g.startFen || '').split(' ')[1] === 'b' ? 'b' : 'w';
        // L'historique reste calé en bas (dernier coup visible), sauf si on est remonté le relire entre deux coups
        const histEl = $('h24-history'), histSc = histEl?.closest('.panel__content');
        const histLen = (g.history || []).length;
        const stick = !histSc || histLen !== this.histLen || histSc.scrollHeight - histSc.scrollTop - histSc.clientHeight < 40;
        this.histLen = histLen;
        // Coup retenu affiché en bas de l'historique : quand il est joué, il glisse à sa place dans la liste
        const card = histSc?.querySelector('.h24-next');
        const from = card && histLen > Number(card.dataset.ply) ? card.getBoundingClientRect() : null;
        if (from) card.remove();
        renderHistory(histEl, (g.history || []).map((san, i) => ({ san, v: s.mode !== 'rush' ? g.hv?.[i] ?? null : null })), first);
        this.renderNextMove(g);
        if (stick || from) this.historyToBottom();
        if (from) this.flyIntoHistory(card, from);
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
        // Un seul coup proposé ou arrivé trop tard : le coup tiré directement
        if (votes.length < 2 || left < 1500) {
            markPodiumWinner($('h24-votes'), g.draw.winner);
            return;
        }
        const wheel = this.ensureWheel(this.style);
        const area = $('h24-wheel-area');
        wheel.votes = new Map(votes.map(v => [v.m, { count: v.n, voters: new Map() }]));
        area.classList.add('is-visible', 'is-spinning');
        wheel.draw();
        // La roue est déjà en place (remplie pendant le vote) : elle tourne sans changer de place
        if (area.classList.contains('wheel-area--docked') && !slot.classList.contains('is-live')) slot.classList.add('is-drawing');
        this.revealing = true;
        // Dès que la roue s'arrête (et pas 2 s plus tard, à la fin de son effet) : flèche, podium et coup retenu
        const reveal = () => {
            if (!this.revealing) return;
            this.revealing = false;
            area.classList.remove('is-spinning');
            markPodiumWinner($('h24-votes'), g.draw?.winner);
            this.renderBoard();
            if (this.state?.game) this.renderNextMove(this.state.game);
        };
        wheel.highlightWinner = reveal;
        wheel.onSpinEnd = reveal;
        // La roue s'arrête un peu avant que le coup soit joué : le temps de voir la flèche
        wheel.spin(Math.max(600, left - 2200), g.draw.winner, g.draw.stop);
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
        // Le coup tiré s'affiche dans l'historique (renderNextMove), plus à la place du podium
        wheel.highlightWinner = () => {};
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
// Mode « 24/24 (régie) » : le Phantom suit la partie 24/24
window.PhantomOwner?.register('h24', {
    pages: ['h24'],
    active: () => !!(H24Page.me.regie && H24Page.regie.live && window.phantomChessboard?.isConnected),
    label: () => t('phantomOwner.modeH24', null, '24/24 (régie)'),
    url: () => '/24h',
});
