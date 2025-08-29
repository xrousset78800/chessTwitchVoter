const appToken = configTwitch.TWITCH_TOKEN;

function getLinkedChannels() {
    let linkedChannels = [];
    
    switch(gameMode) {
        case 'normal':
            // En mode normal (sandbox), utiliser le defaultChannel
            linkedChannels = [defaultChannel];
            break;
            
        case '1vViewers':
            linkedChannels = [mod1vViewersPlayer];
            break;
            
        case '1v1':
            linkedChannels = [oneVsOneModeList0, oneVsOneModeList1].filter(channel => channel && channel.trim() !== '');
            break;
            
        case 'viewersVviewers':
            linkedChannels = [defaultChannel]; // ou la logique appropriée pour ce mode
            break;
            
        case 'modStreamerChatvStreamerChat':
            // Mode Chat vs Chat - on connecte aux deux streamers
            linkedChannels = [streamerChatvStreamerChat0, streamerChatvStreamerChat1];
            break;
            
        default:
            // Fallback sur le defaultChannel
            linkedChannels = [defaultChannel];
    }
    
    // Filtrer les valeurs vides ou nulles
    linkedChannels = linkedChannels.filter(channel => channel && channel.trim() !== '' && channel !== 'PLEASE FILL THIS');
    
    // Si aucun canal valide n'est trouvé, utiliser le defaultChannel comme fallback
    if (linkedChannels.length === 0 && defaultChannel && defaultChannel !== 'PLEASE FILL THIS') {
        linkedChannels = [defaultChannel];
    }
    
    console.log('📺 Channels configurés:', linkedChannels, 'pour le mode:', gameMode);
    return linkedChannels;
}
// ========== ChessboardArrows (version simple) ==========
class ChessboardArrows {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn(`Container ${containerId} not found for ChessboardArrows`);
            return;
        }
        
        this.canvas = document.getElementById('drawing_canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.arrows = [];
        this.circles = [];
    }
    
    clearArrows() {
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.arrows = [];
        this.circles = [];
    }
    
    drawArrow(from, to, color = 'yellow', width = 8) {
        // Implementation basique - peut être étendue plus tard
        console.log(`Drawing arrow from ${from} to ${to}`);
    }
    
    drawCircle(square, color = 'green', filled = false) {
        // Implementation basique - peut être étendue plus tard  
        console.log(`Drawing circle on ${square}`);
    }
}

// Rendre ChessboardArrows disponible globalement
window.ChessboardArrows = ChessboardArrows;
const linkedChannels = getLinkedChannels();

const opts = {
  identity: {
    username: 'chessbot',
    password: 'oauth:'+appToken
  },
  channels: linkedChannels
};

const clickOpts = {
  identity: {
    username: defaultChannel,
  },
  id: 1
};

var problems = null;

var userLang = navigator.language || navigator.userLanguage;

if(userLang !== "fr-FR" && userLang !== "fr" && userLang !== "fr-fr" ) {
	userLang = "en-EN";
}

$("html").attr("data-lang", userLang);

var globalVolume = 1;
var takeAudio = new Audio('mp3/take.mp3');
var checkAudio = new Audio('mp3/check.mp3');
var moveAudio = new Audio('mp3/move.mp3');
var mateAudio = new Audio('mp3/mate.wav');
takeAudio.volume = globalVolume*0.8;
checkAudio.volume = globalVolume*0.8;
moveAudio.volume = globalVolume*0.8;
mateAudio.volume = globalVolume*0.8;

//http-server C:\Users\gnole\Documents\GitHub\chessTwitchVoter

window.multiplayerSocket = null;
window.multiplayerGameId = null;
window.multiplayerRole = null;
window.multiplayerColor = null;

// Détection multiplayer depuis URL
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('game') && urlParams.get('role')) {
    window.multiplayerGameId = urlParams.get('game');
    window.multiplayerRole = urlParams.get('role');
    window.multiplayerColor = (window.multiplayerRole === 'host') ? 'white' : 'black';
    window.modStreamerChatvStreamerChat = true; // Forcer le mode
    console.log(`🎮 Multiplayer: ${window.multiplayerRole} (${window.multiplayerColor})`);
}

var allProblems = [];
var filteredProblems = [];
var selectedThemes = new Set();
var themeStats = {};

function preloadThemesForMenu() {
    console.log('🔄 Préchargement des thèmes pour le menu...');
    
    fetch('js/problemsV2.csv')
        .then(response => response.text())
        .then(data => {
            const lines = data.split("\n").filter(line => line.trim());
            console.log('📁 CSV chargé pour les thèmes:', lines.length, 'lignes');
            
            // Parser le CSV
            const array = lines.map(line => parseCSVLine(line));
            
            // Stocker tous les problèmes (pour le menu)
            allProblems = array.slice(1).filter(row => row.length > 7);
            console.log('✅ Problèmes préchargés pour thèmes:', allProblems.length);
            
            // Charger les thèmes depuis l'URL AVANT d'analyser
            loadSelectedThemesFromUrl();
            
            // Analyser et rendre les thèmes disponibles dans le menu
            analyzeAndRenderThemes();
            
            // Mettre à jour l'affichage
            updateSelectedThemesDisplay();
            updateProblemCount();
            
            console.log('🎨 Thèmes disponibles dans le menu:', Object.keys(themeStats).length);
        })
        .catch(error => {
            console.error("❌ Erreur lors du préchargement des thèmes:", error);
            // En cas d'erreur, afficher un message dans le menu
            const themeListElement = document.getElementById('themeList');
            if (themeListElement) {
                themeListElement.innerHTML = '<div style="text-align: center; color: #ff6b6b;">Erreur de chargement des thèmes</div>';
            }
        });
}

function setupMultiplayerTimerHandlers() {
    if (!window.multiplayerSocket) return;
    
    // Écouter les mises à jour du timer
    window.multiplayerSocket.on('timerUpdate', (data) => {
        voterTimer = data.timeLeft;
        updateTimerDisplay(voterTimer);
    });
    
    // Écouter le début/fin du timer
    window.multiplayerSocket.on('timerStart', (data) => {
        startTimer(data.duration, true);
        voteOpen = true;
    });
    
    window.multiplayerSocket.on('timerStop', () => {
        stopTimer();
        voteOpen = false;
    });
}

function syncTimerWithServer() {
    if (window.multiplayerSocket && window.multiplayerRole === 'host' && voterTimer > 0) {
        window.multiplayerSocket.emit('timerSync', {
            gameId: window.multiplayerGameId,
            timeLeft: voterTimer
        });
    }
}

$(document).ready(function() {
		//addPhantomBridgeControls();

        preloadThemesForMenu();
        updatePageTitle();


    // Si on est en mode multiplayer avec timer
    if (window.multiplayerMode && modStreamerChatvStreamerChat) {
        const checkSocket = setInterval(() => {
            if (window.gameSocket && window.gameSocket.connected) {
                clearInterval(checkSocket);
                setupMultiplayerTimerHandlers();
                
                // Synchronisation périodique du timer (toutes les 5 secondes)
                setInterval(syncTimerWithServer, 5000);
                
                console.log('✅ Handlers timer multiplayer configurés');
                
                // Si c'est le host et c'est le début de partie, démarrer le premier timer
                if (window.multiplayerManager) {
                    const gameInfo = window.multiplayerManager.getGameInfo();
                    if (gameInfo.role === 'host' && chess.turn() === 'w') {
                        console.log('🏁 Host démarre le premier timer');
                        setTimeout(() => {
                            startTimer(InitialvoterTimer, true);
                            voteOpen = true;
                        }, 1000);
                    }
                }
            }
        }, 100);
    }
    console.log('🐍 Phantom Bridge Client initialisé');
});

var colorArray = [
'#f2ff93','#dc90e8','#88e600','#e5c0ff','#01d04b','#ff9cc9','#37ff85','#ffaca6','#08c55c','#ffa837','#85f9ff','#e5c700','#a8d7ff','#84c600','#67b8c3','#fff55e','#01c2a0','#d5a517','#02dbae','#df9f4d','#89ff89','#ffe7dd','#7cbc5f','#ffdfa1','#97ffe0','#a9b174','#bbffa4','#79b8a3','#e6ffcf','#98b391'];

// Create a client with our options
const client = new tmi.client(opts);
var voteOpen = true;
// Register our event handlers (defined below)
client.on('message', onMessageHandler);
//client.on('connected', onConnectedHandler);

// Connect to Twitch:
client.connect();

var teamToPlay = 0;

var prob  = null;
var chess = null;
var moves = null;

var p1 = null;
var p2 = null;

var board = null;

var $board = $('#myBoard')
var squareToHighlight = null
var squareClass = 'square-55d63'
var currentProbPgn = "";

var pollData = [];
var voterTimer = pauseAfterWinLose;

var defaultConfig = {
  orientation: 'white',
  position: 'start',
  moveSpeed: 'slow',
  snapbackSpeed: 500,
  snapSpeed: 100
}

const pieceImages = {};

function preloadPieceImages() {
    const pieces = ['P', 'R', 'N', 'B', 'Q', 'K'];
    const colors = ['w', 'b'];
    
    pieces.forEach(piece => {
        colors.forEach(color => {
            const img = new Image();
            img.src = `./img/chesspieces/wikipedia/${color}${piece}.png`;
            pieceImages[`${color}${piece}`] = img;
        });
    });
}

// Appeler au chargement
preloadPieceImages();

var intervalId = null;


