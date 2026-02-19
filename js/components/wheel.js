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
        this.pieceIcons = {
            w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
            b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
        };
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
    console.log('🎨 DRAW called - isSpinning:', this.isSpinning, '- spinVotes exists:', !!this.spinVotes);
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 2 - 10;


        const turn = window.gameEngine?.chess?.turn() || 'w';
        const pieceIcons = {
            w: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
            b: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' }
        };


        // Clear
        ctx.clearRect(0, 0, width, height);

   const sortedVotes = this.isSpinning && this.spinVotes ? this.spinVotes : this.getSortedVotes();
    const totalVotes = this.isSpinning && this.spinTotalVotes ? this.spinTotalVotes : this.getTotalVotes();

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
            const textRadius = radius * 0.85;
            const textX = centerX + Math.cos(midAngle) * textRadius;
            const textY = centerY + Math.sin(midAngle) * textRadius;

            // Icône de pièce
            const pieceKey = vote.move.charAt(0).toUpperCase();
            const isNamedPiece = ['K', 'Q', 'R', 'B', 'N'].includes(pieceKey);
            const piece = isNamedPiece ? pieceKey : 'P';
            const pieceIcon = this.pieceIcons[turn][piece];
            const firstChar = vote.move.charAt(0).toUpperCase();

            ctx.save();
            ctx.translate(textX, textY);
            ctx.rotate(midAngle + Math.PI / 2);
            
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 4;
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Texte au-dessus (vers le bord)
            ctx.font = 'bold 12px "JetBrains Mono", monospace';
            ctx.fillText(vote.move, 0, -10);

            // Pièce en dessous (vers le centre)
            ctx.font = 'bold 18px sans-serif';
            ctx.fillText(pieceIcon, 0, 10);

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
spin(duration = 5000, forcedWinner = null) {
    if (this.isSpinning || this.votes.size === 0) return null;

    this.isSpinning = true;
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
    const spins = 5 + Math.floor(Math.random() * 3);
    const normalizedCurrent = ((this.currentRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const targetRotationNormalized = ((-winnerMidAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    let delta = targetRotationNormalized - normalizedCurrent;
    if (delta < 0) delta += 2 * Math.PI;
    const totalDelta = spins * 2 * Math.PI + delta;

    const startRotation = this.currentRotation;
    const startTime = Date.now();

    const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        this.currentRotation = startRotation + totalDelta * eased;
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
     * Fin du spin
     */
finishSpin() {

console.log('🔬 DEBUG FINISH:');
console.log('  this.winner:', this.winner);
console.log('  currentRotation final (deg):', (this.currentRotation * 180 / Math.PI).toFixed(1));
console.log('  currentRotation % 360:', ((this.currentRotation * 180 / Math.PI) % 360).toFixed(1));

// Recalculer quel segment est à droite (angle 0) avec la rotation finale
const rot = ((this.currentRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const sortedDbg = this.spinVotes || this.getSortedVotes();
const totalDbg = sortedDbg.reduce((s,v) => s + v.count, 0);
let angleDbg = 0;
for (const v of sortedDbg) {
    const slice = (v.count / totalDbg) * 2 * Math.PI;
    const start = angleDbg;
    const end = angleDbg + slice;
    // Le curseur (angle 0) correspond à -rot dans le repère des segments
    const cursorAngle = ((-rot) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    if (cursorAngle >= start && cursorAngle < end) {
        console.log('  ➡️ Segment visuellement sous le curseur:', v.move);
    }
    angleDbg += slice;
}

    
    this.isSpinning = false;
    this.container.querySelector('.wheel-container').classList.remove('is-spinning');

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
    const turn = window.gameEngine?.chess?.turn() || 'w';
    const pieceKey = this.winner.charAt(0).toUpperCase();
    const isNamedPiece = ['K', 'Q', 'R', 'B', 'N'].includes(pieceKey);
    const piece = isNamedPiece ? pieceKey : 'P';
    const pieceIcon = this.pieceIcons[turn][piece];

    this.centerEl.style.setProperty('--winner-color', winnerColor);
    this.centerEl.innerHTML = `<span class="winner-piece">${pieceIcon}</span><span class="winner-move">${this.winner}</span>`;
    this.centerEl.classList.add('winner-reveal');
    // Appliquer la couleur du segment gagnant
    this.centerEl.style.background = winnerColor;
    this.centerEl.style.boxShadow = `0 0 30px ${winnerColor}99, 0 0 60px ${winnerColor}44, inset 0 2px 10px rgba(255,255,255,0.3)`;

    this.highlightWinner();

    console.log('🏁 Winner:', this.winner, '| Couleur segment:', winnerColor);

    setTimeout(() => {
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
