/**
 * GCR Deadline Reminder System - Application Logic
 * Implements State Management, Drag & Drop Kanban, Monthly Calendar,
 * Mock Google Classroom Sync, Web Audio Synthesis, Web Notifications.
 */

// ==========================================================================
// 1. Initial State & Configuration
// ==========================================================================

const DEFAULT_CLASSES = [
  "CS 101: Intro to Programming",
  "MATH 202: Calculus III",
  "PHYS 301: Classical Mechanics",
  "LIT 105: World Literature"
];

let state = {
  tasks: [],
  classes: new Set(DEFAULT_CLASSES),
  activeView: "list",
  gcrConnected: false,
  audioEnabled: true,
  pushNotifEnabled: false,
  calendarCurrentDate: new Date(),
  selectedCalendarDay: null,
  activeAlarmTaskId: null,
  googleClientId: "",
  googleAccessToken: "",
  googleCourses: [],
  googleTaskLists: [],
  googleSyncMode: "real",
  googleProfileName: "",
  googleProfileEmail: "",
  googleProfilePicture: ""
};

// LocalStorage Keys
const STORAGE_KEY_TASKS = "gcr_reminder_tasks";
const STORAGE_KEY_GCR_STATUS = "gcr_reminder_connected";
const STORAGE_KEY_AUDIO = "gcr_reminder_audio";
const STORAGE_KEY_PUSH = "gcr_reminder_push";
const STORAGE_KEY_CLIENT_ID = "gcr_reminder_client_id";
const STORAGE_KEY_PROFILE_NAME = "gcr_reminder_profile_name";
const STORAGE_KEY_PROFILE_EMAIL = "gcr_reminder_profile_email";
const STORAGE_KEY_PROFILE_PICTURE = "gcr_reminder_profile_picture";

// ==========================================================================
// 2. Sound Synthesis (Web Audio API)
// ==========================================================================

let audioContext = null;

function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
}

/**
 * Synthesizes a premium arpeggio/chime notification.
 * No file assets needed.
 */
function playReminderChime() {
  if (!state.audioEnabled) return;
  
  try {
    initAudioContext();
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const now = audioContext.currentTime;
    
    // Play a sequence of 4 notes (C5 -> E5 -> G5 -> C6)
    const notes = [523.25, 659.25, 783.99, 1046.50]; 
    const noteDuration = 0.15;
    
    notes.forEach((freq, index) => {
      const osc = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + index * noteDuration);
      
      // Dynamic volume envelope
      gainNode.gain.setValueAtTime(0, now + index * noteDuration);
      gainNode.gain.linearRampToValueAtTime(0.3, now + index * noteDuration + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + index * noteDuration + noteDuration * 2);
      
      osc.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      osc.start(now + index * noteDuration);
      osc.stop(now + index * noteDuration + noteDuration * 2.5);
    });
  } catch (err) {
    console.error("Failed to play audio alert:", err);
  }
}

/**
 * Synthesizes a repeating alert chime for active alarms.
 */
let alarmIntervalId = null;
function playAlarmLoop() {
  if (!state.audioEnabled) return;
  
  // Play immediately and repeat every 2.5s
  playReminderChime();
  if (alarmIntervalId) clearInterval(alarmIntervalId);
  alarmIntervalId = setInterval(() => {
    playReminderChime();
  }, 2500);
}

function stopAlarmLoop() {
  if (alarmIntervalId) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
}

// ==========================================================================
// 3. System Toast & Notification Engine
// ==========================================================================