const ctx = document.getElementById('chartPoll').getContext('2d');
const pollChart = new Chart(ctx, {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{
      label: 'Votes',
      data: [],
      backgroundColor: [],
      borderWidth: 0
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: {
        display: false
      }
    },
	  interaction: {
	    intersect: false,
	    mode: 'none' // ← Désactive les hovers
	  },    
	  elements: {
	    bar: {
	      categoryPercentage: 0.3,
	      barPercentage: 0.5
	    }
	  },    
    scales: {
      x: {
        display: false
      },
      y: {
        display: false
      }
    },
    animation: {
		  onProgress: function(animation) {
		    const chart = this;
		    const ctx = chart.ctx;
		    
		    ctx.save();
		    ctx.textAlign = 'center';
		    ctx.textBaseline = 'middle';
		    ctx.fillStyle = 'white';
		    ctx.font = 'bold 16px Arial';
		    
		    // CORRECTION - Utiliser seulement le dataset 0
		    const dataset = chart.data.datasets[0];
		    const meta = chart.getDatasetMeta(0);
		    
		    meta.data.forEach((bar, index) => {
		      const label = chart.data.labels[index];  // ← Maintenant ça devrait marcher !
		      
		      if (label && bar.height > 0) {
		        const yPosition = bar.y + bar.height - 15;
		        ctx.fillText(label, bar.x, yPosition);
		      }
		    });
		    
		    ctx.restore();
		  }
    }
  }
});
function generateTitle() {
    let titleParts = [];
    
    // ========== MODE DE JEU ==========
    switch(gameMode) {
        case 'normal':
            titleParts.push('🎯 Mode Sandbox');
            break;
        case 'probMode':
            titleParts.push('🧩 Mode Problèmes');
            // Ajouter les thèmes sélectionnés si on est en mode problème
            if (selectedThemes && selectedThemes.size > 0) {
                const themesArray = Array.from(selectedThemes);
                if (themesArray.length <= 3) {
                    titleParts.push(`(${themesArray.join(', ')})`);
                } else {
                    titleParts.push(`(${themesArray.slice(0, 2).join(', ')} +${themesArray.length - 2})`);
                }
            }
            break;
        case 'mod1vViewers':
            titleParts.push(`👤 Seul contre tous (${mod1vViewersPlayer})`);
            break;
        case 'mod1v1':
            titleParts.push(`⚔️ Duel (${oneVsOneModeList0} vs ${oneVsOneModeList1})`);
            break;
        case 'modViewersvViewers':
            titleParts.push('👥 Viewers vs Viewers (ID pair/impair)');
            break;
        case 'modStreamerChatvStreamerChat':
            titleParts.push(`🎭 Chat vs Chat (${streamerChatvStreamerChat0} vs ${streamerChatvStreamerChat1})`);
            break;
        default:
            titleParts.push('🎯 Mode par défaut');
    }
    
    // ========== MODE TIMER ==========
    if (timerMode) {
        titleParts.push(`⏱️ Timer ${InitialvoterTimer}s`);
        
        // Sous-options du timer
        let timerOptions = [];
        if (limitToOneVote) {
            timerOptions.push('Vote unique');
        }
        if (majorityMode) {
            timerOptions.push('Majorité');
        } else {
            timerOptions.push('Roue');
        }
        
        if (timerOptions.length > 0) {
            titleParts.push(`(${timerOptions.join(', ')})`);
        }
    } else {
        titleParts.push('🎲 Mode vote libre');
    }
    
    // ========== RESTRICTIONS D'ACCÈS ==========
    let accessRestrictions = [];
    if (followMode) {
        accessRestrictions.push('Followers only');
    }
    if (subMode) {
        accessRestrictions.push('Subs only');
    }
    
    if (accessRestrictions.length > 0) {
        titleParts.push(`🔒 ${accessRestrictions.join(' + ')}`);
    }
    
    // ========== CHANNELS CONNECTÉS ==========
    if (linkedChannels && linkedChannels.length > 1) {
        const channelInfo = linkedChannels.length === 1 
            ? `📺 ${linkedChannels[0]}` 
            : `📺 ${linkedChannels.length} channels`;
        titleParts.push(channelInfo);
    } else {
        titleParts.push(defaultChannel);
    }
    
    // ========== OPTIONS SPÉCIALES ==========
    let specialOptions = [];
    if (noBg) {
        specialOptions.push('No BG');
    }
    
    if (specialOptions.length > 0) {
        titleParts.push(`🎨 ${specialOptions.join(', ')}`);
    }

    return titleParts.join('\n');
}
function updatePageTitle() {
    const title = generateTitle();
    
    // Mettre à jour le titre de la page
    document.title = `Twitchess - ${title}`;
    
    // Mettre à jour un élément de titre si il existe
    const titleElement = document.getElementById('gameTitle');
    if (titleElement) {
        titleElement.textContent = title;
    }
    
    // Mettre à jour un élément de statut si il existe
    const statusElement = document.getElementById('gameStatus');
    if (statusElement) {
        statusElement.innerHTML = `<strong>Configuration actuelle:</strong> ${title}`;
    }
    
    console.log('📋 Titre généré:', title);
    return title;
}

//Start new game
if(noBg) {
	$("body").addClass("noBg");
}

var overlay = new ChessboardArrows('board_wrapper');


function initializeGame() {
    return gameMode === "probMode" ? loadNewProblem() : loadNewgame();
}

initializeGame();

if (window.multiplayerGameId) {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = function() {
        window.multiplayerSocket = io();
        
        // Rejoindre la partie
        window.multiplayerSocket.emit('reconnectGame', {
            gameId: window.multiplayerGameId,
            role: window.multiplayerRole
        });
        
        // Réception des coups
        window.multiplayerSocket.on('movePlayed', (data) => {
            if (data.player !== window.multiplayerColor) {
                console.log(`📥 Coup reçu: ${data.move}`);
                moveAction(data.move, true); // true = coup réseau
            }
        });
        
        console.log('✅ Socket.IO connecté');
    };
    script.onerror = function() {
        console.error('❌ Erreur chargement Socket.IO - Vérifiez que le serveur Node.js est lancé');
    };
    document.head.appendChild(script);
}
/***********************************************************************************************************************/
/**********************************     OMG Voter     *****************************************************************/
/***********************************************************************************************************************/


function loadNewgame() {
    chess = new Chess();
    let vs = "";
    
    if(mod1v1) {
        p1 = oneVsOneModeList0;
        p2 = oneVsOneModeList1;
        
    } else if(modViewersvViewers) {
        p1 = "viewers W";
        p2 = "viewers B";
    }
    else if(mod1vViewers) {
        p1 = mod1vViewersPlayer;
        p2 = "viewers";     
    } else if (modStreamerChatvStreamerChat && window.multiplayerColor) {
        // Utiliser directement window.playerColor défini par multi.js
        if (window.multiplayerColor  === 'black') {
            defaultConfig.orientation = 'black';
            teamToPlay = 1;
        } else {
            defaultConfig.orientation = 'white';
            teamToPlay = 0;
        }
        console.log(`🎮 Orientation: ${defaultConfig.orientation} pour ${window.playerColor}`);
    } else {
        p1 = "*";
        p2 = "*";
    }
    vs = " - "+p1+" vs "+p2;

if (gameMode === "probMode") {
    // Mode problème : ne pas toucher
    if(chess.turn() == 'b') {
        defaultConfig.orientation = 'white';
    } else {
        defaultConfig.orientation = 'black';
    }
} else if (modStreamerChatvStreamerChat && window.multiplayerColor) {
    // Mode multiplayer avec orientation fixe
    defaultConfig.orientation = window.multiplayerColor;
    teamToPlay = (window.multiplayerColor === 'white') ? 0 : 1;
    console.log(`🎮 Multiplayer orientation: ${defaultConfig.orientation}`);
} else {
    // Autres modes : orientation normale
    defaultConfig.orientation = 'white';
    teamToPlay = 0;
}

    if(timerMode == true) {
        startTimer(InitialvoterTimer, true);
    }

    refreshBoard(chess);
    board = Chessboard('myBoard', defaultConfig);
    //var overlay = new ChessboardArrows('board_wrapper');

    var moves = chess.moves();
    
    // Log pour debug
    console.log(`🎯 Nouvelle partie: ${vs}`);
    console.log(`📋 Orientation: ${defaultConfig.orientation}, Team: ${teamToPlay}`);
}

// BONUS: Fonction helper pour obtenir les informations des équipes en mode multiplayer
function getMultiplayerTeamInfo() {
    if (!window.multiplayerManager || !modStreamerChatvStreamerChat) {
        return null;
    }
    
    const gameInfo = window.multiplayerManager.getGameInfo();
    
    return {
        isHost: gameInfo.role === 'host',
        isGuest: gameInfo.role === 'guest',
        myColor: window.playerColor,
        myStreamer: gameInfo.streamerName,
        orientation: defaultConfig.orientation
    };
}

function loadNewProblem() {
    console.log('🔄 Chargement d\'un nouveau problème...');
    console.log('🎯 Thèmes sélectionnés:', Array.from(selectedThemes));
    
    // Si les problèmes ne sont pas encore chargés, les charger
    if (allProblems.length === 0) {
        console.log('📁 Problèmes pas encore chargés, chargement...');
        
        fetch('js/problemsV2.csv')
            .then(response => response.text())
            .then(data => {
                const lines = data.split("\n").filter(line => line.trim());
                const array = lines.map(line => parseCSVLine(line));
                allProblems = array.slice(1).filter(row => row.length > 7);
                console.log('✅ Problèmes chargés:', allProblems.length);
                
                // Analyser les thèmes si ce n'est pas déjà fait
                if (Object.keys(themeStats).length === 0) {
                    loadSelectedThemesFromUrl();
                    analyzeAndRenderThemes();
                    updateSelectedThemesDisplay();
                    updateProblemCount();
                }
                
                // Continuer avec la sélection du problème
                selectAndLoadProblem();
            })
            .catch(error => console.error("❌ Erreur lors du chargement:", error));
    } else {
        // Les problèmes sont déjà chargés, directement sélectionner
        console.log('✅ Problèmes déjà en mémoire, sélection directe');
        selectAndLoadProblem();
    }
}

