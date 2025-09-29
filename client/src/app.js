// This file controls the index.html page (team selection)

// Establish a connection to the server
const socket = io();

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

const teamGrid = document.getElementById('team-grid');
let roomCode = null;

// On page load, get room code and identify the player to the server
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    roomCode = params.get('room');
    const mode = params.get('mode'); // Check if it's single-player
    
    if (!roomCode) {
        window.location.href = '/lobby.html';
        return;
    }

    // Get our persistent player ID from storage
    const playerId = localStorage.getItem('playerId');

    // Tell the server who we are on this new page
    if (playerId) {
        if (mode === 'single') {
            // For single-player, we don't need to identify to server yet
            // Just render team selection
            renderTeamSelection();
        } else {
            // For multiplayer, identify to server
            socket.emit('identify', { roomCode, playerId });
            renderTeamSelection();
        }
    }
});

function renderTeamSelection() {
    teams.forEach(team => {
        const teamCard = document.createElement('div');
        teamCard.classList.add('team-card');
        const logo = document.createElement('img');
        logo.src = `/public/images/team-logos/${team.code}.png`;
        logo.classList.add('team-logo');
        teamCard.appendChild(logo);
        teamCard.addEventListener('click', () => selectTeam(team.code));
        teamGrid.appendChild(teamCard);
    });
}

function selectTeam(teamCode) {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    
    if (roomCode) {
        if (mode === 'single') {
            // For single-player, register team and start auction immediately
            const selectedTeam = teams.find(t => t.code === teamCode);
            const playerId = localStorage.getItem('playerId');
            
            socket.emit('registerSinglePlayerTeam', {
                roomCode,
                playerId,
                teamData: { code: teamCode, name: selectedTeam.name }
            });
        } else {
            // For multiplayer, go to auction room
            window.location.href = `/auction.html?room=${roomCode}&team=${teamCode}`;
        }
    } else {
        alert('Error: No room code found.');
    }
}

// Add this socket handler

socket.on('redirectToAuction', (data) => {
    console.log('Starting single-player auction...');
    window.location.href = `/auction.html?room=${data.roomCode}&team=${data.teamCode}`;
});