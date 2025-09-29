// Import necessary libraries
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// Middleware to log requests
app.use((req, res, next) => {
    console.log(`Request: ${req.method} ${req.url}`);
    next();
});

// Serve static files EXCEPT root
app.use('/public', express.static(path.join(__dirname, '../client/public')));
app.use('/src', express.static(path.join(__dirname, '../client/src')));

// Explicit HTML routes - order matters!
app.get('/', (req, res) => {
    console.log('Serving dashboard.html from root route');
    res.sendFile(path.join(__dirname, '../client/dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dashboard.html'));
});

app.get('/lobby.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/lobby.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/auction.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/auction.html'));
});

app.get('/summary.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/summary.html'));
});

// Serve other static files
app.use(express.static(path.join(__dirname, '../client')));

// --- GLOBAL ROOM MANAGEMENT ---
const rooms = {};

// --- TEAM & AI CONSTANTS ---
const SQUAD_NEEDS = { 'Batsman': 4, 'Bowler': 4, 'All-Rounder': 2, 'Wicket-Keeper': 1 };
const TEAM_CODES = ["CSK", "MI", "RCB", "KKR", "SRH", "DC", "PBKS", "RR", "GT", "LSG"];
const TEAM_NAMES = { CSK: "Chennai Super Kings", MI: "Mumbai Indians", RCB: "Royal Challengers Bengaluru", KKR: "Kolkata Knight Riders", SRH: "Sunrisers Hyderabad", DC: "Delhi Capitals", PBKS: "Punjab Kings", RR: "Rajasthan Royals", GT: "Gujarat Titans", LSG: "Lucknow Super Giants"};

// Enhanced team personalities with more strategic behavior
const TEAM_PERSONALITIES = { 
    CSK: 'Experienced',    // Values experienced players and proven performers
    MI: 'Strategic',       // Balanced approach with focus on match-winners
    RCB: 'Star-Hunter',    // Aggressive bidding for elite players
    PBKS: 'Aggressive',    // High spending, quick decisions
    RR: 'Scout',          // Values young talent and bargain buys
    DC: 'Analytical',     // Data-driven decisions, smart buys
    SRH: 'Value-Focused', // Conservative but will spend on right players
    GT: 'Balanced',       // Well-rounded approach
    KKR: 'Opportunistic', // Waits for the right moment to strike
    LSG: 'Modern'         // Focus on contemporary cricket skills
};

// --- HELPER FUNCTIONS ---
function createNewAuctionState() {
    return {
        hostId: null,
        players: {},
        teams: {},
        playerPool: [],
        availableTeams: TEAM_CODES.map(code => ({ code, name: TEAM_NAMES[code] })),
        isAuctionRunning: false,
        currentPlayerIndex: -1,
        currentBid: 0,
        currentBidder: null,
        bidCount: 0,
        auctionTimer: null,
        participants: {},
        passedTeams: [],
        // Enhanced AI state tracking
        aiBiddingState: {},  // Track AI bidding attempts per player
        competitiveBidding: false  // Flag for elite player auctions
    };
}

function calculateNextBid(currentAmount) {
    if (currentAmount < 100) return currentAmount + 5;
    if (currentAmount < 200) return currentAmount + 10;
    return currentAmount + 20;
}

function initializeTeams(room) {
    room.teams = {};
    TEAM_CODES.forEach(code => {
        room.teams[code] = { 
            name: code, 
            purse: 12500, 
            squad: [], 
            displayName: code,
            // Enhanced AI tracking
            priorityTargets: [],  // Players this team really wants
            biddingHistory: []    // Track bidding patterns
        };
    });
    
    // Initialize AI bidding state
    room.aiBiddingState = {};
    TEAM_CODES.forEach(code => {
        room.aiBiddingState[code] = {
            attemptedBids: 0,
            maxAttempts: 3,
            lastBidTime: 0,
            isActive: true
        };
    });
}

/**
 * Determines AI bidding probability based on player tier and team needs
 */
