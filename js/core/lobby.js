/**
 * LOBBY MODULE
 * Inscriptions au chat ("join") puis liste des joueurs autorisés à voter.
 *
 * Formats :
 *  - vsStreamer : les inscrits jouent contre le streamer, dans la couleur qu'il leur laisse
 *  - teams      : les inscrits sont répartis au hasard entre Blancs et Noirs
 *  - multi      : les inscrits de la chaîne jouent la couleur de cette chaîne
 *  - vsBot      : les inscrits jouent contre Stockfish (gameEngine.vsBot), dans la couleur choisie
 *
 * Le streamer peut retirer ou ajouter un joueur à tout moment, partie comprise.
 * Le chat peut aussi taper join pendant la partie : l'inscrit rejoint son camp
 * (en format teams, l'équipe la moins nombreuse).
 */

const JOIN_COMMAND = /^!?(join|rejoindre)$/i;

export function normalizeLogin(name) {
    return String(name || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

class Lobby {
    constructor() {
        this.active   = false;     // Une session avec liste de joueurs est en cours
        this.open     = false;     // Les inscriptions sont ouvertes
        this.format   = null;
        this.channel  = null;      // Seuls les messages de cette chaîne comptent
        this.color    = null;      // Couleur des inscrits, sauf en format teams ('w' ou 'b')
        this.streamer = null;
        this.players  = new Map(); // login → { name, team }
        this.kicked   = new Set();
        this.checking = new Set(); // Logins en cours de vérification par verifyJoin

        this.isEligible = null;    // (tags) => bool, filtre subs de Twitch
        this.verifyJoin = null;    // (tags) => Promise<bool>, filtre followers (appel à Twitch)
        this.onChange   = null;
        this.onLateJoin = null;    // (player) => void, inscription pendant la partie
    }

    start({ format, channel, streamer = null, color = null, isEligible = null, verifyJoin = null, onChange = null, onLateJoin = null }) {
        this.active     = true;
        this.open       = true;
        this.format     = format;
        this.channel    = normalizeLogin(channel);
        this.streamer   = normalizeLogin(streamer);
        this.color      = color;
        this.isEligible = isEligible;
        this.verifyJoin = verifyJoin;
        this.onChange   = onChange;
        this.onLateJoin = onLateJoin;
        this.players.clear();
        this.kicked.clear();
        this.checking.clear();
        this.notify();
    }

    /** Message du chat Twitch : seul "join" ou "!join" a un effet, inscriptions ouvertes ou partie en cours */
    handleMessage({ channel, username, displayName, message, tags }) {
        if (!this.active || !JOIN_COMMAND.test(String(message).trim())) return false;
        if (normalizeLogin(channel) !== this.channel) return false;
        if (this.isEligible && !this.isEligible(tags)) return false;

        const login = normalizeLogin(username);
        if (this.kicked.has(login) || this.players.has(login)) return false;
        // Contre le streamer, le streamer ne peut pas aussi voter pour le camp adverse
        if (this.format === 'vsStreamer' && login === this.streamer) return false;

        const name = displayName || username;
        if (!this.verifyJoin) {
            this.register(login, name);
            return true;
        }
        if (this.checking.has(login)) return false;
        this.checking.add(login);
        this.verifyJoin(tags).then(allowed => {
            this.checking.delete(login);
            // La session a pu s'arrêter et le streamer a pu trancher pendant la vérification
            if (allowed && this.active && !this.kicked.has(login) && !this.players.has(login)) {
                this.register(login, name);
            }
        });
        return false;
    }

    register(login, name) {
        const player = { name, team: this.defaultTeam() };
        this.players.set(login, player);
        this.notify();
        if (!this.open) this.onLateJoin?.({ login, ...player });
    }

    /** L'équipe d'un inscrit. En format teams : tirage à la clôture, puis l'équipe la moins nombreuse */
    defaultTeam() {
        if (this.format !== 'teams') return this.color;
        return this.open ? null : this.smallestTeam();
    }

    /** Ferme les inscriptions et répartit les équipes */
    close() {
        this.open = false;
        if (this.format === 'teams') {
            const logins = [...this.players.keys()];
            for (let i = logins.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [logins[i], logins[j]] = [logins[j], logins[i]];
            }
            logins.forEach((login, i) => {
                this.players.get(login).team = i % 2 === 0 ? 'w' : 'b';
            });
        }
        this.notify();
    }

    /** Un joueur peut voter si son équipe correspond au trait */
    canVote(username, turn) {
        return this.players.get(normalizeLogin(username))?.team === turn;
    }

    kick(login) {
        login = normalizeLogin(login);
        if (!this.players.delete(login)) return false;
        this.kicked.add(login);
        this.notify();
        return true;
    }

    /** Ajout manuel par le streamer : annule aussi un kick précédent */
    add(name, team = null) {
        const login = normalizeLogin(name);
        if (login.length < 2) return false;
        this.kicked.delete(login);
        const assigned = team || this.defaultTeam() || this.smallestTeam();
        this.players.set(login, { name: login, team: this.open && this.format === 'teams' ? null : assigned });
        this.notify();
        return true;
    }

    smallestTeam() {
        return this.getPlayers('w').length <= this.getPlayers('b').length ? 'w' : 'b';
    }

    /** Liste triée des joueurs, éventuellement limitée à une équipe */
    getPlayers(team) {
        return [...this.players.entries()]
            .map(([login, player]) => ({ login, ...player }))
            .filter(player => team === undefined || player.team === team)
            .sort((p1, p2) => p1.login.localeCompare(p2.login));
    }

    notify() {
        if (this.onChange) this.onChange(this);
    }
}

const lobby = new Lobby();

export { Lobby, lobby };
export default lobby;
