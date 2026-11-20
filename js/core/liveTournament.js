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

// Une partie pas encore jouée a aussi le résultat '*', mais pas d'heure de début
const isLiveGame = g => g.result === '*' && !!(g.startAt || g.currentFEN);

function renderTournament(data) {
    tournamentData = data;
    const panel = document.getElementById('tournamentPanel');
    const header = document.getElementById('tournamentHeader');
    const roundsEl = document.getElementById('tournamentRounds');

    panel.style.display = 'block';

    const tc = parseInt(data.room.timeControl);
    const liveCount = data.games.filter(isLiveGame).length;
    header.textContent = `${data.room.name} · ${tc >= 60 ? tc/60+'min' : tc+'s'} · ${liveCount} en cours`;

    roundsEl.innerHTML = '';
    // Ronde d'une partie en cours, sinon la dernière ronde où l'on a joué (chess.com ne donne pas de fin de ronde)
    const liveRoundId = data.games.find(isLiveGame)?.roundId;
    const playedRoundIds = new Set(data.games.filter(g => g.result !== '*' || isLiveGame(g)).map(g => g.roundId));
    const activeRound = data.rounds.find(r => r.id === liveRoundId)
                     ?? data.rounds.filter(r => playedRoundIds.has(r.id)).at(-1)
                     ?? data.rounds.find(r => r.startAt);
    activeRoundId = activeRound?.id ?? null;

    data.rounds.forEach(r => {
        if (!r.startAt) return;
        const btn = document.createElement('button');
        btn.className = 'round-btn' + (r.id === activeRoundId ? ' is-active' : '');
        btn.textContent = `R${r.slug}`;
        btn.dataset.roundId = r.id;
        btn.addEventListener('click', () => {
            activeRoundId = r.id;
            document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            renderGames(data.games, r.id);
        });
        roundsEl.appendChild(btn);
    });

    renderGames(data.games, activeRoundId);
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
        row.className = 'tournament-game-row' + (isLive ? ' is-live' : ' is-finished');
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
                if (!(await confirmFollowT(g, wName, bName))) return;
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
                startGamePolling(g);  // ← remplace l'ancien log statique
            });
        }

        el.appendChild(row);
    });
}

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

// ── Confirmation avant d'envoyer une partie sur le Phantom ──
function confirmFollowT(g, wName, bName) {
    const modal = document.getElementById('modal-tournament-follow');
    const phantomWillMove = window.phantomChessboard?.isConnected
        && document.getElementById('phantomAutoSyncT')?.checked !== false;
    if (!modal || !phantomWillMove) return Promise.resolve(true);

    document.getElementById('tfTitle').textContent = `${wName} – ${bName}`;
    document.getElementById('tfBoard').innerHTML = miniBoardHTML(g.currentFEN);
    modal.classList.add('is-active');

    return new Promise(resolve => {
        const ok = document.getElementById('tfConfirm');
        const done = (value) => {
            modal.classList.remove('is-active');
            ok.removeEventListener('click', onOk);
            observer.disconnect();
            resolve(value);
        };
        const onOk = () => done(true);
        ok.addEventListener('click', onOk);
        // Fermée autrement (croix, Annuler, clic à côté) : on ne suit pas la partie
        const observer = new MutationObserver(() => {
            if (!modal.classList.contains('is-active')) done(false);
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
}

// À la connexion du Phantom, c'est la partie suivie ici qu'il faut poser sur l'échiquier
window.phantomPositionProviders = window.phantomPositionProviders || {};
window.phantomPositionProviders.tournament = () => stateT.currentGame ? stateT.chess.fen() : null;

async function startGamePolling(game) {
    stopGamePolling();
    stopClockT();  // ← reset
    stateT.currentGame = game;
    stateT.lastFEN = null;
    stateT.polling = true;
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
            renderGames(data.games, activeRoundId);
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

async function fetchEventsList() {
    const el = document.getElementById('eventsList');
    if (el) el.innerHTML = '<span style="color:var(--text-muted,#55556a); font-size:0.8rem;">Chargement…</span>';
    try {
        const r = await fetch(`${PROXY_BASE_T}/proxy/chess-events-list`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } catch (err) {
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
    rooms.forEach(room => {
        const round = room.currentRound?.startAt
            ? ` · ronde ${room.currentRound.name || room.currentRound.slug} le ${fmtDate(room.currentRound.startAt)}`
            : '';
        select.add(new Option(`${room.name}${round}`, room.slug));
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
    const fmtDate = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const typeLabel = { 'swiss': 'Suisse', 'round-robin': 'Toutes rondes', 'team-round-robin': 'Équipes', 'event': 'Événement' };

    shown.forEach(event => {
        const row = document.createElement('div');
        row.style.cssText = [
            'padding:6px 8px', 'border-radius:6px', 'cursor:pointer',
            'background:rgba(139,92,246,0.05)', 'border:1px solid rgba(139,92,246,0.15)',
            'transition:background 0.15s', 'display:flex', 'flex-direction:column', 'gap:2px'
        ].join(';');

        const label = typeLabel[event.eventType] ?? event.eventType ?? 'Tournoi';
        const players = event.playerCount > 0 ? `<span>· ${event.playerCount} joueurs</span>` : '';

        row.innerHTML = `
            <div style="font-size:0.82rem; font-weight:600; color:var(--text-primary,#e2e8f0);
                        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${event.name}">
                ${event.name}
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted,#55556a); display:flex; gap:6px; flex-wrap:wrap;">
                <span>${label}</span>
                <span>· ${fmtDate(event.startAt)} → ${fmtDate(event.endAt)}</span>
                ${players}
            </div>`;

        row.addEventListener('mouseenter', () => row.style.background = 'rgba(139,92,246,0.15)');
        row.addEventListener('mouseleave', () => row.style.background = 'rgba(139,92,246,0.05)');
        row.addEventListener('click', () => {
            const input = document.getElementById('tournamentInput');
            if (input) input.value = event.slug;
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
        loadAndRenderTournament(eventSlug);
    }

    btn.addEventListener('click', async () => {
        const slug = document.getElementById('tournamentInput')?.value.trim();
        if (!slug) return;
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