function getAiBiddingProbability(player, team, room) {
    let baseProbability = 0.5; // Reduced from 0.75
    
    // Tier-based probability boost
    switch (player.tier) {
        case 'Elite': 
            baseProbability = 0.95; // Almost guaranteed to bid on elite players
            break;
        case 'Tier 1': 
            baseProbability = 0.85;
            break;
        case 'Tier 2': 
            baseProbability = 0.70;
            break;
        case 'Uncapped': 
            baseProbability = 0.60;
            break;
    }
    
    // Team personality adjustments
    const personality = TEAM_PERSONALITIES[team.name];
    switch(personality) {
        case 'Star-Hunter':
        case 'Aggressive':
            if (player.tier === 'Elite' || player.tier === 'Tier 1') baseProbability = Math.min(1.0, baseProbability + 0.15);
            break;
        case 'Scout':
            if (player.tier === 'Uncapped' || player.age < 25) baseProbability += 0.20;
            break;
        case 'Value-Focused':
            baseProbability *= 0.8;
            break;
    }
    
    // Need-based probability
    const currentCount = team.squad.filter(p => p.skill === player.skill).length;
    const neededCount = SQUAD_NEEDS[player.skill] || 1;
    if (currentCount < neededCount) {
        baseProbability += 0.25;
    }
    
    return Math.min(1.0, baseProbability);
}

/**
 * Checks if a team should continue bidding aggressively
 */
function shouldContinueBidding(team, player, room, currentAttempts) {
    const personality = TEAM_PERSONALITIES[team.name];
    
    // Elite players get more persistent bidding
    if (player.tier === 'Elite') {
        if (personality === 'Star-Hunter' || personality === 'Aggressive') {
            return currentAttempts < 5; // Up to 5 attempts for star hunters
        }
        return currentAttempts < 3; // Up to 3 attempts for others
    }
    
    if (player.tier === 'Tier 1') {
        return currentAttempts < 3;
    }
    
    return currentAttempts < 2;
}

// --- CORE AUCTION LOGIC ---
function presentNextPlayer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.currentPlayerIndex++;
    if (room.currentPlayerIndex >= room.playerPool.length) {
        io.to(roomCode).emit('auctionConcluded', { roomCode });
        room.isAuctionRunning = false;
        return;
    }
    
    const player = room.playerPool[room.currentPlayerIndex];
    room.currentBid = player.basePrice;
    room.currentBidder = 'Base Price';
    room.bidCount = 0;
    room.passedTeams = [];
    
    // Reset AI bidding state for new player
    TEAM_CODES.forEach(code => {
        room.aiBiddingState[code] = {
            attemptedBids: 0,
            maxAttempts: (player.tier === 'Elite') ? 5 : 3,
            lastBidTime: 0,
            isActive: true,
            hasShownInterest: false
        };
    });
    
    // Set competitive bidding flag for elite players
    room.competitiveBidding = (player.tier === 'Elite' || player.tier === 'Tier 1');
    
    clearInterval(room.auctionTimer);
    
    io.to(roomCode).emit('nextPlayer', player);
    io.to(roomCode).emit('auctionUpdate', {
        currentBid: room.currentBid,
        currentBidder: room.currentBidder,
        timeLeft: null
    });
    
    // Staggered AI bidding with multiple waves
    setTimeout(() => triggerAiBidding(roomCode), 1500);
    if (room.competitiveBidding) {
        setTimeout(() => triggerAiBidding(roomCode), 4000);  // Second wave
        setTimeout(() => triggerAiBidding(roomCode), 7000);  // Third wave
    }
}

function startAuctionTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    clearInterval(room.auctionTimer);
    let timeLeft = 10;
    
    room.auctionTimer = setInterval(() => {
        io.to(roomCode).emit('auctionUpdate', { timeLeft });
        
        // Trigger additional AI bidding during countdown for competitive auctions
        if (room.competitiveBidding && (timeLeft === 7 || timeLeft === 4)) {
            setTimeout(() => triggerAiBidding(roomCode), 200);
        }
        
        timeLeft--;
        if (timeLeft < 0) {
            clearInterval(room.auctionTimer);
            sellPlayer(roomCode);
        }
    }, 1000);
}

function sellPlayer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    const player = room.playerPool[room.currentPlayerIndex];
    player.sold = true;
    const winningBidderCode = room.currentBidder;
    const winningBidAmount = room.currentBid;
    
    if (winningBidderCode && winningBidderCode !== 'Base Price') {
        const winningTeam = room.teams[winningBidderCode];
        if (winningTeam) {
            winningTeam.purse -= winningBidAmount;
            winningTeam.squad.push({...player, finalPrice: winningBidAmount});
            
            // Track bidding history
            winningTeam.biddingHistory.push({
                player: player.name,
                amount: winningBidAmount,
                tier: player.tier
            });
            
            io.to(roomCode).emit('playerSold', {
                playerName: player.name,
                team: winningTeam.displayName,
                teamCode: winningTeam.name,
                finalPrice: winningBidAmount,
                player: player
            });
        }
    } else {
        io.to(roomCode).emit('playerSold', { 
            playerName: player.name, 
            team: "Unsold", 
            amount: 0,
            player: player
        });
    }
    
    io.to(roomCode).emit('auctionUpdate', { teams: room.teams });
    setTimeout(() => presentNextPlayer(roomCode), 2500);
}

