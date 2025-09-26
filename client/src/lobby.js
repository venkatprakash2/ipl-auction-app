const socket = io();

// --- DOM ELEMENTS ---
const joinCreateView = document.getElementById('join-create-view');
const waitingRoomView = document.getElementById('waiting-room-view');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const errorMessage = document.getElementById('error-message');
const roomCodeDisplay = document.getElementById('room-code-display');
const playerList = document.getElementById('player-list');
const startGameBtn = document.getElementById('start-game-btn');
const waitingForHostMsg = document.getElementById('waiting-for-host-msg');
const lobbyTeamGrid = document.getElementById('lobby-team-grid');

// --- PERSISTENT PLAYER ID ---
let playerId = localStorage.getItem('playerId');
if (!playerId) {
    playerId = 'player_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('playerId', playerId);
}

let isHost = false;
let roomCode = '';
let myTeam = null;

const teams = [
    { code: "CSK", name: "Chennai Super Kings" }, { code: "MI", name: "Mumbai Indians" },
    { code: "RCB", name: "Royal Challengers Bengaluru" }, { code: "KKR", name: "Kolkata Knight Riders" },
    { code: "SRH", name: "Sunrisers Hyderabad" }, { code: "DC", name: "Delhi Capitals" },
    { code: "PBKS", name: "Punjab Kings" }, { code: "RR", name: "Rajasthan Royals" },
    { code: "GT", name: "Gujarat Titans" }, { code: "LSG", name: "Lucknow Super Giants" }
];

// --- EVENT LISTENERS ---
createRoomBtn.addEventListener('click', () => socket.emit('createRoom', playerId));
joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.toUpperCase();
    if (code) socket.emit('joinRoom', { roomCode: code, playerId });
});
startGameBtn.addEventListener('click', () => socket.emit('requestStartGame', { roomCode, playerId }));

// --- SERVER EVENT HANDLERS ---
socket.on('roomCreated', (data) => showWaitingRoom(data.roomCode, true));
socket.on('joinSuccess', (data) => showWaitingRoom(data.roomCode, false));
socket.on('joinError', (message) => {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
});

socket.on('updateLobbyState', (lobbyState) => {
    // Update Player List
    playerList.innerHTML = '';
    lobbyState.players.forEach(player => {
        const li = document.createElement('li');
        const teamName = player.team ? `(${player.team.name})` : '(Picking team...)';
        const isMe = player.playerId === playerId;
        li.textContent = `${player.name} ${teamName}` + (player.isHost ? ' (Host)' : '') + (isMe ? ' (You)' : '');
        if (isMe) li.style.fontWeight = 'bold';
        playerList.appendChild(li);
    });

    // Update Team Grid
    renderTeamGrid(lobbyState.availableTeams);

    // Check if host can start the game
    if (isHost) {
        const allPlayersReady = lobbyState.players.every(p => p.team);
        startGameBtn.disabled = !allPlayersReady;
    }
});

socket.on('gameStarting', (data) => {
    if (!myTeam) {
        alert("Please select a team before the game starts!");
        return;
    }
    console.log('Game is starting! Redirecting to auction room...');
    window.location.href = `/auction.html?room=${data.roomCode}&team=${myTeam.code}`;
});

// --- UI FUNCTIONS ---
function showWaitingRoom(code, hostStatus) {
    roomCode = code;
    isHost = hostStatus;
    joinCreateView.classList.add('hidden');
    waitingRoomView.classList.remove('hidden');
    roomCodeDisplay.textContent = roomCode;
    if (isHost) startGameBtn.classList.remove('hidden');
    else waitingForHostMsg.classList.remove('hidden');
}

function renderTeamGrid(availableTeams) {
    lobbyTeamGrid.innerHTML = '';
    teams.forEach(team => {
        const teamCard = document.createElement('div');
        teamCard.classList.add('team-card', 'lobby-team-card');
        const isAvailable = availableTeams.some(at => at.code === team.code);
        const hasBeenPickedByMe = myTeam && myTeam.code === team.code;

        if (hasBeenPickedByMe) {
            teamCard.classList.add('selected');
        } else if (!isAvailable) {
            teamCard.classList.add('taken');
        } else {
            teamCard.addEventListener('click', () => selectTeam(team));
        }
        
        const logo = document.createElement('img');
        logo.src = `/public/images/team-logos/${team.code}.png`;
        logo.classList.add('team-logo');
        teamCard.appendChild(logo);
        lobbyTeamGrid.appendChild(teamCard);
    });
}

function selectTeam(team) {
    myTeam = team;
    socket.emit('selectTeam', { roomCode, playerId, teamData: team });
}