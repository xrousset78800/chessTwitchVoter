/**
 * MOVES.JS - Gestion des mouvements d'échecs
 */

export class MovesManager {
    constructor() {
        this.moveHistory = [];
        this.currentIndex = -1;
        this.variations = new Map();
        this.comments = new Map();
        this.annotations = new Map();
        this.times = new Map();
    }

    /**
     * Ajoute un coup à l'historique
     */
    addMove(move, options = {}) {
        // Si on n'est pas à la fin de l'historique, créer une variation
        if (this.currentIndex < this.moveHistory.length - 1) {
            this.createVariation(move);
        }
        
        // Créer l'objet move complet
        const fullMove = {
            ...move,
            timestamp: Date.now(),
            moveNumber: Math.floor((this.currentIndex + 2) / 2),
            isWhite: (this.currentIndex + 1) % 2 === 0,
            time: options.time || null,
            evaluation: options.evaluation || null
        };
        
        // Ajouter à l'historique
        this.moveHistory.push(fullMove);
        this.currentIndex++;
        
        // Ajouter les métadonnées
        if (options.comment) {
            this.addComment(this.currentIndex, options.comment);
        }
        
        if (options.annotation) {
            this.addAnnotation(this.currentIndex, options.annotation);
        }
        
        if (options.time) {
            this.times.set(this.currentIndex, options.time);
        }
        
        return fullMove;
    }

    /**
     * Crée une variation
     */
    createVariation(move) {
        const variationPoint = this.currentIndex;
        
        if (!this.variations.has(variationPoint)) {
            this.variations.set(variationPoint, []);
        }
        
        // Sauvegarder la ligne principale actuelle comme variation
        const mainLine = this.moveHistory.slice(variationPoint + 1);
        this.variations.get(variationPoint).push({
            moves: mainLine,
            comment: 'Ligne principale'
        });
        
        // Tronquer l'historique
        this.moveHistory = this.moveHistory.slice(0, variationPoint + 1);
    }

    /**
     * Ajoute un commentaire
     */
    addComment(index, comment) {
        this.comments.set(index, comment);
    }

    /**
     * Ajoute une annotation (!, ?, !!, ??, !?, ?!)
     */
    addAnnotation(index, annotation) {
        const validAnnotations = ['!', '?', '!!', '??', '!?', '?!'];
        if (validAnnotations.includes(annotation)) {
            this.annotations.set(index, annotation);
        }
    }

    /**
     * Navigue vers un coup
     */
    goToMove(index) {
        if (index >= -1 && index < this.moveHistory.length) {
            this.currentIndex = index;
            return this.getCurrentPosition();
        }
        return null;
    }

    /**
     * Va au coup précédent
     */
    previous() {
        return this.goToMove(this.currentIndex - 1);
    }

    /**
     * Va au coup suivant
     */
    next() {
        return this.goToMove(this.currentIndex + 1);
    }

    /**
     * Va au début
     */
    first() {
        return this.goToMove(-1);
    }

    /**
     * Va à la fin
     */
    last() {
        return this.goToMove(this.moveHistory.length - 1);
    }

    /**
     * Obtient la position actuelle
     */
    getCurrentPosition() {
        if (this.currentIndex === -1) {
            return null; // Position de départ
        }
        return this.moveHistory[this.currentIndex];
    }

    /**
     * Obtient tous les coups jusqu'à la position actuelle
     */
    getMovesToCurrent() {
        return this.moveHistory.slice(0, this.currentIndex + 1);
    }

    /**
     * Obtient l'historique complet
     */
    getHistory() {
        return [...this.moveHistory];
    }

    /**
     * Obtient les variations pour une position
     */
    getVariations(index = this.currentIndex) {
        return this.variations.get(index) || [];
    }

    /**
     * Efface l'historique
     */
    clear() {
        this.moveHistory = [];
        this.currentIndex = -1;
        this.variations.clear();
        this.comments.clear();
        this.annotations.clear();
        this.times.clear();
    }

    /**
     * Convertit en notation PGN
     */
    toPGN(headers = {}) {
        let pgn = '';
        
        // En-têtes
        const defaultHeaders = {
            Event: '?',
            Site: '?',
            Date: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
            Round: '?',
            White: '?',
            Black: '?',
            Result: '*'
        };
        
        const allHeaders = { ...defaultHeaders, ...headers };
        
        for (const [key, value] of Object.entries(allHeaders)) {
            pgn += `[${key} "${value}"]\n`;
        }
        
        pgn += '\n';
        
        // Coups
        this.moveHistory.forEach((move, index) => {
            // Numéro du coup
            if (index % 2 === 0) {
                pgn += `${Math.floor(index / 2) + 1}. `;
            }
            
            // Coup
            pgn += move.san;
            
            // Annotation
            const annotation = this.annotations.get(index);
            if (annotation) {
                pgn += annotation;
            }
            
            // Commentaire
            const comment = this.comments.get(index);
            if (comment) {
                pgn += ` {${comment}}`;
            }
            
            pgn += ' ';
            
            // Variations
            const variations = this.variations.get(index);
            if (variations && variations.length > 0) {
                variations.forEach(variation => {
                    pgn += `(${this.variationToPGN(variation)}) `;
                });
            }
        });
        
        // Résultat
        pgn += allHeaders.Result;
        
        return pgn;
    }