// --- ENHANCED AI LOGIC ---
function triggerAiBidding(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    const currentPlayer = room.playerPool[room.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.sold) return;
    
    const humanPlayerCodes = Object.values(room.participants).map(p => p.code);
    
    const potentialBidders = Object.values(room.teams).filter(team => {
        return team.name !== room.currentBidder && 
               !humanPlayerCodes.includes(team.name) &&
               !room.passedTeams.includes(team.name) &&
               room.aiBiddingState[team.name]?.isActive;
    });
    
    // Shuffle bidders to create unpredictable bidding patterns
    const shuffledBidders = potentialBidders.sort(() => Math.random() - 0.5);
    
    shuffledBidders.forEach((team, index) => {
        const biddingProb = getAiBiddingProbability(currentPlayer, team, room);
        const aiState = room.aiBiddingState[team.name];
        
        // Check if team should bid based on probability and previous attempts
        if (Math.random() < biddingProb && shouldContinueBidding(team, currentPlayer, room, aiState.attemptedBids)) {
            const delay = (index * 800) + (Math.random() * 1200) + 500;
            
            setTimeout(() => { 
                aiDecideToBid(team, roomCode);
            }, delay);
        }
    });
}

function aiDecideToBid(team, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    
    const player = room.playerPool[room.currentPlayerIndex];
    if (!player || player.sold || room.currentBidder === team.name) return;
    
    const aiState = room.aiBiddingState[team.name];
    if (!aiState.isActive) return;
    
    // Update AI state
    aiState.attemptedBids++;
    aiState.lastBidTime = Date.now();
    aiState.hasShownInterest = true;
    
    // Squad validation
    const squadSize = team.squad.length;
    const overseasCount = team.squad.filter(p => p.country !== 'India').length;
    
    if (squadSize >= 25 || (player.country !== 'India' && overseasCount >= 8)) {
        aiState.isActive = false;
        return;
    }
    
    const nextBid = calculateNextBid(room.currentBid);
    const maxBid = calculatePlayerValueForTeam(player, team, room);
    
    // Enhanced bidding decision with competitive factors
    let shouldBid = team.purse >= nextBid && nextBid <= maxBid;
    
    if (shouldBid) {
        // Add competitive bidding logic for elite players
        if (player.tier === 'Elite' && room.bidCount < 8) {
            // Elite players should generate more bidding activity
            const competitiveBoost = Math.random() < 0.3; // 30% chance to bid even if slightly over budget
            if (competitiveBoost && team.purse >= nextBid && nextBid <= maxBid * 1.1) {
                shouldBid = true;
            }
        }
        
        if (shouldBid) {
            room.currentBid = nextBid;
            room.currentBidder = team.name;
            room.bidCount++;
            
            // Create bidding message for more engagement
            let message = `${team.displayName} bids ${formatCurrency(nextBid)} for ${player.name}`;
            
            io.to(roomCode).emit('auctionUpdate', {
                currentBid: room.currentBid,
                currentBidder: team.displayName,
                message: message
            });
            
            startAuctionTimer(roomCode);
        }
    } else {
        // If can't bid, deactivate for this player
        if (nextBid > team.purse) {
            aiState.isActive = false;
        }
    }
}