function showToast(title, desc, type = "info") {
  const container = document.getElementById("toast-wrapper");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let icon = "🔔";
  if (type === "success") icon = "✓";
  if (type === "error") icon = "❌";
  if (type === "warning") icon = "⚠️";

  toast.innerHTML = `
    <div class="toast-info-icon">${icon}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${desc}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto remove toast after 4.5 seconds
  setTimeout(() => {
    toast.style.animation = "fade-out 0.4s ease forwards";
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

/**
 * Triggers HTML5 Browser Notification if permitted.
 */
function sendBrowserNotification(title, body) {
  if (!state.pushNotifEnabled) return;
  
  if (Notification.permission === "granted") {
    new Notification(title, {
      body: body,
      icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2306b6d4'><circle cx='12' cy='12' r='10'/></svg>"
    });
  }
}

/**
 * Requests push permission and toggles switch.
 */
async function requestPushPermission(silent = false) {
  if (!("Notification" in window)) {
    if (!silent) showToast("Unsupported Browser", "This browser doesn't support desktop notifications.", "error");
    document.getElementById("toggle-push-notif").checked = false;
    state.pushNotifEnabled = false;
    return;
  }

  if (Notification.permission === "granted") {
    state.pushNotifEnabled = true;
    localStorage.setItem(STORAGE_KEY_PUSH, "true");
    if (!silent) showToast("Alerts Active", "Desktop push alerts are enabled.", "success");
    return;
  }

  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      state.pushNotifEnabled = true;
      localStorage.setItem(STORAGE_KEY_PUSH, "true");
      showToast("Access Granted", "You will now receive desktop notifications for upcoming deadlines.", "success");
      return;
    }
  }

  // Denied or disabled
  state.pushNotifEnabled = false;
  localStorage.setItem(STORAGE_KEY_PUSH, "false");
  document.getElementById("toggle-push-notif").checked = false;
  if (!silent) showToast("Access Denied", "Notifications blocked by browser settings.", "warning");
}

// ==========================================================================
// 4. Data Management & Persistence
// ==========================================================================

function loadStateFromStorage() {
  // Load tasks
  const storedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
  if (storedTasks) {
    try {
      state.tasks = JSON.parse(storedTasks);
      // Re-populate classes from loaded tasks
      state.tasks.forEach(t => state.classes.add(t.class));
    } catch (e) {
      console.error("Failed to parse stored tasks, resetting.", e);
      state.tasks = [];
    }
  } else {
    // Generate onboarding sample tasks
    generateMockOnboardingTasks();
  }

  // Load configuration
  state.gcrConnected = localStorage.getItem(STORAGE_KEY_GCR_STATUS) === "true";
  state.audioEnabled = localStorage.getItem(STORAGE_KEY_AUDIO) !== "false";
  state.pushNotifEnabled = localStorage.getItem(STORAGE_KEY_PUSH) === "true";
  state.googleClientId = localStorage.getItem(STORAGE_KEY_CLIENT_ID) || "";
  state.googleProfileName = localStorage.getItem(STORAGE_KEY_PROFILE_NAME) || "";
  state.googleProfileEmail = localStorage.getItem(STORAGE_KEY_PROFILE_EMAIL) || "";
  state.googleProfilePicture = localStorage.getItem(STORAGE_KEY_PROFILE_PICTURE) || "";

  // Bind settings UI
  document.getElementById("toggle-audio").checked = state.audioEnabled;
  document.getElementById("toggle-push-notif").checked = state.pushNotifEnabled;
  
  const clientIdInput = document.getElementById("gcr-client-id");
  if (clientIdInput) {
    clientIdInput.value = state.googleClientId;
  }
  
  updateGcrStatusUI();
  populateClassFilterDropdown();
}

function saveTasksToStorage() {
  localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(state.tasks));
}

function generateMockOnboardingTasks() {
  const now = new Date();
  
  // Task 1: Due in 5 minutes (ideal for instant demo notification verification)
  const task1Time = new Date(now.getTime() + 5 * 60 * 1000);
  
  // Task 2: Due in 3 hours
  const task2Time = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  // Task 3: Completed yesterday
  const task3Time = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  state.tasks = [
    {
      id: "task-demo-1",
      title: "Verify Deadline Alarms (Try waiting!)",
      class: "MATH 202: Calculus III",
      priority: "high",
      dueDate: formatDateString(task1Time),
      dueTime: formatTimeString(task1Time),
      reminder: 0, // Alarm immediately on due
      description: "This task was automatically set to expire 5 minutes from when the application was opened so that you can verify browser notifications and audio alarms.",
      status: "pending",
      source: "custom",
      notified: false,
      dueNotified: false
    },
    {
      id: "task-demo-2",
      title: "Write Literature Critical Review",
      class: "LIT 105: World Literature",
      priority: "medium",
      dueDate: formatDateString(task2Time),
      dueTime: formatTimeString(task2Time),
      reminder: 15, // 15 mins warning
      description: "Analyze the first three chapters of the anthology and draft the thesis statement.",
      status: "in-progress",
      source: "custom",
      notified: false,
      dueNotified: false
    },
    {
      id: "task-demo-3",
      title: "Download Python SDK & Setup IDE",
      class: "CS 101: Intro to Programming",
      priority: "low",
      dueDate: formatDateString(task3Time),
      dueTime: formatTimeString(task3Time),
      reminder: 60,
      description: "Ensure local development dependencies are installed and test environment compiles.",
      status: "completed",
      source: "custom",
      notified: true,
      dueNotified: true
    }
  ];
  
  saveTasksToStorage();
}

// Helpers for dates formatting
function formatDateString(d) {
  return d.toISOString().split('T')[0];
}

function formatTimeString(d) {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// ==========================================================================
// 5. GCR Sync Simulator Engine
// ==========================================================================

const MOCK_GCR_DATABASE = {
  "CS 101: Intro to Programming": [
    { title: "Lab Assignment 3: Loops & Arrays", delayHours: 4, priority: "high", desc: "Write program to sort array lists without built-in library features." },
    { title: "Weekly Coding Challenge 4", delayHours: 48, priority: "low", desc: "Solve logic puzzle problems on the classroom grader system." }
  ],
  "MATH 202: Calculus III": [
    { title: "Calculus Exam Review Worksheet", delayHours: 1.5, priority: "high", desc: "Complete problems on double integrals and surface vectors." },
    { title: "Homework Sheet 7: Vector Calculus", delayHours: 96, priority: "medium", desc: "Submit scanned copy of pages 45-48 in PDF format." }
  ],
  "PHYS 301: Classical Mechanics": [
    { title: "Harmonic Oscillators Simulation Report", delayHours: 24, priority: "medium", desc: "Compare numerical calculations with experimental pendulum data." }
  ],
  "LIT 105: World Literature": [
    { title: "Comparative Essay Final Draft", delayHours: 120, priority: "high", desc: "Write 1,500 word paper contrasting mythological frameworks." }
  ]
};

function updateGcrStatusUI() {
  const disconnectedView = document.getElementById("gcr-disconnected-view");
  const connectedView = document.getElementById("gcr-connected-view");
  const greetingEl = document.getElementById("header-greeting");
  
  if (state.gcrConnected) {
    if (disconnectedView) disconnectedView.style.display = "none";
    if (connectedView) connectedView.style.display = "block";
    
    // Set Profile UI elements
    const nameEl = document.getElementById("gcr-profile-name");
    const emailEl = document.getElementById("gcr-profile-email");
    const avatarImg = document.getElementById("gcr-avatar-img");
    const avatarFallback = document.getElementById("gcr-avatar-fallback");
    
    if (nameEl) nameEl.textContent = state.googleProfileName || "Google Account";
    if (emailEl) emailEl.textContent = state.googleProfileEmail || "Connected";
    
    if (avatarImg && avatarFallback) {
      if (state.googleProfilePicture) {
        avatarImg.src = state.googleProfilePicture;
        avatarImg.style.display = "block";
        avatarFallback.style.display = "none";
      } else {
        avatarImg.style.display = "none";
        avatarFallback.style.display = "flex";
      }
    }

    if (greetingEl) {
      const firstName = state.googleProfileName ? state.googleProfileName.split(' ')[0] : "Scholar";
      greetingEl.textContent = `Welcome back, ${firstName}!`;
    }
  } else {
    if (disconnectedView) disconnectedView.style.display = "block";
    if (connectedView) connectedView.style.display = "none";
    if (greetingEl) greetingEl.textContent = "Welcome back, Scholar!";
  }
}

function disconnectGcr() {
  state.gcrConnected = false;
  state.googleAccessToken = "";
  state.googleProfileName = "";
  state.googleProfileEmail = "";
  state.googleProfilePicture = "";
  
  localStorage.setItem(STORAGE_KEY_GCR_STATUS, "false");
  localStorage.removeItem(STORAGE_KEY_PROFILE_NAME);
  localStorage.removeItem(STORAGE_KEY_PROFILE_EMAIL);
  localStorage.removeItem(STORAGE_KEY_PROFILE_PICTURE);
  
  updateGcrStatusUI();
  showToast("Account Disconnected", "Signed out from Google and cleared session tokens.", "info");
}

/**
 * Handles Sync Classroom trigger
 */
// Google Integration Globals
let tokenClient = null;

function handleGcrSyncTrigger() {
  const modal = document.getElementById("gcr-sync-modal");
  const stageAuth = document.getElementById("sync-stage-auth");
  const stageLoading = document.getElementById("sync-stage-loading");
  const stageSelect = document.getElementById("sync-stage-select");
  
  // Show modal
  modal.style.display = "flex";
  
  // Default to Google Sign-In tab
  switchSyncFlowTab("real");
  
  if (state.gcrConnected && state.googleAccessToken) {
    // If already connected with active token in session, skip to select
    stageAuth.style.display = "none";
    stageLoading.style.display = "none";
    stageSelect.style.display = "flex";
    populateGcrClassSyncChecklist();
  } else {
    // Show auth screen
    stageAuth.style.display = "flex";
    stageLoading.style.display = "none";
    stageSelect.style.display = "none";
  }
}

function switchSyncFlowTab(mode) {
  const tabReal = document.getElementById("tab-real-flow");
  const tabMock = document.getElementById("tab-mock-flow");
  const containerReal = document.getElementById("flow-container-real");
  const containerMock = document.getElementById("flow-container-mock");
  
  state.googleSyncMode = mode;
  
  if (mode === "real") {
    tabReal.classList.add("active");
    tabMock.classList.remove("active");
    containerReal.style.display = "block";
    containerMock.style.display = "none";
  } else {
    tabReal.classList.remove("active");
    tabMock.classList.add("active");
    containerReal.style.display = "none";
    containerMock.style.display = "block";
  }
}

function toggleHelpDrawer() {
  const drawer = document.getElementById("gcr-help-drawer");
  const arrow = document.querySelector("#btn-toggle-help svg");
  if (drawer.style.display === "none") {
    drawer.style.display = "block";
    arrow.style.transform = "rotate(180deg)";
  } else {
    drawer.style.display = "none";
    arrow.style.transform = "rotate(0deg)";
  }
}

function startGcrRealAuthorization() {
  const clientId = document.getElementById("gcr-client-id").value.trim();
  if (!clientId) {
    showToast("Client ID Required", "Please enter your Google OAuth Client ID to connect.", "warning");
    return;
  }
  
  // Save client ID
  state.googleClientId = clientId;
  localStorage.setItem(STORAGE_KEY_CLIENT_ID, clientId);
  
  const stageAuth = document.getElementById("sync-stage-auth");
  const stageLoading = document.getElementById("sync-stage-loading");
  const loadingText = document.getElementById("sync-loading-text");
  const loadingSubtext = document.getElementById("sync-loading-subtext");
  const loadingRing = stageLoading.querySelector(".loading-ring");
  const loadingCheck = stageLoading.querySelector(".loading-check");

  stageAuth.style.display = "none";
  stageLoading.style.display = "flex";
  loadingRing.style.display = "block";
  loadingCheck.style.display = "none";
  loadingText.textContent = "Connecting to Google Account...";
  loadingSubtext.textContent = "Waiting for user authentication in popup...";

  const initialized = initGoogleOAuthClient(clientId, async (response) => {
    if (response.error !== undefined) {
      console.error("Google OAuth Error:", response);
      stageLoading.style.display = "none";
      stageAuth.style.display = "flex";
      showToast("Authentication Failed", response.error_description || response.error, "error");
      return;
    }
    
    // Success: save token
    state.googleAccessToken = response.access_token;
    state.gcrConnected = true;
    localStorage.setItem(STORAGE_KEY_GCR_STATUS, "true");

    // Fetch user profile from Google UserInfo endpoint
    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { "Authorization": `Bearer ${response.access_token}` }
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        state.googleProfileName = profileData.name || "";
        state.googleProfileEmail = profileData.email || "";
        state.googleProfilePicture = profileData.picture || "";
        
        localStorage.setItem(STORAGE_KEY_PROFILE_NAME, state.googleProfileName);
        localStorage.setItem(STORAGE_KEY_PROFILE_EMAIL, state.googleProfileEmail);
        localStorage.setItem(STORAGE_KEY_PROFILE_PICTURE, state.googleProfilePicture);
      }
    } catch (e) {
      console.error("Failed to load Google profile:", e);
    }
    
    updateGcrStatusUI();
    
    try {
      loadingText.textContent = "Fetching Rosters & Tasks...";
      loadingSubtext.textContent = "Downloading active Classroom courses and Google Tasks lists...";
      
      await loadGoogleResources();
      
      loadingRing.style.display = "none";
      loadingCheck.style.display = "block";
      loadingText.textContent = "Resources Downloaded!";
      loadingSubtext.textContent = "Formatting selection checklist...";
      
      setTimeout(() => {
        stageLoading.style.display = "none";
        document.getElementById("sync-stage-select").style.display = "flex";
        populateGcrClassSyncChecklist();
      }, 1000);
    } catch (err) {
      console.error("Failed to load resources:", err);
      stageLoading.style.display = "none";
      stageAuth.style.display = "flex";
      showToast("Sync Fetch Failed", "Could not fetch classroom rosters. Verify API scopes are enabled.", "error");
    }
  });

  if (initialized) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    stageLoading.style.display = "none";
    stageAuth.style.display = "flex";
  }
}

function initGoogleOAuthClient(clientId, callback) {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    showToast("Google SDK Loading", "Google Accounts SDK is not ready yet. Please wait a second.", "warning");
    return false;
  }
  
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/tasks.readonly openid email profile',
      callback: callback
    });
    return true;
  } catch (err) {
    console.error("Failed to initialize Google Token Client:", err);
    showToast("Initialization Failed", "Verify your Client ID structure.", "error");
    return false;
  }
}

async function loadGoogleResources() {
  const token = state.googleAccessToken;
  
  // 1. Fetch Classroom courses
  try {
    const coursesRes = await fetch("https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (coursesRes.ok) {
      const data = await coursesRes.json();
      state.googleCourses = data.courses || [];
    } else {
      console.warn("Classroom API returned status:", coursesRes.status);
      state.googleCourses = [];
    }
  } catch (e) {
    console.error("Error loading courses:", e);
    state.googleCourses = [];
  }

  // 2. Fetch Tasks lists
  try {
    const listsRes = await fetch("https://tasks.googleapis.com/v1/users/@me/lists", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (listsRes.ok) {
      const data = await listsRes.json();
      state.googleTaskLists = data.items || [];
    } else {
      console.warn("Tasks API returned status:", listsRes.status);
      state.googleTaskLists = [];
    }
  } catch (e) {
    console.error("Error loading task lists:", e);
    state.googleTaskLists = [];
  }
}

function startGcrMockAuthorization() {
  const stageAuth = document.getElementById("sync-stage-auth");
  const stageLoading = document.getElementById("sync-stage-loading");
  const loadingText = document.getElementById("sync-loading-text");
  const loadingSubtext = document.getElementById("sync-loading-subtext");
  const loadingRing = stageLoading.querySelector(".loading-ring");
  const loadingCheck = stageLoading.querySelector(".loading-check");

  stageAuth.style.display = "none";
  stageLoading.style.display = "flex";
  
  // Step 1: Simulate OAuth connection
  loadingText.textContent = "Connecting to Google Classroom...";
  loadingSubtext.textContent = "Negotiating scopes: courses.readonly, coursework.me...";
  loadingRing.style.display = "block";
  loadingCheck.style.display = "none";

  setTimeout(() => {
    // Step 2: Simulate fetching classroom index
    loadingText.textContent = "Fetching Class Rosters...";
    loadingSubtext.textContent = "Downloading classroom records for 'Scholar'...";
    
    setTimeout(() => {
      // Step 3: Success & Forward to class list selection
      loadingRing.style.display = "none";
      loadingCheck.style.display = "block";
      loadingText.textContent = "Authorization Granted!";
      loadingSubtext.textContent = "Sync configuration loading...";
      
      setTimeout(() => {
        state.gcrConnected = true;
        localStorage.setItem(STORAGE_KEY_GCR_STATUS, "true");
        updateGcrStatusUI();
        
        stageLoading.style.display = "none";
        document.getElementById("sync-stage-select").style.display = "flex";
        populateGcrClassSyncChecklist();
      }, 1000);
    }, 1200);
  }, 1200);
}

function populateGcrClassSyncChecklist() {
  const container = document.getElementById("gcr-class-list-container");
  container.innerHTML = "";
  
  if (state.googleSyncMode === "real") {
    let htmlContent = "";

    // 1. Google Classroom courses rendering
    if (state.googleCourses.length > 0) {
      htmlContent += `<div style="text-align:left; font-size:0.75rem; font-weight:700; color:var(--accent); text-transform:uppercase; margin-bottom:0.5rem; letter-spacing:0.5px;">Google Classroom Courses</div>`;
      state.googleCourses.forEach(course => {
        const isAlreadyConnected = state.tasks.some(t => t.class === course.name && t.source === "gcr");
        htmlContent += `
          <label class="class-checkbox-item">
            <input type="checkbox" name="real-sync-courses" value="${course.id}" data-name="${escapeHTML(course.name)}" ${isAlreadyConnected ? "checked" : ""}>
            <div class="class-item-details">
              <span class="class-item-title">${escapeHTML(course.name)}</span>
              <span class="class-item-count">Section: ${escapeHTML(course.section || "Active")}</span>
            </div>
          </label>
        `;
      });
    }

    // 2. Google Tasks lists rendering
    if (state.googleTaskLists.length > 0) {
      htmlContent += `<div style="text-align:left; font-size:0.75rem; font-weight:700; color:#8b5cf6; text-transform:uppercase; margin:1rem 0 0.5rem 0; letter-spacing:0.5px;">Google Tasks Lists</div>`;
      state.googleTaskLists.forEach(list => {
        const isAlreadyConnected = state.tasks.some(t => t.class === list.title && t.source === "gtasks");
        htmlContent += `
          <label class="class-checkbox-item">
            <input type="checkbox" name="real-sync-tasklists" value="${list.id}" data-name="${escapeHTML(list.title)}" ${isAlreadyConnected ? "checked" : ""}>
            <div class="class-item-details">
              <span class="class-item-title">${escapeHTML(list.title)}</span>
              <span class="class-item-count">Database: Mail Account Tasks</span>
            </div>
          </label>
        `;
      });
    }

    if (!htmlContent) {
      container.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); padding:1rem 0;">No courses or task lists found on this Google Account.</p>`;
    } else {
      container.innerHTML = htmlContent;
    }
  } else {
    // Mock selection checklist
    Object.keys(MOCK_GCR_DATABASE).forEach((className, i) => {
      const list = MOCK_GCR_DATABASE[className];
      const isAlreadyConnected = state.tasks.some(t => t.class === className && t.source === "gcr");
      
      const card = document.createElement("label");
      card.className = "class-checkbox-item";
      card.innerHTML = `
        <input type="checkbox" name="gcr-sync-classes" value="${className}" ${isAlreadyConnected ? "checked" : ""}>
        <div class="class-item-details">
          <span class="class-item-title">${escapeHTML(className)}</span>
          <span class="class-item-count">${list.length} assignments available for tracking</span>
        </div>
      `;
      container.appendChild(card);
    });
  }
}