function selectAndLoadProblem() {
    $('.poll ol').empty();
    poll = [];
    
    // CORRECTIF : Détruire l'ancien échiquier s'il existe
    if (typeof board !== 'undefined' && board && board.destroy) {
        board.destroy();
        board = null;
    }
    
    // CORRECTIF : Détruire l'ancien objet chess s'il existe  
    if (typeof chess !== 'undefined' && chess) {
        chess = null;
    }
    
    // LOGIC DE FILTRAGE
    let problemsToUse = getFilteredProblems();
    console.log('🎲 Problèmes après filtrage:', problemsToUse.length);
    
    if (problemsToUse.length === 0) {
        console.warn('⚠️ Aucun problème ne correspond aux filtres, utilisation de tous les problèmes');
        problemsToUse = allProblems;
    }
    
    let firstMove = "";
    
    // SÉLECTION ALÉATOIRE DANS LES PROBLÈMES FILTRÉS
    prob = problemsToUse[Math.floor(Math.random() * problemsToUse.length)];
    
    console.log('🎯 Problème sélectionné:', prob[0], 'avec thèmes:', prob[7]);

    currentProbPgn = prob[1];
    
    // CORRECTIF : Créer un nouvel objet chess propre
    chess = new Chess(prob[1]);
    
    defaultConfig.position = prob[1];
    teamToPlay = 0;

    if(chess.turn() == 'b') {
        defaultConfig.orientation='white';
    } else {
        defaultConfig.orientation='black';
    }

    $("[data-opening-tags]").text(prob[7] || '');
    $("[data-prob-elo]").text(prob[3] || 'N/A');
    $("[data-fen]").text(prob[1]);
    
    $("[data-omgSolution]").text(prob[2]);
    $("[data-attempt]").attr("data-attempt", 0);
    $("[data-length]").attr('data-length', prob[2].split(" ").length);
    $("[data-length]").text(prob[2].split(" ").length/2);
    
    // CORRECTIF : Créer un nouvel échiquier propre
    board = Chessboard('myBoard', defaultConfig);
    
    setTimeout(function() {
        firstMove = playPbm();
        console.log("first move");
        moveAction(firstMove);
        var moves = chess.moves();
        refreshBoard(chess);
    }, 1000);

    if(timerMode) {
        startTimer(InitialvoterTimer, true);
    }

    (teamToPlay == 1) ? 0 : 1;
}
/***********************************************************************************************/
/***************************************      voter     ****************************************/
/***********************************************************************************************/
function startTimer(timer, boolTimerVote){
    // CORRECTION : Toujours nettoyer l'ancien timer avant d'en créer un nouveau
    if (intervalId) {
        console.log("Nettoyage de l'ancien timer");
        clearInterval(intervalId);
        intervalId = null;
    }
    
    voterTimer = timer;
    console.log("start timer " + timer);

    intervalId = setInterval(bip.bind(null, boolTimerVote), 1000);
    
    // CSS + animate * 2 
    var element = document.getElementById("countdown");
    if (element) {
        element.style.setProperty("--q", timer);
        element.style.setProperty("--t", timer);
        $(".countdown").css("animation-duration", timer + "s");
    }
    $("body").addClass('showTimer');
}

// Améliorez aussi la fonction stopTimer :
function stopTimer() {
    if (intervalId) {
        console.log("Arrêt du timer");
        clearInterval(intervalId);
        intervalId = null;
    }
    $("body").removeClass('showTimer');
}

function startPauseTimer(duration, callback) {
	setTimeout(callback, duration * 1000);
}

function updateTimerDisplay(seconds) {
    // Mettre à jour l'affichage textuel formaté
    const timerValue = document.getElementById('timer-value');
    if (timerValue) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerValue.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        // Ajouter classe urgence
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) {
            if (seconds <= 10) {
                timerDisplay.classList.add('timer-urgent');
            } else {
                timerDisplay.classList.remove('timer-urgent');
            }
        }
    }
    
    // Mettre à jour le countdown circulaire
    const countdownElement = document.querySelector('.countdown');
    if (countdownElement) {
        // IMPORTANT: Mettre à jour les variables CSS pour que l'affichage circulaire fonctionne
        countdownElement.style.setProperty("--t", seconds);
        countdownElement.style.setProperty("--s", seconds);
        
        // Animation critique pour les dernières secondes
        if (seconds <= 5) {
            countdownElement.classList.add('timer-critical');
        } else {
            countdownElement.classList.remove('timer-critical');
        }
    }
}

function bip(boolTimerVote) {
    voterTimer--;

    // Mettre à jour l'affichage unifié
    updateTimerDisplay(voterTimer);

    if(voterTimer == 0){
        $("body").removeClass('showTimer');
        
        // Cacher l'affichage textuel
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) {
            timerDisplay.style.display = 'none';
        }
        
        if(boolTimerVote == true) {
            voteResult(poll);
            
            // Réinitialiser le graphique
            if (typeof pollChart !== 'undefined') {
                pollChart.data.labels = [];
                pollChart.data.datasets = [{
                    label: 'Votes',
                    data: [],
                    backgroundColor: [],
                    borderWidth: 0,
                    categoryPercentage: 0.3,
                    barPercentage: 0.5
                }];
                pollChart.update();
            }

            poll = [];
        }
        stopTimer();
    }
    else {    
        console.log(voterTimer + " secondes restantes");
    }
}

function addMoveToPoll(player, move){
    // Vérifier si le joueur a déjà voté
    if(limitToOneVote && poll.find(p => p.player === player) !== undefined) {
        console.log("Already vote");
        return false;
    }

		let existingVote = poll.find(p => p.move === move);
    let color = existingVote ? existingVote.color : colorArray[Math.floor(Math.random() * colorArray.length)];
    
    poll.push({'player': player, 'move': move, 'color': color});

    updateChartIncremental(move, color);

    showCurrentmax(poll);

	    if (multiplayerMode && window.multiplayerManager) {
	        window.multiplayerManager.sendVotes(poll);
	    }
}

function showCurrentmax(poll) {
  var result = poll.reduce((acc, o) => (acc[o.move] = (acc[o.move] || 0) + 1, acc), {});
  let max = Math.max.apply(null, Object.values(result));

  $(".available li").each(function() {
      let move = $(this).text();
      if (result[move] === max) {
          $(this).addClass("most-voted");
      } else {
          $(this).removeClass("most-voted");
      }
  });
}

function voteResult(poll) {
	
	let vote = "";
	var randomIdx = null;
	console.log(poll);

    if (window.multiplayerGameId) {
        const isMyTurn = (window.multiplayerColor === 'white' && teamToPlay === 0) ||
                         (window.multiplayerColor === 'black' && teamToPlay === 1);
        
        if (!isMyTurn) {
            console.log('⏭️ Pas mon tour, j\'attends le coup réseau');
            return;
        }
    }

	if(Object.entries(poll).length > 0) {
		// FUNCTION Meilleur vote
		console.log("on a des votes")
		//console.log(poll)
		//Pas de proportionnel en mode problème
		if(majorityMode || probMode) {
			var result = poll.reduce( (acc, o) => (acc[o.move] = (acc[o.move] || 0)+1, acc), {} );
			let max = Math.max.apply(null, Object.values(result));

			//console.log(result);
			$.each(result, function(i, value) {
			  if(value === max) {
			  	vote = i;
			  }
			});
			//console.log(vote);
    	moveAction(vote)

		  if(!probMode && checkforChemate()) {
		      $("body").addClass('omg-win');
		      startTimer(pauseAfterWinLose, false);
		      setTimeout(function() {
		          $("body").removeClass('omg-win');
		          loadNewgame();
		      }, pauseAfterWinLose*1000);
		      return; // Important : arrêter l'exécution
		  }



			$("body").addClass("showTimer");
			startTimer(InitialvoterTimer, true);
			voteOpen = true;
		} else {
			console.log("Pas mode majorité, donc random sur les votes");

			$(".votes ol").html("");
			$("body").addClass("randomWheel");

			$.each(moves, function(i, value) {
			  poll.push({"player": moves.player, "move": moves.move});
			});

			let move = randomWheel(poll, chess.turn());
			voteOpen = false;
			setTimeout(function(){
      	$("body").removeClass("randomWheel");
				$(".votes ol").html("");
      	moveAction(move)
				$("body").addClass("showTimer");
				startTimer(InitialvoterTimer, true);
				voteOpen = true;
    	}, timerWheelAnimation * 1000)
		}
	}	else{
		if(probMode == true){
			//GAME OVER
			console.log("game over")
			$("body").addClass('omg-lose');
				if(timerMode) {
					stopTimer();
				}
	
			startPauseTimer(pauseAfterWinLose, function() {
				$("body").removeClass('omg-lose');
				if(probMode == true) {
					globalReloadProblem(false);
				}
			});

			//GAME OVER
		} else {
			// FUNCTION RANDOM MOVE QUAND PAS DE VOTE
			var moves = chess.moves();
			$.each(moves, function(i, value) {
				let color = colorArray[Math.floor(Math.random() * colorArray.length)];
			  poll.push({"player": 'random', "move": value, color: color });
			});

			$(".votes ol").html("");
			console.log("pas de résultat, random sur les choix dispo");
			$("body").addClass("randomWheel");

			let move = randomWheel(poll, chess.turn());
			//console.log(move);
			voteOpen = false;
			setTimeout(function(){
				moveAction(move)
      	$("body").removeClass("randomWheel");
				$(".votes ol").html("");
				$("body").addClass("showTimer");
				startTimer(InitialvoterTimer, true);
				voteOpen = true;
    	}, timerWheelAnimation * 1000)

			// FUNCTION RANDOM MOVE QUAND PAS DE VOTE
		}

	}

	if(probMode == true) {
		let verif = verifPbm();
		let status;
		if(verif == false) {
			//Nope, erreur
			status = 'Erreur !';
			console.log("faute dans le pb mode timer");
			
            var tmp = $("[data-solution]").text();
            if (tmp && tmp.length >= 4) {
                $("[data-square]").removeClass("highlight-black");
                $("[data-square='"+tmp.slice(0,2)+"']").addClass("highlight-black");
                $("[data-square='"+tmp.slice(2,4)+"']").addClass("highlight-black");
            }
			

			chess.move({from:tmp.slice(0,2), to:tmp.slice(2,4)});
			board.position(chess);

			globalReloadProblem(false);
		} else {
			//On vérifie si c'est la fin du problème
			console.log("Correct, on continue par le move du bot dans le timer");

			if ($("[data-attempt]").attr("data-attempt") == $("[data-length]").attr("data-length")) {
				globalReloadProblem(true);
		  } else {
				setTimeout(function() {
					let move = playPbm();
						moveAction(move);
						var moves = chess.moves();
						refreshBoard(chess);


				}, 2000);
		  }
		}
	} else {



	  // checkmate?
		if(checkforChemate()) {
			$("body").addClass('omg-win');
		  startTimer(pauseAfterWinLose, false);
			setTimeout(function() {
				$("body").removeClass('omg-win');
						loadNewgame();
			}, pauseAfterWinLose*1000);
		}
	}
}	
/***********************************************************************************************/
/***************************************      voter     ****************************************/
/***********************************************************************************************/




