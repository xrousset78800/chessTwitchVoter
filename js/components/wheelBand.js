/**
 * PHANTOM TWITCHESS - Bande de tirage
 * Variante horizontale de la roue, placée sous l'échiquier : même tirage, autre affichage
 */

import VotingWheel from './wheel.js';
import { wheelTick } from './wheelTick.js';
import { fmtMove } from '../utils/moveMatch.js';

const MIN_CELL_WIDTH = 110;  // Assez large pour lire "exd8=Q+"
const MIN_TRAVEL     = 3000; // Distance minimale parcourue par la bande pendant un tirage
const PEG_GAP        = 40;   // Picots le long de la bande : un « tic » à chacun

class WheelBand extends VotingWheel {
    init() {
        if (!this.container) return;

        this.position = null; // Point de la bande sous le curseur (null : bande calée à gauche)
        this.container.innerHTML = `
            <div class="wheel-band">
                <div class="wheel-band__pointer"></div>
                <canvas class="wheel-band__canvas"></canvas>
                <div class="wheel-band__result"></div>
            </div>
        `;

        this.canvas = this.container.querySelector('.wheel-band__canvas');
        this.ctx = this.canvas.getContext('2d');
        this.centerEl = this.container.querySelector('.wheel-band__result');

        // Redessine quand la bande apparaît ou que la colonne change de largeur
        new ResizeObserver(() => this.draw()).observe(this.canvas);
    }

    clear() {
        this.position = null;
        super.clear();
    }

    /**
     * Longueur d'un tour de bande : les segments se répètent ensuite
     */
    getPeriod(votes, totalVotes, width) {
        const smallest = Math.min(...votes.map(v => v.count));
        return Math.max(width, MIN_CELL_WIDTH * totalVotes / smallest);
    }

    getPieceIcon(move) {
        return this.pieceIcons[this.currentTurn()][this.pieceOf(move)];
    }

    draw() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        if (width === 0) return; // Bande masquée