async function executeGcrImport() {
  const syncBtn = document.getElementById("btn-sync-gcr");
  const spinnerIcon = syncBtn.querySelector(".spin-on-sync");
  
  // Close Sync modal
  document.getElementById("gcr-sync-modal").style.display = "none";
  
  // Start syncing animation
  spinnerIcon.classList.add("syncing");
  
  let importedCount = 0;
  const now = new Date();

  if (state.googleSyncMode === "real") {
    const checkedCourses = document.querySelectorAll('input[name="real-sync-courses"]:checked');
    const checkedTasklists = document.querySelectorAll('input[name="real-sync-tasklists"]:checked');
    const token = state.googleAccessToken;

    // 1. Classroom Coursework imports
    for (const cb of checkedCourses) {
      const courseId = cb.value;
      const courseName = cb.getAttribute("data-name");
      
      try {
        const res = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/courseWork`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const list = data.courseWork || [];
          
          list.forEach(work => {
            const exists = state.tasks.some(t => t.title === work.title && t.class === courseName);
            if (!exists) {
              // Parse date and time
              let taskDueDate = formatDateString(new Date(now.getTime() + 48 * 60 * 60 * 1000));
              let taskDueTime = "23:59";
              
              if (work.dueDate) {
                const year = work.dueDate.year;
                const month = String(work.dueDate.month).padStart(2, '0');
                const day = String(work.dueDate.day).padStart(2, '0');
                taskDueDate = `${year}-${month}-${day}`;
              }
              if (work.dueTime) {
                const hour = String(work.dueTime.hours || 0).padStart(2, '0');
                const minute = String(work.dueTime.minutes || 0).padStart(2, '0');
                taskDueTime = `${hour}:${minute}`;
              }

              state.tasks.push({
                id: `real-gcr-${work.id}`,
                title: work.title,
                class: courseName,
                priority: "medium",
                dueDate: taskDueDate,
                dueTime: taskDueTime,
                reminder: 60,
                description: (work.description || "") + `\n\nLink: ${work.alternateLink || ""}`,
                status: "pending",
                source: "gcr",
                notified: false,
                dueNotified: false
              });
              
              state.classes.add(courseName);
              importedCount++;
            }
          });
        }
      } catch (err) {
        console.error(`Failed to fetch coursework for course ${courseId}:`, err);
      }
    }

    // 2. Google Tasks imports
    for (const cb of checkedTasklists) {
      const listId = cb.value;
      const listTitle = cb.getAttribute("data-name");
      
      try {
        const res = await fetch(`https://tasks.googleapis.com/v1/lists/${listId}/tasks?showCompleted=false`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const items = data.items || [];
          
          items.forEach(taskItem => {
            const exists = state.tasks.some(t => t.title === taskItem.title && t.class === listTitle);
            if (!exists && taskItem.title) {
              let taskDueDate = formatDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000));
              let taskDueTime = "23:59";
              
              if (taskItem.due) {
                const taskDateObj = new Date(taskItem.due);
                taskDueDate = formatDateString(taskDateObj);
              }

              state.tasks.push({
                id: `real-tasks-${taskItem.id}`,
                title: taskItem.title,
                class: listTitle,
                priority: "low",
                dueDate: taskDueDate,
                dueTime: taskDueTime,
                reminder: 60,
                description: taskItem.notes || "Imported from Google Tasks.",
                status: "pending",
                source: "gtasks",
                notified: false,
                dueNotified: false
              });
              
              state.classes.add(listTitle);
              importedCount++;
            }
          });
        }
      } catch (err) {
        console.error(`Failed to fetch tasks for list ${listId}:`, err);
      }
    }
  } else {
    // Mock simulation
    const checkedBoxes = document.querySelectorAll('input[name="gcr-sync-classes"]:checked');
    const selectedClasses = Array.from(checkedBoxes).map(cb => cb.value);

    selectedClasses.forEach(className => {
      const assignments = MOCK_GCR_DATABASE[className];
      assignments.forEach(assign => {
        const exists = state.tasks.some(t => t.title === assign.title && t.class === className);
        if (!exists) {
          const dueTimeVal = new Date(now.getTime() + assign.delayHours * 60 * 60 * 1000);
          
          state.tasks.push({
            id: `gcr-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            title: assign.title,
            class: className,
            priority: assign.priority,
            dueDate: formatDateString(dueTimeVal),
            dueTime: formatTimeString(dueTimeVal),
            reminder: 60,
            description: `${assign.desc} (Imported from Google Classroom Simulator)`,
            status: "pending",
            source: "gcr",
            notified: false,
            dueNotified: false
          });
          
          state.classes.add(className);
          importedCount++;
        }
      });
    });
  }

  setTimeout(() => {
    spinnerIcon.classList.remove("syncing");
    
    if (importedCount > 0) {
      saveTasksToStorage();
      populateClassFilterDropdown();
      renderAllViews();
      showToast("Sync Successful", `Imported ${importedCount} actual items to your schedule!`, "success");
    } else {
      showToast("Already Synced", "All deadlines from chosen resources were already up-to-date.", "info");
    }
  }, 1500);
}

// ==========================================================================
// 6. UI Views Rendering & Math calculation
// ==========================================================================

function populateClassFilterDropdown() {
  const dropdown = document.getElementById("filter-class");
  const formDatalist = document.getElementById("class-datalist");
  
  // Clear other than 'All Classes'
  dropdown.innerHTML = `<option value="all">All Classes</option>`;
  formDatalist.innerHTML = "";

  state.classes.forEach(cls => {
    // Filter option
    const opt = document.createElement("option");
    opt.value = cls;
    opt.textContent = cls.split(':')[0] || cls; // Short label e.g. 'CS 101'
    dropdown.appendChild(opt);

    // Form datalist option
    const dataOpt = document.createElement("option");
    dataOpt.value = cls;
    formDatalist.appendChild(dataOpt);
  });
}

/**
 * Calculates countdown string and urgency category.
 * Fired inside view rendering and ticker loops.
 */
function getDeadlineStatus(dueDateStr, dueTimeStr, taskStatus) {
  if (taskStatus === "completed") {
    return { text: "Completed", urgency: "safe" };
  }

  const now = new Date();
  const deadline = new Date(`${dueDateStr}T${dueTimeStr}`);
  const diffMs = deadline.getTime() - now.getTime();
  
  if (diffMs <= 0) {
    return { text: "OVERDUE", urgency: "overdue" };
  }

  const diffSecs = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSecs / 86400);
  const hours = Math.floor((diffSecs % 86400) / 3600);
  const minutes = Math.floor((diffSecs % 3600) / 60);
  const seconds = diffSecs % 60;

  let label = "";
  if (days > 0) {
    label = `${days}d ${hours}h`;
  } else if (hours > 0) {
    label = `${hours}h ${minutes}m`;
  } else {
    label = `${minutes}m ${seconds}s`;
  }

  // Determine urgency code
  let urgency = "safe"; // > 24 hours
  if (diffMs < 3 * 60 * 60 * 1000) {
    urgency = "soon"; // < 3 hours
  } else if (diffMs < 24 * 60 * 60 * 1000) {
    urgency = "approaching"; // < 24 hours
  }

  return { text: `Due in ${label}`, urgency };
}

/**
 * Filter & sort task helper
 */
function getFilteredTasks() {
  const searchVal = document.getElementById("task-search").value.toLowerCase();
  const classVal = document.getElementById("filter-class").value;
  const priorityVal = document.getElementById("filter-priority").value;
  const statusVal = document.getElementById("filter-status").value;
  const sortVal = document.getElementById("sort-tasks").value;

  let result = [...state.tasks];

  // Search Filter
  if (searchVal) {
    result = result.filter(t => 
      t.title.toLowerCase().includes(searchVal) ||
      (t.description && t.description.toLowerCase().includes(searchVal)) ||
      t.class.toLowerCase().includes(searchVal)
    );
  }

  // Class Filter
  if (classVal !== "all") {
    result = result.filter(t => t.class === classVal);
  }

  // Priority Filter
  if (priorityVal !== "all") {
    result = result.filter(t => t.priority === priorityVal);
  }

  // Status Filter
  if (statusVal !== "all") {
    if (statusVal === "completed") {
      result = result.filter(t => t.status === "completed");
    } else if (statusVal === "pending") {
      result = result.filter(t => t.status === "pending" || t.status === "in-progress");
    } else if (statusVal === "overdue") {
      const now = new Date();
      result = result.filter(t => {
        const deadline = new Date(`${t.dueDate}T${t.dueTime}`);
        return t.status !== "completed" && deadline.getTime() <= now.getTime();
      });
    }
  }

  // Sorting
  result.sort((a, b) => {
    const timeA = new Date(`${a.dueDate}T${a.dueTime}`).getTime();
    const timeB = new Date(`${b.dueDate}T${b.dueTime}`).getTime();

    if (sortVal === "deadline-asc") return timeA - timeB;
    if (sortVal === "deadline-desc") return timeB - timeA;
    
    if (sortVal === "priority-desc") {
      const priorityWeights = { high: 3, medium: 2, low: 1 };
      return priorityWeights[b.priority] - priorityWeights[a.priority];
    }
    
    if (sortVal === "title-asc") {
      return a.title.localeCompare(b.title);
    }
    
    return 0;
  });

  return result;
}

// --------------------------------------------------------------------------
// View Rendering: LIST VIEW
// --------------------------------------------------------------------------
function renderListView() {
  const container = document.getElementById("task-list-container");
  const emptyState = document.getElementById("list-empty-state");
  const badge = document.getElementById("list-count-badge");
  
  const filtered = getFilteredTasks();
  container.innerHTML = "";
  badge.textContent = `${filtered.length} tasks`;

  if (filtered.length === 0) {
    emptyState.style.display = "flex";
    return;
  }
  
  emptyState.style.display = "none";

  filtered.forEach(task => {
    const card = document.createElement("div");
    const isCompleted = task.status === "completed";
    const priorityClass = `priority-${task.priority}`;
    const statusClass = `status-${task.status}`;
    const sourceClass = `source-${task.source}`;
    
    card.className = `task-item ${priorityClass} ${statusClass} ${sourceClass}`;
    card.setAttribute("data-id", task.id);
    
    // Calculate live countdown timer
    const dlStatus = getDeadlineStatus(task.dueDate, task.dueTime, task.status);
    const countdownClass = dlStatus.urgency === "soon" ? "countdown-soon" : 
                            dlStatus.urgency === "approaching" ? "countdown-approaching" : 
                            dlStatus.urgency === "overdue" ? "countdown-overdue" : "countdown-safe";

    // Format human readable date
    const dateObj = new Date(`${task.dueDate}T${task.dueTime}`);
    const timeFormatted = dateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dateFormatted = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

    card.innerHTML = `
      <div class="task-checkbox-container">
        <button class="task-checkbox" aria-label="Toggle Complete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      </div>

      <div class="task-info-group">
        <div class="task-title-row">
          <span class="task-title">${escapeHTML(task.title)}</span>
          <span class="class-badge">${escapeHTML(task.class)}</span>
          <span class="priority-badge badge-${task.priority}">${task.priority}</span>
        </div>
        ${task.description ? `<p class="task-desc">${escapeHTML(task.description)}</p>` : ""}
      </div>

      <div class="task-controls-group">
        <div class="task-due-widget">
          <span class="task-due-date">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>${dateFormatted} at ${timeFormatted}</span>
          </span>
          <span class="task-due-countdown ${countdownClass}">${dlStatus.text}</span>
        </div>

        <div class="task-actions">
          <button class="btn-action-icon btn-edit" title="Edit Task">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-action-icon btn-delete" title="Delete Task">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Hook events
    card.querySelector(".task-checkbox").addEventListener("click", () => toggleTaskCompletion(task.id));
    card.querySelector(".btn-edit").addEventListener("click", () => editTask(task.id));
    card.querySelector(".btn-delete").addEventListener("click", () => deleteTask(task.id));

    container.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// View Rendering: KANBAN BOARD VIEW
// --------------------------------------------------------------------------
function renderBoardView() {
  const containers = {
    "pending": document.getElementById("board-pending-container"),
    "in-progress": document.getElementById("board-progress-container"),
    "completed": document.getElementById("board-completed-container")
  };
  
  const badges = {
    "pending": document.getElementById("badge-board-pending"),
    "in-progress": document.getElementById("badge-board-progress"),
    "completed": document.getElementById("badge-board-completed")
  };

  // Clear columns
  Object.keys(containers).forEach(status => {
    containers[status].innerHTML = "";
    badges[status].textContent = "0";
  });

  const filtered = getFilteredTasks();

  const columnGroups = { "pending": [], "in-progress": [], "completed": [] };
  
  filtered.forEach(task => {
    let col = task.status;
    if (col === "pending" || col === "in-progress" || col === "completed") {
      columnGroups[col].push(task);
    } else {
      // Overdue/anything else defaults to pending on Kanban
      columnGroups["pending"].push(task);
    }
  });

  Object.keys(columnGroups).forEach(status => {
    const list = columnGroups[status];
    badges[status].textContent = list.length;
    
    list.forEach(task => {
      const card = document.createElement("div");
      card.className = "kanban-card";
      card.setAttribute("draggable", "true");
      card.setAttribute("data-id", task.id);
      
      const dlStatus = getDeadlineStatus(task.dueDate, task.dueTime, task.status);
      const countdownClass = dlStatus.urgency === "soon" ? "countdown-soon" : 
                            dlStatus.urgency === "approaching" ? "countdown-approaching" : 
                            dlStatus.urgency === "overdue" ? "countdown-overdue" : "countdown-safe";

      // Formulate movement options for buttons (helps navigation on tablet/mobile click)
      let movementsHTML = "";
      if (status === "pending") {
        movementsHTML = `<button class="btn-card-move" data-move="in-progress">Start &rarr;</button>`;
      } else if (status === "in-progress") {
        movementsHTML = `
          <button class="btn-card-move" data-move="pending">&larr; Hold</button>
          <button class="btn-card-move" data-move="completed">Done &rarr;</button>
        `;
      } else if (status === "completed") {
        movementsHTML = `<button class="btn-card-move" data-move="in-progress">&larr; Reopen</button>`;
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <span class="priority-badge badge-${task.priority}" style="font-size:0.65rem;">${task.priority}</span>
          <span class="class-badge" style="font-size:0.65rem; padding: 0.1rem 0.4rem;">${escapeHTML(task.class.split(':')[0] || task.class)}</span>
        </div>
        <h5 class="kanban-card-title">${escapeHTML(task.title)}</h5>
        ${task.description ? `<p class="kanban-card-desc">${escapeHTML(task.description)}</p>` : ""}
        
        <div class="kanban-card-footer">
          <span class="kanban-card-time ${countdownClass}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span style="font-size:0.7rem; font-weight:700;">${dlStatus.text}</span>
          </span>
          <div class="kanban-card-moves">
            ${movementsHTML}
          </div>
        </div>
      `;

      // Drag events
      card.addEventListener("dragstart", (e) => {
        card.classList.add("dragging");
        e.dataTransfer.setData("text/plain", task.id);
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });

      // Quick move clicks
      card.querySelectorAll(".btn-card-move").forEach(btn => {
        btn.addEventListener("click", () => {
          const destStatus = btn.getAttribute("data-move");
          moveTaskStatus(task.id, destStatus);
        });
      });

      containers[status].appendChild(card);
    });
    
    // Drag-over styling hooks for container columns
    const colContainer = containers[status];
    colContainer.addEventListener("dragover", (e) => {
      e.preventDefault();
      colContainer.style.background = "rgba(255, 255, 255, 0.03)";
    });

    colContainer.addEventListener("dragleave", () => {
      colContainer.style.background = "transparent";
    });

    colContainer.addEventListener("drop", (e) => {
      e.preventDefault();
      colContainer.style.background = "transparent";
      const taskId = e.dataTransfer.getData("text/plain");
      moveTaskStatus(taskId, status);
    });
  });
}

// --------------------------------------------------------------------------
// View Rendering: CALENDAR VIEW
// --------------------------------------------------------------------------
function renderCalendarView() {
  const container = document.getElementById("calendar-days");
  const monthYearHeader = document.getElementById("calendar-month-year");
  
  container.innerHTML = "";
  
  const tempDate = new Date(state.calendarCurrentDate.getFullYear(), state.calendarCurrentDate.getMonth(), 1);
  const year = tempDate.getFullYear();
  const month = tempDate.getMonth();
  
  // Set Calendar Header text
  monthYearHeader.textContent = tempDate.toLocaleDateString([], { month: 'long', year: 'numeric' });

  // Grid offsets: Day of week of the first day (0-6)
  const firstDayIndex = tempDate.getDay();
  
  // Total days in current month
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  // Total days in previous month (to fill preceding offsets)
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  const now = new Date();
  
  // 1. Preceding Days (from previous month)
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayCell = document.createElement("div");
    dayCell.className = "calendar-day-cell inactive-month";
    dayCell.innerHTML = `<span class="day-number">${prevMonthTotalDays - i}</span>`;
    container.appendChild(dayCell);
  }

  // 2. Active Month Days
  for (let day = 1; day <= totalDays; day++) {
    const dayCell = document.createElement("div");
    dayCell.className = "calendar-day-cell";
    
    // Check if cell represents today
    const isToday = now.getDate() === day && now.getMonth() === month && now.getFullYear() === year;
    if (isToday) dayCell.classList.add("today-highlight");

    // Fetch tasks due on this calendar day
    const dayISOString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = state.tasks.filter(t => t.dueDate === dayISOString);

    // Build task indicator dots
    let dotsHTML = "";
    if (dayTasks.length > 0) {
      dotsHTML = `<div class="day-tasks-dots">`;
      dayTasks.slice(0, 4).forEach(t => {
        dotsHTML += `<span class="day-task-dot priority-${t.priority} status-${t.status}"></span>`;
      });
      if (dayTasks.length > 4) {
        dotsHTML += `<span style="font-size:0.6rem; color:var(--text-muted);font-weight:700;">+${dayTasks.length - 4}</span>`;
      }
      dotsHTML += `</div>`;
    }

    dayCell.innerHTML = `
      <span class="day-number">${day}</span>
      ${dotsHTML}
    `;

    // Click handler: opens bottom details panel
    dayCell.addEventListener("click", () => {
      showCalendarDayDetails(dayISOString, dayTasks);
    });

    container.appendChild(dayCell);
  }

  // 3. Succeeding Days (to complete 6-row layout = 42 cells total)
  const totalCellsWritten = firstDayIndex + totalDays;
  const remainingCells = 42 - totalCellsWritten;
  
  for (let day = 1; day <= remainingCells; day++) {
    const dayCell = document.createElement("div");
    dayCell.className = "calendar-day-cell inactive-month";
    dayCell.innerHTML = `<span class="day-number">${day}</span>`;
    container.appendChild(dayCell);
  }
}

function showCalendarDayDetails(dateString, tasks) {
  const panel = document.getElementById("calendar-day-details-panel");
  const listContainer = document.getElementById("calendar-day-tasks-list");
  const title = document.getElementById("selected-day-title");

  state.selectedCalendarDay = dateString;

  const dateObj = new Date(`${dateString}T12:00:00`); // mid-day to avoid TZ shifting
  title.textContent = `Schedule for ${dateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}`;
  listContainer.innerHTML = "";
  panel.style.display = "block";

  if (tasks.length === 0) {
    listContainer.innerHTML = `<p style="font-size:0.85rem; color:var(--text-muted); padding:0.5rem 0;">No deadlines due on this date.</p>`;
    return;
  }

  tasks.forEach(task => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.15); padding:0.75rem 1rem; border-radius:10px; border:1px solid var(--border-color);";
    
    const isCompleted = task.status === "completed";
    const statusText = isCompleted ? `<span class="priority-badge badge-completed">Completed</span>` : 
                       `<span class="priority-badge badge-${task.priority}">${task.priority}</span>`;

    row.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.25rem;">
        <span style="font-size:0.9rem; font-weight:600; ${isCompleted ? 'text-decoration:line-through;color:var(--text-muted);' : ''}">${escapeHTML(task.title)}</span>
        <span style="font-size:0.7rem; color:var(--text-muted);">${escapeHTML(task.class)} | Due at ${task.dueTime}</span>
      </div>
      <div>
        ${statusText}
      </div>
    `;
    listContainer.appendChild(row);
  });
}

// --------------------------------------------------------------------------
// View Rendering: DASHBOARD STATISTICS & COUNTERS
// --------------------------------------------------------------------------
function updateDashboardStatistics() {
  const now = new Date();
  
  // Stats counts
  const totalTasks = state.tasks.filter(t => t.status !== "completed").length;
  const completedTasks = state.tasks.filter(t => t.status === "completed").length;
  
  // Tasks due in next 24 hours
  const dueToday = state.tasks.filter(t => {
    if (t.status === "completed") return false;
    const deadline = new Date(`${t.dueDate}T${t.dueTime}`);
    const diff = deadline.getTime() - now.getTime();
    return diff > 0 && diff <= 24 * 60 * 60 * 1000;
  }).length;

  document.getElementById("stat-total-tasks").textContent = totalTasks;
  document.getElementById("stat-due-today").textContent = dueToday;
  document.getElementById("stat-completed-tasks").textContent = completedTasks;

  // Calculate Next Soonest Deadline Countdown
  const pendingTasks = state.tasks
    .filter(t => t.status !== "completed")
    .map(t => ({
      task: t,
      time: new Date(`${t.dueDate}T${t.dueTime}`).getTime()
    }))
    .filter(item => item.time > now.getTime())
    .sort((a, b) => a.time - b.time);

  const countdownTextEl = document.getElementById("stat-countdown");
  const countdownTitleEl = document.getElementById("stat-countdown-title");

  if (pendingTasks.length > 0) {
    const nextItem = pendingTasks[0];
    const diffMs = nextItem.time - now.getTime();
    
    // format countdown HH:MM:SS
    const diffSecs = Math.floor(diffMs / 1000);
    const hours = String(Math.floor(diffSecs / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((diffSecs % 3600) / 60)).padStart(2, '0');
    const seconds = String(diffSecs % 60).padStart(2, '0');

    countdownTextEl.textContent = `${hours}:${minutes}:${seconds}`;
    countdownTitleEl.textContent = nextItem.task.title;
    
    // Add pulsing alarm class if less than 3 hours
    if (diffMs < 3 * 60 * 60 * 1000) {
      countdownTextEl.classList.add("countdown-soon");
    } else {
      countdownTextEl.classList.remove("countdown-soon");
    }
  } else {
    countdownTextEl.textContent = "--:--:--";
    countdownTextEl.classList.remove("countdown-soon");
    countdownTitleEl.textContent = "No upcoming tasks";
  }
}

function renderAllViews() {
  if (state.activeView === "list") renderListView();
  if (state.activeView === "board") renderBoardView();
  if (state.activeView === "calendar") renderCalendarView();
  
  // Update details drawer if open in calendar
  if (state.activeView === "calendar" && state.selectedCalendarDay) {
    const dayTasks = state.tasks.filter(t => t.dueDate === state.selectedCalendarDay);
    showCalendarDayDetails(state.selectedCalendarDay, dayTasks);
  }
  
  updateDashboardStatistics();
}

// ==========================================================================
// 7. Operations & CRUD
// ==========================================================================

function toggleTaskCompletion(id) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx !== -1) {
    const task = state.tasks[idx];
    const isNowCompleted = task.status !== "completed";
    
    task.status = isNowCompleted ? "completed" : "pending";
    
    if (isNowCompleted) {
      task.notified = true;
      task.dueNotified = true;
      showToast("Task Completed", `"${task.title}" checked off!`, "success");
    } else {
      task.notified = false;
      task.dueNotified = false;
      showToast("Task Reopened", `"${task.title}" is back in progress.`, "info");
    }
    
    saveTasksToStorage();
    renderAllViews();
  }
}

function moveTaskStatus(id, newStatus) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx !== -1) {
    const task = state.tasks[idx];
    
    if (task.status !== newStatus) {
      task.status = newStatus;
      
      if (newStatus === "completed") {
        task.notified = true;
        task.dueNotified = true;
        showToast("Task Completed", `"${task.title}" is done!`, "success");
      } else {
        showToast("Status Updated", `"${task.title}" is now ${newStatus}.`, "info");
      }
      
      saveTasksToStorage();
      renderAllViews();
    }
  }
}

function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (task && confirm(`Are you sure you want to delete "${task.title}"?`)) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveTasksToStorage();
    renderAllViews();
    showToast("Task Deleted", "Task removed from schedule.", "warning");
  }
}

function editTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  // Populate Modal Form
  document.getElementById("modal-task-title").textContent = "Edit Task";
  document.getElementById("form-task-id").value = task.id;
  document.getElementById("form-task-source").value = task.source;
  document.getElementById("form-task-name").value = task.title;
  document.getElementById("form-task-class").value = task.class;
  document.getElementById("form-task-priority").value = task.priority;
  document.getElementById("form-task-date").value = task.dueDate;
  document.getElementById("form-task-time").value = task.dueTime;
  document.getElementById("form-task-reminder").value = task.reminder;
  document.getElementById("form-task-desc").value = task.description || "";

  document.getElementById("task-modal").style.display = "flex";
}

function handleTaskFormSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById("form-task-id").value;
  const source = document.getElementById("form-task-source").value || "custom";
  const title = document.getElementById("form-task-name").value;
  const className = document.getElementById("form-task-class").value;
  const priority = document.getElementById("form-task-priority").value;
  const dueDate = document.getElementById("form-task-date").value;
  const dueTime = document.getElementById("form-task-time").value;
  const reminder = parseInt(document.getElementById("form-task-reminder").value, 10);
  const description = document.getElementById("form-task-desc").value;

  const now = new Date();
  const formDeadline = new Date(`${dueDate}T${dueTime}`);
  
  if (id) {
    // Edit existing task
    const task = state.tasks.find(t => t.id === id);
    if (task) {
      task.title = title;
      task.class = className;
      task.priority = priority;
      task.dueDate = dueDate;
      task.dueTime = dueTime;
      task.reminder = reminder;
      task.description = description;
      
      // Reset notifications if due date pushed into future
      if (formDeadline.getTime() > now.getTime()) {
        task.notified = false;
        task.dueNotified = false;
      }
      
      showToast("Task Saved", "Changes updated successfully.", "success");
    }
  } else {
    // Create new task
    const newTask = {
      id: `task-${Date.now()}`,
      title,
      class: className,
      priority,
      dueDate,
      dueTime,
      reminder,
      description,
      status: "pending",
      source,
      notified: false,
      dueNotified: false
    };

    state.tasks.push(newTask);
    showToast("Task Created", "New task added to board.", "success");
  }

  // Register class in master catalog if new
  if (className.trim()) {
    state.classes.add(className.trim());
  }

  saveTasksToStorage();
  populateClassFilterDropdown();
  renderAllViews();
  
  // Close Modal
  document.getElementById("task-modal").style.display = "none";
}

// ==========================================================================
// 8. Clock & 1-Second Reminders Loop (Active Alarm Checker)
// ==========================================================================

function startClockAndTimers() {
  const clockEl = document.getElementById("widget-time");
  const dateEl = document.getElementById("widget-date");

  setInterval(() => {
    const now = new Date();
    
    // Update sidebar clock
    clockEl.textContent = now.toLocaleTimeString([], { hour12: true });
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    // Refresh countdowns in list/board and the Next Deadline stat
    if (state.activeView === "list" || state.activeView === "board") {
      updateLiveCountdowns();
    }
    updateDashboardStatistics();
    
    // Check for reminder triggers
    checkFiredDeadlinesAndReminders(now);
  }, 1000);
}

function updateLiveCountdowns() {
  // Finds visible countdown label spans and recalculates them dynamically
  const countdownLabels = document.querySelectorAll(".task-due-countdown, .kanban-card-time span");
  
  countdownLabels.forEach(el => {
    // Traverse parent nodes to find data-id or task identity
    const taskCard = el.closest("[data-id]");
    if (taskCard) {
      const id = taskCard.getAttribute("data-id");
      const task = state.tasks.find(t => t.id === id);
      if (task) {
        const dlStatus = getDeadlineStatus(task.dueDate, task.dueTime, task.status);
        el.textContent = dlStatus.text;
        
        // Dynamic class updating
        el.className = el.classList[0]; // Reset to base class name
        const countdownClass = dlStatus.urgency === "soon" ? "countdown-soon" : 
                                dlStatus.urgency === "approaching" ? "countdown-approaching" : 
                                dlStatus.urgency === "overdue" ? "countdown-overdue" : "countdown-safe";
        el.classList.add(countdownClass);
      }
    }
  });
}

/**
 * Iterates tasks and checks if thresholds or deadlines have crossed.
 */
function checkFiredDeadlinesAndReminders(now) {
  const nowMs = now.getTime();
  
  state.tasks.forEach(task => {
    if (task.status === "completed") return;

    const deadline = new Date(`${task.dueDate}T${task.dueTime}`);
    const deadlineMs = deadline.getTime();
    
    // 1. Actual Deadline Hit Check
    if (nowMs >= deadlineMs && !task.dueNotified) {
      task.dueNotified = true;
      task.notified = true; // Block subsequent early alerts
      saveTasksToStorage();
      triggerActiveAlarmOverlay(task, "is due NOW!");
      return; // Stop checking reminder thresholds since it is fully due
    }
    
    // 2. Early Threshold Check
    if (task.reminder >= 0 && !task.notified) {
      const reminderMs = deadlineMs - (task.reminder * 60 * 1000);
      
      if (nowMs >= reminderMs && nowMs < deadlineMs) {
        task.notified = true;
        saveTasksToStorage();
        triggerActiveAlarmOverlay(task, `is due in ${task.reminder} minutes!`);
      }
    }
  });
}

function triggerActiveAlarmOverlay(task, alertReason) {
  // Update state
  state.activeAlarmTaskId = task.id;
  
  // Set overlay UI text
  const overlay = document.getElementById("alarm-overlay");
  const alarmText = document.getElementById("alarm-text");
  alarmText.innerHTML = `<strong>${escapeHTML(task.title)}</strong> (${escapeHTML(task.class)}) ${alertReason}`;
  
  // Show UI Overlay
  overlay.style.display = "flex";
  
  // Play chime loop
  playAlarmLoop();
  
  // Trigger system pushes
  sendBrowserNotification(`Deadline Warning!`, `"${task.title}" ${alertReason}`);
  showToast("DEADLINE ALERT", `"${task.title}" ${alertReason}`, "error");
}

function snoozeActiveAlarm() {
  stopAlarmLoop();
  document.getElementById("alarm-overlay").style.display = "none";
  
  const id = state.activeAlarmTaskId;
  state.activeAlarmTaskId = null;

  const task = state.tasks.find(t => t.id === id);
  if (task) {
    // If it's the actual due notification, there's no more snooze needed
    // But if it's an early warning, allow notification snooze (e.g. notify again on actual due time)
    if (task.dueNotified) {
      showToast("Alarm Snoozed", `Good luck finishing "${task.title}"!`, "info");
    } else {
      showToast("Alarm Snoozed", `You will be alerted again when the task is due.`, "info");
    }
  }
}

// ==========================================================================
// 9. Event Listeners & Bootstrapping
// ==========================================================================

function handleViewSwitch(viewName) {
  // Navigation active tab updating
  document.querySelectorAll(".nav-item").forEach(btn => {
    if (btn.getAttribute("data-view") === viewName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Toggle active view panel
  document.querySelectorAll(".view-panel").forEach(panel => {
    if (panel.id === `view-${viewName}`) {
      panel.style.display = "block";
      panel.classList.add("active-view");
    } else {
      panel.style.display = "none";
      panel.classList.remove("active-view");
    }
  });

  state.activeView = viewName;
  renderAllViews();
}

function initEventBindings() {
  // View navigations clicks
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const viewName = btn.getAttribute("data-view");
      handleViewSwitch(viewName);
    });
  });

  // Quick settings toggles
  document.getElementById("toggle-audio").addEventListener("change", (e) => {
    state.audioEnabled = e.target.checked;
    localStorage.setItem(STORAGE_KEY_AUDIO, state.audioEnabled ? "true" : "false");
    
    // Play test note to initialize audio permission context
    if (state.audioEnabled) {
      playReminderChime();
      showToast("Sound Active", "Audio alert chimes enabled.", "info");
    }
  });

  document.getElementById("toggle-push-notif").addEventListener("change", (e) => {
    if (e.target.checked) {
      requestPushPermission();
    } else {
      state.pushNotifEnabled = false;
      localStorage.setItem(STORAGE_KEY_PUSH, "false");
      showToast("Notifications Muted", "Desktop notifications disabled.", "info");
    }
  });

  // Task creation modal triggers
  document.getElementById("btn-add-task").addEventListener("click", () => {
    document.getElementById("modal-task-title").textContent = "Add New Task";
    document.getElementById("task-form").reset();
    document.getElementById("form-task-id").value = "";
    document.getElementById("form-task-source").value = "custom";
    
    // Autofill date as today and time as end-of-day
    const todayStr = formatDateString(new Date());
    document.getElementById("form-task-date").value = todayStr;
    document.getElementById("form-task-time").value = "23:59";
    document.getElementById("form-task-reminder").value = "60"; // 1 hour default
    
    document.getElementById("task-modal").style.display = "flex";
  });

  // Modal closers
  document.getElementById("btn-close-task-modal").addEventListener("click", () => {
    document.getElementById("task-modal").style.display = "none";
  });
  
  document.getElementById("btn-cancel-task").addEventListener("click", () => {
    document.getElementById("task-modal").style.display = "none";
  });

  // Submit task
  document.getElementById("task-form").addEventListener("submit", handleTaskFormSubmit);

  // Search & Filter change inputs
  document.getElementById("task-search").addEventListener("input", renderAllViews);
  document.getElementById("filter-class").addEventListener("change", renderAllViews);
  document.getElementById("filter-priority").addEventListener("change", renderAllViews);
  document.getElementById("filter-status").addEventListener("change", renderAllViews);
  document.getElementById("sort-tasks").addEventListener("change", renderAllViews);

  // GCR sync modal buttons
  document.getElementById("btn-sync-gcr").addEventListener("click", handleGcrSyncTrigger);
  
  document.querySelectorAll(".btn-cancel-auth-modal").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("gcr-sync-modal").style.display = "none";
    });
  });
  
  document.getElementById("btn-back-to-auth").addEventListener("click", () => {
    state.gcrConnected = false;
    state.googleAccessToken = "";
    localStorage.setItem(STORAGE_KEY_GCR_STATUS, "false");
    updateGcrStatusUI();
    document.getElementById("sync-stage-select").style.display = "none";
    document.getElementById("sync-stage-auth").style.display = "flex";
  });

  // Tab switching clicks
  document.getElementById("tab-real-flow").addEventListener("click", () => switchSyncFlowTab("real"));
  document.getElementById("tab-mock-flow").addEventListener("click", () => switchSyncFlowTab("mock"));
  
  // Help drawer toggle click
  document.getElementById("btn-toggle-help").addEventListener("click", toggleHelpDrawer);
  
  // Real and Mock Sync button launch triggers
  document.getElementById("btn-gcr-real-auth").addEventListener("click", startGcrRealAuthorization);
  document.getElementById("btn-gcr-mock-auth").addEventListener("click", startGcrMockAuthorization);
  document.getElementById("btn-gcr-confirm-sync").addEventListener("click", executeGcrImport);
  
  // Connected GCR Profile buttons
  const syncGcrConnectedBtn = document.getElementById("btn-sync-gcr-connected");
  if (syncGcrConnectedBtn) {
    syncGcrConnectedBtn.addEventListener("click", handleGcrSyncTrigger);
  }
  
  const disconnectGcrBtn = document.getElementById("btn-disconnect-gcr");
  if (disconnectGcrBtn) {
    disconnectGcrBtn.addEventListener("click", disconnectGcr);
  }

  // Calendar prev/next triggers
  document.getElementById("calendar-prev-month").addEventListener("click", () => {
    const cur = state.calendarCurrentDate;
    state.calendarCurrentDate = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
    renderCalendarView();
  });

  document.getElementById("calendar-next-month").addEventListener("click", () => {
    const cur = state.calendarCurrentDate;
    state.calendarCurrentDate = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    renderCalendarView();
  });

  document.getElementById("calendar-today").addEventListener("click", () => {
    state.calendarCurrentDate = new Date();
    renderCalendarView();
  });

  document.getElementById("btn-close-details").addEventListener("click", () => {
    document.getElementById("calendar-day-details-panel").style.display = "none";
    state.selectedCalendarDay = null;
  });

  // Snooze active alarm button
  document.getElementById("btn-snooze-alarm").addEventListener("click", snoozeActiveAlarm);
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================================================
// 10. Bootstrapping Initialization
// ==========================================================================
window.addEventListener("DOMContentLoaded", () => {
  loadStateFromStorage();
  initEventBindings();
  renderAllViews();
  startClockAndTimers();
  
  // Push check on silent onload
  if (state.pushNotifEnabled) {
    requestPushPermission(true);
  }
});
