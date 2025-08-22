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
const modStreamerChatvStreamerChat = (gameMode === 'streamerVstreamer');

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
    // Écouter les changements de radio button
    $('input[name="gameMode"]').on('change', function() {
        toggleGameModeElements();
    });
        // Écouter les changements de radio button
    $('input[name="timerMode"]').on('change', function() {
        toggleTimeModeElements();
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