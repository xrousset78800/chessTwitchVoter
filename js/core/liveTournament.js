// Les proxys sont servis par la même origine que la page
const PROXY_BASE_T = '';

let tournamentData = null;
let activeRoundId = null;

const stateT = { 
    chess: null, board: null, polling: false, pollTimer: null, 
    currentGame: null, tournamentSlug: null, lastFEN: null,
    clockInterval: null, clockWhite: 0, clockBlack: 0  // ← nouveau
};

function logT(msg, type = 'info') {
    const el = document.getElementById('liveLogT');
    if (!el) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function initTournamentBoard() {
    stateT.chess = new Chess();
    stateT.board = Chessboard('liveBoardT', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        draggable: false,
    });
    window.BoardAnnotations?.attach('liveBoardT');
    window.addEventListener('resize', () => stateT.board?.resize());
}

async function loadTournament(input) {
    let slug = input.trim();
    const match = slug.match(/chess\.com\/events\/([^\/]+)/);
    if (match) slug = match[1];
    stateT.tournamentSlug = slug; // ← ajout
    const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event/${slug}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}

function formatElapsed(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m${s.toString().padStart(2,'0')}` : `${s}s`;
}

// ── Horaires des rondes (chess.com donne le début ; la fin = dernière partie terminée) ──
const roundLocale = () => (window.i18n?.currentLang === 'en' ? 'en-GB' : 'fr-FR');

/** "15:00" aujourd'hui, sinon "mar. 17, 15:00" */
function formatRoundStart(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const time = d.toLocaleTimeString(roundLocale(), { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return time;
    const day = d.toLocaleDateString(roundLocale(), { weekday: 'short', day: 'numeric' });
    return `${day}, ${time}`;
}

function formatTimeControl(tc) {
    const [base, inc] = String(tc || '').split('+').map(Number);
    if (!base) return '';
    const b = base >= 60 ? `${base / 60} min` : `${base} s`;
    return inc ? `${b} + ${inc} s` : b;
}

// chess.com programme un match en bloc (même heure pour toutes ses rondes) : l'heure réelle
// est celle de la première partie de la ronde
function roundStartedAt(r, games) {
    const starts = games.filter(g => g.roundId === r.id).map(g => Date.parse(g.startAt)).filter(Number.isFinite);
    return starts.length ? new Date(Math.min(...starts)).toISOString() : null;
}

// Pas commencée alors que l'horaire est passé : c'est l'heure du début du match, pas de la ronde
const roundIsOverdue = (r, games) => !roundStartedAt(r, games) && Date.parse(r.startAt) < Date.now();

/** Libellé court : heure réelle de début, sinon heure prévue, ou « à suivre » si elle n'a plus de sens */
const roundTimeLabel = (r, games) => {
    const started = roundStartedAt(r, games);
    if (started) return formatRoundStart(started);
    return roundIsOverdue(r, games) ? 'à suivre' : formatRoundStart(r.startAt);
};

function roundTooltip(r, games) {
    const full = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' };
    const hm = { hour: '2-digit', minute: '2-digit' };
    const lines = [`Ronde ${r.slug}`, `Prévue : ${new Date(r.startAt).toLocaleString(roundLocale(), full)}`];
    const started = roundStartedAt(r, games);
    if (started) lines.push(`Commencée à ${new Date(started).toLocaleTimeString(roundLocale(), hm)}`);
    else if (roundIsOverdue(r, games)) lines.push(`Horaire du match (chess.com) : commencera après la ronde précédente`);
    const tc = formatTimeControl(r.timeControl);
    if (tc) lines.push(tc);
    const roundGames = games.filter(g => g.roundId === r.id);
    const ends = roundGames.map(g => Date.parse(g.endAt)).filter(Number.isFinite);
    if (roundGames.length && ends.length === roundGames.length) {
        const end = new Date(Math.max(...ends)).toLocaleTimeString(roundLocale(), hm);
        lines.push(`Terminée à ${end}`);
    } else if (roundGames.some(isLiveGame)) {
        lines.push('En cours');
    }
    return lines.join('\n');
}

// Une partie pas encore jouée a aussi le résultat '*', mais pas d'heure de début
const isLiveGame = g => g.result === '*' && !!(g.startAt || g.currentFEN);

let roundPinned = false;   // ronde choisie à la main : le rafraîchissement ne la change plus
let lastLiveKeys = null;   // parties en cours au rafraîchissement précédent

// Ronde d'une partie en cours, sinon la dernière ronde où l'on a joué (chess.com ne donne pas de fin de ronde)
function autoRoundId(rounds, games) {
    const liveRoundId = games.find(isLiveGame)?.roundId;
    const playedRoundIds = new Set(games.filter(g => g.result !== '*' || isLiveGame(g)).map(g => g.roundId));
    const r = rounds.find(r => r.id === liveRoundId)
           ?? rounds.filter(r => playedRoundIds.has(r.id)).at(-1)
           ?? rounds.find(r => r.startAt);
    return r?.id ?? null;
}

const gameNames = g => `${g.white?.preferredShortName?.trim() || g.slug.split('-')[0]} – ${g.black?.preferredShortName?.trim() || g.slug.split('-')[1]}`;

/** refresh = mise à jour périodique de la même salle (garde la ronde choisie, signale les nouvelles parties) */
function renderTournament(data, { refresh = false } = {}) {
    const prevLiveRound = refresh ? tournamentData?.games?.find(isLiveGame)?.roundId : undefined;
    tournamentData = data;
    const panel = document.getElementById('tournamentPanel');
    const header = document.getElementById('tournamentHeader');

    panel.style.display = 'block';

    const tc = parseInt(data.room.timeControl);
    const liveCount = data.games.filter(isLiveGame).length;
    header.textContent = `${data.room.name} · ${tc >= 60 ? tc/60+'min' : tc+'s'} · ${liveCount} en cours`;

    if (!refresh) { roundPinned = false; lastLiveKeys = null; }
    const autoId = autoRoundId(data.rounds, data.games);
    const known = data.rounds.some(r => r.id === activeRoundId);
    // On suit l'action : ronde automatique, sauf si l'utilisateur en a choisi une autre que celle qui se jouait
    if (!refresh || !known || !roundPinned || (activeRoundId === prevLiveRound && autoId !== prevLiveRound)) {
        if (refresh && known && autoId !== activeRoundId) {
            const r = data.rounds.find(r => r.id === autoId);
            if (r) logT(`Ronde ${r.slug} en cours`, 'ok');
        }
        activeRoundId = autoId;
        if (refresh && roundPinned) roundPinned = false;
    }

    const liveKeys = new Set(data.games.filter(isLiveGame).map(gameKey));
    if (lastLiveKeys) {
        data.games.filter(g => isLiveGame(g) && !lastLiveKeys.has(gameKey(g)))
            .forEach(g => logT(`▶ ${gameNames(g)} vient de commencer`, 'ok'));
    }
    lastLiveKeys = liveKeys;

    renderRounds(data);
    renderGames(data.games, activeRoundId);
}

// ── Rondes : statut et regroupement par match ("01-02-06" = match 01-02, partie 06) ──
const roundGroupKey = r => { const p = String(r.slug).split('-'); return p.length > 1 ? p.slice(0, -1).join('-') : ''; };
const roundShortName = r => String(r.slug).split('-').at(-1);

/** 'live' | 'done' | 'upcoming' */
function roundStatus(r, games) {
    const gs = games.filter(g => g.roundId === r.id);
    if (gs.some(isLiveGame)) return 'live';
    // Partie jamais jouée (départage inutile…) : la ronde compte comme terminée dès qu'une partie l'est
    return gs.some(g => g.result !== '*') ? 'done' : 'upcoming';
}

function groupStatus(statuses) {
    if (statuses.includes('live')) return 'live';
    if (statuses.every(s => s === 'upcoming')) return 'upcoming';
    if (statuses.every(s => s === 'done')) return 'done';
    return 'partial';
}

/** Dans un groupe : la ronde en cours, sinon la dernière jouée, sinon la première */
function pickRoundInGroup(rounds, status) {
    return (rounds.find(r => status.get(r.id) === 'live')
         ?? rounds.filter(r => status.get(r.id) === 'done').at(-1)
         ?? rounds[0])?.id ?? null;
}

const statusMarker = st => st === 'live' ? '<span class="round-btn__dot"></span>'
                         : st === 'done' ? '<i class="fas fa-check round-btn__check"></i>' : '';

function formatRoundDay(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString(roundLocale(), { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString(roundLocale(), { weekday: 'short', day: 'numeric' });
}

function renderRounds(data) {
    const roundsEl = document.getElementById('tournamentRounds');
    const rounds = data.rounds.filter(r => r.startAt);
    const status = new Map(rounds.map(r => [r.id, roundStatus(r, data.games)]));
    const groups = new Map();
    rounds.forEach(r => {
        const k = roundGroupKey(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    });
    const grouped = groups.size > 1;
    const active = rounds.find(r => r.id === activeRoundId);
    const activeKey = active ? roundGroupKey(active) : [...groups.keys()][0];
    const select = id => {
        activeRoundId = id;
        roundPinned = true;
        renderRounds(data);
        renderGames(data.games, id);
    };

    roundsEl.innerHTML = '';
    if (grouped) {
        const bar = document.createElement('div');
        bar.className = 'round-groups';
        groups.forEach((rs, key) => {
            const st = groupStatus(rs.map(r => status.get(r.id)));
            const first = roundStartedAt(rs[0], data.games) ?? rs[0].startAt;
            const btn = document.createElement('button');
            btn.className = `round-btn round-btn--group is-${st}` + (key === activeKey ? ' is-active' : '');
            btn.innerHTML = `${statusMarker(st)}<span class="round-btn__name">R${key}</span>`
                          + `<span class="round-btn__time">${formatRoundDay(first)}</span>`;
            const done = rs.filter(r => status.get(r.id) === 'done').length;
            btn.title = `Match ${key} · ${rs.length} rondes, ${done} jouée${done > 1 ? 's' : ''}`
                      + (st === 'live' ? ' · en cours' : '');
            btn.addEventListener('click', () => select(pickRoundInGroup(rs, status)));
            bar.appendChild(btn);
        });
        roundsEl.appendChild(bar);
    }

    const list = document.createElement('div');
    list.className = 'round-list';
    (groups.get(activeKey) || []).forEach(r => {
        const st = status.get(r.id);
        const btn = document.createElement('button');
        btn.className = `round-btn is-${st}` + (r.id === activeRoundId ? ' is-active' : '');
        btn.innerHTML = `${statusMarker(st)}<span class="round-btn__name">${grouped ? roundShortName(r) : 'R' + r.slug}</span>`
                      + `<span class="round-btn__time">${roundTimeLabel(r, data.games)}</span>`;
        btn.title = roundTooltip(r, data.games);
        btn.dataset.roundId = r.id;
        btn.addEventListener('click', () => select(r.id));
        list.appendChild(btn);
    });
    roundsEl.appendChild(list);
}

// ── Rafraîchissement automatique de la salle (quand on ne suit pas de partie, pollGame s'en charge sinon) ──
const tournamentPageVisible = () => document.visibilityState === 'visible'
    && (document.getElementById('page-tournament')?.getClientRects().length ?? 0) > 0;

let roomRefreshBusy = false;
async function refreshRoomT() {
    if (roomRefreshBusy || stateT.polling || !tournamentData || !stateT.tournamentSlug || !tournamentPageVisible()) return;
    roomRefreshBusy = true;
    const slug = stateT.tournamentSlug;
    try {
        const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event/${slug}`);
        if (r.ok) {
            const data = await r.json();
            if (slug === stateT.tournamentSlug && !stateT.polling) renderTournament(data, { refresh: true });
        }
    } catch { /* nouvel essai au prochain tour */ }
    roomRefreshBusy = false;
}