/***********************************************************************************************/
/**************************************      Problems     **************************************/
/***********************************************************************************************/
function verifPbm(){
	console.log("verif");
	let undo = chess.history({ verbose: true });
	let concat = "";
	let idx = parseInt($("[data-attempt]").attr("data-attempt"));
	let arrMoves = [];

	arrMoves = $("[data-omgSolution]").text().split(" ");

	console.log(undo)
	let promotion = "";

    if(undo[idx-1] && undo[idx-1].promotion) {
    	promotion = undo[idx-1].promotion;
    }

	concat = undo[idx-1].from+""+undo[idx-1].to+promotion;
	$("[data-solution]").text(arrMoves[idx-1]);

	if(concat !== arrMoves[idx-1]) {
		return false;
	}

	return true;
}

function convertirNotationEchecs(c1, c2, promotion = '') {
    const piece = chess.get(c1);
    if (!piece) return null;

    // Construire l'objet moveAttempt
    const moveAttempt = {
        from: c1,
        to: c2
    };

    // Ajouter la promotion si nécessaire
    if (promotion) {
        moveAttempt.promotion = promotion;
    }

    // Tester le coup et obtenir toutes les informations
    let move;
    try {
        move = chess.move(moveAttempt);
        if (!move) return null;
        
        // Annuler immédiatement pour restaurer l'état
        chess.undo();
    } catch (error) {
        console.error('Error testing move:', error);
        return null;
    }

    // Utiliser les informations fournies par chess.js
    const isCapture = move.captured !== undefined;
    const isPromotion = move.promotion !== undefined;

    // Gérer les cas spéciaux de roque
    if (move.san === 'O-O') return 'O-O';
    if (move.san === 'O-O-O') return 'O-O-O';

    let notation = '';

    // Ajouter la pièce (sauf pour les pions)
    if (piece.type !== 'p') {
        notation += piece.type.toUpperCase();
        
        // Gérer l'ambiguïté pour les pièces (pas les pions)
        const legalMoves = chess.moves({ verbose: true })
            .filter(m => m.to === c2 && m.piece === piece.type);
            
        if (legalMoves.length > 1) {
            const differentFiles = legalMoves.some(m => m.from[0] !== c1[0]);
            const differentRanks = legalMoves.some(m => m.from[1] !== c1[1]);
            
            if (differentFiles && !differentRanks) {
                notation += c1[0]; // Spécifier la colonne
            } else if (differentRanks && !differentFiles) {
                notation += c1[1]; // Spécifier la rangée
            } else if (differentFiles && differentRanks) {
                notation += c1[0]; // Spécifier la colonne par défaut
            }
        }
    }

    // Pour les pions qui capturent, ajouter la colonne d'origine
    if (piece.type === 'p' && isCapture) {
        notation += c1[0];
    }

    // Ajouter le 'x' pour les captures
    if (isCapture) notation += 'x';

    // Ajouter la destination
    notation += c2;

    // Ajouter la promotion
    if (isPromotion && move.promotion) {
        notation += '=' + move.promotion.toUpperCase();
    }

    // Ajouter le check/mate
    if (move.san.endsWith('+')) notation += '+';
    if (move.san.endsWith('#')) notation += '#';

    return notation;
}

function playPbm(){
    let idx = parseInt($("[data-attempt]").attr("data-attempt"));
    let arrMoves = $("[data-omgSolution]").text().split(" ");
    
    let c1 = arrMoves[idx].slice(0, 2);
    let c2 = arrMoves[idx].slice(2, 4);
    let promotion = arrMoves[idx].slice(4, 5) || '';  // Gestion de la promotion

    $("[data-square]").removeClass("highlight-white");
    $("[data-square='"+c1+"']").addClass("highlight-white");
    $("[data-square='"+c2+"']").addClass("highlight-white");

    return convertirNotationEchecs(c1, c2, promotion);
}

function globalReloadProblem(isWinner = true){
	if(isWinner) {
		$("body").addClass('omg-win');

    let status = 'Probleme résolu';

	}
	else {
		$("body").addClass('omg-lose');
    let status = 'Erreur';
		board.position(chess.fen(chess.undo()), false)
	}
	
	$("[data-attempt]").attr("data-attempt", 0);
	$("[data-square]").removeClass("highlight-white");
	
    startTimer(pauseAfterWinLose, false);
    setTimeout(function() {
        $("body").removeClass('omg-win');        
        $("body").removeClass('omg-lose');
        loadNewProblem();
        $("[data-square]").removeClass("highlight-black");
    }, pauseAfterWinLose*1000);
}

function ReloadPgn(pgn, target, chess, context) {
	console.log("omg restart");
	chess = new Chess(pgn);
	defaultConfig.position = pgn;
	if(chess.turn() == 'b') {
		defaultConfig.orientation='black';
		teamToPlay = 1;
	}
	refreshBoard(chess, null);
	$(".poll ol").empty();
	board = Chessboard('myBoard', defaultConfig);
	var overlay = new ChessboardArrows('board_wrapper');
}

function playSoundForMove(chess) {
  const history = chess.history({ verbose: true });
  const lastMove = history[history.length - 1];

  if (chess.in_checkmate()) {
    mateAudio.play();
  } else if (chess.in_check()) {
    checkAudio.play();
  } else if (lastMove && lastMove.captured) {
    takeAudio.play();
  } else {
    moveAudio.play();
  }
}

/***********************************************************************************************/
/**************************************      Problems     **************************************/
/***********************************************************************************************/

var poll = [];
var moves = [];

function moveAction(move, isFromNetwork = false) {
	(teamToPlay == 1) ? 0 : 1;
	chess.move(move);
	board.position(chess.fen());



    if (isFromNetwork) {
        chess.move(move);
        board.position(chess.fen());
        playSoundForMove(chess);
        
        // Mise à jour de l'historique - UNE SEULE FOIS
        if(chess.turn() == 'b') {
            $(".poll ol").append("<li><span class='w' data-fen='"+chess.fen()+"'>"+move+"</span></li>");
        } else {
            if($(".poll ol li").length == 0) {
                $(".poll ol").append("<li><span class='b' data-fen='"+chess.fen()+"'>"+move+"</span></li>");
            } else {
                $(".poll ol li").last().append("<span class='b' data-fen='"+chess.fen()+"'>"+move+"</span>");
            }
        }
        
        refreshBoard(chess);
        return; // IMPORTANT : sortir ici pour éviter la double exécution
    }



if (window.multiplayerSocket && !isFromNetwork && 
    ((window.multiplayerColor === 'white' && teamToPlay === 0) ||
     (window.multiplayerColor === 'black' && teamToPlay === 1))) {
    window.multiplayerSocket.emit('moveSelected', {
        gameId: window.multiplayerGameId,
        player: window.multiplayerColor,
        move: move,
        fen: chess.fen()
    });
    console.log(`📤 Coup émis: ${move}`);
}	

    setTimeout(refreshPlayerDisplay, 100);
    playSoundForMove(chess)

		if(chess.turn() == 'b') {
			$(".poll ol").append("<li><span class='w' data-fen='"+chess.fen()+"'>"+move+"</span></li>");
		} else {
			if($(".poll ol li").length == 0) {
				$(".poll ol").append("<li><span class='b' data-fen='"+chess.fen()+"'>"+move+"</span></li>");
			} else {
				$(".poll ol li").last().append("<span class='b' data-fen='"+chess.fen()+"'>"+move+"</span>");
			}
		}
		// ANIMATION DU MOVE
		// ANIMATION DU MOVE
		console.log("move action")
	  $("[data-attempt]").attr("data-attempt", parseInt($("[data-attempt]").attr("data-attempt"))+1 );

		$(".poll ol").animate({ scrollTop: $(".poll").offset().top }, 500);
		refreshBoard(chess);

		$("[data-fen]").click(function(){
			board.position($(this).data("fen"));
		});
	}

