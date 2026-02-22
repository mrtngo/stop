const authPanel = document.getElementById("auth-panel");
const gamePanel = document.getElementById("game-panel");

const noticeEl = document.getElementById("notice");
const playerNameInput = document.getElementById("player-name");
const roomCodeInput = document.getElementById("room-code");
const serverUrlInput = document.getElementById("server-url");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const leaveRoomBtn = document.getElementById("leave-room-btn");

const roomCodeDisplay = document.getElementById("room-code-display");
const myNameDisplay = document.getElementById("my-name-display");
const phaseDisplay = document.getElementById("phase-display");
const playersList = document.getElementById("players-list");

const settingsPanel = document.getElementById("settings-panel");
const categoriesInput = document.getElementById("categories-input");
const roundSecondsInput = document.getElementById("round-seconds-input");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const startRoundBtn = document.getElementById("start-round-btn");
const categoriesPreview = document.getElementById("categories-preview");

const roundPanel = document.getElementById("round-panel");
const roundNumberDisplay = document.getElementById("round-number-display");
const roundLetterDisplay = document.getElementById("round-letter-display");
const timerDisplay = document.getElementById("timer-display");
const answersForm = document.getElementById("answers-form");
const submitAnswersBtn = document.getElementById("submit-answers-btn");
const callStopBtn = document.getElementById("call-stop-btn");
const submittedNote = document.getElementById("submitted-note");

const resultsPanel = document.getElementById("results-panel");
const resultsContainer = document.getElementById("results-container");

let roomState = null;
let latestResults = null;
let activeRoundNumber = null;
let timerInterval = null;
let socket = null;
let socketServerUrl = null;

function normalizeServerUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const needsProtocol = !/^https?:\/\//i.test(trimmed);
  const localMatch = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?($|\/)/i.test(trimmed);
  const withProtocol = needsProtocol ? `${localMatch ? "http" : "https"}://${trimmed}` : trimmed;

  try {
    const parsed = new URL(withProtocol);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function getDesiredServerUrl() {
  const raw = serverUrlInput.value.trim();
  if (!raw) {
    localStorage.removeItem("stop_server_url");
    return window.location.origin;
  }

  const normalized = normalizeServerUrl(raw);
  if (!normalized) {
    return "";
  }

  serverUrlInput.value = normalized;
  localStorage.setItem("stop_server_url", normalized);
  return normalized;
}

function showNotice(message, isError = true) {
  if (!message) {
    noticeEl.classList.add("hidden");
    noticeEl.textContent = "";
    return;
  }

  noticeEl.classList.remove("hidden");
  noticeEl.textContent = message;
  noticeEl.style.borderColor = isError ? "rgba(197, 61, 19, 0.25)" : "rgba(15, 118, 110, 0.35)";
  noticeEl.style.background = isError ? "rgba(197, 61, 19, 0.1)" : "rgba(15, 118, 110, 0.12)";
  noticeEl.style.color = isError ? "#8f2d11" : "#0c655f";
}

function clearTimer() {
  if (!timerInterval) {
    return;
  }

  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimer() {
  if (!roomState || roomState.status !== "round" || !roomState.round) {
    timerDisplay.textContent = "-";
    return;
  }

  const remainingMs = Math.max(0, roomState.round.endsAt - Date.now());
  timerDisplay.textContent = `${(remainingMs / 1000).toFixed(1)}s`;
}

function ensureTimerActive() {
  if (timerInterval) {
    return;
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 120);
}

function getRequiredName() {
  const name = playerNameInput.value.trim();
  if (!name) {
    showNotice("Type your player name first.");
    return null;
  }

  localStorage.setItem("stop_name", name);
  return name;
}

function resetLocalRoomState() {
  roomState = null;
  latestResults = null;
  activeRoundNumber = null;
  clearTimer();
}

function bindSocketEvents(nextSocket) {
  nextSocket.on("room_state", (nextState) => {
    roomState = nextState;
    renderGameState();
  });

  nextSocket.on("round_results", (results) => {
    latestResults = results;
    renderResults(results);
  });

  nextSocket.on("connect", () => {
    showNotice("");
  });

  nextSocket.on("connect_error", (error) => {
    const reason = error?.message ? ` (${error.message})` : "";
    showNotice(`Could not connect to realtime server ${socketServerUrl || ""}${reason}`);
  });
}

function getSocket() {
  if (typeof io !== "function") {
    showNotice("Socket.IO client failed to load. Refresh and try again.");
    return null;
  }

  const desiredUrl = getDesiredServerUrl();
  if (!desiredUrl) {
    showNotice("Enter a valid realtime server URL.");
    return null;
  }

  if (socket && socketServerUrl === desiredUrl) {
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  socketServerUrl = desiredUrl;
  socket = io(socketServerUrl, {
    transports: ["websocket", "polling"]
  });
  bindSocketEvents(socket);
  return socket;
}

function buildCategoryPreview(categories) {
  categoriesPreview.innerHTML = "";

  for (const category of categories) {
    const chip = document.createElement("span");
    chip.className = "category-chip";
    chip.textContent = category;
    categoriesPreview.appendChild(chip);
  }
}

function renderPlayers() {
  playersList.innerHTML = "";
  if (!roomState) {
    return;
  }

  const submittedIds = new Set(roomState.round?.submittedPlayerIds || []);

  for (const player of roomState.players) {
    const row = document.createElement("li");
    row.className = "player-row";

    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = player.name;
    left.appendChild(name);

    const tagsWrap = document.createElement("div");
    tagsWrap.className = "player-tags";

    if (player.id === roomState.me) {
      const youTag = document.createElement("span");
      youTag.className = "tag";
      youTag.textContent = "You";
      tagsWrap.appendChild(youTag);
    }

    if (player.isHost) {
      const hostTag = document.createElement("span");
      hostTag.className = "tag host";
      hostTag.textContent = "Host";
      tagsWrap.appendChild(hostTag);
    }

    if (submittedIds.has(player.id)) {
      const submittedTag = document.createElement("span");
      submittedTag.className = "tag";
      submittedTag.textContent = "Submitted";
      tagsWrap.appendChild(submittedTag);
    }

    if (tagsWrap.children.length > 0) {
      left.appendChild(tagsWrap);
    }

    const score = document.createElement("span");
    score.textContent = `${player.score} pts`;
    row.appendChild(left);
    row.appendChild(score);
    playersList.appendChild(row);
  }
}

function buildAnswerFields(categories) {
  answersForm.innerHTML = "";
  categories.forEach((category, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "answer-field";

    const label = document.createElement("label");
    label.textContent = category;
    const inputId = `answer-${index}`;
    label.setAttribute("for", inputId);

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "text";
    input.maxLength = 48;
    input.dataset.category = category;
    input.autocomplete = "off";

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    answersForm.appendChild(wrapper);
  });
}

function renderResults(results) {
  if (!results) {
    resultsPanel.classList.add("hidden");
    resultsContainer.innerHTML = "";
    return;
  }

  const reasonMap = {
    time: "Timer ended",
    stop: "STOP was called",
    all_submitted: "Everyone submitted"
  };

  resultsContainer.innerHTML = "";
  const caption = document.createElement("p");
  caption.className = "results-caption";
  caption.textContent = `Round ${results.roundNumber} • Letter ${results.letter} • ${reasonMap[results.reason] || "Round ended"}`;
  resultsContainer.appendChild(caption);

  const table = document.createElement("table");
  table.className = "results-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  const headCells = ["Player", ...results.categories, "Round", "Total"];
  for (const cellText of headCells) {
    const th = document.createElement("th");
    th.textContent = cellText;
    headRow.appendChild(th);
  }

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const player of results.players) {
    const tr = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = player.name;
    tr.appendChild(nameCell);

    for (const category of results.categories) {
      const cell = document.createElement("td");
      const categoryResult = player.categories[category];
      const answer = categoryResult.answer || "-";
      cell.textContent = `${answer} (${categoryResult.points})`;
      tr.appendChild(cell);
    }

    const roundCell = document.createElement("td");
    roundCell.textContent = String(player.roundPoints);
    tr.appendChild(roundCell);

    const totalCell = document.createElement("td");
    totalCell.textContent = String(player.totalScore);
    tr.appendChild(totalCell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  resultsContainer.appendChild(table);
  resultsPanel.classList.remove("hidden");
}

function renderGameState() {
  if (!roomState) {
    authPanel.classList.remove("hidden");
    gamePanel.classList.add("hidden");
    serverUrlInput.disabled = false;
    return;
  }

  authPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
  serverUrlInput.disabled = true;

  const me = roomState.players.find((player) => player.id === roomState.me);
  const isHost = roomState.hostId === roomState.me;
  const isRoundActive = roomState.status === "round" && !!roomState.round;
  const hasSubmitted = isRoundActive && roomState.round.submittedPlayerIds.includes(roomState.me);

  roomCodeDisplay.textContent = roomState.code;
  myNameDisplay.textContent = me ? me.name : "-";
  phaseDisplay.textContent = roomState.status;

  buildCategoryPreview(roomState.settings.categories);
  renderPlayers();

  settingsPanel.classList.toggle("hidden", !isHost || isRoundActive);
  if (isHost && !isRoundActive) {
    categoriesInput.value = roomState.settings.categories.join(", ");
    roundSecondsInput.value = roomState.settings.roundSeconds;
  }

  roundPanel.classList.toggle("hidden", !isRoundActive);
  if (isRoundActive) {
    if (activeRoundNumber !== roomState.round.number) {
      activeRoundNumber = roomState.round.number;
      buildAnswerFields(roomState.settings.categories);
      latestResults = null;
      resultsPanel.classList.add("hidden");
      resultsContainer.innerHTML = "";
    }

    roundNumberDisplay.textContent = String(roomState.round.number);
    roundLetterDisplay.textContent = roomState.round.letter;
    ensureTimerActive();
    updateTimer();

    const answerInputs = answersForm.querySelectorAll("input[data-category]");
    answerInputs.forEach((input) => {
      input.disabled = hasSubmitted;
    });

    submittedNote.classList.toggle("hidden", !hasSubmitted);
    submitAnswersBtn.disabled = hasSubmitted;
    callStopBtn.disabled = hasSubmitted || !!roomState.round.stopRequestedBy;
    callStopBtn.textContent = roomState.round.stopRequestedBy ? "STOP Called" : "Call STOP";
  } else {
    activeRoundNumber = null;
    clearTimer();
  }

  if (!isRoundActive) {
    renderResults(roomState.lastResults || latestResults);
  }
}

const savedName = localStorage.getItem("stop_name");
if (savedName) {
  playerNameInput.value = savedName;
}

const queryServerUrl = normalizeServerUrl(new URLSearchParams(window.location.search).get("server"));
const savedServerUrl = normalizeServerUrl(localStorage.getItem("stop_server_url"));
serverUrlInput.value = queryServerUrl || savedServerUrl || window.location.origin;

serverUrlInput.addEventListener("change", () => {
  const raw = serverUrlInput.value.trim();
  if (!raw) {
    localStorage.removeItem("stop_server_url");
    serverUrlInput.value = window.location.origin;
  } else {
    const normalized = normalizeServerUrl(raw);
    if (!normalized) {
      showNotice("Enter a valid realtime server URL.");
      return;
    }

    serverUrlInput.value = normalized;
    localStorage.setItem("stop_server_url", normalized);
  }

  if (socket && !roomState) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    socketServerUrl = null;
  }
});

createRoomBtn.addEventListener("click", () => {
  const name = getRequiredName();
  if (!name) {
    return;
  }

  const activeSocket = getSocket();
  if (!activeSocket) {
    return;
  }

  showNotice("");
  activeSocket.emit("create_room", { name }, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "Could not create room.");
    }
  });
});