// ── Étapes : liste des événements repliée une fois le choix fait, colonne masquée pendant le suivi ──
function setEventStepT(name) {
    const summary = document.getElementById('tEventSummary');
    if (!summary) return;
    document.getElementById('tEventName').textContent = name;
    document.getElementById('tEventName').title = name;
    summary.style.display = 'flex';
    toggleEventPickerT(false);
}

function toggleEventPickerT(open) {
    const picker = document.getElementById('tEventPicker');
    if (!picker) return;
    picker.style.display = open ? '' : 'none';
    const btn = document.getElementById('btnChangeEvent');
    if (btn) btn.textContent = open ? 'Fermer' : 'Changer';
}

function setFollowLayoutT(following) {
    const grid = document.querySelector('#page-tournament .live-content');
    if (!grid) return;
    grid.classList.toggle('t-following', following);
    grid.classList.remove('t-list-open');
    updateListToggleT();
    stateT.board?.resize();
}

// ── Revue d'une partie terminée ──
const reviewT = { game: null, fens: [], moves: [], idx: 0 };

async function startReviewT(g, wName, bName) {
    const token = {};
    startReviewT.token = token;
    logT(`Revue de ${wName} – ${bName} : chargement des coups…`, 'info');
    let moves;
    try {
        moves = await fetchGameMovesT(g);
    } catch (err) {
        if (startReviewT.token === token) logT(`Revue impossible : ${err.message}`, 'error');
        return;
    }
    if (startReviewT.token !== token) return;

    stopGamePolling();
    const info = [];
    const fens = replayFensT(moves, g.currentFEN, info);
    Object.assign(reviewT, { game: g, fens, moves: info, idx: fens.length - 1 });

    document.getElementById('playerWhiteT').textContent = wName;
    document.getElementById('ratingWhiteT').textContent = g.whiteElo ? `(${g.whiteElo})` : '';
    document.getElementById('playerBlackT').textContent = bName;
    document.getElementById('ratingBlackT').textContent = g.blackElo ? `(${g.blackElo})` : '';
    document.getElementById('clockWhiteT').textContent = '—';
    document.getElementById('clockBlackT').textContent = '—';
    const status = document.getElementById('statusTextT');
    if (status) status.textContent = `Revue · ${g.result}`;

    document.getElementById('tReview').style.display = '';
    const slider = document.getElementById('tRevSlider');
    slider.max = fens.length - 1;
    setFollowLayoutT(true);
    if (tournamentData) renderGames(tournamentData.games, activeRoundId); // ligne de la partie en évidence
    logT(`Revue : ${fens.length - 1} coups, résultat ${g.result}. Flèches ← → pour naviguer`, 'ok');
    showReviewStepT(reviewT.idx);
}