function calculatePlayerValueForTeam(player, team, room) {
    // Enhanced base value calculation
    let baseValue;
    switch (player.tier) {
        case 'Elite': 
            baseValue = player.basePrice * 12; // Increased from 8
            break;
        case 'Tier 1': 
            baseValue = player.basePrice * 8;  // Increased from 5
            break;
        case 'Tier 2': 
            baseValue = player.basePrice * 4;  // Increased from 3
            break;
        case 'Uncapped': 
            baseValue = player.basePrice * 3;  // Increased from 2.5
            break;
        default: 
            baseValue = player.basePrice * 2.5;
    }
    
    // Enhanced bonus multipliers
    let bonusMultiplier = 1.0;
    if (player.isCaptain) bonusMultiplier += 0.3; // Increased from 0.2
    if (player.age < 25) bonusMultiplier += 0.2;  // Increased from 0.15
    if (player.age > 35) bonusMultiplier -= 0.1;  // Age penalty
    
    // Squad composition analysis
    const currentCount = team.squad.filter(p => p.skill === player.skill).length;
    const neededCount = SQUAD_NEEDS[player.skill] || 1;
    
    let needFactor = 1.0;
    if (currentCount < neededCount) {
        needFactor = 1.8 - (currentCount * 0.2); // Increased urgency
    } else if (currentCount >= neededCount + 2) {
        needFactor = 0.6; // Reduced interest in excess positions
    } else {
        needFactor = 0.9;
    }
    
    // Enhanced personality modifiers
    let personalityModifier = 1.0;
    const personality = TEAM_PERSONALITIES[team.name];
    
    switch(personality) {
        case 'Star-Hunter':
            if (player.tier === 'Elite') personalityModifier = 1.5;
            else if (player.tier === 'Tier 1') personalityModifier = 1.3;
            break;
        case 'Aggressive':
            if (player.tier === 'Elite' || player.tier === 'Tier 1') personalityModifier = 1.4;
            break;
        case 'Experienced':
            if (player.age > 28 && (player.tier === 'Elite' || player.tier === 'Tier 1')) personalityModifier = 1.3;
            break;
        case 'Scout':
            if (player.tier === 'Uncapped' || player.age < 25) personalityModifier = 1.6;
            else personalityModifier = 0.9;
            break;
        case 'Value-Focused':
            if (player.tier === 'Elite') personalityModifier = 0.9; // Less conservative for elite
            else personalityModifier = 0.85;
            break;
        case 'Strategic':
        case 'Analytical':
            // More calculated approach - higher value for needed positions
            if (currentCount < neededCount) personalityModifier = 1.2;
            break;
        case 'Opportunistic':
            // Random boost for surprise bids
            if (Math.random() < 0.3) personalityModifier = 1.3;
            break;
    }
    
    // Auction phase modifiers
    let phaseModifier = 1.0;
    const totalPlayers = room.playerPool.length;
    const currentPlayerNum = room.currentPlayerIndex;
    
    if (currentPlayerNum < 20) { 
        phaseModifier = 1.2; // More aggressive early on
    } else if (currentPlayerNum > totalPlayers - 20) { 
        phaseModifier = 0.9; // Slightly more conservative at end
    }
    
    // Budget pressure modifier
    let budgetModifier = 1.0;
    const remainingBudget = team.purse;
    const squadGaps = 25 - team.squad.length;
    
    if (squadGaps > 0) {
        const budgetPerPlayer = remainingBudget / squadGaps;
        if (budgetPerPlayer < 50) { // Less than 50 lakhs per remaining slot
            budgetModifier = 0.8;
        } else if (budgetPerPlayer > 500) { // More than 5 crores per slot
            budgetModifier = 1.2;
        }
    }
    
    // Reduced randomness, more predictable for elite players
    const randomFactor = player.tier === 'Elite' ? 
        Math.random() * 0.2 + 0.9 :  // 0.9 to 1.1 for elite
        Math.random() * 0.3 + 0.85;  // 0.85 to 1.15 for others
    
    const maxBid = baseValue * bonusMultiplier * needFactor * personalityModifier * phaseModifier * budgetModifier * randomFactor;
    
    return Math.round(maxBid / 5) * 5;
}

// Helper function to format currency (add this if not present)
function formatCurrency(amountLakhs) {
    return `₹${(amountLakhs / 100).toFixed(2)} Cr`;
}

// --- USER PROFILE MANAGEMENT ---
function createDefaultUserProfile(userId) {
    return {
        userId: userId,
        username: `Player_${userId.slice(-4)}`,
        stats: {
            totalAuctions: 0,
            auctionsWon: 0,
            averageSpending: 0,
            bestSquadGrade: null,
            totalPlayersOwned: 0
        },
        auctionHistory: [],
        achievements: [],
        preferences: {
            defaultTeam: null,
            bidSounds: true,
            notifications: true
        }
    };
}

