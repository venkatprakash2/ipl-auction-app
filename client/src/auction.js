/**
 * @fileoverview IPL Auction Room Client-Side Controller
 * @description This file manages the real-time auction interface for IPL team bidding.
 * Handles player auctions, bid management, squad tracking, and real-time updates.
 * @author IPL Auction App Team
 * @version 1.0.0
 */

/**
 * Socket.IO connection instance for real-time communication with auction server
 * @type {Socket}
 */
const socket = io();

// --- STATE MANAGEMENT ---

/**
 * Current user's selected team data
 * @type {Object|null}
 * @property {string} code - Team code (e.g., 'CSK', 'MI')
 * @property {string} name - Full team name (e.g., 'Chennai Super Kings')
 */
let myTeam = null;

/**
 * Array of players purchased by the current user's team
 * @type {Array<Object>}
 * @property {string} name - Player name
 * @property {string} country - Player's country
 * @property {string} skill - Player's primary skill (Batsman, Bowler, etc.)
 * @property {number} finalPrice - Amount paid for the player in lakhs
 */
let mySquad = [];

/**
 * Current team's remaining budget in lakhs (₹)
 * @type {number}
 * @default 12500
 */
let myPurse = 12500;

/**
 * Current highest bid amount for the active player in lakhs
 * @type {number}
 * @default 0
 */
let currentBid = 0;

/**
 * Currently auctioned player object
 * @type {Object|null}
 * @property {string} name - Player name
 * @property {string} country - Player's country
 * @property {string} skill - Player's role/skill
 * @property {number} basePrice - Minimum bid amount in lakhs
 */
let currentPlayer = null;

/**
 * Current auction room code
 * @type {string|null}
 */
let roomCode = null;

/**
 * Unique identifier for the current user
 * @type {string|null}
 */
let playerId = null;

/**
 * Flag indicating if current user has passed on the active player
 * @type {boolean}
 * @default false
 */
let passedOnCurrentPlayer = false;

/**
 * Global auction state containing all auction data
 * @type {Object}
 * @property {Array} playerPool - All players that have been auctioned
 */
let auctionState = { playerPool: [] };

// --- DOM ELEMENTS ---

/**
 * @description DOM element references for auction interface
 */
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

/**
 * Static array of all IPL teams with their codes and full names
 * @type {Array<Object>}
 * @constant
 * @property {string} code - Short team code
 * @property {string} name - Full team name
 */
const teams = [
    { code: "CSK", name: "Chennai Super Kings" }, 
    { code: "MI", name: "Mumbai Indians" },
    { code: "RCB", name: "Royal Challengers Bengaluru" }, 
    { code: "KKR", name: "Kolkata Knight Riders" },
    { code: "SRH", name: "Sunrisers Hyderabad" }, 
    { code: "DC", name: "Delhi Capitals" },
    { code: "PBKS", name: "Punjab Kings" }, 
    { code: "RR", name: "Rajasthan Royals" },
    { code: "GT", name: "Gujarat Titans" }, 
    { code: "LSG", name: "Lucknow Super Giants" }
];

// --- HELPER FUNCTIONS ---

/**
 * Formats currency amount from lakhs to crores with proper symbol
 * @param {number} amountLakhs - Amount in lakhs (₹)
 * @returns {string} Formatted currency string (e.g., "₹1.25 Cr")
 * @example
 * formatCurrency(125) // Returns "₹1.25 Cr"
 * formatCurrency(50) // Returns "₹0.50 Cr"
 */
function formatCurrency(amountLakhs) { 
    return `₹${(amountLakhs / 100).toFixed(2)} Cr`; 
}

/**
 * Calculates the next valid bid amount based on current bid
 * @param {number} currentAmount - Current highest bid in lakhs
 * @returns {number} Next valid bid amount in lakhs
 * @description Implements IPL auction bidding increments:
 * - Below ₹1 Cr: ₹5 lakh increments
 * - ₹1-2 Cr: ₹10 lakh increments  
 * - Above ₹2 Cr: ₹20 lakh increments
 * @example
 * calculateNextBid(50) // Returns 55 (₹5L increment)
 * calculateNextBid(150) // Returns 160 (₹10L increment)
 * calculateNextBid(250) // Returns 270 (₹20L increment)
 */