        const ctx = this.ctx;
        const ratio = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * ratio);
        this.canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const spinning = this.isSpinning && this.spinVotes;
        const sortedVotes = spinning ? this.spinVotes : this.getSortedVotes();
        const totalVotes = spinning ? this.spinTotalVotes : this.getTotalVotes();

        if (sortedVotes.length === 0) {
            ctx.fillStyle = '#1a1a25';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#8888a0';
            ctx.font = '14px sans-serif';
            ctx.fillText(window.i18n?.t('wheelStyle.waiting') || '', width / 2, height / 2);
            return;
        }

        const period = spinning ? this.spinPeriod : this.getPeriod(sortedVotes, totalVotes, width);
        const offset = width / 2 - (this.position ?? width / 2);

        // Depuis la première répétition qui touche le bord gauche
        for (let origin = ((offset % period) + period) % period - period; origin < width; origin += period) {
            let x = origin;
            sortedVotes.forEach((vote, index) => {
                const cellWidth = (vote.count / totalVotes) * period;
                if (x + cellWidth > 0 && x < width) {
                    this.drawCell(vote.move, this.colors[index % this.colors.length], x, cellWidth, height);
                }
                x += cellWidth;
            });
        }

        // Picots en haut et en bas, entraînés avec la bande
        ctx.save();
        ctx.fillStyle = 'rgba(244, 238, 232, 0.85)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 2;
        for (let px = ((offset % PEG_GAP) + PEG_GAP) % PEG_GAP; px < width; px += PEG_GAP) {
            for (const py of [4, height - 4]) {
                ctx.beginPath();
                ctx.arc(px, py, 2, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    drawCell(move, color, x, cellWidth, height) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, cellWidth, height);
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(x + cellWidth - 1, 0, 2, height);

        // Pièce à la couleur du camp, plus grande quand la case le permet, puis le coup
        const fontSize = Math.max(14, Math.min(height * 0.36, cellWidth * 0.16, 28));
        const pieceSize = Math.max(18, Math.min(height * 0.62, cellWidth * 0.3, 44));
        ctx.save();
        ctx.font = `800 ${Math.round(fontSize)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = fmtMove(move);
        const tw = ctx.measureText(label).width;
        const gap = 6;
        const left = x + cellWidth / 2 - (pieceSize + gap + tw) / 2;
        this.drawPiece(ctx, move, this.currentTurn(), left + pieceSize / 2, height / 2, pieceSize);
        this.drawMoveText(ctx, label, this.currentTurn(), left + pieceSize + gap + tw / 2, height / 2, fontSize);
        ctx.restore();
    }

    /** Coup de la case sous le curseur (milieu de la bande) */
    pointerMove() {
        const votes = this.spinVotes || this.getSortedVotes();
        const total = this.spinTotalVotes || this.getTotalVotes();
        const period = this.spinPeriod;
        if (!votes.length || !total || !period) return null;
        const x = (((this.position ?? 0) % period) + period) % period;
        let acc = 0;
        for (const v of votes) {
            acc += (v.count / total) * period;
            if (x < acc) return v.move;
        }
        return votes[votes.length - 1].move;
    }

    /** Pendant le tirage : prévient la page quand le coup sous le curseur change (flèche sur l'échiquier) */
    trackPointer() {
        const mv = this.pointerMove();
        if (mv === this.pointerAt) return;
        this.pointerAt = mv;
        try { this.onPointer?.(mv); } catch { /* affichage seulement */ }
    }

    /**
     * Fait défiler la bande jusqu'au coup tiré au sort
     */
    spin(duration = 5000, forcedWinner = null, stop = null) {
        if (this.isSpinning || this.votes.size === 0) return null;
        // Point d'arrêt dans la case gagnante (0.15 à 0.85) : imposé pour que tous les spectateurs voient le même
        stop = Number.isFinite(stop) && stop >= 0.15 && stop <= 0.85 ? stop : 0.15 + Math.random() * 0.7;

        this.isSpinning = true;
        const token = this.spinToken = (this.spinToken || 0) + 1;
        this.container.classList.add('is-spinning');
        // Sur un petit écran la bande peut être sous la ligne de flottaison
        this.container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        const sortedVotes = this.getSortedVotes();
        const totalVotes = this.getTotalVotes();
        const width = this.canvas.clientWidth;
        const period = this.getPeriod(sortedVotes, totalVotes, width);
        this.spinVotes = sortedVotes;
        this.spinTotalVotes = totalVotes;
        this.spinPeriod = period;
        this.winner = forcedWinner && sortedVotes.some(v => v.move === forcedWinner)
            ? forcedWinner
            : this.pickWeightedRandom();
        // Les spectateurs rejouent le même tirage (mêmes coups, même gagnant)
        this.spinInfo = { winner: this.winner, votes: sortedVotes.map(v => ({ m: v.move, n: v.count })), duration, stop, startedAt: Date.now() };

        // Case du gagnant sur la bande
        let cellStart = 0;
        let cellWidth = 0;
        for (let i = 0; i < sortedVotes.length; i++) {
            cellWidth = (sortedVotes[i].count / totalVotes) * period;
            if (sortedVotes[i].move === this.winner) {
                this.winnerColorIndex = i;
                break;
            }
            cellStart += cellWidth;
        }

        // S'arrête n'importe où dans la case gagnante, sans frôler ses bords
        const target = cellStart + cellWidth * stop;
        const startPosition = this.position ?? width / 2;
        // Distance proportionnelle à la durée (≈ 400 px/s en moyenne) : démarrage plus doux ; 0 = direct
        const travel = duration > 0 ? Math.max(period, MIN_TRAVEL * Math.min(1.6, duration / 7500)) : 0;
        const turns = duration > 0 ? Math.ceil(travel / period) + Math.floor(Math.random() * 2) : 0;
        let delta = target - (startPosition % period);
        if (delta < 0) delta += period;
        const totalDelta = turns * period + delta;

        const startTime = Date.now();
        let lastPeg = Math.floor(startPosition / PEG_GAP);
        const animate = () => {
            if (token !== this.spinToken) return;   // tirage annulé (abort)
            const progress = duration > 0 ? Math.min((Date.now() - startTime) / duration, 1) : 1;
            const eased = 1 - Math.pow(1 - progress, 3);
            this.position = startPosition + totalDelta * eased;
            // Un picot passe sous le curseur : « tic »
            const peg = Math.floor(this.position / PEG_GAP);
            if (peg !== lastPeg && duration > 0) wheelTick();
            lastPeg = peg;
            this.draw();
            this.trackPointer();
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.finishSpin();
            }
        };

        requestAnimationFrame(animate);
        return new Promise(resolve => { this._spinResolve = resolve; });
    }

    /** Annule le tirage en cours : la fin d'animation (gelée quand l'onglet est caché) n'affichera plus le coup tiré */
    abort() {
        this.spinToken = (this.spinToken || 0) + 1;
        this.isSpinning = false;
        this._spinResolve = null;
        this.container?.classList.remove('is-spinning');
        this.centerEl?.classList.remove('is-revealed');
    }

    finishSpin() {
        console.log('  ➡️ Segment visuellement sous le curseur:', this.moveAtPointer());
        console.log('🏁 Winner:', this.winner);

        this.isSpinning = false;
        this.container.classList.remove('is-spinning');

        this.winnerColor = this.colors[this.winnerColorIndex % this.colors.length];
        this.winnerPct = this.computeWinnerPct(this.spinVotes || this.getSortedVotes(), this.spinTotalVotes || this.getTotalVotes());
        // L'hôte affiche le coup tiré en grand dans l'encart du podium ; les spectateurs gardent l'étiquette sur la bande
        if (this.showResultInside !== false) {
            this.centerEl.style.background = this.winnerColor;
            this.centerEl.innerHTML = `${this.pieceHtml(this.winner)}<span class="winner-move">${fmtMove(this.winner)}</span>`;
            this.centerEl.classList.add('is-revealed');
        }
        this.highlightWinner();

        const token = this.spinToken;
        setTimeout(() => {
            if (token !== this.spinToken) return;
            this.centerEl.classList.remove('is-revealed');

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

    moveAtPointer() {
        const votes = this.spinVotes || this.getSortedVotes();
        const total = votes.reduce((sum, v) => sum + v.count, 0);
        let remaining = this.position % this.spinPeriod;
        for (const vote of votes) {
            remaining -= (vote.count / total) * this.spinPeriod;
            if (remaining < 0) return vote.move;
        }
        return null;
    }
}

export default WheelBand;