joinRoomBtn.addEventListener("click", () => {
  const name = getRequiredName();
  if (!name) {
    return;
  }

  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showNotice("Enter the room code.");
    return;
  }

  const activeSocket = getSocket();
  if (!activeSocket) {
    return;
  }

  showNotice("");
  activeSocket.emit("join_room", { name, code }, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "Could not join room.");
    }
  });
});

saveSettingsBtn.addEventListener("click", () => {
  if (!roomState) {
    return;
  }

  const activeSocket = getSocket();
  if (!activeSocket) {
    return;
  }

  const categories = categoriesInput.value
    .split(/[\n,]+/)
    .map((category) => category.trim())
    .filter(Boolean);
  const roundSeconds = Number(roundSecondsInput.value);

  activeSocket.emit("update_settings", { categories, roundSeconds }, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "Could not save settings.");
      return;
    }

    showNotice("Settings updated.", false);
  });
});

startRoundBtn.addEventListener("click", () => {
  const activeSocket = getSocket();
  if (!activeSocket) {
    return;
  }

  activeSocket.emit("start_round", {}, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "Could not start round.");
    } else {
      showNotice("");
    }
  });
});

submitAnswersBtn.addEventListener("click", () => {
  if (!roomState || roomState.status !== "round") {
    return;
  }

  const activeSocket = getSocket();
  if (!activeSocket) {
    return;
  }

  const answers = {};
  const answerInputs = answersForm.querySelectorAll("input[data-category]");
  answerInputs.forEach((input) => {
    answers[input.dataset.category] = input.value;
  });

  activeSocket.emit("submit_answers", { answers }, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "Could not submit answers.");
      return;
    }

    showNotice("Answers submitted.", false);
  });
});

callStopBtn.addEventListener("click", () => {
  const activeSocket = getSocket();
  if (!activeSocket) {
    return;
  }

  activeSocket.emit("call_stop", {}, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "Could not call STOP.");
      return;
    }

    showNotice("STOP called. 5 second countdown started.", false);
  });
});

leaveRoomBtn.addEventListener("click", () => {
  if (!socket) {
    resetLocalRoomState();
    showNotice("");
    renderGameState();
    return;
  }

  socket.emit("leave_room", {}, () => {
    resetLocalRoomState();
    showNotice("");
    renderGameState();
  });
});

renderGameState();