function play(target, context, args) {
	if(!voteOpen) { 
		console.log("not vote open")
	}else{
		moves = chess.moves();
		if (args.length == 1) {
			let move = args[0];
			

			switch(gameMode) {
			    case 'mod1vViewers':
							if(context.username === mod1vViewersPlayer && teamToPlay == 1) {
								//client.say(target, `Nope, it's viewers turn`);
								return false;
							}
							if(context.username !== mod1vViewersPlayer && teamToPlay == 0) {
								//client.say(target, `Nope, it's @${mod1vViewersPlayer} turn`);
								return false;
							}		
							console.log(context.username+ "vote : "+ move);
			        break;
			    case 'mod1v1':
							console.log("mod1v1");
							if(context.username === oneVsOneModeList0 && teamToPlay == 1) {
								//client.say(target, `Nope, it's @${oneVsOneModeList1} turn`);
								return false;
							}
							if(context.username === oneVsOneModeList1 && teamToPlay == 0) {
								//client.say(target, `Nope, it's @${oneVsOneModeList0} turn`);
								return false;
							}

			        break;
			    case 'modViewersvViewers':
			    		//hack
							if(!context['user-id']) {
								context['user-id'] = 0;
							}

							if(context['user-id'] % 2 == 0 && teamToPlay == 1) {
								//client.say(target, `Nope, Black to play`);
								//console.log("nope");
								return false;
							}
							if(context['user-id'] % 2 == 1 && teamToPlay == 0) {
								//client.say(target, `Nope, White to play`);
								//console.log("nope");
								return false;
							}		
			        break;
                case 'modStreamerChatvStreamerChat':
                    let playerTeam = getTeamByChannel(target, context);
                    if(playerTeam !== teamToPlay) {
                        console.log(`Vote rejeté: ${context.username} vote depuis le mauvais chat. Équipe ${playerTeam} vs équipe attendue ${teamToPlay}`);
                        return false; // Pas le bon chat pour cette équipe
                    }
                    console.log(`Vote accepté: ${context.username} vote pour l'équipe ${playerTeam} depuis ${target}`);
                    break;
			    default:
			}

			// Fonction pour vérifier si l'utilisateur est le propriétaire de la chaîne
			function isChannelOwner(context, target) {
				// Récupérer le nom du canal sans le #
				let channelName = target.replace('#', '').toLowerCase();
				return context.username.toLowerCase() === channelName;
			}
			
			// Vérification du mode followers
			if(followMode == true) {
				// Le propriétaire de la chaîne peut toujours jouer
				if(isChannelOwner(context, target)) {
					console.log("Channel owner can always play:", context.username);
				} else {
					// Vérifier si l'utilisateur a le badge follower
					let isFollower = context.badges && context.badges.follower;
					// Vérifier si c'est un abonné, VIP, modérateur ou broadcaster (ils ont toujours accès)
					let hasSpecialAccess = (context.badges && (
						context.badges.subscriber || 
						context.badges.vip || 
						context.badges.moderator || 
						context.badges.broadcaster
					)) || context['user-type'] === 'mod' || context.mod;
					
					if(!isFollower && !hasSpecialAccess) {
						console.log("User is not a follower:", context.username);
						//client.say(target, `@${context.username} Seuls les followers peuvent jouer !`);
						return false;
					}
				}
			}

			// Vérification du mode abonnés
			if(subMode == true) {
				// Le propriétaire de la chaîne peut toujours jouer
				if(isChannelOwner(context, target)) {
					console.log("Channel owner can always play:", context.username);
				} else {
					// Vérifier si l'utilisateur a le badge subscriber
					let isSubscriber = context.badges && context.badges.subscriber;
					// Vérifier si c'est un VIP, modérateur ou broadcaster (ils ont toujours accès)
					let hasSpecialAccess = (context.badges && (
						context.badges.vip || 
						context.badges.moderator || 
						context.badges.broadcaster
					)) || context['user-type'] === 'mod' || context.mod;
					
					if(!isSubscriber && !hasSpecialAccess) {
						console.log("User is not a subscriber:", context.username);
						//client.say(target, `@${context.username} Seuls les abonnés peuvent jouer !`);
						return false;
					}
				}
			}

			// Move invalide ?
			if(moves.includes(move) !== true && moves.includes(move+"#") !== true && moves.includes(move+"+") !== true){
				//client.say(target, `Invalid move`);
				//console.log("Invalid move");
				showAvailableMoves(target, chess, context);
				return false;
			}
    if (window.multiplayerMode && window.multiplayerManager && !isFromNetwork) {
        window.multiplayerManager.sendMove(move);
    }
			// FUNCTION MOVE
			//client.say(target, `@${context.username} vote for ${move}`);
			
			// Move = resetTimeOut  + nouveau coup		
            if(timerMode) {
				addMoveToPoll(context.username, move);
			} else {
				moveAction(move);
                if(timerMode && (gameMode === 'mod1v1' || gameMode === 'mod1vViewers')) {
                    $("body").addClass("showTimer");
                    startTimer(InitialvoterTimer, true);
                    voteOpen = true;
                }
				if(gameMode == "probMode") {
					let verif = verifPbm();
					if(verif == false) {
						//Nope, erreur
						let status = 'Erreur !';
						console.log("faute dans le pb mode pas timer");
						
						var tmp = $("[data-solution]").text();
						$("[data-square]").removeClass("highlight-black");
						$("[data-square="+tmp.slice(0,2)+"]").addClass("highlight-black");
						$("[data-square="+tmp.slice(2,4)+"]").addClass("highlight-black");		
						

						chess.move({from:tmp.slice(0,2), to:tmp.slice(2,4)});
						board.position(chess);

						globalReloadProblem(false);
					} else {
						//On vérifie si c'est la fin du problème
						console.log("Correct, on continue par le move du bot");

						if ($("[data-attempt]").attr("data-attempt") == $("[data-length]").attr("data-length")) {

							globalReloadProblem(true);
					  } else {
							setTimeout(function() {
								let move = playPbm();
									moveAction(move);
									var moves = chess.moves();
									refreshBoard(chess);
							}, 2000);
					  }
					}
				}

				if(checkforChemate()) {
					$("body").addClass('omg-win');
				  startTimer(pauseAfterWinLose, false);
					setTimeout(function() {
						$("body").removeClass('omg-win');
								loadNewgame();
					}, pauseAfterWinLose*1000);
				}


			}
		} else {
			//client.say(target, `Syntaxe : !p XXXX `);
			//console.log("Syntax error : !p _MOVE_");
		}
	}
}

function refreshPlayerDisplay() {
    updatePlayerDisplay();
}

function updatePlayerDisplay() {
    const whiteHeader = $('h3[data-team="w"]');
    const blackHeader = $('h3[data-team="b"]');
    
    // Réinitialiser les headers
    whiteHeader.find('.player-info').remove();
    blackHeader.find('.player-info').remove();
    
    let whitePlayerInfo = '';
    let blackPlayerInfo = '';
    
    switch(gameMode) {
        case 'modStreamerChatvStreamerChat':
            // Chat vs Chat - afficher les pseudos des streamers
            whitePlayerInfo = `
                <span class="player-info">
                    <img src="https://static-cdn.jtvnw.net/jtv_user_pictures/${streamerChatvStreamerChat0}-profile_image-70x70.png" 
                         class="streamer-avatar" 
                         onerror="this.style.display='none'"
                         alt="${streamerChatvStreamerChat0}">
                    <span class="streamer-name">@${streamerChatvStreamerChat0}</span>
                </span>`;
            
            blackPlayerInfo = `
                <span class="player-info">
                    <img src="https://static-cdn.jtvnw.net/jtv_user_pictures/${streamerChatvStreamerChat1}-profile_image-70x70.png" 
                         class="streamer-avatar" 
                         onerror="this.style.display='none'"
                         alt="${streamerChatvStreamerChat1}">
                    <span class="streamer-name">@${streamerChatvStreamerChat1}</span>
                </span>`;
            break;
            
        case 'mod1v1':
            // Duel 1v1
            whitePlayerInfo = `
                <span class="player-info">
                    <img src="https://static-cdn.jtvnw.net/jtv_user_pictures/${oneVsOneModeList0}-profile_image-70x70.png" 
                         class="streamer-avatar" 
                         onerror="this.style.display='none'"
                         alt="${oneVsOneModeList0}">
                    <span class="streamer-name">@${oneVsOneModeList0}</span>
                </span>`;
            
            blackPlayerInfo = `
                <span class="player-info">
                    <img src="https://static-cdn.jtvnw.net/jtv_user_pictures/${oneVsOneModeList1}-profile_image-70x70.png" 
                         class="streamer-avatar" 
                         onerror="this.style.display='none'"
                         alt="${oneVsOneModeList1}">
                    <span class="streamer-name">@${oneVsOneModeList1}</span>
                </span>`;
            break;
            
        case 'mod1vViewers':
            // Seul contre tous
            if(teamToPlay === 0) {
                whitePlayerInfo = `
                    <span class="player-info">
                        <img src="https://static-cdn.jtvnw.net/jtv_user_pictures/${mod1vViewersPlayer}-profile_image-70x70.png" 
                             class="streamer-avatar" 
                             onerror="this.style.display='none'"
                             alt="${mod1vViewersPlayer}">
                        <span class="streamer-name">@${mod1vViewersPlayer}</span>
                    </span>`;
                blackPlayerInfo = `
                    <span class="player-info">
                        <span class="team-name">(Chat)</span>
                    </span>`;
            } else {
                whitePlayerInfo = `
                    <span class="player-info">
                        <span class="team-name">(Chat)</span>
                    </span>`;
                blackPlayerInfo = `
                    <span class="player-info">
                        <img src="https://static-cdn.jtvnw.net/jtv_user_pictures/${mod1vViewersPlayer}-profile_image-70x70.png" 
                             class="streamer-avatar" 
                             onerror="this.style.display='none'"
                             alt="${mod1vViewersPlayer}">
                        <span class="streamer-name">@${mod1vViewersPlayer}</span>
                    </span>`;
            }
            break;
            
        case 'modViewersvViewers':
            // Viewers vs Viewers (ID pair/impair)
            whitePlayerInfo = `
                <span class="player-info">
                    <span class="team-name">(ID Pairs)</span>
                </span>`;
            blackPlayerInfo = `
                <span class="player-info">
                    <span class="team-name">(ID Impairs)</span>
                </span>`;
            break;
            
        default:
            // Mode normal - tous contre tous
            whitePlayerInfo = `
                <span class="player-info">
                    <span class="team-name">(Chat)</span>
                </span>`;
            blackPlayerInfo = `
                <span class="player-info">
                    <span class="team-name">(Chat)</span>
                </span>`;
            break;
    }
    
    // Ajouter les infos aux headers
    whiteHeader.append(whitePlayerInfo);
    blackHeader.append(blackPlayerInfo);
    
    // Mettre en évidence le joueur actuel
    $('.player-info').removeClass('current-player');
    if(chess.turn() === 'w') {
        whiteHeader.find('.player-info').addClass('current-player');
    } else {
        blackHeader.find('.player-info').addClass('current-player');
    }
}