    /**
     * Convertit une variation en PGN
     */
    variationToPGN(variation) {
        return variation.moves.map((move, index) => {
            let moveStr = '';
            if (index % 2 === 0) {
                moveStr += `${Math.floor(index / 2) + 1}. `;
            }
            moveStr += move.san;
            return moveStr;
        }).join(' ');
    }

    /**
     * Importe depuis PGN
     */
    fromPGN(pgn) {
        // Parser simple (pour une implémentation complète, utiliser une lib)
        this.clear();
        
        // Extraire les headers
        const headerRegex = /\[(\w+)\s+"([^"]+)"\]/g;
        const headers = {};
        let match;
        
        while ((match = headerRegex.exec(pgn)) !== null) {
            headers[match[1]] = match[2];
        }
        
        // Extraire les coups (simplifié)
        const movesSection = pgn.replace(/\[.*?\]/g, '').trim();
        const moveRegex = /\d+\.?\s*([^\s]+)/g;
        
        while ((match = moveRegex.exec(movesSection)) !== null) {
            // Ici on devrait parser correctement le SAN
            // Pour l'instant, on stocke juste la notation
            this.addMove({ san: match[1] });
        }
        
        return headers;
    }

    /**
     * Obtient les statistiques
     */
    getStatistics() {
        const stats = {
            totalMoves: this.moveHistory.length,
            whiteMoves: 0,
            blackMoves: 0,
            captures: 0,
            castles: 0,
            checks: 0,
            promotions: 0,
            averageTime: 0,
            pieces: {
                pawn: 0,
                knight: 0,
                bishop: 0,
                rook: 0,
                queen: 0,
                king: 0
            }
        };
        
        let totalTime = 0;
        let timeCount = 0;
        
        this.moveHistory.forEach((move, index) => {
            // Couleur
            if (move.isWhite) {
                stats.whiteMoves++;
            } else {
                stats.blackMoves++;
            }
            
            // Type de coup
            if (move.captured) stats.captures++;
            if (move.san.includes('O-O')) stats.castles++;
            if (move.san.includes('+')) stats.checks++;
            if (move.promotion) stats.promotions++;
            
            // Pièce
            const piece = move.piece || 'p';
            switch (piece.toLowerCase()) {
                case 'p': stats.pieces.pawn++; break;
                case 'n': stats.pieces.knight++; break;
                case 'b': stats.pieces.bishop++; break;
                case 'r': stats.pieces.rook++; break;
                case 'q': stats.pieces.queen++; break;
                case 'k': stats.pieces.king++; break;
            }
            
            // Temps
            const time = this.times.get(index);
            if (time) {
                totalTime += time;
                timeCount++;
            }
        });
        
        if (timeCount > 0) {
            stats.averageTime = totalTime / timeCount;
        }
        
        return stats;
    }

    /**
     * Trouve les coups critiques
     */
    findCriticalMoves() {
        const critical = [];
        
        this.moveHistory.forEach((move, index) => {
            const annotation = this.annotations.get(index);
            
            // Coups brillants ou erreurs
            if (annotation === '!!' || annotation === '??') {
                critical.push({
                    index,
                    move,
                    annotation,
                    comment: this.comments.get(index)
                });
            }
            
            // Coups avec grande variation d'évaluation
            if (move.evaluation && index > 0) {
                const prevMove = this.moveHistory[index - 1];
                if (prevMove.evaluation) {
                    const diff = Math.abs(move.evaluation - prevMove.evaluation);
                    if (diff > 200) { // 2 pions de différence
                        critical.push({
                            index,
                            move,
                            evaluationChange: diff,
                            comment: this.comments.get(index)
                        });
                    }
                }
            }
        });
        
        return critical;
    }

    /**
     * Exporte l'historique
     */
    export() {
        return {
            moves: this.moveHistory,
            currentIndex: this.currentIndex,
            variations: Array.from(this.variations.entries()),
            comments: Array.from(this.comments.entries()),
            annotations: Array.from(this.annotations.entries()),
            times: Array.from(this.times.entries())
        };
    }

    /**
     * Importe un historique
     */
    import(data) {
        this.moveHistory = data.moves || [];
        this.currentIndex = data.currentIndex || -1;
        this.variations = new Map(data.variations || []);
        this.comments = new Map(data.comments || []);
        this.annotations = new Map(data.annotations || []);
        this.times = new Map(data.times || []);
    }
}