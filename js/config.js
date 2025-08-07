/***********************************************************************************************************************/
/************************************************     OMG CONFIG     ***************************************************/
/***********************************************************************************************************************/
$.urlParam = function (name) {
    var results = new RegExp('[\?&]' + name + '=([^&#]*)')
                      .exec(window.location.search);
    return (results !== null) ? results[1] || 0 : false;
}

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
const mod1vViewersPlayer = $.urlParam('mod1vViewersPlayer') ? $.urlParam('mod1vViewersPlayer') : "Xou____";
$("#configForm #mod1vViewersPlayer").val(mod1vViewersPlayer);

const oneVsOneModeList0 = $.urlParam('oneVsOneModeList0') ? $.urlParam('oneVsOneModeList0') : "Xou____";
const oneVsOneModeList1 = $.urlParam('oneVsOneModeList1') ? $.urlParam('oneVsOneModeList1') : "Xou____";
$("#configForm #oneVsOneModeList0").val(oneVsOneModeList0);
$("#configForm #oneVsOneModeList1").val(oneVsOneModeList1);

const streamerChatvStreamerChat0 = $.urlParam('streamerChatvStreamerChat0') ? $.urlParam('streamerChatvStreamerChat0') : "Xou____";
const streamerChatvStreamerChat1 = $.urlParam('streamerChatvStreamerChat1') ? $.urlParam('streamerChatvStreamerChat1') : "Xou____";
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

const timerMoveBot = $.urlParam('timerMoveBot') ? $.urlParam('timerMoveBot') : 2;
$("#configForm #timerMoveBot").val(timerMoveBot);

const timerMoveText = $.urlParam('timerMoveText') ? $.urlParam('timerMoveText') : 3;
$("#configForm #timerMoveText").val(timerMoveText);

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

//Mode streamer vs viewers - Mode viewers vs viewers ( A tester )
//Prévisualiser un coup
//P'tit stockfish pour la barre ?
//Rejouer le problème (stop restart auto)
//OMG CommuStreamerVsCommuStreamer
// Css piece d'échec pour le coup
// Jouer le problème en entier quand erreur

/***********************************************************************************************************************/
/**********************************     OMG CONFIG     *****************************************************************/
/***********************************************************************************************************************/