function reviewMoveLabelT(i) {
    const n = reviewT.fens.length - 1;
    if (i === 0) return `Départ · 0/${n}`;
    const mv = reviewT.moves[i - 1];
    if (!mv) return `Position finale · ${i}/${n}`;
    return `${Math.ceil(i / 2)}${i % 2 ? '.' : '…'} ${mv.san} · ${i}/${n}`;
}

async function showReviewStepT(i, fromPlayer = false) {
    if (!reviewT.game) return;
    if (!fromPlayer) setReviewPlayingT(false); // une navigation manuelle met la lecture en pause
    i = Math.max(0, Math.min(reviewT.fens.length - 1, i));
    reviewT.idx = i;
    const fen = reviewT.fens[i];
    stateT.chess.load(fen);
    stateT.board.position(fen, false);
    document.querySelectorAll('.highlight-last-move-live')
        .forEach(el => el.classList.remove('highlight-last-move-live'));
    const mv = reviewT.moves[i - 1];
    if (mv) highlightLastMoveT(mv.from, mv.to);
    updateTurnIndicatorT();
    document.getElementById('fenDisplayT').textContent = `FEN : ${fen}`;
    document.getElementById('tRevMove').textContent = reviewMoveLabelT(i);
    document.getElementById('tRevSlider').value = i;
    const last = reviewT.fens.length - 1;
    document.getElementById('tRevFirst').disabled = document.getElementById('tRevPrev').disabled = i === 0;
    document.getElementById('tRevLast').disabled = document.getElementById('tRevNext').disabled = i === last;
    if (document.getElementById('tRevPhantom')?.checked && window.phantomChessboard?.isConnected) {
        await window.phantomChessboard.syncPosition(fen);
    }
}

// Lecture automatique : un coup, puis (si le Phantom suit) attendre qu'il ait fini, puis la pause choisie
const REVIEW_MIN_STEP_MS = 500; // rythme minimal à l'écran avec une pause de 0 s
function setReviewPlayingT(on) {
    const play = document.getElementById('tRevPlay');
    if (!on) {
        reviewT.playToken = null;
        if (play) { play.innerHTML = '<i class="fas fa-play"></i>'; play.classList.remove('is-playing'); }
        return;
    }
    if (!reviewT.game) return;
    if (reviewT.idx >= reviewT.fens.length - 1) showReviewStepT(0); // en fin de partie : on repart du début
    const token = {};
    reviewT.playToken = token;
    if (play) { play.innerHTML = '<i class="fas fa-pause"></i>'; play.classList.add('is-playing'); }
    (async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        while (reviewT.playToken === token && reviewT.game && reviewT.idx < reviewT.fens.length - 1) {
            const started = Date.now();
            const delay = (+document.getElementById('tRevDelay')?.value || 0) * 1000;
            const phantom = window.phantomChessboard;
            if (document.getElementById('tRevPhantom')?.checked && phantom?.isConnected) {
                while (reviewT.playToken === token && phantom.isConnected && phantom.isBusy?.()) await wait(150);
            }
            await wait(Math.max(delay, REVIEW_MIN_STEP_MS - (Date.now() - started)));
            if (reviewT.playToken !== token || !reviewT.game) return;
            await showReviewStepT(reviewT.idx + 1, true);
        }
        if (reviewT.playToken === token) setReviewPlayingT(false);
    })();
}

function endReviewT(restoreLayout = true) {
    startReviewT.token = null;
    setReviewPlayingT(false);
    if (!reviewT.game) return;
    reviewT.game = null;
    document.getElementById('tReview').style.display = 'none';
    const status = document.getElementById('statusTextT');
    if (status) status.textContent = 'En attente';
    if (restoreLayout) setFollowLayoutT(false);
    if (tournamentData) renderGames(tournamentData.games, activeRoundId);
}


function updateListToggleT() {
    const grid = document.querySelector('#page-tournament .live-content');
    const btn = document.getElementById('btnToggleListT');
    if (!grid || !btn) return;
    btn.style.display = grid.classList.contains('t-following') ? '' : 'none';
    btn.innerHTML = grid.classList.contains('t-list-open')
        ? '<i class="fas fa-chevron-left"></i> Masquer la liste'
        : '<i class="fas fa-list"></i> Parties du tournoi';
}