function getTeamByChannel(target, context) {
    // Récupérer le nom du canal sans le #
    let channelName = target.replace('#', '').toLowerCase();
    
    // Déterminer l'équipe en fonction du canal
    if(channelName === streamerChatvStreamerChat0.toLowerCase()) {
        return 0; // Équipe des blancs
    } else if(channelName === streamerChatvStreamerChat1.toLowerCase()) {
        return 1; // Équipe des noirs
    }
    
    console.log(`Canal non reconnu: ${channelName}`);
    return -1; // Canal non reconnu
}

function refreshBoard(chess, context=null) {
	if(chess.turn() == 'w') {
		teamToPlay = 0;
	}
	else {
		teamToPlay = 1
	}

	$('body').attr('data-team', chess.turn());

	$("#availableList ul").empty();
 
	let moves = chess.moves().sort(function(a, b) {
		if(a === b) return 0; 
		return a > b ? 1 : -1;
	});
	
	moves.forEach((item) => {	
		let li = document.createElement("li");
		let val = item.replaceAll('#', '').replaceAll('+', '');
		
		let list = document.getElementById("availableList"+val.slice(0,1));
		
		if(list == null)
			list = document.getElementById("availableListP");
		
		li.innerText = val
		list.appendChild(li);
	});
	
	$("#availableList ul li").on("click", function(){
		play(clickOpts.identity, clickOpts.identity, [$(this).text()]);
	});
	
}

function checkforChemate() {
	//console.log(chess)
		let status;
	  if (chess.in_checkmate()) {
	    status = 'Game over, ' + chess.turn() + ' is in checkmate.';

	    return true;
	  }

	  // draw?
	  else if (chess.in_draw()) {
	    status = 'Game over, drawn position';
	    $(".votes h3 b").text(status);
	    return true;
	  }

	  // game still on
	  else {
	    // check?
	    if (chess.in_check()) {
	      //status += ', ' + chess.turn() + ' is in check';
	    	$("[data-piece="+chess.turn()+"K]").closest('[data-square]').addClass("highlight-white");
	    } else {
	    	$("[data-square]").removeClass("highlight-white");
	    }
	  }
	  return false;
}


/***********************************************************************************************/
/***************************************   Wheel  ****************************************/
/***********************************************************************************************/

function randomWheel(poll, turn) {

$('#chart').html('');
	var padding = {top:0, right:20, bottom:0, left:0},
            w = 400 - padding.left - padding.right,
            h = 400 - padding.top  - padding.bottom,
            r = Math.min(w, h)/2,
            rotation = 0,
            oldrotation = 0,
            picked = 100000,
            oldpick = [],
            data = [],
            col = 'black',
            //color = colorArray;//category20c()
            //color = d3.scale.category20();//category20c()

  			player = poll[0].player;
  			for(var i=0; i < poll.length; i++){
            data.push({label: poll[i].move, value: poll[i].move, color: poll[i].color});
            color = poll[i].color;
        }

        var svg = d3.select('#chart')
            .append("svg")
            .data([data])
            .attr("width",  w + padding.left + padding.right)
            .attr("height", h + padding.top + padding.bottom);
        var container = svg.append("g")
            .attr("class", "chartholder")
            .attr("transform", "translate(" + (w/2 + padding.left) + "," + (h/2 + padding.top) + ")");
        var vis = container
            .append("g");
            
        var pie = d3.layout.pie().sort(null).value(function(d){return 1;});
        // declare an arc generator function
        var arc = d3.svg.arc().outerRadius(r);
        // select paths, use arc generator to draw
        var arcs = vis.selectAll("g.slice")
            .data(pie)
            .enter()
            .append("g")
            .attr("class", "slice");
            
        arcs.append("path")
            .attr("fill", function(d, i){ return d.data.color+'ee'; })
            .attr("d", function (d) { return arc(d); });
        // add the text

        arcs.append("text").attr("transform", function(d){
                d.innerRadius = 0;
                d.outerRadius = r;
                d.angle = (d.startAngle + d.endAngle)/2;
                return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")translate(" + (d.outerRadius -20) +")";
            })
        		.attr('x', -10)
        		.attr('y', 3)
        		.attr("text-anchor", "end")
            .text( function(d, i) {
                return data[i].label;
             });

        if(turn=='b') {
        	colorImage = 'b'
        }
        else{
        	colorImage = 'w'
        }

				arcs.append("image")
					  .attr({
					    "xlink:href": function(d) {
					    	let piece = 'P';

				        if (d.data.label.slice(0, 1) == "Q" || 
				        	 d.data.label.slice(0, 1) == "K" || 
				        	 d.data.label.slice(0, 1) == "R" || 
				        	 d.data.label.slice(0, 1) == "B" ||
				        	 d.data.label.slice(0, 1) == "N" ) {
				        	piece = d.data.label.slice(0, 1);
				        }
                return "./img/chesspieces/wikipedia/"+colorImage+piece+".png";
             },
					    width: 20,
					    height: 20
					  })
					  .attr("text-anchor", "end")
					  .attr('y', -15)
					  .attr("transform", function(d){
                d.innerRadius = 0;
                d.outerRadius = r;
                d.angle = (d.startAngle + d.endAngle)/2;
                return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")translate(" + (d.outerRadius - 30) +")";
            })

        container.on("click", spin);
        function spin(d){
            container.on("click", null);
            //all slices have been seen, all done
            //console.log("OldPick: " + oldpick.length, "Data length: " + data.length);
            if(oldpick.length == data.length){
                console.log("done");

                return;
            }
            var  dataSize = data.length,
            			ps       = 360/dataSize,
                 pieslice = Math.round(1440/dataSize),
                 rng      = Math.floor((Math.random() * 1440) + 360);
            
            let rngmin = rng - ((ps / 2)-1);
            let rngmax = rng + ((ps / 2)-1);

            let random =  Math.floor(Math.random() * (rngmax - rngmin + 1) + rngmin);
//						console.log(random);
//						console.log(rng);
//						console.log(rngmin);
//						console.log(rngmax);

            rotation = random;

            picked = Math.round(dataSize - (rotation % 360)/ps);
            picked = picked >= dataSize ? (picked % dataSize) : picked;
            if(oldpick.indexOf(picked) !== -1){
                d3.select(this).call(spin);
                return;
            } else {
                oldpick.push(picked);
            }

            rotation += 90 - (Math.round(ps/2));

            //console.log(rotation);
            vis.transition()
                .duration(timerWheelAnimation * 1000)
                .attrTween("transform", rotTween)
                .each("end", function(){
                    oldrotation = rotation;
                    /* Get the result value from object "data" */
                });
        }
        //make arrow

        if(turn=='b') {
        	col = 'white'
        }
        else{
        	col = 'black'
        }

        svg.append("g")
            .attr("transform", "translate(" + (w + padding.left + padding.right) + "," + ((h/2)+padding.top) + ")")
            .append("path")
            .attr("d", "M-" + (r*.15) + ",0L0," + (r*.05) + "L0,-" + (r*.05) + "Z")
            .style({"fill":col});
        //draw spin circle
        container.append("circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", 15)
            .style({"fill":"#ffffffff","cursor":"pointer"});       

        function rotTween(to) {
          var i = d3.interpolate(oldrotation % 360, rotation);
          return function(t) {
            return "rotate(" + i(t) + ")";
          };
        }
        spin(data);
        return data[picked].value;
}


// NOUVELLE FONCTION : Obtenir la pièce d'un coup
function getPieceFromMove(move) {
    let piece = 'P'; // Pion par défaut
    
    if (move.slice(0, 1) === "Q" || 
        move.slice(0, 1) === "K" || 
        move.slice(0, 1) === "R" || 
        move.slice(0, 1) === "B" ||
        move.slice(0, 1) === "N") {
        piece = move.slice(0, 1);
    }
    
    return piece;
}

