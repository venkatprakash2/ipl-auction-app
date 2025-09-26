// This file controls the auction.html page for a specific multiplayer room

const socket = io();

// --- STATE MANAGEMENT ---
let myTeam = null;
let mySquad = [];
let myPurse = 12500;
let currentBid = 0;
let currentPlayer = null;
let roomCode = null;
let playerId = null;
let passedOnCurrentPlayer = false;
let auctionState = { playerPool: [] };

// --- DOM ELEMENTS ---
const myTeamLogo = document.getElementById('my-team-logo');
const myTeamName = document.getElementById('my-team-name');
const myTeamPurse = document.getElementById('my-team-purse');
const preAuctionView = document.getElementById('pre-auction-view');
const auctionView = document.getElementById('auction-view');
const playerCardContainer = document.getElementById('player-card-container');
const currentBidAmountSpan = document.getElementById('current-bid-amount');
const currentBidTeamSpan = document.getElementById('current-bid-team');
const bidTimerContainer = document.getElementById('bid-timer-container');
const bidTimerProgressBar = document.getElementById('bid-timer-progress-bar');
const bidTimerDisplay = document.getElementById('bid-timer');
const squadList = document.getElementById('squad-list');
const auctionLogList = document.getElementById('auction-log-list');
const allTeamsDisplay = document.getElementById('all-teams-display');

// --- TEAM DATA ---
const teams = [
    { code: "CSK", name: "Chennai Super Kings" }, { code: "MI", name: "Mumbai Indians" },
    { code: "RCB", name: "Royal Challengers Bengaluru" }, { code: "KKR", name: "Kolkata Knight Riders" },
    { code: "SRH", name: "Sunrisers Hyderabad" }, { code: "DC", name: "Delhi Capitals" },
    { code: "PBKS", name: "Punjab Kings" }, { code: "RR", name: "Rajasthan Royals" },
    { code: "GT", name: "Gujarat Titans" }, { code: "LSG", name: "Lucknow Super Giants" }
];

// --- HELPER FUNCTIONS ---
function formatCurrency(amountLakhs) { return `₹${(amountLakhs / 100).toFixed(2)} Cr`; }
function calculateNextBid(currentAmount) {
    if (currentAmount < 100) return currentAmount + 5;
    if (currentAmount < 200) return currentAmount + 10;
    return currentAmount + 20;
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    roomCode = params.get('room');
    const teamCode = params.get('team');
    playerId = localStorage.getItem('playerId');

    if (roomCode && teamCode && playerId) {
        myTeam = teams.find(t => t.code === teamCode);
        if (myTeam) {
            socket.emit('identify', { roomCode, playerId });
            if (sessionStorage.getItem(`inAuction_${roomCode}`)) {
                preAuctionView.innerHTML = '<h3>Rejoining auction...</h3>';
                socket.emit('requestFullState', { roomCode, playerId });
            } else {
                socket.emit('registerTeam', { roomCode, playerId, teamData: { code: myTeam.code, name: myTeam.name } });
                initializeAuctionRoom(true);
            }
        }
    } else {
        document.body.innerHTML = '<h1>Error: Missing data. <a href="/lobby.html">Go to Lobby</a></h1>';
    }
});

function initializeAuctionRoom(isFirstJoin = false) {
    if (!myTeam) return;
    myTeamLogo.src = `/public/images/team-logos/${myTeam.code}.png`;
    myTeamName.textContent = myTeam.name;
    myTeamPurse.textContent = formatCurrency(myPurse);
    if (isFirstJoin) {
        logAuctionEvent('Welcome! Waiting for players...');
        preAuctionView.innerHTML = '<h3>Waiting for all players...</h3>';
    }
}