function calculateNextBid(currentAmount) {
    if (currentAmount < 100) return currentAmount + 5;
    if (currentAmount < 200) return currentAmount + 10;
    return currentAmount + 20;
}

// --- INITIALIZATION ---

/**
 * Initializes the auction room when page loads
 * @description Extracts room code and team from URL parameters,
 * validates user session, and sets up auction interface
 * @listens DOMContentLoaded
 */
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    roomCode = params.get('room');
    const teamCode = params.get('team');
    playerId = localStorage.getItem('playerId');

    if (roomCode && teamCode && playerId) {
        myTeam = teams.find(t => t.code === teamCode);
        initializeAuctionRoom(true);
        
        // Register team and request full state
        socket.emit('registerTeam', {
            roomCode,
            playerId,
            teamData: myTeam
        });
        
        socket.emit('requestFullState', {
            roomCode,
            playerId
        });
    } else {
        alert('Invalid session. Redirecting to dashboard.');
        window.location.href = '/';
    }
});

/**
 * Sets up the auction room interface with user's team data
 * @param {boolean} [isFirstJoin=false] - Whether this is the user's first time joining
 * @description Updates team logo, name, purse display and requests current auction state
 */
function initializeAuctionRoom(isFirstJoin = false) {
    if (!myTeam) return;
    
    myTeamLogo.src = `/public/images/team-logos/${myTeam.code}.png`;
    myTeamName.textContent = myTeam.name;
    myTeamPurse.textContent = formatCurrency(myPurse);
    
    if (isFirstJoin) {
        // Request current state from server
        socket.emit('requestAuctionState', { roomCode, playerId });
    }
}

// --- SERVER EVENT LISTENERS ---

/**
 * Handles complete auction state received from server
 * @param {Object} data - Complete auction state data
 * @param {Array} data.teams - All teams with their squads and purses
 * @param {Object} data.currentPlayer - Currently auctioned player
 * @param {number} data.currentBid - Current highest bid
 * @param {string} data.currentBidder - Team code of current highest bidder
 * @listens fullAuctionState
 */
socket.on('fullAuctionState', (data) => {
    try {
        // Update local state with server data
        if (data.teams && data.teams[myTeam.code]) {
            const myTeamData = data.teams[myTeam.code];
            mySquad = myTeamData.squad || [];
            myPurse = myTeamData.purse || 12500;
        }
        
        // Update current auction state
        if (data.currentPlayer) {
            currentPlayer = data.currentPlayer;
            currentBid = data.currentBid || currentPlayer.basePrice;
            updatePlayerCard(currentPlayer);
        }
        
        // Update UI elements
        updateSquadUI();
        updateAllTeamsDisplay(data.teams);
        
    } catch (error) {
        console.error('Error processing full auction state:', error);
    }
});

/**
 * Handles new player being put up for auction
 * @param {Object} player - Player object being auctioned
 * @param {string} player.name - Player's name
 * @param {string} player.country - Player's country
 * @param {string} player.skill - Player's primary skill
 * @param {number} player.basePrice - Minimum bid amount
 * @listens nextPlayer
 */