function drawLabelsOnChart() {
    const chart = pollChart;
    const ctx = chart.ctx;
    
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px Arial';
    
    // Ombre pour le texte
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'white';
    
    const meta = chart.getDatasetMeta(0);
    
    meta.data.forEach((bar, index) => {
        const label = chart.data.labels[index];
        
        if (label && bar.height > 0) {
            const piece = getPieceFromMove(label);
            const color = (teamToPlay == 0) ? "w" : "b";
            const pieceKey = `${color}${piece}`;
            const pieceImage = pieceImages[pieceKey];
            
            const centerY = bar.y + (bar.height / 2);
            
            // Image à gauche du centre
            const imageX = bar.x - 25;
            const imageY = centerY - 10;
            
            // Texte à droite du centre
            const textX = bar.x - 2;
            
            // Dessiner l'image
            if (pieceImage && pieceImage.complete) {
                ctx.shadowColor = 'transparent';
                ctx.drawImage(pieceImage, imageX, imageY, 20, 20);
                ctx.shadowColor = 'black';
            }
            
            // Dessiner le texte
            ctx.fillText(label, textX, centerY);
        }
    });
    
    ctx.restore();
}
function updateChartIncremental(move, color) {
    const currentLabels = pollChart.data.labels;
    const currentData = pollChart.data.datasets[0].data;
    const currentColors = pollChart.data.datasets[0].backgroundColor;
    
    // Chercher si le coup existe déjà
    const existingIndex = currentLabels.indexOf(move);
    
    if (existingIndex !== -1) {
        // LE COUP EXISTE → Incrémenter la valeur
        currentData[existingIndex]++;
    } else {
        // NOUVEAU COUP → Ajouter à la fin
        currentLabels.push(move);
        currentData.push(1);
        currentColors.push(color);
    }
    
    // Mettre à jour sans recréer
    pollChart.data.datasets[0] = {
        label: 'Votes',
        data: currentData,
        backgroundColor: currentColors,
        borderWidth: 0,
        categoryPercentage: 1.0,
        barPercentage: 0.9
    };
    
    pollChart.update('none'); // ← 'none' = pas d'animation pour être plus rapide
    setTimeout(() => {
        drawLabelsOnChart();
    }, 100);
}

function updateChartData() {
    // Compter les votes par coup
    var result = poll.reduce((acc, o) => (acc[o.move] = (acc[o.move] || 0) + 1, acc), {});
    
    // Extraire les labels et données
    const labels = Object.keys(result);
    const data = Object.values(result);
    const colors = labels.map(move => {
        const pollItem = poll.find(p => p.move === move);
        return pollItem ? pollItem.color : colorArray[0];
    });
    
    // CORRECTION - Structure correcte
    pollChart.data.labels = labels;
    pollChart.data.datasets = [{  // ← UN SEUL dataset
        label: 'Votes',
        data: data,
        backgroundColor: colors,
        borderWidth: 0,
        categoryPercentage: 1.0,  // ← AJOUTER ICI
        barPercentage: 0.95   
    }];
    
    pollChart.update();
}


/***********************************************************************************************/
/***************************************   Wheel  ****************************************/
/***********************************************************************************************/


// ========== FONCTIONS DE FILTRAGE PAR THÈMES ==========

function analyzeAndRenderThemes() {
    // Vérifier si les problèmes sont chargés
    if (allProblems.length === 0) {
        console.log('⚠️ Aucun problème chargé pour analyser les thèmes');
        const themeListElement = document.getElementById('themeList');
        if (themeListElement) {
            themeListElement.innerHTML = '<div style="text-align: center; color: #aaa;">Chargement des thèmes...</div>';
        }
        return;
    }
    
    themeStats = {};
    
    console.log('🔍 Analyse des thèmes pour', allProblems.length, 'problèmes');
    
    // Analyser tous les thèmes disponibles
    allProblems.forEach((problem, index) => {
        if (problem[7]) { // Colonne des thèmes
            let themesString = problem[7];
            
            // Nettoyer la chaîne (enlever les guillemets)
            themesString = themesString.replace(/^"/, '').replace(/"$/, '');
            
            // Déterminer le séparateur : virgule ou espace
            let themes = [];
            if (themesString.includes(',')) {
                // Séparés par virgules
                themes = themesString.split(',');
            } else {
                // Séparés par espaces
                themes = themesString.split(' ');
            }
            
            themes.forEach(theme => {
                theme = theme.trim();
                if (theme && theme !== '') {
                    themeStats[theme] = (themeStats[theme] || 0) + 1;
                }
            });
            
            // Debug pour les premiers problèmes
            if (index < 3) {
                console.log(`  Problème ${index}:`, problem[0], 'Thèmes bruts:', problem[7], 'Thèmes parsés:', themes);
            }
        }
    });
    
    console.log('📊 Thèmes trouvés:', Object.keys(themeStats).length);
    console.log('📈 Statistiques des thèmes:', themeStats);
    
    // Trier par fréquence décroissante
    const sortedThemes = Object.keys(themeStats).sort((a, b) => themeStats[b] - themeStats[a]);
    themeStats = Object.fromEntries(sortedThemes.map(theme => [theme, themeStats[theme]]));
    
    renderThemeList();
    updateProblemCount();
}
function loadSelectedThemesFromUrl() {
    // Utiliser la variable globale définie dans config.js
    if (typeof selectedThemesFromUrl !== 'undefined' && selectedThemesFromUrl.size > 0) {
        selectedThemes = new Set(selectedThemesFromUrl);
        console.log('📁 Thèmes chargés depuis l\'URL:', Array.from(selectedThemes));
        return true;
    }
    return false;
}

function renderThemeList() {
    const themeListElement = document.getElementById('themeList');
    if (!themeListElement) {
        console.warn('⚠️ Élément themeList non trouvé');
        return;
    }
    
    themeListElement.innerHTML = '';
    
    if (Object.keys(themeStats).length === 0) {
        themeListElement.innerHTML = '<div style="text-align: center; color: #aaa;">Chargement des thèmes...</div>';
        return;
    }
    
    Object.entries(themeStats).forEach(([theme, count]) => {
        const themeItem = document.createElement('div');
        themeItem.className = 'theme-item';
        
        const safeThemeId = theme.replace(/[^a-zA-Z0-9]/g, '_');
        
        // Vérifier si ce thème était sélectionné dans l'URL
        const isChecked = selectedThemes.has(theme) ? 'checked' : '';
        
        themeItem.innerHTML = `
            <input type="checkbox" id="theme_${safeThemeId}" name="theme_${safeThemeId}" value="${theme}" ${isChecked} onchange="toggleTheme('${theme}')">
            <label for="theme_${safeThemeId}">${theme}</label>
            <span class="theme-count">(${count})</span>
        `;
        
        themeListElement.appendChild(themeItem);
    });
    
    console.log('🎨 Liste des thèmes rendue avec', selectedThemes.size, 'thèmes pré-sélectionnés');
    
    // Ajouter un indicateur visuel si on n'est pas en mode problème
    if (gameMode !== "probMode") {
        const infoElement = document.createElement('div');
        infoElement.style.cssText = 'text-align: center; color: #ffa500; font-size: 12px; margin-top: 10px; padding: 5px; background-color: #2a2a2a; border-radius: 3px;';
        infoElement.innerHTML = '💡 Activez le mode problème pour utiliser ces filtres';
        themeListElement.appendChild(infoElement);
    }
}

function toggleTheme(theme) {
    if (selectedThemes.has(theme)) {
        selectedThemes.delete(theme);
    } else {
        selectedThemes.add(theme);
    }
    updateSelectedThemesDisplay();
    updateProblemCount();
    
    console.log('Thèmes sélectionnés:', Array.from(selectedThemes));
}

function updateSelectedThemesDisplay() {
    const container = document.getElementById('selectedThemes');
    const tagsContainer = document.getElementById('selectedThemesTags');
    
    if (!container || !tagsContainer) return;
    
    if (selectedThemes.size === 0) {
        container.style.display = 'none';
    } else {
        container.style.display = 'block';
        tagsContainer.innerHTML = Array.from(selectedThemes)
            .map(theme => `<span class="theme-tag">${theme}</span>`)
            .join('');
    }
}

function updateProblemCount() {
    const availableElement = document.getElementById('availableProblems');
    if (!availableElement) return;
    
    const filteredCount = getFilteredProblems().length;
    availableElement.textContent = filteredCount;
    
    console.log('Problèmes filtrés:', filteredCount, '/', allProblems.length);
}

function getFilteredProblems() {
    if (selectedThemes.size === 0) {
        return allProblems;
    }
    
    return allProblems.filter(problem => {
        if (!problem[7]) return false;
        
        let themesString = problem[7];
        // Nettoyer la chaîne (enlever les guillemets)
        themesString = themesString.replace(/^"/, '').replace(/"$/, '');
        
        // Déterminer le séparateur et parser les thèmes
        let problemThemes = [];
        if (themesString.includes(',')) {
            problemThemes = themesString.split(',').map(t => t.trim());
        } else {
            problemThemes = themesString.split(' ').map(t => t.trim());
        }
        
        // Vérifier si le problème contient au moins un des thèmes sélectionnés
        return Array.from(selectedThemes).some(selectedTheme => 
            problemThemes.includes(selectedTheme)
        );
    });
}

function selectAllThemes() {
    selectedThemes = new Set(Object.keys(themeStats));
    
    // Cocher tous les checkboxes
    Object.keys(themeStats).forEach(theme => {
        const safeThemeId = theme.replace(/[^a-zA-Z0-9]/g, '_');
        const checkbox = document.getElementById(`theme_${safeThemeId}`);
        if (checkbox) checkbox.checked = true;
    });
    
    updateSelectedThemesDisplay();
    updateProblemCount();
}

function clearThemeFilter() {
    selectedThemes.clear();
    
    // Décocher tous les checkboxes
    Object.keys(themeStats).forEach(theme => {
        const safeThemeId = theme.replace(/[^a-zA-Z0-9]/g, '_');
        const checkbox = document.getElementById(`theme_${safeThemeId}`);
        if (checkbox) checkbox.checked = false;
    });
    
    updateSelectedThemesDisplay();
    updateProblemCount();
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}