// --- SERVER EVENT LISTENERS ---
socket.on('fullAuctionState', (data) => {
    try {
        const room = data.room;
        myTeam = data.myTeam;
        if (!room || !myTeam || !room.teams || !room.teams[myTeam.code]) return;
        
        const myTeamOnServer = room.teams[myTeam.code];
        mySquad = myTeamOnServer.squad || [];
        myPurse = myTeamOnServer.purse;
        auctionState.playerPool = room.playerPool || [];
        currentPlayer = room.playerPool[room.currentPlayerIndex];
        currentBid = room.currentBid;
        passedOnCurrentPlayer = room.passedTeams.includes(myTeam.code);

        initializeAuctionRoom(false);
        myTeamPurse.textContent = formatCurrency(myPurse);
        updateSquadUI();
        updateAllTeamsDisplay(room.teams);

        if (room.isAuctionRunning && currentPlayer) {
            preAuctionView.classList.add('hidden');
            auctionView.classList.remove('hidden');
            updatePlayerCard(currentPlayer);
            const bidButtonsContainer = document.getElementById('bid-buttons');
            if (passedOnCurrentPlayer) {
                bidButtonsContainer.innerHTML = '<p class="passed-text">You have passed on this player.</p>';
            } else {
                bidButtonsContainer.innerHTML = `
                    <button id="bid-button" class="btn">Bid</button>
                    <button id="pass-button" class="btn btn-secondary">Pass</button>
                `;
                document.getElementById('bid-button').addEventListener('click', handleBid);
                document.getElementById('pass-button').addEventListener('click', handlePass);
            }
            currentBidAmountSpan.textContent = formatCurrency(room.currentBid);
            if (room.currentBidder === 'Base Price') {
                 currentBidTeamSpan.textContent = 'Base Price';
            } else if (room.teams[room.currentBidder]) {
                 currentBidTeamSpan.textContent = room.teams[room.currentBidder].displayName;
            }
            checkBidEligibility();
        } else if (room.isAuctionRunning) {
             preAuctionView.innerHTML = '<h3>Waiting for next player...</h3>';
        } else {
            preAuctionView.innerHTML = '<h3>Waiting for auction to start...</h3>';
        }
    } catch (error) {
        console.error("Error processing fullAuctionState:", error);
    }
});

socket.on('nextPlayer', (player) => {
    sessionStorage.setItem(`inAuction_${roomCode}`, 'true');
    auctionState.playerPool.push(player);
    passedOnCurrentPlayer = false; 
    currentPlayer = player;
    
    const existingOverlay = playerCardContainer.querySelector('.player-card-sold-overlay');
    if (existingOverlay) existingOverlay.remove();

    const bidButtonsContainer = document.getElementById('bid-buttons');
    bidButtonsContainer.innerHTML = `
        <button id="bid-button" class="btn">Bid</button>
        <button id="pass-button" class="btn btn-secondary">Pass</button>
    `;
    document.getElementById('bid-button').addEventListener('click', handleBid);
    document.getElementById('pass-button').addEventListener('click', handlePass);
    
    preAuctionView.classList.add('hidden');
    auctionView.classList.remove('hidden');
    updatePlayerCard(player);
    logAuctionEvent(`${player.name} is up for auction.`);
    resetTimerDisplay();
    checkBidEligibility();
});

socket.on('auctionUpdate', (data) => {
    if (data.currentBid !== undefined) {
        currentBid = data.currentBid;
        currentBidAmountSpan.textContent = formatCurrency(data.currentBid);
    }
    if (data.currentBidder !== undefined) {
        currentBidTeamSpan.textContent = data.currentBidder;
    }
    if (data.timeLeft !== undefined && data.timeLeft !== null) {
        updateTimerDisplay(data.timeLeft);
    } else if (data.timeLeft === null) {
        bidTimerContainer.classList.add('hidden');
    }
    if (data.message) {
        auctionView.innerHTML = `<h2>${data.message}</h2>`;
        bidTimerContainer.classList.add('hidden');
        sessionStorage.removeItem(`inAuction_${roomCode}`);
    }
    if(data.teams) {
        updateAllTeamsDisplay(data.teams);
    }
    checkBidEligibility();
});

socket.on('playerSold', (data) => {
    if (data.team === "Unsold") {
        logAuctionEvent(`${data.playerName} went unsold.`);
    } else {
        logAuctionEvent(`${data.playerName} sold to ${data.team} for ${formatCurrency(data.amount)}!`);
        showSoldOverlay(formatCurrency(data.amount));
    }
    if (data.teamCode === myTeam.code) {
        myPurse -= data.amount;
        const playerObject = auctionState.playerPool.find(p => p.name === data.playerName);
        if (playerObject) mySquad.push(playerObject);
        updateSquadUI();
        myTeamPurse.textContent = formatCurrency(myPurse);
    }
});

