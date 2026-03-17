// ── Décodeur TCN (Two Character Notation chess.com) ──
const TCN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?';
const FILES = 'abcdefgh';
const PROXY_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : 'https://chesstwitchvoter.onrender.com';

    
function decodeTCNMove(two) {
    const c1 = TCN_CHARS.indexOf(two[0]);
    const c2 = TCN_CHARS.indexOf(two[1]);
    if (c1 === -1 || c2 === -1) return null;

    const fromFile = FILES[c1 % 8];
    const fromRank = Math.floor(c1 / 8) + 1;
    const toFile   = FILES[c2 % 8];
    const toRank   = Math.floor(c2 / 8) + 1;

    if (fromRank < 1 || fromRank > 8 || toRank < 1 || toRank > 8) return null;
    return `${fromFile}${fromRank}${toFile}${toRank}`;
}

// ── État ──
const state = {
    polling: false,
    pollTimer: null,
    legacyId: null,
    uuid: null,
    lastMoveCount: 0,
    chess: null,
    board: null,
    moveHistory: [],
};

// ── Helpers UI ──
function log(msg, type = 'info') {
    const el = document.getElementById('liveLog');
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const ts = new Date().toLocaleTimeString('fr-FR');
    line.textContent = `[${ts}] ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
}

function setStatus(s, text) {
    const badge = document.getElementById('statusBadge');
    badge.className = `live-badge ${s}`;
    document.getElementById('statusText').textContent = text;
}

function parseGameId(input) {
    input = input.trim();
    const match = input.match(/\/(\d+)\/?$/);
    if (match) return match[1];
    if (/^\d+$/.test(input)) return input;
    return null;
}

// ── Init échiquier ──
function initBoard() {
    state.chess = new Chess();
    state.board = Chessboard('liveBoard', {
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        draggable: false,
    });
    window.addEventListener('resize', () => state.board.resize());
}

// ── Étape 1 : récupérer UUID + infos joueurs ──
async function fetchGameInfo(legacyId) {
    const r = await fetch(`${PROXY_BASE}/proxy/chess/${legacyId}`);
    if (!r.ok) throw new Error(`Infos partie : HTTP ${r.status}`);
    return await r.json();
}

// ── Étape 2 : récupérer les coups ──
async function fetchMoves(uuid) {
    const r = await fetch(`${PROXY_BASE}/proxy/chess-moves/?url=${encodeURIComponent(state.movesUrl)}`);
    if (!r.ok) throw new Error(`Coups : HTTP ${r.status}`);
    return await r.json();
}

// ── Appliquer les coups TCN ──
function applyMoves(movesArray) {
    if (movesArray.length === state.lastMoveCount) return false;

    state.chess.reset();
    state.moveHistory = [];

    for (const [tcn] of movesArray) {
        const uci = decodeTCNMove(tcn);
        if (!uci) continue;
        const move = state.chess.move({
            from: uci.slice(0, 2),
            to:   uci.slice(2, 4),
            promotion: uci[4] || undefined
        });
        if (move) state.moveHistory.push(move.san);
    }

    state.lastMoveCount = movesArray.length;
    return true;
}

// ── Mettre à jour l'UI ──
function updateUI(gameInfo) {
    const fen = state.chess.fen();
    state.board.position(fen, false);
    document.getElementById('fenDisplay').textContent = `FEN : ${fen}`;

    if (document.getElementById('phantomAutoSync').checked &&
        window.phantomChessboard?.isConnected) {
        window.phantomChessboard.syncPosition(fen);
    }

    renderMoveList();

    if (gameInfo?.playersDetails?.length >= 2) {
        const w = gameInfo.playersDetails[0];
        const b = gameInfo.playersDetails[1];
        document.getElementById('playerWhite').textContent = w.username || '—';
        document.getElementById('ratingWhite').textContent = w.rating ? `(${w.rating})` : '';
        document.getElementById('playerBlack').textContent = b.username || '—';
        document.getElementById('ratingBlack').textContent = b.rating ? `(${b.rating})` : '';

        const meta = document.getElementById('gameMeta');
        if (meta.children.length === 0) {
            if (gameInfo.timeclass) addTag(meta, gameInfo.timeclass);
            if (gameInfo.rated)     addTag(meta, 'Rated');
        }
    }
}

function addTag(container, text) {
    const t = document.createElement('span');
    t.className = 'meta-tag';
    t.textContent = text;
    container.appendChild(t);
}

function renderMoveList() {
    const el = document.getElementById('movesList');
    el.innerHTML = '';
    if (state.moveHistory.length === 0) {
        el.innerHTML = '<span style="color:var(--text-muted,#55556a);font-size:0.8rem;">Aucun coup pour l\'instant</span>';
        return;
    }
    for (let i = 0; i < state.moveHistory.length; i += 2) {
        const row = document.createElement('div');
        const isLast = i >= state.moveHistory.length - 2;
        row.className = `move-row${isLast ? ' current' : ''}`;
        row.innerHTML = `
            <span class="move-num">${Math.floor(i/2)+1}.</span>
            <span class="move-san${i === state.moveHistory.length-1 ? ' active' : ''}">${state.moveHistory[i]}</span>
            <span class="move-san${i+1 === state.moveHistory.length-1 ? ' active' : ''}">${state.moveHistory[i+1] || ''}</span>
        `;
        el.appendChild(row);
    }
    el.scrollTop = el.scrollHeight;
}

// ── Boucle de polling ──
async function poll(gameInfo) {
    if (!state.polling) return;

    try {
        const data = await fetchMoves(state.uuid);
        const movesArray = data.moves ?? [];
        const changed = applyMoves(movesArray);

        if (changed) {
            updateUI(gameInfo);
            log(`${state.lastMoveCount} coups — ${state.chess.fen().split(' ')[0]}`, 'ok');
        }

        // Fin de partie
        if (state.chess.game_over() || data.status === 'finished') {
            setStatus('ended', 'Terminée');
            log('Partie terminée', 'warn');
            stopPolling();
            return;
        }

        setStatus('live', 'En direct');
    } catch (err) {
        log(`Erreur : ${err.message}`, 'error');
    }

    const interval = parseInt(document.getElementById('pollInterval').value) * 1000;
    state.pollTimer = setTimeout(() => poll(gameInfo), interval);
}

function stopPolling() {
    state.polling = false;
    clearTimeout(state.pollTimer);
    document.getElementById('btnConnect').disabled = false;
    document.getElementById('btnStop').disabled = true;
}

document.getElementById('btnPhantom').addEventListener('click', async () => {
    if (!window.phantomChessboard) {
        log('Module Phantom non chargé', 'error');
        return;
    }
    const connected = await window.phantomChessboard.connect();
    if (connected) {
        log('Phantom connecté', 'ok');
        // Sync immédiate si une partie est en cours
        if (state.chess && state.lastMoveCount > 0) {
            window.phantomChessboard.sendGameStart();
            window.phantomChessboard.syncPosition(state.chess.fen());
            log('Phantom synchronisé sur la position actuelle', 'ok');
        }
    } else {
        log('Connexion Phantom échouée', 'error');
    }
});

// ── Connexion ──
document.getElementById('btnConnect').addEventListener('click', async () => {
    const raw = document.getElementById('gameInput').value;
    const legacyId = parseGameId(raw);
    if (!legacyId) { log('ID invalide', 'error'); return; }

    setStatus('polling', 'Connexion…');
    log(`Récupération des infos pour la partie ${legacyId}…`, 'info');

    document.getElementById('btnConnect').disabled = true;
    document.getElementById('btnStop').disabled = false;
    document.getElementById('gameMeta').innerHTML = '';

    try {
        const gameInfo = await fetchGameInfo(legacyId);
        state.uuid = gameInfo.id;
        state.movesUrl = gameInfo.transports.http.url;
        state.legacyId = legacyId;
        state.lastMoveCount = 0;
        state.moveHistory = [];
        state.chess.reset();
        state.board.position('start');

        log(`UUID : ${state.uuid}`, 'ok');
        log(`${gameInfo.playersDetails?.[0]?.username} vs ${gameInfo.playersDetails?.[1]?.username}`, 'ok');


        // Ajouter ici
        if (window.phantomChessboard?.isConnected) {
            window.phantomChessboard.sendGameStart();
            log('Phantom : partie démarrée', 'ok');
        }


        state.polling = true;
        log(`UUID utilisé : ${state.uuid}`, 'info');
        await poll(gameInfo);

    } catch (err) {
        log(`Erreur connexion : ${err.message}`, 'error');
        setStatus('idle', 'Erreur');
        document.getElementById('btnConnect').disabled = false;
        document.getElementById('btnStop').disabled = true;
    }
});

document.getElementById('btnStop').addEventListener('click', () => {
    stopPolling();
    setStatus('idle', 'Arrêté');
    log('Arrêté manuellement', 'warn');
});

document.getElementById('phantomSpeed').addEventListener('input', function() {
    document.getElementById('speedVal').textContent = this.value + '%';
    if (window.phantomChessboard?.isConnected) {
        window.phantomChessboard.setSpeed(parseInt(this.value));
    }
});

setInterval(() => {
    const el = document.getElementById('phantomStatus');
    if (window.phantomChessboard?.isConnected) {
        el.className = 'phantom-status connected';
        el.innerHTML = '<i class="fas fa-check-circle"></i> Connecté';
    } else {
        el.className = 'phantom-status disconnected';
        el.innerHTML = '<i class="fas fa-times-circle"></i> Déconnecté';
    }
}, 2000);

document.addEventListener('DOMContentLoaded', () => {
    initBoard();
    log('Phantom Live prêt', 'ok');
    log('Entrez un ID de partie chess.com en cours', 'info');
});