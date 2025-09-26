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

app.use(express.static(path.join(__dirname, '../client')));

// Serve the HTML files
app.get('/lobby.html', (req, res) => res.sendFile(path.join(__dirname, '../client/lobby.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/lobby.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));
app.get('/auction.html', (req, res) => res.sendFile(path.join(__dirname, '../client/auction.html')));
app.get('/summary.html', (req, res) => res.sendFile(path.join(__dirname, '../client/summary.html')));


// --- GLOBAL ROOM MANAGEMENT ---
const rooms = {};

// --- TEAM & AI CONSTANTS ---
const SQUAD_NEEDS = { 'Batsman': 4, 'Bowler': 4, 'All-Rounder': 2, 'Wicket-Keeper': 1 };
const TEAM_CODES = ["CSK", "MI", "RCB", "KKR", "SRH", "DC", "PBKS", "RR", "GT", "LSG"];
const TEAM_NAMES = { CSK: "Chennai Super Kings", MI: "Mumbai Indians", RCB: "Royal Challengers Bengaluru", KKR: "Kolkata Knight Riders", SRH: "Sunrisers Hyderabad", DC: "Delhi Capitals", PBKS: "Punjab Kings", RR: "Rajasthan Royals", GT: "Gujarat Titans", LSG: "Lucknow Super Giants"};
const TEAM_PERSONALITIES = { CSK: 'Balanced', MI: 'Balanced', RCB: 'Spendthrift', PBKS: 'Spendthrift', RR: 'Scout', DC: 'Scout', SRH: 'Conservative', GT: 'Conservative', KKR: 'Balanced', LSG: 'Balanced' };

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
        passedTeams: []
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
        room.teams[code] = { name: code, purse: 12500, squad: [], displayName: code };
    });
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
    clearInterval(room.auctionTimer);
    io.to(roomCode).emit('nextPlayer', player);
    io.to(roomCode).emit('auctionUpdate', {
        currentBid: room.currentBid,
        currentBidder: room.currentBidder,
        timeLeft: null
    });
    setTimeout(() => triggerAiBidding(roomCode), 2000);
}

function startAuctionTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    clearInterval(room.auctionTimer);
    let timeLeft = 10;
    room.auctionTimer = setInterval(() => {
        io.to(roomCode).emit('auctionUpdate', { timeLeft });
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
            winningTeam.squad.push(player);
            io.to(roomCode).emit('playerSold', {
                playerName: player.name,
                team: winningTeam.displayName,
                teamCode: winningTeam.name,
                amount: winningBidAmount
            });
        }
    } else {
        io.to(roomCode).emit('playerSold', { playerName: player.name, team: "Unsold", amount: 0 });
    }
    io.to(roomCode).emit('auctionUpdate', { teams: room.teams });
    setTimeout(() => presentNextPlayer(roomCode), 2000);
}

// --- AI LOGIC ---
function triggerAiBidding(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const humanPlayerCodes = Object.values(room.participants).map(p => p.code);
    const potentialBidders = Object.values(room.teams).filter(team => {
        return team.name !== room.currentBidder && !humanPlayerCodes.includes(team.name);
    });
    for (const team of potentialBidders) {
        if (Math.random() < 0.75) {
            setTimeout(() => { aiDecideToBid(team, roomCode); }, Math.random() * 4000 + 1000);
        }
    }
}

function aiDecideToBid(team, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.playerPool[room.currentPlayerIndex];
    if (player.sold || room.currentBidder === team.name) return;
    const squadSize = team.squad.length;
    const overseasCount = team.squad.filter(p => p.country !== 'India').length;
    if (squadSize >= 25 || (player.country !== 'India' && overseasCount >= 8)) return;
    const nextBid = calculateNextBid(room.currentBid);
    const maxBid = calculatePlayerValueForTeam(player, team, room);
    if (team.purse >= nextBid && nextBid <= maxBid) {
        room.currentBid = nextBid;
        room.currentBidder = team.name;
        room.bidCount++;
        io.to(roomCode).emit('auctionUpdate', {
            currentBid: room.currentBid,
            currentBidder: team.displayName
        });
        startAuctionTimer(roomCode);
    }
}

function calculatePlayerValueForTeam(player, team, room) {
    let baseValue;
    switch (player.tier) {
        case 'Elite': baseValue = player.basePrice * 8; break;
        case 'Tier 1': baseValue = player.basePrice * 5; break;
        case 'Tier 2': baseValue = player.basePrice * 3; break;
        case 'Uncapped': baseValue = player.basePrice * 2.5; break;
        default: baseValue = player.basePrice * 2;
    }
    let bonusMultiplier = 1.0;
    if (player.isCaptain) bonusMultiplier += 0.2;
    if (player.age < 25) bonusMultiplier += 0.15;
    const currentCount = team.squad.filter(p => p.skill === player.skill).length;
    const neededCount = SQUAD_NEEDS[player.skill] || 1;
    let needFactor = 1.0;
    if (currentCount < neededCount) {
        needFactor = 1.5 - (currentCount * 0.15);
    } else {
        needFactor = 0.8;
    }
    let personalityModifier = 1.0;
    const personality = TEAM_PERSONALITIES[team.name];
    switch(personality) {
        case 'Spendthrift': if (player.tier === 'Elite' || player.tier === 'Tier 1') personalityModifier = 1.25; break;
        case 'Scout': if (player.tier === 'Uncapped') personalityModifier = 1.4; break;
        case 'Conservative': personalityModifier = 0.85; break;
    }
    let phaseModifier = 1.0;
    const totalPlayers = room.playerPool.length;
    const currentPlayerNum = room.currentPlayerIndex;
    if (currentPlayerNum < 15) { phaseModifier = 1.1; }
    else if (currentPlayerNum > totalPlayers - 15) { phaseModifier = 0.8; }
    const randomFactor = Math.random() * 0.3 + 0.85;
    const maxBid = baseValue * bonusMultiplier * needFactor * personalityModifier * phaseModifier * randomFactor;
    return Math.round(maxBid / 5) * 5;
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
});

// --- SERVER START ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});