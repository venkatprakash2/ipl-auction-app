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
    if (!roomCode) {
        // If no room code, redirect back to the lobby
        window.location.href = '/lobby.html';
        return; // Stop further execution
    }

    // Get our persistent player ID from storage
    const playerId = localStorage.getItem('playerId');

    // Tell the server who we are on this new page
    if (playerId) {
        socket.emit('identify', { roomCode, playerId });
    }
    
    // Now that we have verified we're in a room, render the teams
    renderTeamSelection();
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
    // Navigate to the auction room, passing BOTH the room and team codes
    if (roomCode) {
        window.location.href = `/auction.html?room=${roomCode}&team=${teamCode}`;
    } else {
        alert('Error: No room code found.');
    }
}