socket.on('nextPlayer', (player) => {
    // Mark auction as active in session storage
    sessionStorage.setItem(`inAuction_${roomCode}`, 'true');
    auctionState.playerPool.push(player);
    passedOnCurrentPlayer = false; 
    currentPlayer = player;
    
    // Remove any existing sold overlay
    const existingOverlay = playerCardContainer.querySelector('.player-card-sold-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Create bid action buttons
    const bidButtonsContainer = document.getElementById('bid-buttons');
    bidButtonsContainer.innerHTML = `
        <button id="bid-button" class="btn">Bid</button>
        <button id="pass-button" class="btn btn-secondary">Pass</button>
    `;
    
    // Attach event listeners to new buttons
    document.getElementById('bid-button').addEventListener('click', handleBid);
    document.getElementById('pass-button').addEventListener('click', handlePass);
    
    // Update UI for new auction
    preAuctionView.classList.add('hidden');
    auctionView.classList.remove('hidden');
    updatePlayerCard(player);
    logAuctionEvent(`${player.name} is up for auction.`);
    resetTimerDisplay();
    checkBidEligibility();
});

/**
 * Handles real-time auction updates (bids, timer, etc.)
 * @param {Object} data - Auction update data
 * @param {number} [data.currentBid] - Updated bid amount
 * @param {string} [data.currentBidder] - Updated bidder team code
 * @param {number} [data.timeLeft] - Remaining time in seconds
 * @param {string} [data.message] - Auction event message
 * @param {Object} [data.teams] - Updated team data
 * @listens auctionUpdate
 */
socket.on('auctionUpdate', (data) => {
    // Update bid information
    if (data.currentBid !== undefined) {
        currentBid = data.currentBid;
        currentBidAmountSpan.textContent = formatCurrency(currentBid);
    }
    
    // Update bidder information
    if (data.currentBidder !== undefined) {
        const bidderTeam = teams.find(t => t.code === data.currentBidder);
        currentBidTeamSpan.textContent = bidderTeam ? bidderTeam.name : 'No bids yet';
    }
    
    // Update timer display
    if (data.timeLeft !== undefined && data.timeLeft !== null) {
        updateTimerDisplay(data.timeLeft);
    } else {
        resetTimerDisplay();
    }
    
    // Log auction events
    if (data.message) {
        logAuctionEvent(data.message);
    }
    
    // Update team displays
    if(data.teams) {
        updateAllTeamsDisplay(data.teams);
    }
    
    // Recheck bid eligibility
    checkBidEligibility();
});

/**
 * Handles player being sold or going unsold
 * @param {Object} data - Player sale data
 * @param {string} data.team - "Unsold" or winning team code
 * @param {string} [data.teamCode] - Winning team code (if sold)
 * @param {number} [data.finalPrice] - Final sale price in lakhs
 * @param {Object} data.player - Sold player object
 * @listens playerSold
 */
socket.on('playerSold', (data) => {
    if (data.team === "Unsold") {
        logAuctionEvent(`${data.player.name} went unsold.`);
    } else {
        const teamName = teams.find(t => t.code === data.teamCode)?.name || data.team;
        logAuctionEvent(`${data.player.name} sold to ${teamName} for ${formatCurrency(data.finalPrice)}.`);
    }
    
    // Update squad if current user won the player
    if (data.teamCode === myTeam.code) {
        mySquad.push({...data.player, finalPrice: data.finalPrice});
        myPurse -= data.finalPrice;
        updateSquadUI();
        myTeamPurse.textContent = formatCurrency(myPurse);
    }
});

/**
 * Handles auction conclusion and redirect to results
 * @param {Object} data - Auction conclusion data
 * @param {string} data.roomCode - Room code for results page
 * @listens auctionConcluded
 */
socket.on('auctionConcluded', (data) => {
    logAuctionEvent("Auction has concluded! Generating summary...");
    sessionStorage.removeItem(`inAuction_${data.roomCode}`);
    
    setTimeout(() => {
        window.location.href = `/results.html?room=${data.roomCode}`;
    }, 2000);
});

// --- UI UPDATE & ELIGIBILITY FUNCTIONS ---

/**
 * Updates the player card display with current player information
 * @param {Object} player - Player object to display
 * @param {string} player.name - Player's name
 * @param {string} player.country - Player's country
 * @param {string} player.skill - Player's role/skill
 * @param {number} player.basePrice - Player's base price
 */
function updatePlayerCard(player) {
    auctionView.innerHTML = `
        <h2 class="player-name">${player.name}</h2>
        <p class="player-details">${player.country} | ${player.skill}</p>
        <p class="player-base-price">Base Price: ${formatCurrency(player.basePrice)}</p>
    `;
}

/**
 * Updates the user's squad display with current players
 * @description Refreshes the squad list UI and updates squad count in header
 */
function updateSquadUI() {
    squadList.innerHTML = '';
    mySquad.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.name} - ${formatCurrency(player.finalPrice)}`;
        squadList.appendChild(li);
    });
    
    // Update squad count in header
    const squadCountHeader = document.querySelector('#my-squad h3');
    squadCountHeader.textContent = `My Squad (${mySquad.length}/25)`;
}

/**
 * Adds a message to the auction event log
 * @param {string} message - Message to log in the auction history
 * @description Prepends message to auction log list for chronological order
 */
function logAuctionEvent(message) {
    const li = document.createElement('li');
    li.textContent = message;
    auctionLogList.prepend(li);
}

/**
 * Determines if current user can place a bid on the active player
 * @description Checks squad size, overseas player limits, budget, and bid status
 * Updates bid button state accordingly
 */
function checkBidEligibility() {
    if (!myTeam || !currentPlayer) return;
    
    const squadSize = mySquad.length;
    const overseasCount = mySquad.filter(p => p.country !== 'India').length;
    let canBid = true;
    
    // Check various bid restrictions
    if (passedOnCurrentPlayer || 
        squadSize >= 25 || 
        (currentPlayer.country !== 'India' && overseasCount >= 8) || 
        currentBidTeamSpan.textContent === myTeam.name) {
        canBid = false;
    }
    
    // Update bid button state
    const bidButton = document.getElementById('bid-button');
    if (bidButton) {
        bidButton.disabled = !canBid;
    }
}

/**
 * Updates the bid timer display with remaining time
 * @param {number} timeLeft - Seconds remaining for bidding
 * @description Updates timer display and progress bar, applies warning styles
 */
function updateTimerDisplay(timeLeft) {
    bidTimerContainer.classList.remove('hidden');
    bidTimerDisplay.textContent = timeLeft;
    
    // Update progress bar
    const totalTime = 10;
    const progressPercentage = (timeLeft / totalTime) * 100;
    bidTimerProgressBar.style.height = `${progressPercentage}%`;
    
    // Apply warning styles based on time remaining
    bidTimerContainer.classList.remove('warning', 'critical');
    if (timeLeft <= 3) {
        bidTimerContainer.classList.add('critical');
    } else if (timeLeft <= 5) {
        bidTimerContainer.classList.add('warning');
    }
}

/**
 * Resets timer display to hidden state
 * @description Hides timer, resets progress bar, and removes warning classes
 */
function resetTimerDisplay() {
    bidTimerContainer.classList.add('hidden');
    bidTimerProgressBar.style.height = '100%';
    bidTimerContainer.classList.remove('warning', 'critical');
    bidTimerDisplay.textContent = '';
}

/**
 * Displays sold overlay on player card
 * @param {string} finalPrice - Formatted final sale price
 * @description Creates and displays "SOLD!" overlay with final price
 */
function showSoldOverlay(finalPrice) {
    const soldOverlay = document.createElement('div');
    soldOverlay.classList.add('player-card-sold-overlay');
    soldOverlay.innerHTML = `SOLD! <div style="font-size: 0.5em;">${finalPrice}</div>`;
    playerCardContainer.appendChild(soldOverlay);
}

/**
 * Updates the display showing all teams' current status
 * @param {Object} teamsData - Object containing all team data
 * @param {Object} teamsData[teamCode] - Individual team data with squad and purse
 * @description Updates the sidebar showing all teams' squad counts and remaining budgets
 */
function updateAllTeamsDisplay(teamsData) {
    if (!allTeamsDisplay || !teamsData) return;
    
    allTeamsDisplay.innerHTML = '';
    teams.forEach(team => {
        const teamData = teamsData[team.code];
        if (teamData) {
            const teamDiv = document.createElement('div');
            teamDiv.className = 'team-summary';
            teamDiv.innerHTML = `
                <h4>${team.name}</h4>
                <p>Squad: ${teamData.squad?.length || 0}/25</p>
                <p>Purse: ${formatCurrency(teamData.purse || 12500)}</p>
            `;
            allTeamsDisplay.appendChild(teamDiv);
        }
    });
}

// --- USER ACTIONS ---

/**
 * Handles user clicking the bid button
 * @description Calculates next bid amount and sends bid to server
 * @emits bid - Sends bid data to server
 */
function handleBid() {
    if (!currentPlayer) return;
    
    const nextBid = calculateNextBid(currentBid);
    
    // Check if user has enough budget
    if (nextBid > myPurse) {
        alert('Insufficient funds for this bid!');
        return;
    }
    
    // Send bid to server
    socket.emit('bid', { 
        roomCode, 
        bidData: { 
            teamCode: myTeam.code, 
            amount: nextBid 
        } 
    });
}

/**
 * Handles user clicking the pass button
 * @description Marks user as passed for current player and updates UI
 * @emits pass - Notifies server that user has passed
 */
function handlePass() {
    if (!currentPlayer) return;
    
    passedOnCurrentPlayer = true;
    
    // Send pass notification to server
    socket.emit('pass', { 
        roomCode, 
        teamCode: myTeam.code 
    });
    
    // Update UI to reflect pass status
    checkBidEligibility();
    logAuctionEvent(`You passed on ${currentPlayer.name}.`);
}