// ========== Configuration globale ==========
window.CHESS_VOTER_CONFIG = {
    basePath: '/chessTwitchVoter/',
    serverUrl: null, // Mettez l'URL de votre serveur si vous en avez un
    isProduction: window.location.hostname !== 'localhost'
};

// Variables globales pour le multiplayer
window.multiplayerMode = false;
window.gameSocket = null;
window.currentGameId = null;
window.playerColor = null;

// ========== Gestion du modal de configuration ==========
function setupConfigModal() {
    const configForm = document.getElementById('configModal');
    const openButton = document.getElementById('openFormButton');
    const closeButton = document.querySelector('.close');
    
    // Ouvrir le formulaire
    if (openButton) {
        openButton.addEventListener('click', function(e) {
            e.preventDefault();
            if (configForm) {
                configForm.style.display = 'block';
            }
        });
    }
    
    // Fermer le formulaire
    if (closeButton) {
        closeButton.addEventListener('click', function() {
            if (configForm) {
                configForm.style.display = 'none';
            }
        });
    }
    
    // Fermer en cliquant à l'extérieur
    window.addEventListener('click', function(event) {
        if (event.target === configForm) {
            configForm.style.display = 'none';
        }
    });
}

// ========== Gestion des onglets multiplayer ==========
function setupMultiplayerTabs() {
    document.querySelectorAll('.multiplayer-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            
            // Activer l'onglet
            document.querySelectorAll('.multiplayer-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Afficher le panneau correspondant
            document.querySelectorAll('.multiplayer-panel').forEach(panel => panel.classList.remove('active'));
            const targetPanel = document.getElementById(tabName + '-panel');
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
        });
    });
}

// ========== Gestion des boutons multiplayer ==========
function setupMultiplayerButtons() {
    // Bouton créer partie
    const createGameBtn = document.getElementById('createGameBtn');
    if (createGameBtn) {
        createGameBtn.addEventListener('click', function(e) {
            e.preventDefault(); // Empêcher le submit du formulaire
            
            const streamerName = document.getElementById('hostStreamerName').value;
            if (!streamerName) {
                alert('Veuillez entrer votre nom de streameur');
                return;
            }
            
            // Simuler la création de partie
            const gameCode = Math.random().toString(36).substring(2, 6).toUpperCase();
            const gameCodeEl = document.getElementById('gameCode');
            if (gameCodeEl) {
                gameCodeEl.textContent = gameCode;
            }
            
            // Générer les URLs
            const baseUrl = window.location.origin + window.location.pathname;
            //const hostUrl = `${baseUrl}?game=${gameCode}&role=host&streamer=${encodeURIComponent(streamerName)}&defaultChannel=Xou____&gameMode=modStreamerChatvStreamerChat`;
            //const guestUrl = `${baseUrl}?game=${gameCode}&role=guest&streamer=${encodeURIComponent(streamerName)}&defaultChannel=Xou____&gameMode=modStreamerChatvStreamerChat`;
            
            const hostUrl = `${baseUrl}?game=${gameCode}&role=host&streamer=${encodeURIComponent(streamerName)}&defaultChannel=Xou____&gameMode=modStreamerChatvStreamerChat&timerMode=on&InitialvoterTimer=80&timerWheelAnimation=5`;
            const guestUrl = `${baseUrl}?game=${gameCode}&role=guest&streamer=${encodeURIComponent(streamerName)}&defaultChannel=Xou____&gameMode=modStreamerChatvStreamerChat&timerMode=on&InitialvoterTimer=80&timerWheelAnimation=5`;
            
            const hostUrlEl = document.getElementById('hostUrl');
            const guestUrlEl = document.getElementById('guestUrl');
            if (hostUrlEl) hostUrlEl.textContent = hostUrl;
            if (guestUrlEl) guestUrlEl.textContent = guestUrl;
            
            // Afficher le panneau de partie créée
            const gameCreatedInfo = document.getElementById('gameCreatedInfo');
            if (gameCreatedInfo) {
                gameCreatedInfo.style.display = 'block';
            }
            this.style.display = 'none';
        });
    }
    
    // Bouton rejoindre partie
    const joinGameBtn = document.getElementById('joinGameBtn');
    if (joinGameBtn) {
        joinGameBtn.addEventListener('click', function(e) {
            e.preventDefault(); // Empêcher le submit du formulaire
            
            const streamerName = document.getElementById('guestStreamerName').value;
            const gameCode = document.getElementById('gameCodeInput').value;
            
            if (!streamerName || !gameCode) {
                alert('Veuillez remplir tous les champs');
                return;
            }
            
            // Simuler la connexion
            const baseUrl = window.location.origin + window.location.pathname;
            //const playerUrl = `${baseUrl}?game=${gameCode}&role=guest&streamer=${encodeURIComponent(streamerName)}&defaultChannel=Xou____&gameMode=modStreamerChatvStreamerChat&timerMode=on&`;
            
            const playerUrl = `${baseUrl}?game=${gameCode}&role=guest&streamer=${encodeURIComponent(streamerName)}&defaultChannel=Xou____&gameMode=modStreamerChatvStreamerChat&timerMode=on&InitialvoterTimer=80&timerWheelAnimation=5`;
            
            const playerUrlEl = document.getElementById('playerUrl');
            if (playerUrlEl) {
                playerUrlEl.textContent = playerUrl;
            }
            
            // Afficher le panneau de partie rejointe
            const gameJoinedInfo = document.getElementById('gameJoinedInfo');
            if (gameJoinedInfo) {
                gameJoinedInfo.style.display = 'block';
            }
            this.style.display = 'none';
        });
    }
}

// ========== Gestion des boutons de copie ==========
function setupCopyButtons() {
    // Boutons de copie
    document.querySelectorAll('.btn-copy').forEach(btn => {
        btn.addEventListener('click', function() {
            const targetId = this.dataset.target;
            const targetElement = document.getElementById(targetId);
            if (!targetElement) return;
            
            const text = targetElement.textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                const originalIcon = this.innerHTML;
                this.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    this.innerHTML = originalIcon;
                }, 2000);
            }).catch(err => {
                console.error('Erreur lors de la copie:', err);
                // Fallback pour les navigateurs qui ne supportent pas clipboard API
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                const originalIcon = this.innerHTML;
                this.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => {
                    this.innerHTML = originalIcon;
                }, 2000);
            });
        });
    });

    // Boutons d'ouverture dans un nouvel onglet
    document.querySelectorAll('.btn-blank').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.dataset.target;
            const targetElement = document.getElementById(targetId);
            if (!targetElement) return;
            
            const text = targetElement.textContent;
            window.open(text, "_blank");
        });
    });
}

// ========== Initialisation Socket.IO pour multiplayer ==========
function initializeSocketIO(gameId, role) {
    console.log('🔗 Initialisation de Socket.IO...');
    
    // Connexion au serveur Socket.io
    window.gameSocket = io();
    
    window.gameSocket.emit('reconnectGame', { gameId, role });
    
    // Écouter les votes du partenaire
    window.gameSocket.on('partnerVotes', (votes) => {
        if (typeof chess !== 'undefined' && chess.turn() !== window.playerColor[0]) {
            // C'est le tour du partenaire, afficher ses votes
            if (typeof updatePartnerVotesDisplay === 'function') {
                updatePartnerVotesDisplay(votes);
            }
        }
    });
    
    // Synchroniser les mouvements
    window.gameSocket.on('movePlayed', (data) => {
        if (data.player !== window.playerColor && typeof chess !== 'undefined' && typeof board !== 'undefined') {
            // Le partenaire a joué, appliquer le coup
            chess.move(data.move);
            board.position(chess.fen());
        }
    });
    
    console.log('✅ Socket.IO initialisé pour le jeu:', gameId);
}

// ========== Détection et initialisation du mode multiplayer ==========
function detectMultiplayerMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    const role = urlParams.get('role');

    if (gameId && role) {
        window.multiplayerMode = true;
        window.currentGameId = gameId;
        window.playerColor = (role === 'host') ? 'white' : 'black';
        
        console.log('🎮 Mode multiplayer détecté:', { gameId, role, playerColor: window.playerColor });
        
        // Check if we have a server URL or if we should always load Socket.IO
        if (window.CHESS_VOTER_CONFIG.serverUrl || true) { // Set to true to always load
            const script = document.createElement('script');
            script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
            script.onload = function() {
                console.log('✅ Socket.io chargé avec succès');
                initializeSocketIO(gameId, role);
            };
            script.onerror = function() {
                console.error('❌ Erreur lors du chargement de Socket.io');
            };
            document.head.appendChild(script);
        }
    } else {
        console.log('🎯 Mode solo détecté - Socket.IO non chargé');
    }
}

// ========== Fonctions utilitaires ==========
function showNotification(message, type = 'info') {
    console.log(`${type.toUpperCase()}: ${message}`);
    
    // Créer une notification personnalisée
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#48bb78' : type === 'error' ? '#f56565' : '#4299e1'};
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        z-index: 10000;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Suppression automatique
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// ========== Initialisation principale ==========
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initialisation des gestionnaires DOM...');
    
    // Configuration des différents composants
    setupConfigModal();
    setupMultiplayerTabs();
    setupMultiplayerButtons();
    setupCopyButtons();
    
    // Détection du mode multiplayer
    detectMultiplayerMode();
    
    console.log('✅ Gestionnaires DOM initialisés');
});

// ========== Export pour utilisation externe ==========
window.DOMHandlers = {
    showNotification,
    setupConfigModal,
    setupMultiplayerTabs,
    setupMultiplayerButtons,
    setupCopyButtons,
    detectMultiplayerMode,
    initializeSocketIO
};