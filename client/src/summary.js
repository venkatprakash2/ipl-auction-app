// This script controls the summary.html page

const socket = io();

// --- DOM ELEMENTS ---
const myFinalTeamName = document.getElementById('my-final-team-name');
const finalSquadList = document.getElementById('final-squad-list');
const squadGrade = document.getElementById('squad-grade');
const squadStrengths = document.getElementById('squad-strengths');
const squadWeaknesses = document.getElementById('squad-weaknesses');
const leagueSquads = document.getElementById('league-squads');
const tabs = document.querySelectorAll('.tab-button');

let roomCode = null;
let playerId = null;

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    roomCode = params.get('room');
    playerId = localStorage.getItem('playerId');

    const returnToLobbyBtn = document.getElementById('return-to-lobby-btn');
    returnToLobbyBtn.addEventListener('click', () => {
        window.location.href = '/lobby.html';
    });

    if (roomCode && playerId) {
        // Request the final auction data from the server
        socket.emit('requestFinalState', { roomCode, playerId });
    } else {
        document.body.innerHTML = '<h1>Error: Missing data. Cannot display summary.</h1>';
    }

    // Tab switching logic
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelector('.tab-button.active').classList.remove('active');
            document.querySelector('.tab-content.active').classList.remove('active');
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
});

// --- SERVER EVENT HANDLERS ---
socket.on('finalAuctionState', (data) => {
    const { room, myTeamCode } = data;
    if (!room || !myTeamCode) return;

    const myTeam = room.teams[myTeamCode];
    myFinalTeamName.textContent = myTeam.displayName;

    // 1. Populate "My Final Squad"
    populateFinalSquad(myTeam.squad);

    // 2. Populate and run "Squad Analysis"
    analyzeAndDisplaySquad(myTeam.squad);

    // 3. Populate "League Overview"
    populateLeagueOverview(room.teams);
});


// --- UI POPULATION FUNCTIONS ---
function populateFinalSquad(squad) {
    finalSquadList.innerHTML = '';
    if (squad.length === 0) {
        finalSquadList.innerHTML = '<p>No players were bought.</p>';
        return;
    }
    squad.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.classList.add('player-summary-card');
        playerCard.innerHTML = `
            <div class="player-summary-name">${player.name}</div>
            <div class="player-summary-skill">${player.skill}</div>
            <div class="player-summary-tier">${player.tier}</div>
        `;
        finalSquadList.appendChild(playerCard);
    });
}

function populateLeagueOverview(allTeams) {
    leagueSquads.innerHTML = '';
    for (const teamCode in allTeams) {
        const team = allTeams[teamCode];
        const teamContainer = document.createElement('div');
        teamContainer.classList.add('league-team-summary');
        let playerListHtml = team.squad.map(p => `<li>${p.name} (${p.skill})</li>`).join('');
        if(team.squad.length === 0) playerListHtml = '<li>No players bought.</li>';
        
        teamContainer.innerHTML = `
            <h3>${team.displayName}</h3>
            <p>Purse Remaining: ${formatCurrency(team.purse)}</p>
            <ul>${playerListHtml}</ul>
        `;
        leagueSquads.appendChild(teamContainer);
    }
}

// --- SQUAD ANALYSIS LOGIC ---
function analyzeAndDisplaySquad(squad) {
    let score = 0;
    const strengths = [];
    const weaknesses = [];

    // Tier-based scoring
    const elitePlayers = squad.filter(p => p.tier === 'Elite').length;
    const tier1Players = squad.filter(p => p.tier === 'Tier 1').length;
    score += elitePlayers * 25; // Elite players are worth a lot
    score += tier1Players * 15;

    if(elitePlayers > 2) strengths.push("Packed with superstar talent.");
    if(elitePlayers === 0) weaknesses.push("Lacks a true marquee player.");

    // Role balance scoring
    const batsmen = squad.filter(p => p.skill === 'Batsman').length;
    const bowlers = squad.filter(p => p.skill === 'Bowler').length;
    const allRounders = squad.filter(p => p.skill === 'All-Rounder').length;
    const keepers = squad.filter(p => p.skill === 'Wicket-Keeper').length;

    if (batsmen > 4) score += 10; else weaknesses.push("Light on specialist batting.");
    if (bowlers > 4) score += 10; else weaknesses.push("Needs more bowling options.");
    if (allRounders > 1) score += 15; else weaknesses.push("Lacks all-rounder depth.");
    if (keepers > 0) score += 5; else weaknesses.push("No specialist Wicket-Keeper!");

    if (allRounders > 2) strengths.push("Excellent all-rounder balance.");
    if (batsmen > 5 && bowlers > 5) strengths.push("Very balanced squad composition.");

    // Captaincy bonus
    const hasCaptain = squad.some(p => p.isCaptain);
    if(hasCaptain) {
        score += 10;
        strengths.push("Has a clear captaincy option.");
    } else {
        weaknesses.push("No experienced captain in the squad.");
    }
    
    // Convert score to grade
    let grade = 'D';
    if (score > 120) grade = 'A+';
    else if (score > 100) grade = 'A';
    else if (score > 80) grade = 'B+';
    else if (score > 65) grade = 'B';
    else if (score > 50) grade = 'C';

    squadGrade.textContent = grade;
    squadStrengths.textContent = strengths.length > 0 ? strengths.join(' ') : "A well-rounded team.";
    squadWeaknesses.textContent = weaknesses.length > 0 ? weaknesses.join(' ') : "No obvious weaknesses.";
}

function formatCurrency(amountLakhs) {
    return `₹${(amountLakhs / 100).toFixed(2)} Cr`;
}