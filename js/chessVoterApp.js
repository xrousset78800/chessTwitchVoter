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

$(document).ready(function() {
		//addPhantomBridgeControls();

        preloadThemesForMenu();
        updatePageTitle();

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
if (gameMode !== "probMode") {
	loadNewgame();
} else {
  loadNewProblem();
}


/***********************************************************************************************************************/
/**********************************     OMG Voter     *****************************************************************/
/***********************************************************************************************************************/



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
	}	else if(modStreamerChatvStreamerChat) {
    p1 = streamer1Channel + " chat";
    p2 = streamer2Channel + " chat";
	} else{
		p1 = "*";
		p2 = "*";
	}
	vs = " - "+p1+" vs "+p2;

	if(chess.turn() == 'b') {
		defaultConfig.orientation='black';
		teamToPlay = 1;
	} else {
		defaultConfig.orientation='white';
		teamToPlay = 0;
	}

	if(timerMode == true) {
		startTimer(InitialvoterTimer, true);
	}

	refreshBoard(chess);
	board = Chessboard('myBoard', defaultConfig);
	//var overlay = new ChessboardArrows('board_wrapper');


	var moves = chess.moves();
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
    console.log('🎯 Problème sélectionné:', prob);

    currentProbPgn = prob[1];
    chess = new Chess(prob[1]);
    defaultConfig.position = prob[1];
    teamToPlay = 0;

    if(chess.turn() == 'b') {
        defaultConfig.orientation='white';
    } else {
        defaultConfig.orientation='black';
    }

    $("[data-opening-tags]").text(prob[9] || '');
    $("[data-tags]").text(prob[7] || '');
    $("#configBadge b").text("ELO : " + (prob[3] || 'N/A'));
    
    $("[data-omgSolution]").text(prob[2]);
    $("[data-attempt]").attr("data-attempt", 0);
    $("[data-length]").attr('data-length', prob[2].split(" ").length);
    $("[data-length]").text(prob[2].split(" ").length/2);
    board = Chessboard('myBoard', defaultConfig);
    
    firstMove = playPbm();
    console.log("first move");
    moveAction(firstMove);
    var moves = chess.moves();
    refreshBoard(chess);

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

    if (multiplayerMode && chess.turn() === playerColor[0]) {
        gameSocket.emit('votesUpdate', {
            gameId: currentGameId,
            votes: poll,
            turn: chess.turn()
        });
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
			$("[data-square]").removeClass("highlight-black");
			$("[data-square="+tmp.slice(0,2)+"]").addClass("highlight-black");
			$("[data-square="+tmp.slice(2,4)+"]").addClass("highlight-black");		
			

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
    // Récupérer la pièce à la position de départ
    const piece = chess.get(c1);
    if (!piece) return null;

    // Vérifier si c'est une promotion de pion
    const isPromotion = (piece.type === 'p' && (c2[1] === '8' || c2[1] === '1'));
    
    // Vérifier si c'est une capture
    const isCapture = chess.get(c2) !== null;

    // Vérifier si c'est un roque
    const isKing = piece.type === 'k';
    const isKingSideCastle = isKing && c1 === 'e1' && c2 === 'g1' || c1 === 'e8' && c2 === 'g8';
    const isQueenSideCastle = isKing && c1 === 'e1' && c2 === 'c1' || c1 === 'e8' && c2 === 'c8';

    // Obtenir tous les coups possibles qui mènent à la case cible
    const legalMoves = chess.moves({ verbose: true })
        .filter(m => m.to === c2 && m.piece === piece.type);

    // Tester le coup
    try {
        const moveAttempt = {
            from: c1,
            to: c2
        };

        // Ajouter la promotion si nécessaire
        if (isPromotion && promotion) {
            moveAttempt.promotion = promotion;
        }

        const move = chess.move(moveAttempt);
        if (!move) return null;

        // Annuler le coup pour permettre d'autres tests
        chess.undo();

        // Gérer les cas spéciaux
        if (isKingSideCastle) return 'O-O';
        if (isQueenSideCastle) return 'O-O-O';

        let notation = '';

        // Ajouter la pièce (sauf pour les pions)
        if (piece.type !== 'p') {
            notation += piece.type.toUpperCase();
        }

        // Gérer l'ambiguïté
				if (legalMoves.length > 1) {
				    // Vérifier s'il y a des pièces sur différentes colonnes (même rangée)
				    const differentFiles = legalMoves.some(m => m.from[0] !== c1[0]);
				    // Vérifier s'il y a des pièces sur différentes rangées (même colonne) 
				    const differentRanks = legalMoves.some(m => m.from[1] !== c1[1]);
				    
				    if (differentFiles && !differentRanks) {
				        // Pièces sur même rangée, colonnes différentes -> spécifier la colonne
				        notation += c1[0];
				    } else if (differentRanks && !differentFiles) {
				        // Pièces sur même colonne, rangées différentes -> spécifier la rangée
				        notation += c1[1];
				    } else if (differentFiles && differentRanks) {
				        // Pièces sur colonnes ET rangées différentes -> spécifier la colonne par défaut
				        notation += c1[0];
				    }
				}

        // Ajouter le 'x' pour les captures
        if (isCapture) notation += 'x';

        // Ajouter la destination
        notation += c2;

        // Ajouter la promotion
        if (isPromotion && promotion) {
            notation += '=' + promotion.toUpperCase();
        }

        // Ajouter le check/mate si présent
        if (move.san.endsWith('+')) notation += '+';
        if (move.san.endsWith('#')) notation += '#';

        return notation;

    } catch (error) {
        console.error('Error converting move notation:', error);
        return null;
    }
}

function playPbm(){
    let idx = parseInt($("[data-attempt]").attr("data-attempt"));
    let arrMoves = $("[data-omgSolution]").text().split(" ");
    
    let c1 = arrMoves[idx].slice(0, 2);
    let c2 = arrMoves[idx].slice(2, 4);
    let promotion = arrMoves[idx].slice(4, 5) || '';  // Gestion de la promotion

    $("[data-square]").removeClass("highlight-white");
    $("[data-square="+c1+"]").addClass("highlight-white");
    $("[data-square="+c2+"]").addClass("highlight-white");

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
	
	startPauseTimer(pauseAfterWinLose, function() {
		$("body").removeClass('omg-win');		
		$("body").removeClass('omg-lose');
		loadNewProblem();
		$("[data-square]").removeClass("highlight-black");
	});
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
        setTimeout(refreshPlayerDisplay, 100);
    playSoundForMove(chess)


    if (window.multiplayerMode && window.gameSocket && !isFromNetwork) {
        console.log('🎯 Émission du coup vers le serveur:', move);
        window.gameSocket.emit('moveSelected', {
            gameId: window.currentGameId,
            player: window.playerColor,
            move: move,
            fen: chess.fen()
        });
    }


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

			// FUNCTION MOVE
			//client.say(target, `@${context.username} vote for ${move}`);
			
			// Move = resetTimeOut  + nouveau coup		
            if(timerMode && gameMode === 'normal') {
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

