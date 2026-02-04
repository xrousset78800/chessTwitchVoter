/**
 * PHANTOM TWITCHESS - Phantom Manager
 * Gestion de la connexion BLE et communication avec le Phantom Chess Board
 */

class PhantomManager {
    constructor() {
        // UUIDs Bluetooth
        this.SERVICE_UUID = 'fd31a840-22e7-11eb-adc1-0242ac120002';
        this.UUID_GAME = 'cc68a66e-3bfa-4614-a77f-f46954a4c103';
        this.UUID_MECHANISM_SPEED = 'acb646cc-92ca-11ee-b9d1-0242ac120002';
        this.UUID_SOUND_SETTINGS = 'acb64a32-92ca-11ee-b9d1-0242ac120002';
        this.UUID_BATTERY = '7b204548-40c4-11eb-adc1-0242ac120002';

        // OpCodes
        this.OP_CODES = {
            GAME_START: 0,
            GAME_END: 1,
            MOVEMENT: 2,
            MOVEMENT_VERIFY: 3,
            VOICE_COMMAND: 4,
            TAKE_BACK: 5,
            BOARD_STATE: 6,
            CALIBRATION: 7,
            ERROR_MSG: 8,
            CHECK_SOUND: 9,
            SIDE: 10,
            GAME_ASSISTANCE: 11,
            BLE_MOVE_DONE: 12,
            SNAPTOCENTERCOM: 13,
            RESET_DETECTION: 14
        };

        // État
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristics = {};
        this.isConnected = false;
        this.enabled = true;
        this.lastFenSent = null;

        // File d'attente des mouvements
        this.moveQueue = [];
        this.isMoving = false;
        this.moveDoneResolver = null;
        this.moveTimeout = null;
        this.MOVE_TIMEOUT_MS = 30000;

        // Settings
        this.settings = {
            autoSync: true,
            autoCastling: true,
            autoEnPassant: true,
            snapToCenter: true,
            autoCorrect: true,
            speed: 3
        };

        // Battery
        this.battery = null;

        // Callbacks
        this.onConnectionChange = null;
        this.onBatteryUpdate = null;
        this.onMoveDone = null;
        this.onError = null;
    }

    /**
     * Vérifie si le Bluetooth est supporté
     */
    isSupported() {
        return !!navigator.bluetooth;
    }

    /**
     * Connexion au Phantom
     */
    async connect() {
        if (!this.isSupported()) {
            throw new Error(window.i18n?.t('errors.bluetoothNotSupported') || 'Bluetooth not supported');
        }

        try {
            this.log('🔍 Recherche du Phantom...');

            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Phantom' }],
                optionalServices: [this.SERVICE_UUID]
            });

            this.device.addEventListener('gattserverdisconnected', () => {
                this.handleDisconnect();
            });