socket.on('auctionConcluded', (data) => {
    logAuctionEvent("Auction has concluded! Generating summary...");
    sessionStorage.removeItem(`inAuction_${data.roomCode}`);
    setTimeout(() => {
        window.location.href = `/summary.html?room=${data.roomCode}`;
    }, 2000);
});

// --- UI UPDATE & ELIGIBILITY FUNCTIONS ---
function updatePlayerCard(player) {
    auctionView.innerHTML = `
        <h2 class="player-name">${player.name}</h2>
        <p class="player-details">${player.country} | ${player.skill}</p>
        <p class="player-base-price">Base Price: ${formatCurrency(player.basePrice)}</p>
    `;
}
function updateSquadUI() {
    squadList.innerHTML = '';
    mySquad.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.name} (${player.skill})`;
        squadList.appendChild(li);
    });
    const squadCountHeader = document.querySelector('#my-squad h3');
    squadCountHeader.textContent = `My Squad (${mySquad.length}/25)`;
}
function logAuctionEvent(message) {
    const li = document.createElement('li');
    li.textContent = message;
    auctionLogList.prepend(li);
}
function checkBidEligibility() {
    if (!myTeam || !currentPlayer) return;
    const squadSize = mySquad.length;
    const overseasCount = mySquad.filter(p => p.country !== 'India').length;
    let canBid = true;
    if (passedOnCurrentPlayer || squadSize >= 25 || (currentPlayer.country !== 'India' && overseasCount >= 8) || currentBidTeamSpan.textContent === myTeam.name) {
        canBid = false;
    }
    const bidButton = document.getElementById('bid-button');
    if (bidButton) {
        bidButton.disabled = !canBid;
    }
}
function updateTimerDisplay(timeLeft) {
    bidTimerContainer.classList.remove('hidden');
    bidTimerDisplay.textContent = timeLeft;
    const totalTime = 10;
    const progressPercentage = (timeLeft / totalTime) * 100;
    bidTimerProgressBar.style.height = `${progressPercentage}%`;
    bidTimerContainer.classList.remove('warning', 'critical');
    if (timeLeft <= 3) {
        bidTimerContainer.classList.add('critical');
    } else if (timeLeft <= 6) {
        bidTimerContainer.classList.add('warning');
    }
}
function resetTimerDisplay() {
    bidTimerContainer.classList.add('hidden');
    bidTimerProgressBar.style.height = '100%';
    bidTimerContainer.classList.remove('warning', 'critical');
    bidTimerDisplay.textContent = '';
}
function showSoldOverlay(finalPrice) {
    const soldOverlay = document.createElement('div');
    soldOverlay.classList.add('player-card-sold-overlay');
    soldOverlay.innerHTML = `SOLD! <div style="font-size: 0.5em;">${finalPrice}</div>`;
    playerCardContainer.appendChild(soldOverlay);
}
function updateAllTeamsDisplay(teamsData) {
    allTeamsDisplay.innerHTML = '';
    for (const teamCode in teamsData) {
        const team = teamsData[teamCode];
        const teamDiv = document.createElement('div');
        teamDiv.classList.add('team-item');
        teamDiv.setAttribute('data-team-name', team.displayName);
        teamDiv.innerHTML = `<strong>${team.displayName}</strong>: ${formatCurrency(team.purse)}`;
        allTeamsDisplay.appendChild(teamDiv);
    }
}

// --- USER ACTIONS ---
function handleBid() {
    const nextBid = calculateNextBid(currentBid);
    if (myPurse >= nextBid) {
        socket.emit('bid', { roomCode, bidData: { teamCode: myTeam.code, amount: nextBid } });
    } else {
        alert("You don't have enough purse to make this bid!");
    }
}
function handlePass() {
    passedOnCurrentPlayer = true;
    socket.emit('pass', { roomCode, teamCode: myTeam.code });
    const bidButtonsContainer = document.getElementById('bid-buttons');
    bidButtonsContainer.innerHTML = '<p class="passed-text">You have passed on this player.</p>';
}