// --- SOCKET.IO CONNECTION LOGIC ---
io.on('connection', (socket) => {
    console.log(`User connected with temporary ID: ${socket.id}`);
    let currentPlayerId = null; 

    socket.on('createRoom', (playerId) => {
        currentPlayerId = playerId;
        let roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomCode] = createNewAuctionState();
        rooms[roomCode].hostId = playerId;
        rooms[roomCode].players[playerId] = { socketId: socket.id, name: `Player 1`, isHost: true, playerId: playerId, team: null };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode });
        io.to(roomCode).emit('updateLobbyState', {
            players: Object.values(rooms[roomCode].players),
            availableTeams: rooms[roomCode].availableTeams
        });
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, playerId } = data;
        currentPlayerId = playerId;
        const room = rooms[roomCode];
        if (room && !room.isAuctionRunning) {
            room.players[playerId] = { socketId: socket.id, name: `Player ${Object.keys(room.players).length + 1}`, isHost: false, playerId: playerId, team: null };
            socket.join(roomCode);
            socket.emit('joinSuccess', { roomCode });
            io.to(roomCode).emit('updateLobbyState', {
                players: Object.values(room.players),
                availableTeams: room.availableTeams
            });
        } else {
            socket.emit('joinError', room ? 'Auction is already in progress.' : 'Room not found.');
        }
    });

    socket.on('selectTeam', (data) => {
        const { roomCode, playerId, teamData } = data;
        const room = rooms[roomCode];
        if (!room || !room.players[playerId]) return;
        const teamIndex = room.availableTeams.findIndex(t => t.code === teamData.code);
        if (teamIndex > -1) {
            const player = room.players[playerId];
            if (player.team) {
                room.availableTeams.push(player.team);
            }
            player.team = teamData;
            room.availableTeams.splice(teamIndex, 1);
            io.to(roomCode).emit('updateLobbyState', {
                players: Object.values(room.players),
                availableTeams: room.availableTeams
            });
        }
    });
    
    socket.on('requestStartGame', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room && room.hostId === playerId) {
            io.to(roomCode).emit('gameStarting', { roomCode });
        }
    });

    socket.on('identify', (data) => {
        const { roomCode, playerId } = data;
        currentPlayerId = playerId;
        const room = rooms[roomCode];
        if (room && room.players[playerId]) {
            room.players[playerId].socketId = socket.id;
            socket.join(roomCode);
            console.log(`Player ${playerId} re-identified in room ${roomCode}`);
        }
    });
    
    socket.on('registerTeam', (data) => {
        const { roomCode, playerId, teamData } = data;
        const room = rooms[roomCode];
        if (!room) return;
        room.participants[playerId] = teamData;
        
        const allPlayersReady = Object.keys(room.participants).length === Object.keys(room.players).length;

        if (!room.isAuctionRunning && allPlayersReady) {
            console.log(`[Room ${roomCode}] All players have registered. Starting auction.`);
            room.isAuctionRunning = true;
            initializeTeams(room);
            Object.values(room.players).forEach(p => {
                if(p.team && room.teams[p.team.code]) {
                    room.teams[p.team.code].displayName = p.team.name;
                }
            });
            fs.readFile(path.join(__dirname, '../client/public/data/players.json'), 'utf8', (err, fileData) => {
                if (err) { return; }
                room.playerPool = JSON.parse(fileData);
                presentNextPlayer(roomCode);
            });
        }
    });

    socket.on('requestFullState', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room && room.players[playerId]) {
            const stateToSend = {
                teams: room.teams,
                playerPool: room.playerPool,
                currentPlayerIndex: room.currentPlayerIndex,
                currentBid: room.currentBid,
                currentBidder: room.currentBidder,
                isAuctionRunning: room.isAuctionRunning,
                passedTeams: room.passedTeams,
                participants: room.participants,
            };
            const teamData = room.participants[playerId];
            socket.emit('fullAuctionState', {
                room: stateToSend,
                myTeam: teamData
            });
        }
    });

    socket.on('requestFinalState', (data) => {
        const { roomCode, playerId } = data;
        const room = rooms[roomCode];
        if (room && room.participants[playerId]) {
            socket.emit('finalAuctionState', {
                room: room,
                myTeamCode: room.participants[playerId].code
            });
        }
    });

    socket.on('bid', (data) => {
        const { roomCode, bidData } = data;
        const room = rooms[roomCode];
        if (!room) return;
        if (room.passedTeams.includes(bidData.teamCode) || room.currentBidder === bidData.teamCode) return;
        const player = room.playerPool[room.currentPlayerIndex];
        const biddingTeam = room.teams[bidData.teamCode];
        const squadSize = biddingTeam.squad.length;
        const overseasCount = biddingTeam.squad.filter(p => p.country !== 'India').length;
        if (squadSize >= 25 || (player.country !== 'India' && overseasCount >= 8)) return;
        room.currentBid = bidData.amount;
        room.currentBidder = bidData.teamCode;
        room.bidCount++;
        io.to(roomCode).emit('auctionUpdate', {
            currentBid: room.currentBid,
            currentBidder: room.teams[bidData.teamCode].displayName
        });
        startAuctionTimer(roomCode);
    });

    socket.on('pass', (data) => {
        const { roomCode, teamCode } = data;
        const room = rooms[roomCode];
        if (room && !room.passedTeams.includes(teamCode)) {
            room.passedTeams.push(teamCode);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User with temporary ID ${socket.id} disconnected`);
        if (currentPlayerId) {
            for (const roomCode in rooms) {
                const room = rooms[roomCode];
                if (room && room.players[currentPlayerId] && room.players[currentPlayerId].socketId === socket.id) {
                    room.players[currentPlayerId].socketId = null;
                    console.log(`Persistent Player ${currentPlayerId} marked as disconnected from room ${roomCode}`);
                    break;
                }
            }
        }
    });

    // Add these handlers to your io.on('connection') section in server.js

    socket.on('createSinglePlayerRoom', (userId) => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        const room = createNewAuctionState();
        
        // Mark as single-player
        room.isSinglePlayer = true;
        room.hostId = userId;
        
        // Add human player
        room.players[userId] = { 
            socketId: socket.id, 
            name: `Player 1`,
            isHost: true, 
            playerId: userId, 
            team: null 
        };
        
        // Fill remaining 9 slots with AI placeholders
        const aiTeams = TEAM_CODES.slice(0, 9);
        aiTeams.forEach((teamCode, index) => {
            const aiId = `ai_${teamCode}`;
            room.players[aiId] = {
                socketId: null,
                name: `AI ${TEAM_NAMES[teamCode]}`,
                isHost: false,
                playerId: aiId,
                team: { code: teamCode, name: TEAM_NAMES[teamCode] },
                isAI: true
            };
        });
        
        rooms[roomCode] = room;
        socket.join(roomCode);
        socket.emit('singlePlayerRoomCreated', { roomCode });
        
        console.log(`Single-player room ${roomCode} created for user ${userId}`);
    });

    socket.on('requestUserProfile', (userId) => {
        // For now, just return a default profile
        // Later this will load from database/file
        const profile = createDefaultUserProfile(userId);
        socket.emit('userProfileData', profile);
    });

    socket.on('registerSinglePlayerTeam', (data) => {
        const { roomCode, playerId, teamData } = data;
        const room = rooms[roomCode];
        
        if (!room || !room.isSinglePlayer) return;
        
        // Register human player's team
        room.participants[playerId] = teamData;
        
        // Auto-register all AI teams
        TEAM_CODES.forEach(code => {
            if (code !== teamData.code) {
                const aiId = `ai_${code}`;
                room.participants[aiId] = { code, name: TEAM_NAMES[code] };
            }
        });
        
        // Start auction immediately for single-player
        console.log(`[Room ${roomCode}] Single-player auction starting.`);
        room.isAuctionRunning = true;
        initializeTeams(room);
        
        // Set display names
        room.teams[teamData.code].displayName = teamData.name;
        TEAM_CODES.forEach(code => {
            if (code !== teamData.code) {
                room.teams[code].displayName = TEAM_NAMES[code];
            }
        });
        
        // Load players and start auction
        fs.readFile(path.join(__dirname, '../client/public/data/players.json'), 'utf8', (err, fileData) => {
            if (err) return;
            room.playerPool = JSON.parse(fileData);
            
            // Redirect to auction page
            socket.emit('redirectToAuction', { roomCode, teamCode: teamData.code });
            
            // Start first player after a short delay
            setTimeout(() => {
                presentNextPlayer(roomCode);
            }, 2000);
        });
    });
});

// --- Add this debugging route temporarily to see what's happening
app.get('/debug', (req, res) => {
    res.json({
        message: 'Server is working',
        dashboardExists: require('fs').existsSync(path.join(__dirname, '../client/dashboard.html')),
        clientPath: path.join(__dirname, '../client'),
        dashboardPath: path.join(__dirname, '../client/dashboard.html')
    });
});

// --- SERVER START ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});