function renderGames(games, roundId) {
    const el = document.getElementById('tournamentGames');
    bindPreviewT();
    const filtered = games
        .filter(g => g.roundId === roundId)
        .sort((a, b) => (isLiveGame(a) ? 0 : 1) - (isLiveGame(b) ? 0 : 1) || a.board - b.board);

    if (filtered.length === 0) {
        el.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted,#55556a);">Aucune partie</div>';
        return;
    }

    el.innerHTML = '';
    const now = Date.now();

    filtered.forEach(g => {
        const isLive = isLiveGame(g);
        const elapsed = g.startAt ? Math.floor((now - new Date(g.startAt)) / 1000) : null;
        const wTitle = g.whiteTitle ? `<span class="player-title">${g.whiteTitle}</span> ` : '';
        const bTitle = g.blackTitle ? `<span class="player-title">${g.blackTitle}</span> ` : '';
        const wName = g.white?.preferredShortName?.trim() || g.slug.split('-')[0];
        const bName = g.black?.preferredShortName?.trim() || g.slug.split('-')[1];

        const row = document.createElement('div');
        const reviewable = !isLive && g.result !== '*';
        row.className = 'tournament-game-row' + (isLive ? ' is-live' : ' is-finished')
                      + (reviewable ? ' is-reviewable' : '')
                      + (reviewable && reviewT.game && gameKey(reviewT.game) === gameKey(g) ? ' is-reviewing' : '');
        row.dataset.gameKey = gameKey(g);
        previewGames.set(gameKey(g), { fen: g.currentFEN, title: `${wName} – ${bName}` });
        row.innerHTML = `
            <div class="tg-players">
                <span class="tg-white">${wTitle}${wName} <span class="tg-elo">${g.whiteElo ?? ''}</span></span>
                <span class="tg-sep">vs</span>
                <span class="tg-black">${bTitle}${bName} <span class="tg-elo">${g.blackElo ?? ''}</span></span>
            </div>
            <div class="tg-meta">
                ${isLive
                    ? `<span class="tg-live-dot"></span><span class="tg-elapsed">${elapsed !== null ? formatElapsed(elapsed) : '—'}</span>`
                    : `<span class="tg-result">${g.result === '*' ? 'à venir' : g.result}</span>`
                }
            </div>`;

        if (isLive && g.currentFEN) {
            row.style.cursor = 'pointer';
            row.addEventListener('click', async () => {
                hidePreviewT();
                const choice = await confirmFollowT(g, wName, bName);
                if (!choice) return;
                // L'état interne doit suivre l'échiquier affiché : c'est lui que Synchroniser envoie au Phantom
                stateT.chess.load(g.currentFEN);
                stateT.board.position(g.currentFEN);
                updateTurnIndicatorT();
                document.getElementById('fenDisplayT').textContent = `FEN : ${g.currentFEN ?? '—'}`;
                document.getElementById('playerWhiteT').textContent = wName;
                document.getElementById('ratingWhiteT').textContent = g.whiteElo ? `(${g.whiteElo})` : '';
                document.getElementById('playerBlackT').textContent = bName;
                document.getElementById('ratingBlackT').textContent = g.blackElo ? `(${g.blackElo})` : '';
                logT(`${wName} vs ${bName} — suivi démarré`, 'ok');
                if (choice.replay) {
                    // Position de départ d'abord (le Phantom vide sa file et remet l'échiquier à zéro),
                    // puis chaque coup ; le suivi normal enchaîne derrière dans la même file
                    for (const fen of choice.replay) await window.phantomChessboard.syncPosition(fen);
                    logT(`Phantom : remise à zéro puis ${choice.replay.length - 1} coups rejoués`, 'ok');
                }
                startGamePolling(g);  // ← remplace l'ancien log statique
            });
        } else if (reviewable) {
            row.title = 'Revoir la partie coup par coup';
            row.addEventListener('click', () => {
                hidePreviewT();
                startReviewT(g, wName, bName);
            });
        }

        el.appendChild(row);
    });
}

// Traduction si le module i18n est chargé, sinon le texte français
const trT = (key, fallback) => {
    const v = window.i18n?.t?.(key);
    return v && v !== key ? v : fallback;
};

// ── Aperçu de la position au survol d'une partie ──
const previewGames = new Map(); // clé -> { fen, title }, remis à jour à chaque actualisation de la liste
const gameKey = g => String(g.id ?? g.slug);
const PIECE_IMG = p => `https://chessboardjs.com/img/chesspieces/wikipedia/${p}.png`;

/** Petit échiquier statique (blancs en bas) à partir d'un FEN */
function miniBoardHTML(fen) {
    const rows = String(fen || '').split(' ')[0].split('/');
    if (rows.length !== 8) return '';
    let html = '';
    rows.forEach((row, r) => {
        let c = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) {
                for (let k = 0; k < +ch; k++, c++) html += `<div class="mini-board__sq ${(r + c) % 2 ? 'is-dark' : ''}"></div>`;
            } else {
                const piece = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
                html += `<div class="mini-board__sq ${(r + c) % 2 ? 'is-dark' : ''}"><img src="${PIECE_IMG(piece)}" alt=""></div>`;
                c++;
            }
        }
    });
    return `<div class="mini-board">${html}</div>`;
}

function previewEl() {
    let el = document.getElementById('tgPreview');
    if (!el) {
        el = document.createElement('div');
        el.id = 'tgPreview';
        el.className = 'tg-preview';
        document.body.appendChild(el);
    }
    return el;
}

function hidePreviewT() {
    document.getElementById('tgPreview')?.classList.remove('is-visible');
}

function showPreviewT(row) {
    const info = previewGames.get(row.dataset.gameKey);
    if (!info?.fen) return hidePreviewT();
    const el = previewEl();
    if (el.dataset.fen !== info.fen) {
        el.innerHTML = `<div class="tg-preview__title">${info.title}</div>${miniBoardHTML(info.fen)}`;
        el.dataset.fen = info.fen;
    }
    // À gauche de la liste (colonne de droite), sinon en dessous de la ligne
    const r = row.getBoundingClientRect();
    const w = el.offsetWidth || 220, h = el.offsetHeight || 240;
    let left = r.left - w - 12, top = r.top + r.height / 2 - h / 2;
    if (left < 8) { left = Math.min(r.left, window.innerWidth - w - 8); top = r.bottom + 8; }
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top  = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
    el.classList.add('is-visible');
}