            this.log(`🔗 Connexion à ${this.device.name}...`);

            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);

            // Get main characteristic
            this.characteristics.game = await this.service.getCharacteristic(this.UUID_GAME);

            // Subscribe to notifications
            await this.characteristics.game.startNotifications();
            this.characteristics.game.addEventListener('characteristicvaluechanged', 
                this.handleNotification.bind(this));

            // Try to get other characteristics
            try {
                this.characteristics.speed = await this.service.getCharacteristic(this.UUID_MECHANISM_SPEED);
                this.characteristics.battery = await this.service.getCharacteristic(this.UUID_BATTERY);
            } catch (e) {
                this.log('⚠️ Certaines caractéristiques non disponibles');
            }

            this.isConnected = true;
            this.log(`✅ Connecté à ${this.device.name}`);

            // Read initial values
            await this.readInitialValues();

            // Save for reconnection
            window.storage?.set('phantom_device', this.device.name);

            // Notify
            if (this.onConnectionChange) this.onConnectionChange(true);
            window.dispatchEvent(new CustomEvent('phantomConnected', { detail: { device: this.device.name } }));

            return true;
        } catch (error) {
            this.log(`❌ Erreur: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Déconnexion
     */
    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
        this.handleDisconnect();
    }

    /**
     * Gestion de la déconnexion
     */
    handleDisconnect() {
        this.isConnected = false;
        this.isMoving = false;
        this.moveQueue = [];
        this.hideIndicator();
        
        window.storage?.remove('phantom_device');
        
        if (this.onConnectionChange) this.onConnectionChange(false);
        window.dispatchEvent(new CustomEvent('phantomDisconnected'));
        
        this.log('🔌 Déconnecté');
    }

    /**
     * Lecture des valeurs initiales
     */
    async readInitialValues() {
        // Battery
        if (this.characteristics.battery) {
            try {
                const value = await this.characteristics.battery.readValue();
                this.battery = new TextDecoder().decode(value);
                if (this.onBatteryUpdate) this.onBatteryUpdate(this.battery);
            } catch (e) {
                this.log('Batterie non disponible');
            }
        }

        // Speed
        if (this.characteristics.speed) {
            try {
                const value = await this.characteristics.speed.readValue();
                this.settings.speed = parseInt(new TextDecoder().decode(value)) || 3;
            } catch (e) {
                this.log('Vitesse non disponible');
            }
        }
    }

    /**
     * Gestion des notifications BLE
     */
    handleNotification(event) {
        const value = event.target.value;
        const bytes = new Uint8Array(value.buffer);
        const opCode = bytes[0];
        
        try {
            const decoder = new TextDecoder('utf-8');
            const dataStr = decoder.decode(value).substring(1);

            // BLE_MOVE_DONE - Mouvement terminé
            if (opCode === this.OP_CODES.BLE_MOVE_DONE) {
                this.log('✅ Mouvement terminé');
                
                if (this.moveTimeout) {
                    clearTimeout(this.moveTimeout);
                    this.moveTimeout = null;
                }
                
                if (this.moveDoneResolver) {
                    const resolver = this.moveDoneResolver;
                    this.moveDoneResolver = null;
                    resolver();
                }
                
                if (this.onMoveDone) this.onMoveDone();
            }

            // ERROR_MSG
            if (opCode === this.OP_CODES.ERROR_MSG) {
                this.log(`⚠️ Message: ${dataStr}`, 'warn');
                if (this.onError) this.onError(dataStr);
            }

        } catch (e) {
            this.log(`Erreur parsing notification: ${e.message}`, 'error');
        }
    }

    /**
     * Envoi d'une commande au Phantom
     */
    async sendCommand(opCode, data = '') {
        if (!this.characteristics.game) {
            this.log('❌ Non connecté', 'error');
            return false;
        }

        try {
            const encoder = new TextEncoder();
            const dataBytes = encoder.encode(data);
            const command = new Uint8Array([opCode, ...dataBytes]);
            
            await this.characteristics.game.writeValue(command);
            this.log(`📤 [OpCode ${opCode}] ${data.length > 50 ? data.substring(0, 50) + '...' : data}`);
            return true;
        } catch (error) {
            this.log(`❌ Erreur envoi: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Conversion FEN vers matrice 10x10 (avec rotation 90° horaire)
     */
    fenToMatrix(fen) {
        const position = fen.split(' ')[0];
        const rows = position.split('/');
        
        // Parser le FEN en tableau 8x8
        const board = [];
        for (const row of rows) {
            let boardRow = '';
            for (const char of row) {
                if (/\d/.test(char)) {
                    boardRow += '.'.repeat(parseInt(char));
                } else {
                    boardRow += char;
                }
            }
            board.push(boardRow.padEnd(8, '.'));
        }
        
        // ROTATION 90° HORAIRE pour le Phantom
        // Chaque colonne du FEN devient une ligne de la matrice
        const rotated = [];
        for (let col = 0; col < 8; col++) {
            let newRow = '';
            for (let row = 0; row < 8; row++) {
                newRow += board[row][col];
            }
            rotated.push(newRow);
        }
        
        // Construire la matrice 10x10 avec bordures (cimetière)
        let matrix = '..........'; // Première ligne
        for (const row of rotated) {
            matrix += '.' + row + '.';
        }
        matrix += '..........'; // Dernière ligne
        
        return matrix;
    }

    /**
     * Synchronise la position avec le Phantom
     */
    async syncPosition(fen) {
        if (!this.isConnected || !this.enabled) return;

        // Ajouter à la file d'attente
        this.moveQueue.push(fen);
        
        // Traiter si pas déjà en cours
        if (!this.isMoving) {
            this.processQueue();
        }
    }

    /**
     * Traitement de la file d'attente
     */
    async processQueue() {
        if (this.moveQueue.length === 0) {
            this.isMoving = false;
            this.hideIndicator();
            return;
        }

        this.isMoving = true;
        const fen = this.moveQueue.shift();
        const remaining = this.moveQueue.length;

        this.showIndicator(remaining + 1);

        try {
            await this.syncPositionAndWait(fen);
        } catch (error) {
            this.log(`❌ Erreur mouvement: ${error.message}`, 'error');
        }

        // Délai entre les mouvements
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Prochain coup
        this.processQueue();
    }

    /**
     * Sync et attend BLE_MOVE_DONE
     */
    async syncPositionAndWait(fen) {
        return new Promise(async (resolve, reject) => {
            this.moveDoneResolver = resolve;

            // Timeout de sécurité
            this.moveTimeout = setTimeout(() => {
                this.log('⚠️ Timeout mouvement', 'warn');
                this.moveDoneResolver = null;
                resolve();
            }, this.MOVE_TIMEOUT_MS);

            try {
                const matrix = this.fenToMatrix(fen);
                const fenParts = fen.split(' ');
                const colorToPlay = (fenParts[1] === 'b') ? 'B' : 'W';

                // Envoyer GAME_START
                await this.sendCommand(this.OP_CODES.GAME_START, matrix + ',' + colorToPlay);

                // Attendre puis envoyer SIDE
                await new Promise(r => setTimeout(r, 300));
                await this.sendCommand(this.OP_CODES.SIDE, '2');

                this.lastFenSent = fen;
            } catch (error) {
                clearTimeout(this.moveTimeout);
                this.moveDoneResolver = null;
                reject(error);
            }
        });
    }

    /**
     * Envoyer GAME_END
     */
    async sendGameEnd() {
        return await this.sendCommand(this.OP_CODES.GAME_END, '');
    }

    /**
     * Envoyer TAKE_BACK
     */
    async sendTakeBack(count = 1) {
        return await this.sendCommand(this.OP_CODES.TAKE_BACK, count.toString());
    }

    /**
     * Calibration
     */
    async calibrate() {
        return await this.sendCommand(this.OP_CODES.CALIBRATION, '');
    }

    /**
     * Définir la vitesse du mécanisme (1-5)
     */
    async setSpeed(speed) {
        if (!this.characteristics.speed) return false;
        
        try {
            const value = new TextEncoder().encode(speed.toString());
            await this.characteristics.speed.writeValue(value);
            this.settings.speed = speed;
            this.log(`⚡ Vitesse: ${speed}`);
            return true;
        } catch (error) {
            this.log(`❌ Erreur vitesse: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Lire la vitesse actuelle
     */
    async getSpeed() {
        if (!this.characteristics.speed) return this.settings.speed;
        
        try {
            const value = await this.characteristics.speed.readValue();
            this.settings.speed = parseInt(new TextDecoder().decode(value)) || 3;
            return this.settings.speed;
        } catch (error) {
            return this.settings.speed;
        }
    }

    /**
     * Afficher l'indicateur soft (non bloquant)
     */
    showIndicator(queueLength = 1) {
        let indicator = document.getElementById('phantom-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'phantom-indicator';
            indicator.className = 'phantom-indicator';
            indicator.innerHTML = `
                <div class="phantom-indicator__spinner"></div>
                <span class="phantom-indicator__text"></span>
                <span class="phantom-indicator__queue"></span>
            `;
            document.body.appendChild(indicator);
        }

        const text = indicator.querySelector('.phantom-indicator__text');
        const queue = indicator.querySelector('.phantom-indicator__queue');
        
        text.textContent = window.i18n?.t('phantom.moving') || 'Déplacement en cours...';
        
        if (queueLength > 1) {
            queue.textContent = `+${queueLength - 1}`;
            queue.style.display = 'block';
        } else {
            queue.style.display = 'none';
        }

        indicator.classList.add('is-visible');
    }

    /**
     * Masquer l'indicateur
     */
    hideIndicator() {
        const indicator = document.getElementById('phantom-indicator');
        if (indicator) {
            indicator.classList.remove('is-visible');
        }
    }

    /**
     * Vérifie si le Phantom est occupé
     */
    isBusy() {
        return this.isMoving || this.moveQueue.length > 0;
    }

    /**
     * Log avec préfixe
     */
    log(message, level = 'info') {
        const prefix = '[Phantom]';
        switch (level) {
            case 'error':
                console.error(prefix, message);
                break;
            case 'warn':
                console.warn(prefix, message);
                break;
            default:
                console.log(prefix, message);
        }
    }

    /**
     * Active/désactive la synchronisation
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.moveQueue = [];
            this.isMoving = false;
            this.hideIndicator();
        }
    }
}

// Create global instance
window.phantom = new PhantomManager();

export default window.phantom;
