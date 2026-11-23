/**
 * PHANTOM TWITCHESS - Voting Wheel Component
 * Roue de vote animée avec design amélioré
 */
import { paletteColors } from './votePalettes.js';
import { renderPodium, markPodiumWinner, revealWinner } from './voteViews.js';
import { secretVotes } from './voteAnonymity.js';
import { wheelTick } from './wheelTick.js';

const TAU = 2 * Math.PI;
const LAMPS = 24;

class VotingWheel {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
        this.votes = new Map(); // move -> { count, voters: Set }
        this.paletteColors = null; // imposé (spectateur : palette du streamer), sinon celle choisie ici
        this.isSpinning = false;
        this.currentRotation = 0;
        this.winner = null;

        // Callbacks
        this.onSpinEnd = null;
        this.pieceIcons = {
            w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
            b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
        };
        this.init();
    }

    /** Couleurs du tirage : n°1 pour le coup en tête, n°2 pour le suivant… */
    get colors() {
        return this.paletteColors || paletteColors();
    }

    init() {
        if (!this.container) return;

        // Créer la structure HTML
        this.container.innerHTML = `
            <div class="wheel-container">
                <div class="wheel-pointer"></div>
                <canvas class="wheel-canvas" width="400" height="400"></canvas>
                <div class="wheel-center">?</div>
            </div>
        `;

        this.canvas = this.container.querySelector('.wheel-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.centerEl = this.container.querySelector('.wheel-center');

        this.draw();
    }

    /**
     * Ajouter un vote
     */
    addVote(move, voter) {
        if (!this.votes.has(move)) {
            this.votes.set(move, { count: 0, voters: new Set() });
        }

        const voteData = this.votes.get(move);

        // Vérifier si le voter a déjà voté pour ce coup
        if (!voteData.voters.has(voter)) {
            voteData.voters.add(voter);
            voteData.count++;
        }

        this.draw();
        this.updateVoteList();
    }

    /**
     * Supprimer le vote d'un voter (pour vote unique)
     */
    removeVoterVote(voter) {
        for (const [move, data] of this.votes) {
            if (data.voters.has(voter)) {
                data.voters.delete(voter);
                data.count--;
                if (data.count <= 0) {
                    this.votes.delete(move);
                }
                break;
            }
        }
        this.draw();
        this.updateVoteList();
    }

    /**
     * Obtenir le vote actuel d'un voter
     */
    getVoterMove(voter) {
        for (const [move, data] of this.votes) {
            if (data.voters.has(voter)) {
                return move;
            }
        }
        return null;
    }

    /**
     * Reset les votes
     */
    /** Camp qui joue (icônes des pièces) ; la page spectateur le remplace */
    currentTurn() {
        return window.gameEngine?.chess?.turn() || 'w';
    }

    /** Pièce jouée d'après le SAN (sensible à la casse : « b3 » est un pion, « Bb3 » un fou) ; roque : le roi */
    pieceOf(move) {
        const c = String(move || '').charAt(0);
        if (c === 'O' || c === '0') return 'K';
        return 'KQRBN'.includes(c) ? c : 'P';
    }

    /** Pièce dessinée à la couleur du camp : forme pleine, blanche à contour sombre ou noire à contour clair */
    drawPiece(ctx, move, turn, x, y, size) {
        const glyph = this.pieceIcons.b[this.pieceOf(move)] + '︎';
        ctx.save();
        ctx.font = `${Math.round(size)}px "Segoe UI Symbol", "DejaVu Sans", "Noto Sans Symbols2", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2, size / 8);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 4;
        ctx.strokeStyle = turn === 'b' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(10, 10, 15, 0.9)';
        ctx.strokeText(glyph, x, y);
        ctx.shadowBlur = 0;
        ctx.fillStyle = turn === 'b' ? '#15151c' : '#ffffff';
        ctx.fillText(glyph, x, y);
        ctx.restore();
    }

    /** Coup écrit à la couleur du camp, comme la pièce : blanc à contour sombre ou noir à contour clair */
    drawMoveText(ctx, text, turn, x, y, size) {
        ctx.save();
        ctx.font = `800 ${Math.round(size)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2.5, size / 5);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3;
        ctx.strokeStyle = turn === 'b' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(10, 10, 15, 0.9)';
        ctx.strokeText(text, x, y);
        ctx.shadowBlur = 0;
        ctx.fillStyle = turn === 'b' ? '#15151c' : '#ffffff';
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    /** Même chose en HTML (coup tiré au centre de la roue / sur la bande) */
    pieceHtml(move, turn = this.currentTurn()) {
        const dark = turn === 'b';
        return `<span class="winner-piece" style="color:${dark ? '#15151c' : '#fff'};-webkit-text-stroke:1.5px ${dark ? 'rgba(255,255,255,.9)' : 'rgba(10,10,15,.85)'};paint-order:stroke fill">${this.pieceIcons.b[this.pieceOf(move)]}︎</span>`;
    }

    clear() {
        this.votes.clear();
        this.winner = null;
        this.currentRotation = 0;
        this.revealMove = null;
        this.revealAt = 0;
        this.centerEl.textContent = '?';
        this.draw();
        this.updateVoteList();
    }

    /**
     * Obtenir le total des votes
     */
    getTotalVotes() {
        let total = 0;
        for (const data of this.votes.values()) {
            total += data.count;
        }
        return total;
    }

    /**
     * Obtenir les votes triés
     */
getSortedVotes() {
    return Array.from(this.votes.entries())
        .map(([move, data]) => ({ move, count: data.count }))
        .sort((a, b) => {
            // Tri stable : si même count, garder l'ordre d'insertion
            if (b.count === a.count) return 0;
            return b.count - a.count;
        });
}

    /**
     * Dessiner la roue
     */
    draw() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        // Parts, puis la jante (lampes) et la languette du curseur à droite
        const radius = Math.min(width, height) / 2 - 32;


        const turn = this.currentTurn();
        const pieceIcons = {
            w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
            b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
        };


        // Clear
        ctx.clearRect(0, 0, width, height);

   const sortedVotes = this.isSpinning && this.spinVotes ? this.spinVotes : this.getSortedVotes();
    const totalVotes = this.isSpinning && this.spinTotalVotes ? this.spinTotalVotes : this.getTotalVotes();

        if (sortedVotes.length === 0) {
            // Roue vide
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, TAU);
            ctx.fillStyle = '#1a1a25';
            ctx.fill();
            this.drawRim(ctx, centerX, centerY, radius);
            this.drawFlapper(ctx, centerX, centerY, radius);
            return;
        }

        let startAngle = this.currentRotation;

        sortedVotes.forEach((vote, index) => {
            const sliceAngle = (vote.count / totalVotes) * 2 * Math.PI;
            const endAngle = startAngle + sliceAngle;
            const color = this.colors[index % this.colors.length];

            // Dessiner le segment
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();

            // Bordure du segment
            ctx.strokeStyle = '#0a0a0f';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Texte du coup
            const midAngle = startAngle + sliceAngle / 2;
            // Tailles selon la place : largeur de la part et rayon de la roue
            const arc = sliceAngle * radius * 0.8;
            const fontSize = Math.max(12, Math.min(radius * 0.11, arc * 0.4, 30));
            const pieceSize = Math.max(16, Math.min(radius * 0.2, arc * 0.62, 46));
            const r0 = radius - 8 - fontSize / 2;

            ctx.save();
            ctx.translate(centerX + Math.cos(midAngle) * r0, centerY + Math.sin(midAngle) * r0);
            ctx.rotate(midAngle + Math.PI / 2);

            // Coup près du bord, pièce en dessous (vers le centre), tous deux à la couleur du camp
            this.drawMoveText(ctx, vote.move, turn, 0, 0, fontSize);
            this.drawPiece(ctx, vote.move, turn, 0, fontSize / 2 + 3 + pieceSize / 2, pieceSize);

            ctx.restore();

            // Coup tiré : part cerclée de clair
            if (!this.isSpinning && this.revealMove === vote.move) {
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.arc(centerX, centerY, radius - 2, startAngle, endAngle);
                ctx.closePath();
                ctx.lineJoin = 'round';
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#fff3ea';
                ctx.stroke();
            }

            startAngle = endAngle;
        });

        this.drawRim(ctx, centerX, centerY, radius);

        // Petit moyeu discret
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius * 0.07, 0, TAU);
        ctx.fillStyle = '#14100e';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 138, 61, 0.6)';
        ctx.stroke();

        this.drawFlapper(ctx, centerX, centerY, radius);
    }

    /** Jante sombre et ses lampes : défilent pendant le tirage, clignotent à l'arrêt, puis restent allumées */
    drawRim(ctx, cx, cy, radius) {
        const rim = radius + 11;
        const now = performance.now();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rim, 0, TAU);
        ctx.lineWidth = 18;
        ctx.strokeStyle = '#2b211b';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, rim + 9, 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 138, 61, 0.35)';
        ctx.stroke();
        for (let i = 0; i < LAMPS; i++) {
            const a = (i / LAMPS) * TAU;
            let on;
            if (this.isSpinning) on = (i + Math.floor(now / (60 + 260 * (this.spinProgress || 0)))) % 3 === 0 ? 1 : 0.18;
            else if (this.revealMove && now - this.revealAt < 2200) on = Math.floor((now - this.revealAt) / 220) % 2 ? 1 : 0.2;
            else if (this.revealMove) on = 1;
            else on = 0.4;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rim, cy + Math.sin(a) * rim, 3.6, 0, TAU);
            ctx.fillStyle = `rgba(255, 196, 140, ${on})`;
            if (on > 0.9) { ctx.shadowColor = '#ff8a3d'; ctx.shadowBlur = 10; }
            ctx.fill();
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    /** Languette du curseur, à droite (angle 0), pointe vers le centre ; bascule à chaque part qui passe */
    drawFlapper(ctx, cx, cy, radius) {
        ctx.save();
        ctx.translate(cx + radius + 26, cy);
        ctx.rotate(Math.PI / 2 + (this.flap || 0));
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(9, 0);
        ctx.lineTo(1.5, 34);
        ctx.lineTo(-1.5, 34);
        ctx.closePath();
        ctx.fillStyle = '#f4eee8';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, TAU);
        ctx.fillStyle = '#ff8a3d';
        ctx.fill();
        ctx.restore();
    }

    /** Part sous le curseur (angle 0) pour une rotation donnée */
    sliceAtPointer(votes, total, rotation) {
        const a = ((-rotation % TAU) + TAU) % TAU;
        let acc = 0;
        for (let i = 0; i < votes.length; i++) {
            acc += (votes[i].count / total) * TAU;
            if (a < acc) return i;
        }
        return votes.length - 1;
    }

    /**
     * Faire tourner la roue
     */