// Délégation : la liste est reconstruite toutes les 5 s pendant le suivi
function bindPreviewT() {
    const list = document.getElementById('tournamentGames');
    if (!list || list.dataset.previewBound) return;
    list.dataset.previewBound = '1';
    if (window.matchMedia?.('(hover: none)').matches) return; // tactile : pas de survol
    list.addEventListener('mousemove', (e) => {
        const row = e.target.closest('.tournament-game-row');
        row ? showPreviewT(row) : hidePreviewT();
    });
    list.addEventListener('mouseleave', hidePreviewT);
}

// ── Rejouer le début : coups de la partie depuis chess.com ──
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function fetchGameMovesT(g) {
    const room = tournamentData?.room?.slug || stateT.tournamentSlug;
    const round = tournamentData?.rounds?.find(r => r.id === g.roundId)?.slug;
    if (!room || !round || !g.slug) throw new Error('ronde introuvable');
    const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event-game/${[room, round, g.slug].map(encodeURIComponent).join('/')}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (g.id != null && data.id != null && data.id !== g.id) throw new Error('autre partie');
    return data.moves || [];
}

/** Positions successives depuis le départ ; `cbn` = "e2e4_e4" (coordonnées_SAN) */
function replayFensT(moves, currentFEN, info = []) {
    const chess = new Chess();
    const fens = [START_FEN];
    for (const cbn of moves) {
        const [uci = '', san = ''] = String(cbn).split('_');
        let mv = null;
        try { mv = chess.move(san); } catch { mv = null; }
        if (!mv) {
            const promo = uci[4] || (san.match(/=([QRBN])/)?.[1] || '').toLowerCase() || undefined;
            try { mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: promo }); } catch { mv = null; }
        }
        if (!mv) break; // coup illisible : on termine par la position actuelle
        fens.push(chess.fen());
        info.push({ san: mv.san, from: mv.from, to: mv.to });
    }
    const board = f => String(f || '').split(' ')[0];
    if (currentFEN && board(fens.at(-1)) !== board(currentFEN)) { fens.push(currentFEN); info.push(null); }
    return fens;
}

