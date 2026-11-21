/**
 * PHANTOM TWITCHESS - Bande de tirage
 * Variante horizontale de la roue, placée sous l'échiquier : même tirage, autre affichage
 */

import VotingWheel from './wheel.js';

const MIN_CELL_WIDTH = 110;  // Assez large pour lire "exd8=Q+"
const MIN_TRAVEL     = 3000; // Distance minimale parcourue par la bande pendant un tirage

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
        const turn = this.currentTurn();
        const pieceKey = move.charAt(0).toUpperCase();
        const piece = ['K', 'Q', 'R', 'B', 'N'].includes(pieceKey) ? pieceKey : 'P';
        return this.pieceIcons[turn][piece];
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
    }

    drawCell(move, color, x, cellWidth, height) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, cellWidth, height);
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(x + cellWidth - 1, 0, 2, height);

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px "JetBrains Mono", monospace';
        ctx.fillText(`${this.getPieceIcon(move)} ${move}`, x + cellWidth / 2, height / 2);
        ctx.restore();
    }

    /**
     * Fait défiler la bande jusqu'au coup tiré au sort
     */
    spin(duration = 5000, forcedWinner = null) {
        if (this.isSpinning || this.votes.size === 0) return null;

        this.isSpinning = true;
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
        this.spinInfo = { winner: this.winner, votes: sortedVotes.map(v => ({ m: v.move, n: v.count })), duration, startedAt: Date.now() };

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
        const target = cellStart + cellWidth * (0.15 + Math.random() * 0.7);
        const startPosition = this.position ?? width / 2;
        const turns = Math.ceil(MIN_TRAVEL / period) + Math.floor(Math.random() * 2);
        let delta = target - (startPosition % period);
        if (delta < 0) delta += period;
        const totalDelta = turns * period + delta;

        const startTime = Date.now();
        const animate = () => {
            const progress = Math.min((Date.now() - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            this.position = startPosition + totalDelta * eased;
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

    finishSpin() {
        console.log('  ➡️ Segment visuellement sous le curseur:', this.moveAtPointer());
        console.log('🏁 Winner:', this.winner);

        this.isSpinning = false;
        this.container.classList.remove('is-spinning');

        this.centerEl.style.background = this.colors[this.winnerColorIndex % this.colors.length];
        this.centerEl.innerHTML = `<span class="winner-piece">${this.getPieceIcon(this.winner)}</span><span class="winner-move">${this.winner}</span>`;
        this.centerEl.classList.add('is-revealed');
        this.highlightWinner();

        setTimeout(() => {
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
