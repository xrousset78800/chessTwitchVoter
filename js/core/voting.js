/**
 * VOTING MODULE
 * Gestion des votes pour les coups d'échecs
 */

class VotingSystem {
    constructor() {
        this.votes = [];             // Liste des votes [{player, move, color}]
        this.isOpen = false;         // Le vote est-il ouvert ?
        this.singleVotePerPlayer = false;  // Un seul vote par joueur ?
        this.majorityMode = true;    // Mode majorité ou roue ?
        
        // Callbacks
        this.onVoteAdded = null;     // Appelé quand un vote est ajouté
        this.onResultReady = null;   // Appelé quand le résultat est prêt
        
        // Couleurs pour le graphique
        this.colorPalette = [
            '#f2ff93','#dc90e8','#88e600','#e5c0ff','#01d04b','#ff9cc9',
            '#37ff85','#ffaca6','#08c55c','#ffa837','#85f9ff','#e5c700',
            '#a8d7ff','#84c600','#67b8c3','#fff55e','#01c2a0','#d5a517',
            '#02dbae','#df9f4d','#89ff89','#ffe7dd','#7cbc5f','#ffdfa1',
            '#97ffe0','#a9b174','#bbffa4','#79b8a3','#e6ffcf','#98b391'
        ];
    }

    /**
     * Initialise le système de vote
     */
    init(options = {}) {
        this.singleVotePerPlayer = options.singleVote || false;
        this.majorityMode = options.majorityMode !== false;
        
        if (options.onVoteAdded) this.onVoteAdded = options.onVoteAdded;
        if (options.onResultReady) this.onResultReady = options.onResultReady;
        
        console.log('🗳️ Système de vote initialisé:', {
            singleVote: this.singleVotePerPlayer,
            majorityMode: this.majorityMode
        });
        
        return this;
    }

    /**
     * Ouvre le vote
     */
    open() {
        this.votes = [];
        this.isOpen = true;
        console.log('🗳️ Vote ouvert');
    }

    /**
     * Ferme le vote
     */
    close() {
        this.isOpen = false;
        console.log('🗳️ Vote fermé -', this.votes.length, 'votes reçus');
    }

    /**
     * Ajoute un vote
     * @param {string} player - Nom du joueur
     * @param {string} move - Coup voté (ex: "e4", "Nf3")
     * @returns {boolean} - true si le vote a été ajouté
     */
    addVote(player, move) {
        if (!this.isOpen) {
            console.log('❌ Vote rejeté: vote fermé');
            return false;
        }
        
        // Vérifier si le joueur a déjà voté (si mode vote unique)
        if (this.singleVotePerPlayer) {
            const existingVote = this.votes.find(v => v.player === player);
            if (existingVote) {
                console.log('❌ Vote rejeté:', player, 'a déjà voté');
                return false;
            }
        }
        
        // Trouver ou créer une couleur pour ce coup
        const existingMoveVote = this.votes.find(v => v.move === move);
        const color = existingMoveVote 
            ? existingMoveVote.color 
            : this.colorPalette[Math.floor(Math.random() * this.colorPalette.length)];
        
        // Ajouter le vote
        const vote = { player, move, color, timestamp: Date.now() };
        this.votes.push(vote);
        
        console.log('✅ Vote ajouté:', player, '→', move);
        
        // Callback
        if (this.onVoteAdded) {
            this.onVoteAdded(vote, this.getResults());
        }
        
        return true;
    }

    /**
     * Retire les votes d'un joueur exclu pendant le tour
     */
    removePlayer(player) {
        this.votes = this.votes.filter(v => v.player !== player);
    }

    /**
     * Retourne les résultats agrégés
     * @returns {Object} - {move: count, ...}
     */
    getResults() {
        return this.votes.reduce((acc, vote) => {
            acc[vote.move] = (acc[vote.move] || 0) + 1;
            return acc;
        }, {});
    }

    /**
     * Retourne les résultats triés par nombre de votes
     * @returns {Array} - [{move, count, color, percentage}, ...]
     */
    getSortedResults() {
        const results = this.getResults();
        const total = this.votes.length;
        
        return Object.entries(results)
            .map(([move, count]) => {
                const voteWithColor = this.votes.find(v => v.move === move);
                return {
                    move,
                    count,
                    color: voteWithColor?.color || '#ffffff',
                    percentage: total > 0 ? Math.round((count / total) * 100) : 0
                };
            })
            .sort((a, b) => b.count - a.count);
    }

    /**
     * Sélectionne le coup gagnant selon le mode
     * @returns {string|null} - Le coup sélectionné
     */
    selectWinner() {
        if (this.votes.length === 0) {
            return null;
        }
        
        const results = this.getSortedResults();
        
        if (this.majorityMode) {
            return this.selectByMajority();
        } else {
            // Mode roue : sélection aléatoire pondérée
            return this.selectByWheel();
        }
    }

    /**
     * Coup le plus voté, tiré au sort entre les ex æquo
     * @returns {string|null} - Le coup sélectionné
     */
    selectByMajority() {
        const results = this.getSortedResults();
        if (results.length === 0) return null;

        const tied = results.filter(r => r.count === results[0].count);
        const winner = tied[Math.floor(Math.random() * tied.length)];
        console.log('🏆 Gagnant (majorité):', winner.move, 'avec', winner.count, 'vote(s),', tied.length, 'ex æquo');
        return winner.move;
    }

    /**
     * Sélection aléatoire pondérée (pour la roue)
     * @returns {string} - Le coup sélectionné
     */
    selectByWheel() {
        if (this.votes.length === 0) return null;
        
        // Sélectionner un vote aléatoire (chaque vote a une chance égale)
        const randomIndex = Math.floor(Math.random() * this.votes.length);
        const winner = this.votes[randomIndex].move;
        
        console.log('🎡 Gagnant (roue):', winner);
        return winner;
    }

    /**
     * Retourne le coup le plus voté actuellement
     * @returns {string|null}
     */
    getCurrentLeader() {
        const results = this.getSortedResults();
        return results.length > 0 ? results[0].move : null;
    }

    /**
     * Retourne le nombre total de votes
     */
    getTotalVotes() {
        return this.votes.length;
    }

    /**
     * Retourne tous les votes bruts
     */
    getAllVotes() {
        return [...this.votes];
    }

    /**
     * Réinitialise les votes
     */
    reset() {
        this.votes = [];
        this.isOpen = false;
        console.log('🗳️ Votes réinitialisés');
    }

    /**
     * Configure le mode de vote
     */
    setMode(options) {
        if (options.singleVote !== undefined) {
            this.singleVotePerPlayer = options.singleVote;
        }
        if (options.majorityMode !== undefined) {
            this.majorityMode = options.majorityMode;
        }
    }
}

// Instance singleton
const voting = new VotingSystem();

// Export
export { VotingSystem, voting };
export default voting;