// Dashboard page controller
const socket = io();

// --- PERSISTENT USER MANAGEMENT ---
let userId = localStorage.getItem('userId');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem('userId', userId);
}

// --- DOM ELEMENTS ---
const username = document.getElementById('username');
const userStats = document.getElementById('user-stats');
const startSoloBtn = document.getElementById('start-solo-btn');
const enterLobbyBtn = document.getElementById('enter-lobby-btn');
const profileBtn = document.getElementById('profile-btn');
const recentAuctions = document.getElementById('recent-auctions');
const achievementsList = document.getElementById('achievements-list');

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    // Load user profile data
    loadUserProfile();
    
    // Set up event listeners
    startSoloBtn.addEventListener('click', startSinglePlayerAuction);
    enterLobbyBtn.addEventListener('click', enterMultiplayerLobby);
    profileBtn.addEventListener('click', openProfile);
    
    // Request user data from server
    socket.emit('requestUserProfile', userId);
});

// --- USER PROFILE FUNCTIONS ---
function loadUserProfile() {
    const savedProfile = localStorage.getItem(`profile_${userId}`);
    if (savedProfile) {
        const profile = JSON.parse(savedProfile);
        updateProfileDisplay(profile);
    } else {
        // Create default profile
        const defaultProfile = {
            username: 'Cricket Fan',
            stats: {
                totalAuctions: 0,
                auctionsWon: 0,
                bestSquadGrade: null,
                averageSpending: 0
            },
            auctionHistory: [],
            achievements: []
        };
        localStorage.setItem(`profile_${userId}`, JSON.stringify(defaultProfile));
        updateProfileDisplay(defaultProfile);
    }
}

function updateProfileDisplay(profile) {
    username.textContent = profile.username;
    
    const gradeText = profile.stats.bestSquadGrade || 'No Grade Yet';
    userStats.textContent = `${profile.stats.totalAuctions} Auctions • ${profile.stats.auctionsWon} Wins • ${gradeText} Best Grade`;
    
    // Update recent auctions
    if (profile.auctionHistory && profile.auctionHistory.length > 0) {
        const recentList = profile.auctionHistory.slice(-3).reverse();
        recentAuctions.innerHTML = recentList.map(auction => 
            `<p>${auction.team} - ${auction.grade} grade (${auction.date})</p>`
        ).join('');
    }
    
    // Update achievements
    if (profile.achievements && profile.achievements.length > 0) {
        achievementsList.innerHTML = profile.achievements.map(achievement => 
            `<span class="achievement-badge">${achievement}</span>`
        ).join('');
    }
}

// --- GAME MODE FUNCTIONS ---
function startSinglePlayerAuction() {
    // Create single-player room
    socket.emit('createSinglePlayerRoom', userId);
}

function enterMultiplayerLobby() {
    // Navigate to existing lobby
    window.location.href = '/lobby.html';
}

function openProfile() {
    // For now, just show an alert - will implement profile page later
    alert('Profile management coming soon!');
}

// --- SERVER EVENT HANDLERS ---
socket.on('singlePlayerRoomCreated', (data) => {
    console.log('Single player room created:', data.roomCode);
    // Navigate directly to team selection for single player
    window.location.href = `/index.html?room=${data.roomCode}&mode=single`;
});

socket.on('userProfileData', (profileData) => {
    if (profileData) {
        localStorage.setItem(`profile_${userId}`, JSON.stringify(profileData));
        updateProfileDisplay(profileData);
    }
});