spin(duration = 5000, forcedWinner = null) {
    if (this.isSpinning || this.votes.size === 0) return null;

    this.isSpinning = true;
    this.revealMove = null;
    this.spinProgress = 0;
    this.flap = 0;
    const token = this.spinToken = (this.spinToken || 0) + 1;
    this.container.querySelector('.wheel-container').classList.add('is-spinning');

    // Snapshot figé
    const sortedVotes = this.getSortedVotes();
    const totalVotes = sortedVotes.reduce((sum, v) => sum + v.count, 0);
    this.spinVotes = [...sortedVotes];
    this.spinTotalVotes = totalVotes;

    // Utiliser le gagnant imposé, ou tirer au sort dans le même ordre que les segments
    let winner = forcedWinner;
    if (!winner || !sortedVotes.find(v => v.move === winner)) {
        let rand = Math.random() * totalVotes;
        winner = sortedVotes[sortedVotes.length - 1].move;
        for (const vote of sortedVotes) {
            rand -= vote.count;
            if (rand <= 0) { winner = vote.move; break; }
        }
    }
    this.winner = winner;
    console.log('🎯 Gagnant tiré:', winner, forcedWinner ? '(imposé)' : '(aléatoire)');
    // Les spectateurs rejouent le même tirage (mêmes coups, même gagnant)
    this.spinInfo = { winner, votes: sortedVotes.map(v => ({ m: v.move, n: v.count })), duration, startedAt: Date.now() };

    // Angle du milieu du segment gagnant
    let angleAccum = 0;
    let winnerMidAngle = 0;
    let winnerColorIndex = 0;
    for (let i = 0; i < sortedVotes.length; i++) {
        const sliceAngle = (sortedVotes[i].count / totalVotes) * 2 * Math.PI;
        if (sortedVotes[i].move === winner) {
            winnerMidAngle = angleAccum + sliceAngle / 2;
            winnerColorIndex = i;
            break;
        }
        angleAccum += sliceAngle;
    }
    this.winnerColorIndex = winnerColorIndex;

    // Calcul de la rotation finale
    // ~1 tour toutes les 1,6 s : la roue démarre moins vite (avant : 5 à 7 tours en 5 s)
    const spins = duration > 0 ? Math.max(2, Math.round(duration / 1600)) + Math.floor(Math.random() * 2) : 0;
    const normalizedCurrent = ((this.currentRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const targetRotationNormalized = ((-winnerMidAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    let delta = targetRotationNormalized - normalizedCurrent;
    if (delta < 0) delta += 2 * Math.PI;
    const totalDelta = spins * 2 * Math.PI + delta;

    const startRotation = this.currentRotation;
    const startTime = Date.now();
    let lastSlice = this.sliceAtPointer(sortedVotes, totalVotes, startRotation);

    const animate = () => {
        if (token !== this.spinToken) return;   // tirage annulé (abort)
        const elapsed = Date.now() - startTime;
        const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
        const eased = 1 - Math.pow(1 - progress, 3);
        this.currentRotation = startRotation + totalDelta * eased;
        this.spinProgress = progress;
        // Une part passe sous le curseur : la languette bascule et la roue fait « tic »
        const slice = this.sliceAtPointer(sortedVotes, totalVotes, this.currentRotation);
        if (slice !== lastSlice && sortedVotes.length > 1) {
            lastSlice = slice;
            this.flap = -0.6;
            if (duration > 0) wheelTick();
        }
        this.flap = (this.flap || 0) * 0.84;
        this.draw();
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            this.finishSpin();
        }
    };

    requestAnimationFrame(animate);
    return new Promise(resolve => { this._spinResolve = resolve; });
}

    /**
     * Annule le tirage en cours : la fin d'animation (gelée quand l'onglet est caché) n'affichera plus le coup tiré
     */
abort() {
    this.spinToken = (this.spinToken || 0) + 1;
    this.isSpinning = false;
    this._spinResolve = null;
    this.container.querySelector('.wheel-container')?.classList.remove('is-spinning');
    this.centerEl?.classList.remove('winner-reveal');
}

    /**
     * Fin du spin
     */
finishSpin() {
    this.isSpinning = false;
    this.flap = 0;
    this.container.querySelector('.wheel-container').classList.remove('is-spinning');

    // Lampes qui clignotent ~2 s autour de la part gagnante cerclée
    this.revealMove = this.winner;
    this.revealAt = performance.now();
    const blinkToken = this.spinToken;
    const blink = () => {
        if (blinkToken !== this.spinToken || this.revealMove !== this.winner) return;
        this.draw();
        if (performance.now() - this.revealAt < 2300) requestAnimationFrame(blink);
    };
    requestAnimationFrame(blink);

    // Déterminer la couleur du segment gagnant pour le rond central
    const sortedVotes = this.spinVotes || this.getSortedVotes();
    const totalVotes = this.spinTotalVotes || sortedVotes.reduce((s, v) => s + v.count, 0);

    let winnerColor = '#10b981'; // fallback vert
    let currentAngle = 0;
    for (let i = 0; i < sortedVotes.length; i++) {
        const sliceAngle = (sortedVotes[i].count / totalVotes) * 2 * Math.PI;
        if (sortedVotes[i].move === this.winner) {
            winnerColor = this.colors[i % this.colors.length];
            break;
        }
        currentAngle += sliceAngle;
    }

    // Afficher la pièce + le coup au centre, couleur du segment gagnant

    this.winnerColor = winnerColor;
    this.winnerPct = this.computeWinnerPct(sortedVotes, totalVotes);
    // L'hôte affiche le coup tiré en grand dans l'encart du podium ; les spectateurs gardent le centre de la roue
    if (this.showResultInside !== false) {
        this.centerEl.style.setProperty('--winner-color', winnerColor);
        this.centerEl.innerHTML = `${this.pieceHtml(this.winner)}<span class="winner-move">${this.winner}</span>`;
        this.centerEl.classList.add('winner-reveal');
        this.centerEl.style.background = winnerColor;
        this.centerEl.style.boxShadow = `0 0 30px ${winnerColor}99, 0 0 60px ${winnerColor}44, inset 0 2px 10px rgba(255,255,255,0.3)`;
    }

    this.highlightWinner();

    console.log('🏁 Winner:', this.winner, '| Couleur segment:', winnerColor);

    const token = this.spinToken;
    setTimeout(() => {
        if (token !== this.spinToken) return;
        this.centerEl.classList.remove('winner-reveal');
        this.centerEl.style.background = '';
        this.centerEl.style.boxShadow = '';

        if (this.onSpinEnd) {
            this.onSpinEnd(this.winner);
        }
        if (this._spinResolve) {
            this._spinResolve(this.winner);
            this._spinResolve = null;
        }
    }, 2000);

    this.spinVotes = null;
    this.spinTotalVotes = null;
}

    /**
     * Tirage au sort pondéré
     */
pickWeightedRandom() {
    console.log('🎲 pickWeightedRandom appelé');
    // ⚠️ CRITIQUE: même ordre que getSortedVotes() pour cohérence avec les angles
    const sorted = this.getSortedVotes();
    console.log('  - sorted:', sorted.map(v => `${v.move}:${v.count}`));

    const totalVotes = sorted.reduce((sum, v) => sum + v.count, 0);
    let random = Math.random() * totalVotes;

    for (const vote of sorted) {
        random -= vote.count;
        if (random <= 0) {
            console.log('  - Résultat:', vote.move);
            return vote.move;
        }
    }

    const fallback = sorted[0]?.move ?? null;
    console.log('  - Fallback:', fallback);
    return fallback;
}

    /**
     * Obtenir le coup majoritaire
     */
    getMajority() {
        const sorted = this.getSortedVotes();
        if (sorted.length === 0) return null;

        // Vérifier s'il y a une vraie majorité (pas d'égalité)
        if (sorted.length > 1 && sorted[0].count === sorted[1].count) {
            return null; // Égalité
        }

        return sorted[0].move;
    }

    /**
     * Mettre à jour la liste des votes (sidebar)
     */
    updateVoteList() {
        const listEl = document.getElementById('vote-list');
        if (!listEl) return;
        // Roue de hasard (tous les coups à 1) : le podium garde les vrais votes
        if (document.body.classList.contains('randomWheel')) return;
        renderPodium(listEl, document.getElementById('vote-total'), this.getSortedVotes(), {
            turn: this.currentTurn(), colors: this.colors, secret: secretVotes()
        });
    }

    /**
     * Highlight le gagnant dans la liste
     */
    highlightWinner() {
        markPodiumWinner(document.getElementById('vote-list'), this.winner);
        if (this.showResultInside === false) {
            revealWinner(document.getElementById('votes-panel'), {
                move: this.winner, color: this.winnerColor, pct: this.winnerPct, turn: this.currentTurn()
            });
        }
    }

    /** Score du coup tiré ; null quand chaque coup n'a qu'une voix (pur tirage au sort) */
    computeWinnerPct(votes, total) {
        if (!votes?.length || !total) return null;
        if (votes.length > 1 && votes.every(v => v.count === 1)) return null;
        const w = votes.find(v => v.move === this.winner);
        return w ? Math.round((w.count / total) * 100) : null;
    }
}

// Export
window.VotingWheel = VotingWheel;

export default VotingWheel;
