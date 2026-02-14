/**
 * PHANTOM TWITCHESS - Voting Wheel Component
 * Roue de vote animée avec design amélioré
 */

class VotingWheel {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
        this.votes = new Map(); // move -> { count, voters: Set }
        this.colors = [
            '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', 
            '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
            '#14b8a6', '#f97316', '#84cc16', '#a855f7'
        ];
        this.isSpinning = false;
        this.currentRotation = 0;
        this.winner = null;
        
        // Callbacks
        this.onSpinEnd = null;
        
        this.init();
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
    clear() {
        this.votes.clear();
        this.winner = null;
        this.currentRotation = 0;
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
            .sort((a, b) => b.count - a.count);
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
        const radius = Math.min(width, height) / 2 - 10;

        // Clear
        ctx.clearRect(0, 0, width, height);

        const sortedVotes = this.getSortedVotes();
        const totalVotes = this.getTotalVotes();

        if (sortedVotes.length === 0) {
            // Dessiner un cercle vide
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.fillStyle = '#1a1a25';
            ctx.fill();
            ctx.strokeStyle = '#2a2a3a';
            ctx.lineWidth = 3;
            ctx.stroke();
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
            const textRadius = radius * 0.65;
            const textX = centerX + Math.cos(midAngle) * textRadius;
            const textY = centerY + Math.sin(midAngle) * textRadius;

            ctx.save();
            ctx.translate(textX, textY);
            ctx.rotate(midAngle + Math.PI / 2);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 16px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Ombre pour le texte
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 4;
            ctx.fillText(vote.move, 0, 0);
            ctx.restore();

            startAngle = endAngle;
        });

        // Cercle central (sera couvert par l'élément HTML)
        ctx.beginPath();
        ctx.arc(centerX, centerY, 35, 0, 2 * Math.PI);
        ctx.fillStyle = '#12121a';
        ctx.fill();
    }

    /**
     * Faire tourner la roue
     */
    spin(duration = 5000) {
        if (this.isSpinning || this.votes.size === 0) return null;

        this.isSpinning = true;
        this.container.querySelector('.wheel-container').classList.add('is-spinning');

        // Déterminer le gagnant (tirage au sort pondéré)
        const winner = this.pickWeightedRandom();
        this.winner = winner;

        // Calculer l'angle final
        const sortedVotes = this.getSortedVotes();
        const totalVotes = this.getTotalVotes();
        
        let winnerStartAngle = 0;
        let winnerEndAngle = 0;
        let currentAngle = 0;

        for (const vote of sortedVotes) {
            const sliceAngle = (vote.count / totalVotes) * 2 * Math.PI;
            if (vote.move === winner) {
                winnerStartAngle = currentAngle;
                winnerEndAngle = currentAngle + sliceAngle;
                break;
            }
            currentAngle += sliceAngle;
        }

        // Angle au milieu du segment gagnant
        const winnerMidAngle = (winnerStartAngle + winnerEndAngle) / 2;
        
        // La roue doit s'arrêter avec le gagnant en haut (angle -PI/2)
        // On fait plusieurs tours + l'angle nécessaire
        const spins = 5 + Math.random() * 3; // 5-8 tours
        const targetAngle = spins * 2 * Math.PI - winnerMidAngle;

        // Animation
        const startTime = Date.now();
        const startRotation = this.currentRotation;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing: ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            
            this.currentRotation = startRotation + targetAngle * eased;
            this.draw();

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.finishSpin();
            }
        };

        requestAnimationFrame(animate);
        
        return new Promise(resolve => {
            this._spinResolve = resolve;
        });
    }

    /**
     * Fin du spin
     */
    finishSpin() {
        this.isSpinning = false;
        this.container.querySelector('.wheel-container').classList.remove('is-spinning');
        
        // Afficher le gagnant au centre
        this.centerEl.textContent = this.winner;
        this.centerEl.style.fontSize = '1.2rem';

        // Highlight le gagnant dans la liste
        this.highlightWinner();

        // Callback
        if (this.onSpinEnd) {
            this.onSpinEnd(this.winner);
        }

        if (this._spinResolve) {
            this._spinResolve(this.winner);
            this._spinResolve = null;
        }
    }

    /**
     * Tirage au sort pondéré
     */
    pickWeightedRandom() {
        const totalVotes = this.getTotalVotes();
        let random = Math.random() * totalVotes;
        
        for (const [move, data] of this.votes) {
            random -= data.count;
            if (random <= 0) {
                return move;
            }
        }
        
        // Fallback
        return this.votes.keys().next().value;
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

        const sortedVotes = this.getSortedVotes();
        const totalVotes = this.getTotalVotes();

        if (sortedVotes.length === 0) {
            listEl.innerHTML = '<div class="empty-state"><p>Aucun vote</p></div>';
            return;
        }

        listEl.innerHTML = sortedVotes.map((vote, index) => {
            const percentage = totalVotes > 0 ? Math.round((vote.count / totalVotes) * 100) : 0;
            const color = this.colors[index % this.colors.length];
            
            return `
                <div class="vote-item" data-move="${vote.move}">
                    <span class="vote-item__color" style="background: ${color}"></span>
                    <span class="vote-item__move">${vote.move}</span>
                    <span class="vote-item__count">${vote.count} (${percentage}%)</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Highlight le gagnant dans la liste
     */
    highlightWinner() {
        const items = document.querySelectorAll('.vote-item');
        items.forEach(item => {
            item.classList.toggle('is-winner', item.dataset.move === this.winner);
        });
    }
}

// Export
window.VotingWheel = VotingWheel;

export default VotingWheel;
