/**
 * CONFIG.JS - VERSION FINALE SANS DOUBLONS
 * Gestion unifiée de tous les toggles : gameMode, timerMode, phantom
 */

// ========== FONCTIONS DE TOGGLE (PATTERN UNIFIÉ) ==========

function toggleGameModeElements() {
    $('div[data-game-mode]').hide();
    const selectedMode = $('input[name="gameMode"]:checked').val();
    if (selectedMode) {
        $('div[data-game-mode="' + selectedMode + '"]').show();
    }
}

function toggleTimeModeElements() {
    $('div[data-time-mode]').hide();
    const timerChecked = $('#timerMode').is(':checked');
    if (timerChecked) {
        $('div[data-time-mode]').show();
    }
}

function togglePhantomPanel() {
    const phantomChecked = $('#phantomChess').is(':checked');
    
    if (phantomChecked) {
        $('#phantomControlPanel').show();
        if (window.phantomChessboard) {
            window.phantomChessboard.setEnabled(true);
        }
    } else {
        $('#phantomControlPanel').hide();
        if (window.phantomChessboard) {
            window.phantomChessboard.setEnabled(false);
        }
    }
}

// ========== INITIALISATION ==========

$(document).ready(function() {
    console.log('🎯 Initialisation config.js...');
    
    // États initiaux
    toggleGameModeElements();
    toggleTimeModeElements();
    togglePhantomPanel();
    
    // ===== LISTENERS =====
    
    // Mode de jeu
    $('input[name="gameMode"]').on('change', function() {
        console.log('Game mode changed:', this.value);
        toggleGameModeElements();
    });
    
    // Mode timer
    $('#timerMode').on('change', function() {
        console.log('Timer mode changed:', this.checked);
        toggleTimeModeElements();
    });
    
    // Mode Phantom
    $('#phantomChess').on('change', function() {
        console.log('Phantom mode changed:', this.checked);
        togglePhantomPanel();
    });
    
    // ===== BOUTONS PHANTOM =====
    
    // Connecter
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
            $('#phantomChess').prop('checked', true);
            togglePhantomPanel();
        }
    });
    
    // Déconnecter
    $('#phantom-disconnect').on('click', async function(e) {
        e.preventDefault();
        console.log('🔌 Déconnexion Phantom...');
        
        if (window.phantomChessboard) {
            await window.phantomChessboard.disconnect();
        }
    });
    
    // Calibrer
    $('#phantom-calibrate').on('click', async function(e) {
        e.preventDefault();
        console.log('🔧 Calibration Phantom...');
        
        if (window.phantomChessboard) {
            await window.phantomChessboard.calibrate();
        }
    });
    
    // Test Sync
    $('#phantom-test').on('click', function(e) {
        e.preventDefault();
        console.log('🧪 Test de synchronisation...');
        
        if (window.phantomChessboard && typeof chess !== 'undefined') {
            window.phantomChessboard.syncPosition(chess.fen());
        } else {
            console.warn('⚠️ Aucune partie en cours pour tester');
            alert('Lancez une partie avant de tester la synchronisation');
        }
    });
    
    // Auto-Sync checkbox
    $('#phantom-auto-sync').on('change', function() {
        const enabled = this.checked;
        console.log(`🔄 Auto-sync ${enabled ? 'activé' : 'désactivé'}`);
        
        if (window.phantomChessboard) {
            window.phantomChessboard.setEnabled(enabled);
        }
    });
    
    // Override updateUI
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
        };
    }
    
    console.log('✅ Config.js initialisé');
});

// ========== RESET AVEC PHANTOM ==========