// ── Confirmation avant d'envoyer une partie sur le Phantom ──
// Résout { replay: null } (position actuelle), { replay: [fen…] } (rejouer le début) ou false (annulé)
function confirmFollowT(g, wName, bName) {
    const modal = document.getElementById('modal-tournament-follow');
    const phantomWillMove = window.phantomChessboard?.isConnected
        && document.getElementById('phantomAutoSyncT')?.checked !== false;
    if (!modal || !phantomWillMove) return Promise.resolve({ replay: null });

    document.getElementById('tfTitle').textContent = `${wName} – ${bName}`;
    document.getElementById('tfBoard').innerHTML = miniBoardHTML(g.currentFEN);
    modal.classList.add('is-active');

    // Coups chargés pendant que la fenêtre est ouverte
    const replayBtn = document.getElementById('tfReplay');
    const replayLabel = document.getElementById('tfReplayLabel');
    let replayFens = null;
    replayBtn.disabled = true;
    replayLabel.textContent = trT('tournamentFollow.loading', 'Chargement des coups…');
    const token = {};
    confirmFollowT.token = token;
    fetchGameMovesT(g).then(moves => {
        if (confirmFollowT.token !== token) return;
        replayFens = replayFensT(moves, g.currentFEN);
        const n = replayFens.length - 1;
        replayLabel.textContent = trT('tournamentFollow.replay', 'Rejouer depuis le début') + ` (${n})`;
        replayBtn.disabled = n < 1;
    }).catch(err => {
        if (confirmFollowT.token !== token) return;
        replayLabel.textContent = trT('tournamentFollow.replayUnavailable', 'Coups indisponibles');
        logT(`Coups de la partie indisponibles : ${err.message}`, 'warn');
    });

    return new Promise(resolve => {
        const ok = document.getElementById('tfConfirm');
        const done = (value) => {
            confirmFollowT.token = null;
            modal.classList.remove('is-active');
            ok.removeEventListener('click', onOk);
            replayBtn.removeEventListener('click', onReplay);
            observer.disconnect();
            resolve(value);
        };
        const onOk = () => done({ replay: null });
        const onReplay = () => replayFens && done({ replay: replayFens });
        ok.addEventListener('click', onOk);
        replayBtn.addEventListener('click', onReplay);
        // Fermée autrement (croix, Annuler, clic à côté) : on ne suit pas la partie
        const observer = new MutationObserver(() => {
            if (!modal.classList.contains('is-active')) done(false);
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
}

// À la connexion du Phantom, c'est la partie suivie ici qu'il faut poser sur l'échiquier
window.phantomPositionProviders = window.phantomPositionProviders || {};
window.phantomPositionProviders.tournament = () =>
    stateT.currentGame || (reviewT.game && document.getElementById('tRevPhantom')?.checked) ? stateT.chess.fen() : null;

async function startGamePolling(game) {
    stopGamePolling();
    stopClockT();  // ← reset
    stateT.currentGame = game;
    stateT.lastFEN = null;
    stateT.polling = true;
    endReviewT(false);
    setFollowLayoutT(true);
    logT(`Suivi de ${game.white?.preferredShortName} vs ${game.black?.preferredShortName}`, 'info');
    await pollGame();
}

function stopGamePolling() {
    stateT.polling = false;
    clearTimeout(stateT.pollTimer);
    stopClockT();  // ← reset
    stateT.currentGame = null;
}

async function pollGame() {
    if (!stateT.polling || !stateT.currentGame) return;
    const g = stateT.currentGame;
    try {
        const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event/${stateT.tournamentSlug}`);
        if (!r.ok) {
            logT(`Suivi : chess.com a répondu HTTP ${r.status}, nouvel essai dans 5 s`, 'warn');
        } else {
            const data = await r.json();


            
            // Par id : en match, les mêmes joueurs ont plusieurs parties avec le même slug
            const updatedGame = data.games.find(game => g.id != null ? game.id === g.id : game.slug === g.slug);





            if (updatedGame?.currentFEN && updatedGame.currentFEN !== stateT.lastFEN) {
                const prevFEN = stateT.lastFEN;
                stateT.lastFEN = updatedGame.currentFEN;

                // Highlight : trouver le coup joué entre prevFEN et le nouveau FEN
                if (prevFEN) {
                    const prevObj = Chessboard.fenToObj(prevFEN);
                    const newObj  = Chessboard.fenToObj(updatedGame.currentFEN);
                    
                    // Cases qui ont disparu = "from", cases qui sont apparues = "to"
                    const disappeared = Object.keys(prevObj).filter(sq => !newObj[sq] || newObj[sq] !== prevObj[sq]);
                    const appeared    = Object.keys(newObj).filter(sq => !prevObj[sq] || newObj[sq] !== prevObj[sq]);
                    
                    // Le "to" est la case qui a reçu une pièce (appeared), le "from" celle qui s'est vidée
                    const toSq   = appeared.find(sq => !prevObj[sq]);
                    const fromSq = disappeared.find(sq => !newObj[sq]);
                    
                    if (fromSq && toSq) highlightLastMoveT(fromSq, toSq);
                }

                stateT.chess.load(updatedGame.currentFEN);
                stateT.board.position(updatedGame.currentFEN);
                updateTurnIndicatorT();

                // Chrono — resync depuis les données Chess.com si dispo, sinon simulation
                if (updatedGame.whiteClock != null) {
                    startClockT(updatedGame.whiteClock, updatedGame.blackClock);
                }

                // Phantom
                if (window.phantomChessboard?.isConnected && document.getElementById('phantomAutoSyncT')?.checked !== false) {
                    const sent = await window.phantomChessboard.syncPosition(updatedGame.currentFEN);
                    logT(sent === false ? 'Phantom non actif : synchronisation ignorée' : 'Phantom synchronisé', sent === false ? 'warn' : 'ok');
                }
            }
            renderTournament(data, { refresh: true });
        }
    } catch (err) {
        logT(`Poll erreur : ${err.message}`, 'error');
    }
    stateT.pollTimer = setTimeout(pollGame, 5000);
}

function highlightLastMoveT(from, to) {
    document.querySelectorAll('.highlight-last-move-live')
        .forEach(el => el.classList.remove('highlight-last-move-live'));
    const fromSq = document.querySelector(`#liveBoardT [data-square="${from}"]`);
    const toSq   = document.querySelector(`#liveBoardT [data-square="${to}"]`);
    if (fromSq) fromSq.classList.add('highlight-last-move-live');
    if (toSq)   toSq.classList.add('highlight-last-move-live');
}

function updateTurnIndicatorT() {
    const turn = stateT.chess?.turn();
    document.getElementById('playerWhiteT')?.closest('.player-row')
        ?.classList.toggle('is-turn', turn === 'w');
    document.getElementById('playerBlackT')?.closest('.player-row')
        ?.classList.toggle('is-turn', turn === 'b');
}

function startClockT(whiteMs, blackMs) {
    stopClockT();
    stateT.clockWhite = whiteMs;
    stateT.clockBlack = blackMs;
    stateT.clockInterval = setInterval(() => {
        const turn = stateT.chess?.turn();
        if (turn === 'w') stateT.clockWhite = Math.max(0, stateT.clockWhite - 1000);
        else              stateT.clockBlack = Math.max(0, stateT.clockBlack - 1000);
        renderClocksT();
    }, 1000);
    renderClocksT();
}

function stopClockT() {
    clearInterval(stateT.clockInterval);
    stateT.clockInterval = null;
}

function renderClocksT() {
    const fmt = ms => {
        const total = Math.floor(ms / 1000);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };
    document.getElementById('clockWhiteT').textContent = fmt(stateT.clockWhite);
    document.getElementById('clockBlackT').textContent = fmt(stateT.clockBlack);
}


// ── Liste des tournois en cours ──
let allEvents = [];

let selectedEventSlug = null;

/** silent : rafraîchissement en arrière-plan, sans « Chargement… » ni effacer la liste en cas d'erreur */
async function fetchEventsList(silent = false) {
    const el = document.getElementById('eventsList');
    if (el && !silent) el.innerHTML = '<span style="color:var(--text-muted,#55556a); font-size:0.8rem;">Chargement…</span>';
    try {
        const r = await fetch(`${PROXY_BASE_T}/proxy/chess-events-list`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } catch (err) {
        if (silent) return null;
        if (el) el.innerHTML = `<span style="color:#f87171; font-size:0.8rem;">Erreur : ${err.message}</span>`;
        return [];
    }
}

// Un événement chess.com (index) regroupe souvent plusieurs salles : groupes, brackets, départages…
// Seul le slug d'une salle donne accès aux parties, on le lit donc dans l'index de l'événement.
async function loadEventRooms(slug) {
    const r = await fetch(`${PROXY_BASE_T}/proxy/chess-event-index/${slug}`);
    if (r.status === 404) throw new Error(`événement "${slug}" introuvable sur chess.com`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).rooms || [];
}

// D'abord les salles dont la ronde courante est la plus proche de maintenant
function sortRooms(rooms) {
    const now = Date.now();
    const gap = room => room.currentRound?.startAt ? Math.abs(new Date(room.currentRound.startAt) - now) : Infinity;
    return [...rooms].sort((a, b) => gap(a) - gap(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function renderRoomPicker(rooms) {
    const picker = document.getElementById('tournamentRoomPicker');
    const select = document.getElementById('tournamentRoomSelect');
    const fmtDate = d => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    select.innerHTML = '';
    const now = Date.now();
    rooms.forEach(room => {
        const ended = room.endAt && Date.parse(room.endAt) < now;
        const started = room.currentRound?.startAt && Date.parse(room.currentRound.startAt) <= now;
        const round = ended ? ' · terminé'
            : room.currentRound?.startAt
                ? ` · ronde ${room.currentRound.name || room.currentRound.slug} le ${fmtDate(room.currentRound.startAt)}`
                : '';
        const mark = ended ? '✓ ' : started ? '● ' : '';
        select.add(new Option(`${mark}${room.name}${round}`, room.slug));
    });
    picker.style.display = rooms.length > 1 ? 'block' : 'none';
}

async function loadRoom(slug) {
    const data = await loadTournament(slug);
    const input = document.getElementById('tournamentInput');
    if (input) input.value = slug;
    renderTournament(data);
    logT(`${data.games.length} parties chargées`, 'ok');
}

async function loadAndRenderTournament(slug, isIndex = false) {
    try {
        logT(`Chargement de "${slug}"…`, 'info');
        document.getElementById('tournamentRoomPicker').style.display = 'none';
        if (!isIndex) {
            try {
                await loadRoom(slug);
                return;
            } catch (err) {
                if (!err.message.includes('HTTP 404')) throw err;
                // Ce n'est pas une salle : sans doute un événement qui en regroupe plusieurs
            }
        }
        const rooms = sortRooms(await loadEventRooms(slug));
        if (rooms.length === 0) {
            logT(`Aucune salle publiée pour cet événement pour l'instant`, 'warn');
            return;
        }
        renderRoomPicker(rooms);
        if (rooms.length > 1) logT(`${rooms.length} salles dans cet événement, choisissez-en une`, 'info');
        await loadRoom(rooms[0].slug);
    } catch (err) {
        logT(`Erreur : ${err.message}`, 'error');
    }
}

function renderEventsList(events, filter = '') {
    const el = document.getElementById('eventsList');
    if (!el) return;

    const shown = filter
        ? events.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
        : events;

    if (shown.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted,#55556a); font-size:0.8rem;">Aucun tournoi trouvé</span>';
        return;
    }

    el.innerHTML = '';
    const fmtDate = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const fmtFull = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const typeLabel = { 'swiss': 'Suisse', 'round-robin': 'Toutes rondes', 'team-round-robin': 'Équipes', 'event': 'Événement', 'knockout': 'Élimination directe' };
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const now = Date.now();

    // En cours d'abord, puis à venir
    const upcoming = e => Date.parse(e.startAt) > now;
    [...shown].sort((a, b) => upcoming(a) - upcoming(b)).forEach(event => {
        const isUpcoming = upcoming(event);
        const row = document.createElement('div');
        row.className = 't-event' + (isUpcoming ? ' is-upcoming' : ' is-live')
                      + (event.slug === selectedEventSlug ? ' is-selected' : '');

        const label = typeLabel[event.eventType] ?? event.eventType ?? 'Tournoi';
        const players = event.playerCount > 0 ? ` · ${event.playerCount} joueurs` : '';
        row.title = `${event.name}\n${label} · ${fmtFull(event.startAt)} → ${fmtFull(event.endAt)}${players}`;
        row.innerHTML = `
            <span class="t-event__status"></span>
            <span class="t-event__name">${esc(event.name)}</span>
            <span class="t-event__dates">${isUpcoming ? 'dès le ' + fmtDate(event.startAt) : 'jusqu\'au ' + fmtDate(event.endAt)}</span>`;

        row.addEventListener('click', () => {
            const input = document.getElementById('tournamentInput');
            if (input) input.value = event.slug;
            selectedEventSlug = event.slug;
            el.querySelectorAll('.t-event.is-selected').forEach(r => r.classList.remove('is-selected'));
            row.classList.add('is-selected');
            setEventStepT(event.name);
            loadAndRenderTournament(event.slug, event.type === 'index');
        });

        el.appendChild(row);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnLoadTournament');
    if (!btn) return;

    // Chargement initial de la liste
    fetchEventsList().then(events => {
        allEvents = events;
        renderEventsList(events);
    });

    // La salle suivie se met à jour toute seule (nouvelles parties, rondes qui commencent)
    setInterval(refreshRoomT, 15000);
    // La liste des événements aussi, sans clignoter
    setInterval(async () => {
        if (!tournamentPageVisible()) return;
        const events = await fetchEventsList(true);
        if (!events) return;
        allEvents = events;
        renderEventsList(allEvents, document.getElementById('eventSearchInput')?.value || '');
    }, 120000);

    const step = d => showReviewStepT(d === 'first' ? 0 : d === 'last' ? reviewT.fens.length - 1 : reviewT.idx + d);
    document.getElementById('tRevFirst')?.addEventListener('click', () => step('first'));
    document.getElementById('tRevPrev')?.addEventListener('click', () => step(-1));
    document.getElementById('tRevNext')?.addEventListener('click', () => step(1));
    document.getElementById('tRevLast')?.addEventListener('click', () => step('last'));
    document.getElementById('tRevSlider')?.addEventListener('input', function () { showReviewStepT(+this.value); });
    document.getElementById('tRevClose')?.addEventListener('click', () => endReviewT());
    document.getElementById('tRevPlay')?.addEventListener('click', () => setReviewPlayingT(!reviewT.playToken));
    document.getElementById('tRevPhantom')?.addEventListener('change', async function () {
        if (!this.checked || !reviewT.game || !window.phantomChessboard?.isConnected) return;
        const sent = await window.phantomChessboard.syncPosition(stateT.chess.fen());
        logT(sent === false ? 'Phantom non actif : synchronisation ignorée' : 'Phantom : position de la revue', sent === false ? 'warn' : 'ok');
    });
    document.addEventListener('keydown', e => {
        if (!reviewT.game || !tournamentPageVisible() || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); setReviewPlayingT(!reviewT.playToken); return; }
        const d = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' }[e.key];
        if (d === undefined) return;
        e.preventDefault();
        step(d);
    });

    document.getElementById('btnChangeEvent')?.addEventListener('click', () => {
        toggleEventPickerT(document.getElementById('tEventPicker')?.style.display === 'none');
    });
    document.getElementById('btnToggleListT')?.addEventListener('click', () => {
        document.querySelector('#page-tournament .live-content')?.classList.toggle('t-list-open');
        updateListToggleT();
        requestAnimationFrame(() => stateT.board?.resize());
    });

    document.getElementById('tournamentRoomSelect')?.addEventListener('change', async function () {
        logT(`Chargement de "${this.value}"…`, 'info');
        try {
            await loadRoom(this.value);
        } catch (err) {
            logT(`Erreur : ${err.message}`, 'error');
        }
    });

    // Filtre texte en temps réel
    document.getElementById('eventSearchInput')?.addEventListener('input', function () {
        renderEventsList(allEvents, this.value);
    });

    // Bouton refresh
    document.getElementById('btnRefreshEvents')?.addEventListener('click', async () => {
        const icon = document.querySelector('#btnRefreshEvents i');
        if (icon) icon.style.animation = 'spin 0.6s linear infinite';
        allEvents = await fetchEventsList();
        renderEventsList(allEvents, document.getElementById('eventSearchInput')?.value || '');
        if (icon) icon.style.animation = '';
    });

    // Auto-load depuis ?event=slug ou #/tournament?event=slug
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
    const eventSlug = hashParams.get('event');
    if (eventSlug) {
        const input = document.getElementById('tournamentInput');
        if (input) input.value = eventSlug;
        setEventStepT(eventSlug);
        loadAndRenderTournament(eventSlug);
    }

    btn.addEventListener('click', async () => {
        const slug = document.getElementById('tournamentInput')?.value.trim();
        if (!slug) return;
        setEventStepT(slug);
        loadAndRenderTournament(slug);
    });

    // Phantom
    document.getElementById('btnPhantomT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard) { logT('Module Phantom non chargé', 'error'); return; }
        const connected = await window.phantomChessboard.connect();
        logT(connected ? 'Phantom connecté' : 'Connexion échouée', connected ? 'ok' : 'error');
    });

    document.getElementById('phantomSpeedT')?.addEventListener('input', function() {
        document.getElementById('speedValT').textContent = this.value;
    });
    document.getElementById('phantomSpeedT')?.addEventListener('change', async function() {
        if (window.phantomChessboard?.isConnected) {
            await window.phantomChessboard.setSpeed(parseInt(this.value));
            logT(`Vitesse réglée à ${this.value}/5`, 'ok');
        }
    });
    
    // Réactiver la sync automatique remet tout de suite l'échiquier à jour
    document.getElementById('phantomAutoSyncT')?.addEventListener('change', async function () {
        if (!this.checked || !stateT.currentGame || !window.phantomChessboard?.isConnected) return;
        const sent = await window.phantomChessboard.syncPosition(stateT.chess.fen());
        logT(sent === false ? 'Phantom non actif : synchronisation ignorée' : 'Phantom synchronisé', sent === false ? 'warn' : 'ok');
    });

    document.getElementById('btnSyncT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard?.isConnected) { logT('Phantom non connecté', 'warn'); return; }
        if (!stateT.chess) return;
        const sent = await window.phantomChessboard.syncPosition(stateT.chess.fen());
        logT(sent === false ? 'Phantom non actif : synchronisation ignorée' : 'Synchronisation envoyée', sent === false ? 'warn' : 'ok');
    });

    document.getElementById('btnResetT')?.addEventListener('click', async () => {
        stopGamePolling();
        endReviewT(false);
        setFollowLayoutT(false);
        stateT.chess.reset();
        stateT.board.position('start');
        stateT.lastFEN = null;
        document.querySelectorAll('.highlight-last-move-live')
            .forEach(el => el.classList.remove('highlight-last-move-live'));
        document.getElementById('fenDisplayT').textContent = 'FEN : —';
        document.getElementById('playerWhiteT').textContent = '—';
        document.getElementById('playerBlackT').textContent = '—';
        document.getElementById('clockWhiteT').textContent = '—';
        document.getElementById('clockBlackT').textContent = '—';
        const badgeT = document.getElementById('statusBadgeT');
        if (badgeT) badgeT.className = 'live-badge idle';
        const statusTextT = document.getElementById('statusTextT');
        if (statusTextT) statusTextT.textContent = 'En attente';
        if (window.phantomChessboard?.isConnected) {
            window.phantomChessboard.sendGameStart();
            await window.phantomChessboard.syncPosition(stateT.chess.fen());
            logT('Échiquier réinitialisé et synchronisé', 'ok');
        } else {
            logT('Échiquier réinitialisé', 'ok');
        }
    });

    document.getElementById('btnGameEndT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard?.isConnected) { logT('Phantom non connecté', 'warn'); return; }
        await window.phantomChessboard.sendGameEnd();
        logT('Fin de partie envoyée', 'ok');
    });

    document.getElementById('btnCalibrateT')?.addEventListener('click', async () => {
        if (!window.phantomChessboard?.isConnected) { logT('Phantom non connecté', 'warn'); return; }
        await window.phantomChessboard.calibrate();
        logT('Calibration lancée', 'ok');
    });

    setInterval(() => {
        const el = document.getElementById('phantomStatusT');
        if (!el) return;
        if (window.phantomChessboard?.isConnected) {
            el.className = 'phantom-status connected';
            el.innerHTML = '<i class="fas fa-check-circle"></i> Connecté';
        } else {
            el.className = 'phantom-status disconnected';
            el.innerHTML = '<i class="fas fa-times-circle"></i> Déconnecté';
        }
    }, 2000);
});

// ── Menu Phantom des pages Live et Tournoi (comme celui de la page de jeu) ──
document.addEventListener('DOMContentLoaded', () => {
    const menus = [...document.querySelectorAll('.live-phantom-menu')];
    const setMenu = (menu, open) => {
        menu.classList.toggle('is-open', open);
        menu.querySelector('.live-phantom-menu__btn')?.setAttribute('aria-expanded', String(open));
    };
    menus.forEach(menu => {
        menu.querySelector('.live-phantom-menu__btn')?.addEventListener('click', e => {
            e.stopPropagation();
            setMenu(menu, !menu.classList.contains('is-open'));
        });
        // Une action lancée referme le menu (pas la connexion : on veut voir le résultat)
        menu.querySelectorAll('.phantom-action').forEach(b => b.addEventListener('click', () => setMenu(menu, false)));
    });
    document.addEventListener('click', e => menus.forEach(m => { if (!m.contains(e.target)) setMenu(m, false); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menus.forEach(m => setMenu(m, false)); });
    // Pastille verte quand le Phantom est connecté
    setInterval(() => {
        const on = !!window.phantomChessboard?.isConnected;
        menus.forEach(m => m.classList.toggle('is-connected', on));
    }, 1000);
});
