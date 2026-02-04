/**
 * PHANTOM-FORM.JS - Gestion du panneau Phantom dans le formulaire
 * Ce fichier doit être chargé APRÈS phantom.js et APRÈS config.js
 */

(function() {
    'use strict';
    
    /**
     * Affiche/masque le panneau de contrôle Phantom selon la checkbox
     */
    function togglePhantomPanel() {
        const phantomCheckbox = document.getElementById('phantomChess');
        const phantomPanel = document.getElementById('phantomControlPanel');
        
        if (!phantomCheckbox || !phantomPanel) {
            console.warn('⚠️ Éléments Phantom non trouvés dans le DOM');
            return;
        }
        
        if (phantomCheckbox.checked) {
            phantomPanel.style.display = 'block';
            console.log('✅ Panneau Phantom affiché');
            
            // Activer la synchronisation si Phantom disponible
            if (window.phantomChessboard) {
                window.phantomChessboard.setEnabled(true);
            }
        } else {
            phantomPanel.style.display = 'none';
            console.log('❌ Panneau Phantom masqué');
            
            // Désactiver la synchronisation
            if (window.phantomChessboard) {
                window.phantomChessboard.setEnabled(false);
            }
        }
    }
    
    /**
     * Initialisation au chargement du DOM
     */
    $(document).ready(function() {
        console.log('🎯 Initialisation Phantom Form...');
        
        // État initial au chargement
        togglePhantomPanel();
        
        // ===== ÉCOUTER LES CHANGEMENTS DE LA CHECKBOX =====
        $('#phantomChess').on('change', function() {
            console.log('Phantom checkbox changed:', this.checked);
            togglePhantomPanel();
        });
        
        // ===== BOUTON CONNECTER =====
        $('#phantom-connect').on('click', async function(e) {
            e.preventDefault();
            console.log('🔗 Tentative de connexion Phantom...');
            
            if (!window.phantomChessboard) {
                console.error('❌ phantomChessboard non disponible');
                alert('Module Phantom non chargé. Vérifiez que phantom.js est bien inclus.');
                return;
            }
            
            const connected = await window.phantomChessboard.connect();
            
            if (connected) {
                console.log('✅ Connexion réussie');
                // Cocher automatiquement la checkbox si connexion réussie
                $('#phantomChess').prop('checked', true);
                togglePhantomPanel();
            } else {
                console.log('❌ Connexion échouée');
            }
        });
        
        // ===== BOUTON DÉCONNECTER =====
        $('#phantom-disconnect').on('click', async function(e) {
            e.preventDefault();
            console.log('🔌 Déconnexion Phantom...');
            
            if (window.phantomChessboard) {
                await window.phantomChessboard.disconnect();
            }
        });
        
        // ===== BOUTON CALIBRER =====
        $('#phantom-calibrate').on('click', async function(e) {
            e.preventDefault();
            console.log('🔧 Calibration Phantom...');
            
            if (window.phantomChessboard) {
                await window.phantomChessboard.calibrate();
            }
        });
        
        // ===== BOUTON TEST SYNC =====
        $('#phantom-test').on('click', function(e) {
            e.preventDefault();
            console.log('🧪 Test de synchronisation...');
            
            if (typeof testPhantomSync === 'function') {
                testPhantomSync();
            } else if (window.phantomChessboard && typeof chess !== 'undefined') {
                window.phantomChessboard.syncPosition(chess.fen());
            } else {
                console.warn('⚠️ Aucune partie en cours pour tester');
                alert('Lancez une partie avant de tester la synchronisation');
            }
        });
        
        // ===== CHECKBOX AUTO-SYNC =====
        $('#phantom-auto-sync').on('change', function() {
            const enabled = this.checked;
            console.log(`🔄 Auto-sync ${enabled ? 'activé' : 'désactivé'}`);
            
            if (window.phantomChessboard) {
                window.phantomChessboard.setEnabled(enabled);
            }
        });
        
        // ===== OVERRIDE DE LA FONCTION updateUI DU PHANTOM =====
        // Pour utiliser les éléments du formulaire
        if (window.phantomChessboard) {
            window.phantomChessboard.updateUI = function(connected) {
                const statusEl = $('#phantom-status');
                const connectBtn = $('#phantom-connect');
                const disconnectBtn = $('#phantom-disconnect');
                const calibrateBtn = $('#phantom-calibrate');
                const testBtn = $('#phantom-test');
                
                if (statusEl.length) {
                    if (connected) {
                        statusEl.text(`✅ Connecté: ${this.device ? this.device.name : 'Phantom'}`);
                        statusEl.css('background', 'rgba(72, 187, 120, 0.3)');
                    } else {
                        statusEl.text('❌ Déconnecté');
                        statusEl.css('background', 'rgba(244, 67, 54, 0.3)');
                    }
                }
                
                connectBtn.prop('disabled', connected);
                disconnectBtn.prop('disabled', !connected);
                calibrateBtn.prop('disabled', !connected);
                testBtn.prop('disabled', !connected);
                
                console.log(`UI mise à jour: ${connected ? 'Connecté' : 'Déconnecté'}`);
            };
            
            console.log('✅ Override updateUI installé');
        } else {
            console.warn('⚠️ phantomChessboard non disponible pour override updateUI');
        }
        
        console.log('✅ Phantom Form initialisé');
    });
    
    /**
     * Reset de la partie avec synchronisation Phantom
     */
    window.resetGameWithPhantom = function() {
        console.log('🔄 Reset de la partie avec synchronisation Phantom...');
        
        // 1. Reset du moteur d'échecs
        if (typeof chess !== 'undefined') {
            chess.reset();
            console.log('✅ Moteur d\'échecs réinitialisé');
        }
        
        // 2. Reset de l'échiquier visuel
        if (typeof board !== 'undefined') {
            board.position('start');
            console.log('✅ Échiquier visuel réinitialisé');
        }
        
        // 3. Synchronisation avec Phantom (si connecté et activé)
        setTimeout(function() {
            const phantomCheckbox = $('#phantomChess');
            
            if (phantomCheckbox.is(':checked') && 
                window.phantomChessboard && window.phantomChessboard.isConnected) {
                
                const startFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                window.phantomChessboard.syncPosition(startFEN);
                console.log('✅ Phantom synchronisé à la position initiale');
                
                if ($('#phantom-auto-sync').is(':checked')) {
                    window.phantomChessboard.setEnabled(true);
                }
            } else {
                console.log('ℹ️ Phantom non actif, sync ignorée');
            }
        }, 500);
        
        console.log('🎉 Reset complet terminé !');
    };
    
    /**
     * Hook pour appeler reset après le reload de la page
     */
    $(document).ready(function() {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Si on vient de sauvegarder la config (il y a des params dans l'URL)
        if (urlParams.toString()) {
            console.log('📄 Paramètres détectés, reset automatique dans 1s...');
            setTimeout(function() {
                window.resetGameWithPhantom();
            }, 1000);
        }
    });
    
})();