function resetGameWithPhantom() {
    console.log('🔄 Reset de la partie avec synchronisation Phantom...');
    
    if (typeof chess !== 'undefined') {
        chess.reset();
        console.log('✅ Moteur d\'échecs réinitialisé');
    }
    
    if (typeof board !== 'undefined') {
        board.position('start');
        console.log('✅ Échiquier visuel réinitialisé');
    }
    
    setTimeout(function() {
        if ($('#phantomChess').is(':checked') && 
            window.phantomChessboard && 
            window.phantomChessboard.isConnected) {
            
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
}

// Hook reset après reload
$(document).ready(function() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.toString()) {
        console.log('📄 Configuration détectée, reset automatique dans 1s...');
        setTimeout(resetGameWithPhantom, 1000);
    }
});

/***********************************************************************************************************************/
/************************************************     OMG CONFIG     ***************************************************/
/***********************************************************************************************************************/
$.urlParam = function (name) {
    var results = new RegExp('[\?&]' + name + '=([^&#]*)')
                      .exec(window.location.search);
    return (results !== null) ? results[1] || 0 : false;
}

const defaultChannel = $.urlParam('defaultChannel') ? $.urlParam('defaultChannel') : "";
$("#configForm #defaultChannel").val(defaultChannel);

const probMode = $.urlParam('probMode') == 'on' ? true : false;
if(probMode)
    $("#configForm #probMode:checkbox").attr("checked", "checked");

// MODE DE JEU - Un seul mode actif à la fois
const gameMode = $.urlParam('gameMode') ? $.urlParam('gameMode') : 'normal';
$("#configForm input[name='gameMode'][value='" + gameMode + "']").attr("checked", "checked");

// Variables dérivées pour la compatibilité avec l'ancien code
const mod1vViewers = (gameMode === '1vViewers');
const mod1v1 = (gameMode === '1v1');
const modViewersvViewers = (gameMode === 'viewersVviewers');
const modStreamerChatvStreamerChat = (gameMode === 'modStreamerChatvStreamerChat');

// PARAMÈTRES SPÉCIFIQUES AUX MODES
const mod1vViewersPlayer = $.urlParam('mod1vViewersPlayer') ? $.urlParam('mod1vViewersPlayer') : defaultChannel;
$("#configForm #mod1vViewersPlayer").val(mod1vViewersPlayer);

const oneVsOneModeList0 = $.urlParam('oneVsOneModeList0') ? $.urlParam('oneVsOneModeList0') : defaultChannel;
const oneVsOneModeList1 = $.urlParam('oneVsOneModeList1') ? $.urlParam('oneVsOneModeList1') : "";
$("#configForm #oneVsOneModeList0").val(oneVsOneModeList0);
$("#configForm #oneVsOneModeList1").val(oneVsOneModeList1);

const streamerChatvStreamerChat0 = $.urlParam('streamerChatvStreamerChat0') ? $.urlParam('streamerChatvStreamerChat0') : defaultChannel;
const streamerChatvStreamerChat1 = $.urlParam('streamerChatvStreamerChat1') ? $.urlParam('streamerChatvStreamerChat1') : "";
$("#configForm #streamerChatvStreamerChat0").val(streamerChatvStreamerChat0);
$("#configForm #streamerChatvStreamerChat1").val(streamerChatvStreamerChat1);

// OPTIONS DE TIMER (inchangées)
const timerMode = $.urlParam('timerMode') == 'on' ? true : false;
if(timerMode)
    $("#configForm #timerMode").attr("checked", "checked");

const InitialvoterTimer = $.urlParam('InitialvoterTimer') ? $.urlParam('InitialvoterTimer') : 25;
$("#configForm #InitialvoterTimer").val(InitialvoterTimer);

const pauseAfterWinLose = $.urlParam('pauseAfterWinLose') ? $.urlParam('pauseAfterWinLose') : 15;
$("#configForm #pauseAfterWinLose").val(pauseAfterWinLose);

const timerWheelAnimation = $.urlParam('timerWheelAnimation') ? $.urlParam('timerWheelAnimation') : 5;
$("#configForm #timerWheelAnimation").val(timerWheelAnimation);

// AUTRES OPTIONS (inchangées)
const limitToOneVote = $.urlParam('limitToOneVote') == 'on' ? true : false;
if(limitToOneVote)
    $("#configForm #limitToOneVote").attr("checked", "checked");

const majorityMode = $.urlParam('majorityMode') == 'on' ? true : false;
if(majorityMode)
    $("#configForm #majorityMode").attr("checked", "checked");

const noBg = $.urlParam('noBg') == 'on' ? true : false;
if(noBg)
    $("#configForm #noBg").attr("checked", "checked");

const followMode = $.urlParam('followMode') == 'on' ? true : false;
if(followMode)
	$("#configForm #followMode").attr("checked", "checked");

const subMode = $.urlParam('subMode') == 'on' ? true : false;
if(subMode)
	$("#configForm #subMode").attr("checked", "checked");

const selectedThemesParam = $.urlParam('selectedThemes');
let selectedThemesFromUrl = new Set();

if (selectedThemesParam) {
    try {
        // Les thèmes sont séparés par des virgules dans l'URL
        const themesArray = decodeURIComponent(selectedThemesParam).split(',').filter(t => t.trim());
        selectedThemesFromUrl = new Set(themesArray);
        console.log('🎯 Thèmes récupérés depuis l\'URL:', Array.from(selectedThemesFromUrl));
    } catch (error) {
        console.warn('⚠️ Erreur lors du parsing des thèmes URL:', error);
    }
}
document.addEventListener('DOMContentLoaded', function() {
    const configForm = document.getElementById('configForm');
    
    if (configForm) {
        configForm.addEventListener('submit', function(event) {
            // Ajouter les thèmes sélectionnés juste avant la soumission
            if (typeof selectedThemes !== 'undefined' && selectedThemes.size > 0) {
                const themesString = Array.from(selectedThemes).join(',');
                
                // Créer un champ hidden temporaire pour les thèmes
                let themesInput = document.getElementById('hiddenSelectedThemes');
                if (!themesInput) {
                    themesInput = document.createElement('input');
                    themesInput.type = 'hidden';
                    themesInput.id = 'hiddenSelectedThemes';
                    themesInput.name = 'selectedThemes';
                    configForm.appendChild(themesInput);
                }
                themesInput.value = themesString;
                
                console.log('🎯 Thèmes ajoutés au formulaire:', themesString);
            }
        });
    }
});
function toggleGameModeElements() {
    // Masquer toutes les divs de mode de jeu
    $('div[data-game-mode]').hide();
    
    // Obtenir la valeur du radio button sélectionné
    const selectedMode = $('input[name="gameMode"]:checked').val();
    
    // Afficher seulement la div correspondante
    if (selectedMode) {
        $('div[data-game-mode="' + selectedMode + '"]').toggle(300);
    }
}
function toggleTimeModeElements() {
    // Masquer toutes les divs de mode de jeu
    $('div[data-time-mode]').hide();
    
    // Obtenir la valeur du radio button sélectionné
    const selectedMode = $('input[data-mode]:checked').val();
    
    // Afficher seulement la div correspondante
    if (selectedMode) {
        $('div[data-time-mode]').toggle(300);
    }
}


$(document).ready(function() {
    // Appel initial pour définir l'état correct au chargement
    toggleGameModeElements();
    toggleTimeModeElements();
    togglePhantomPanel();
    // Écouter les changements de radio button
    $('input[name="gameMode"]').on('change', function() {
        toggleGameModeElements();
    });
        // Écouter les changements de radio button
    $('input[name="timerMode"]').on('change', function() {
        toggleTimeModeElements();
    });

    $('#phantomChess').on('change', function() {
        togglePhantomPanel();
    });
    
    $('#phantom-connect').on('click', async function(e) {
        e.preventDefault();
        if (window.phantomChessboard) {
            const connected = await window.phantomChessboard.connect();
            if (connected) {
                $('#phantomChess').prop('checked', true);
                togglePhantomPanel();
            }
        }
    });
});

/*
REFAIRE LA TODO
*/

//- Prévisualiser un coup ?
//- P'tit stockfish pour la barre ?
//- Rejouer le problème (stop restart auto)
//- Css piece d'échec pour le coup (transition + blink)
//- Jouer le problème en entier quand erreur ?
//- vérifier échec et mat (mauvaise détection)
//- bug sur le timer entre les problèmes
//- Possibilité de créer des "teams" (1 ou 2 poll d'inscriptions ?)
//- Améliorer le design un peu dégueu
//- Réflexion sur la connexion (siteweb ? Extension ? Local pour le moment ? WIP)
//- Vérifier certains bugs (notation complexe (Deux pièces concurrentes, sous promotion))
//- Trouver le moyen de connecter 2 streameurs (Ou 2 chats de streameurs) ok ?
//- Meilleurs gestion du temps (pause, affichage, transitions)
//- OMG PHANTOMCHESS !!
//- Faire un mode avec des coups spéciaux. (fou prend sa propre tour = dame)


/***********************************************************************************************************************/
/**********************************     OMG CONFIG     *****************************************************************/
/***********************************************************************************************************************/