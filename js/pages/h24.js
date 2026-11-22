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
import { renderPodium, renderHistory, markPodiumWinner, morphPodiumToWheel, revealWinner, clearWinner } from '../components/voteViews.js';

const t = (key, params, fallback) => {
    const s = window.i18n?.t(key, params);
    return s && s !== key ? s : (fallback ?? key);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const PIECES = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const STEPS = ['play', 'recap', 'voteMode', 'voteOptions', 'signup'];

/** Libellé d'un choix de vote (mode, durée du tour, décision, niveau) */
function choiceLabel(ballot, c) {
    if (ballot === 'mode') return t(`h24.mode.${c}`, null, c);
    if (ballot === 'turn') return t('h24.seconds', { n: c }, `${c} s`);
    if (ballot === 'decision') return t(`h24.decision.${c}`, null, c);
    if (ballot === 'level') return t(`h24.level.${c}`, null, c);
    return String(c);
}
const CHOICE_ICON = { teams: 'fa-chess', problems: 'fa-puzzle-piece', majority: 'fa-check-double', draw: 'fa-dice', band: 'fa-grip-lines', easy: 'fa-seedling', medium: 'fa-chess-knight', hard: 'fa-fire' };

const H24Page = {
    socket: null,
    board: null,
    state: null,
    me: { login: null, team: null, vote: null, ballot: null },
    clock: null,
    boardKey: null,

    init() {
        if (!this.socket) this.connect();
        if (!this._bound) this.bind();
        this.ensureBoard();
        requestAnimationFrame(() => this.board?.resize());
        this.render();
    },

    stop() {
        if (!this.socket) return;
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
        socket.on('connect', join);
        socket.on('h24:state', (st) => {
            this.skew = st.now - Date.now();
            this.state = st;
            this.render();
        });
        socket.on('h24:me', (me) => { this.me = me || {}; this.render(); });
        this.clock = setInterval(() => this.renderClock(), 250);
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
            if (e.target.closest('[data-h24-quit]')) { this.socket?.emit('h24:quit'); return; }
            if (e.target.closest('[data-h24-login]')) { twitchAuth.login?.(); return; }
            const mv = e.target.closest('[data-h24-move]');
            if (mv) this.socket?.emit('h24:vote', { move: mv.dataset.h24Move });
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
        if (s.mode === 'problems') return g.puzzle?.status === 'playing' && g.turn === g.puzzle.side;
        // Camp sans joueur : l'autre équipe joue aussi ses coups
        return g.turn === this.me.team || !(s.teams?.[g.turn] || []).length;
    },

    orientation() {
        const s = this.state;
        if (s?.mode === 'problems') return s.game?.puzzle?.side === 'b' ? 'black' : 'white';
        return this.me.team === 'b' ? 'black' : 'white';
    },

    ensureBoard() {
        const el = $('h24-board');
        if (!el || this.board || typeof Chessboard !== 'function') return;
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
        this.renderBoard();
        this.renderClock();
    },

    remaining(at) {
        if (!at) return null;
        return Math.max(0, Math.ceil((at - (Date.now() + (this.skew || 0))) / 1000));
    },

    renderClock() {
        const s = this.state;
        if (!s) return;
        const phaseLeft = s.paused ? null : this.remaining(s.endsAt);
        const el = $('h24-phase-clock');
        if (el) el.textContent = s.paused ? t('h24.paused', null, 'En pause') : phaseLeft == null ? '' : `${phaseLeft} s`;
        const turn = $('h24-turn-clock');
        if (turn) {
            const left = s.game && !s.paused ? this.remaining(s.game.turnEndsAt) : null;
            turn.textContent = left == null ? '' : `${left}`;
            turn.hidden = left == null;
            turn.classList.toggle('is-urgent', left != null && left <= 5);
        }
    },

    renderSteps() {
        const s = this.state;
        const el = $('h24-steps');
        if (!el) return;
        const cur = STEPS.indexOf(s?.phase);
        el.innerHTML = STEPS.map((p, i) => `<li class="h24-step${i === cur ? ' is-current' : ''}${cur > i ? ' is-done' : ''}">
            <span class="h24-step__dot">${i + 1}</span><span>${esc(t(`h24.phase.${p}`, null, p))}</span></li>`).join('');
        const title = $('h24-mode');
        if (title) title.textContent = s?.mode ? t(`h24.mode.${s.mode}`, null, s.mode) : '24/24';
        const opts = $('h24-options');
        if (opts) {
            const o = s?.options || {};
            const parts = [];
            if (s?.mode === 'problems' && o.level) parts.push(choiceLabel('level', o.level));
            if (o.turn) parts.push(choiceLabel('turn', o.turn));
            if (s?.mode === 'teams' && o.decision) parts.push(choiceLabel('decision', o.decision));
            opts.textContent = parts.join(' · ');
        }
        const viewers = $('h24-viewers');
        if (viewers) viewers.textContent = s ? t('h24.viewers', { n: s.viewers }, `${s.viewers} en ligne`) : '';
    },

    renderTeams() {
        const s = this.state;
        const el = $('h24-teams');
        if (!el) return;
        const teams = s?.teams || { w: [], b: [] };
        const solo = s?.mode === 'problems';
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
                <button type="button" class="btn btn--twitch h24-account__btn" data-h24-login><i class="fab fa-twitch"></i> ${esc(t('h24.login', null, 'Se connecter avec Twitch'))}</button>`;
            return;
        }
        const team = this.me.team;
        const canJoin = s && (s.phase === 'signup' || s.phase === 'play');
        if (team) {
            const label = s?.mode === 'problems' ? t('h24.inGame', null, 'Tu joues') : t(team === 'w' ? 'h24.inWhite' : 'h24.inBlack', null, team === 'w' ? 'Tu joues les Blancs' : 'Tu joues les Noirs');
            el.innerHTML = `<p class="h24-account__me h24-account__me--${team}"><strong>${esc(login)}</strong> · ${esc(label)}</p>
                <button type="button" class="btn btn--ghost btn--sm h24-account__btn" data-h24-quit>${esc(t('h24.quit', null, 'Quitter la partie'))}</button>`;
        } else {
            el.innerHTML = `<p class="h24-account__me"><strong>${esc(login)}</strong> · ${esc(t('h24.spectator', null, 'Spectateur'))}</p>
                ${canJoin ? `<button type="button" class="btn btn--primary h24-account__btn" data-h24-signup><i class="fas fa-user-plus"></i> ${esc(t('h24.join', null, 'Rejoindre'))}</button>` : `<p class="h24-account__hint">${esc(t('h24.joinLater', null, 'Les inscriptions ouvrent après les votes.'))}</p>`}`;
        }
    },

    /** Colonne de droite : selon la phase, la partie, le récap, un vote ou l'inscription */
    renderStage() {
        const s = this.state;
        const stage = $('h24-stage');
        if (!stage || !s) return;
        const play = $('h24-play');
        const card = $('h24-card');
        const inGame = s.phase === 'play' && s.game;
        play.hidden = !inGame;
        card.hidden = !!inGame;
        if (inGame) this.renderPlay();
        else card.innerHTML = this.cardHtml();
    },

    cardHtml() {
        const s = this.state;
        const clock = `<div class="h24-card__clock" id="h24-phase-clock"></div>`;
        if (s.phase === 'recap' && s.recap) return clock + this.recapHtml(s.recap);
        if ((s.phase === 'voteMode' || s.phase === 'voteOptions') && s.ballot) {
            const b = s.ballot;
            const counts = Object.fromEntries((b.tally || []).map(x => [x.k, x.n]));
            const mine = this.me.ballot;
            const canVote = !!this.me.login;
            const buttons = b.choices.map(c => {
                const n = counts[String(c)] || 0;
                const pct = b.total ? Math.round(n * 100 / b.total) : 0;
                const icon = CHOICE_ICON[c] ? `<i class="fas ${CHOICE_ICON[c]}"></i>` : '';
                return `<button type="button" class="h24-choice${String(mine) === String(c) ? ' is-mine' : ''}" data-h24-choice="${esc(c)}" ${canVote ? '' : 'disabled'} style="--pct:${pct}%">
                    <span class="h24-choice__label">${icon}${esc(choiceLabel(b.id, c))}</span>
                    <span class="h24-choice__pct">${pct}%<small>${n}</small></span></button>`;
            }).join('');
            const next = (s.next || []).length ? `<p class="h24-card__next">${esc(t('h24.nextBallots', { n: s.next.length }, `Encore ${s.next.length} vote(s)`))}</p>` : '';
            return `${clock}<h2 class="h24-card__title">${esc(t(`h24.ballot.${b.id}`, null, b.id))}</h2>
                <div class="h24-choices">${buttons}</div>
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

    recapHtml(r) {
        const res = r.result || {};
        let headline;
        if (res.kind === 'problems') headline = t('h24.recapProblems', { solved: res.solved, total: res.total }, `${res.solved} / ${res.total} problèmes résolus`);
        else if (res.kind === 'mate') headline = t(res.winner === 'w' ? 'h24.whiteWins' : 'h24.blackWins', null, res.winner === 'w' ? 'Victoire des Blancs' : 'Victoire des Noirs');
        else headline = t('h24.drawResult', null, 'Partie nulle') + (res.reason ? ` · ${t(`h24.drawReason.${res.reason}`, null, res.reason)}` : '');
        const mins = Math.max(1, Math.round((r.durationMs || 0) / 60000));
        const tops = ['w', 'b'].filter(side => r.top?.[side]?.length).map(side => `<div class="h24-recap__top h24-recap__top--${side}">
            <span class="h24-team__swatch"></span><ol>${r.top[side].map(p => `<li>${esc(p.login)} <small>${p.n}</small></li>`).join('')}</ol></div>`).join('');
        return `<h2 class="h24-card__title">${esc(t('h24.recapTitle', null, 'Fin de partie'))}</h2>
            <p class="h24-recap__headline">${esc(headline)}</p>
            <div class="h24-recap__stats">
                ${r.mode !== 'problems' ? `<span><strong>${Math.ceil((r.plies || 0) / 2)}</strong> ${esc(t('h24.moves', null, 'coups'))}</span>` : ''}
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
            const turnLabel = s.mode === 'problems'
                ? this.puzzleLabel(g)
                : t(g.turn === 'w' ? 'h24.whiteToPlay' : 'h24.blackToPlay', null, g.turn === 'w' ? 'Aux Blancs de jouer' : 'Aux Noirs de jouer');
            side.textContent = turnLabel;
            side.className = `h24-turn h24-turn--${g.turn}`;
        }
        const hint = $('h24-hint');
        if (hint) {
            let msg = '';
            if (!this.me.login) msg = t('h24.watchOnly', null, 'Tu regardes. Connecte-toi pour jouer.');
            else if (!this.me.team) msg = t('h24.joinToVote', null, 'Rejoins une équipe pour voter.');
            else if (this.myTurn() && g.turn !== this.me.team && s.mode === 'teams') msg = t('h24.bothSides', { side: t(g.turn === 'w' ? 'h24.sideW' : 'h24.sideB') }, 'Ton équipe joue aussi ce camp.') + (this.me.vote ? ' ' + t('h24.yourVote', { move: this.me.vote }) : '');
            else if (this.myTurn()) msg = this.me.vote ? t('h24.yourVote', { move: this.me.vote }, `Ton vote : ${this.me.vote}`) : t('h24.yourTurn', null, 'À toi : déplace une pièce ou tape un coup.');
            else msg = t('h24.waitTurn', null, 'L\'autre équipe réfléchit…');
            hint.textContent = msg;
            hint.classList.toggle('is-active', this.myTurn());
        }
        $('h24-move-form')?.toggleAttribute('hidden', !this.myTurn());
        // Nouveau tour : le podium repart de zéro (pas de coup fantôme du tour précédent)
        if (!g.votes?.length) $('h24-votes')?.querySelector('.podium')?.remove();
        if (!g.draw) renderPodium($('h24-votes'), $('h24-votes-total'), g.votes || [], { turn: g.turn });
        this.renderDraw(g);
        const first = (g.startFen || '').split(' ')[1] === 'b' ? 'b' : 'w';
        renderHistory($('h24-history'), (g.history || []).map(san => ({ san })), first);
        const score = $('h24-score');
        if (score) {
            score.hidden = s.mode !== 'problems';
            if (g.score) score.innerHTML = `<span class="h24-score__ok"><i class="fas fa-check"></i> ${g.score.solved}</span><span class="h24-score__ko"><i class="fas fa-times"></i> ${g.score.failed}</span>`;
        }
        const feed = $('h24-recent');
        if (feed) {
            const secret = false;
            feed.innerHTML = secret ? '' : (g.recent || []).slice().reverse().map(r => `<li><span>${esc(r.u)}</span> ${esc(r.m)}</li>`).join('');
        }
    },

    /** Tirage au sort : la roue prend la place du podium, puis le coup tiré s'affiche en grand */
    renderDraw(g) {
        const slot = $('h24-votes-panel');
        if (!slot) return;
        if (!g.draw || g.result) {
            if (this.drawSig) {
                this.drawSig = null;
                this.revealing = false;
                slot.classList.remove('is-drawing');
                $('h24-band-area')?.classList.remove('is-visible', 'is-spinning');
                clearWinner(slot);
            }
            return;
        }
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
            revealWinner(slot, { move: g.draw.winner, color: '#8b5cf6', pct: g.draw.random || !total ? null : Math.round(n * 100 / total), turn: g.turn });
            return;
        }
        const band = !g.draw.tie && this.state?.options?.decision === 'band';
        const wheel = band ? this.ensureBand() : this.ensureWheel();
        wheel.votes = new Map(votes.map(v => [v.m, { count: v.n, voters: new Map() }]));
        if (band) {
            // La bande apparaît sous le podium, qui reste visible
            $('h24-band-area').classList.add('is-visible');
        } else {
            morphPodiumToWheel(slot, $('h24-wheel-area')?.querySelector('.wheel-container'));
            slot.classList.add('is-drawing');
        }
        wheel.draw();
        this.revealing = true;
        wheel.onSpinEnd = () => { this.revealing = false; this.renderBoard(); };
        // La roue s'arrête un peu avant que le coup soit joué
        wheel.spin(Math.max(600, left - 1300), g.draw.winner);
    },

    ensureBand() {
        if (this.band) return this.band;
        const band = new WheelBand('h24-band-area');
        band.updateVoteList = () => {};
        band.showResultInside = false;
        band.currentTurn = () => (this.state?.game?.turn === 'b' ? 'b' : 'w');
        band.highlightWinner = () => {
            markPodiumWinner($('h24-votes'), band.winner);
            revealWinner($('h24-votes-panel'), { move: band.winner, color: band.winnerColor, pct: band.winnerPct, turn: band.currentTurn() });
        };
        // La page tient sans scroll : pas de défilement vers la bande
        band.container.scrollIntoView = () => {};
        this.band = band;
        return band;
    },

    ensureWheel() {
        if (this.wheel) return this.wheel;
        const wheel = new VotingWheel('h24-wheel-area');
        wheel.updateVoteList = () => {};
        wheel.showResultInside = false;
        wheel.currentTurn = () => (this.state?.game?.turn === 'b' ? 'b' : 'w');
        wheel.highlightWinner = () => {
            markPodiumWinner($('h24-votes'), wheel.winner);
            revealWinner($('h24-votes-panel'), { move: wheel.winner, color: wheel.winnerColor, pct: wheel.winnerPct, turn: wheel.currentTurn() });
        };
        this.wheel = wheel;
        return wheel;
    },

    puzzleLabel(g) {
        const p = g.puzzle;
        if (!p) return '';
        const head = t('h24.puzzleN', { i: p.index, n: p.total }, `Problème ${p.index}/${p.total}`) + (p.rating ? ` · ${p.rating}` : '');
        if (p.status === 'solved') return `${head} · ${t('h24.solved', null, 'Résolu !')}`;
        if (p.status === 'failed') return `${head} · ${t('h24.failed', null, 'Raté')}`;
        if (p.status === 'timeout') return `${head} · ${t('h24.timeout', null, 'Temps écoulé')}`;
        return `${head} · ${t(p.side === 'b' ? 'h24.findBlack' : 'h24.findWhite', null, p.side === 'b' ? 'Trouve le coup des Noirs' : 'Trouve le coup des Blancs')}`;
    }
};

export default H24Page;
