const http = require("http");
const path = require("path");

const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_CATEGORIES = ["Name", "Country", "Animal", "Food", "Color"];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const roundTimers = new Map();

function sanitizeName(name) {
  if (typeof name !== "string") {
    return "";
  }

  return name.trim().replace(/\s+/g, " ").slice(0, 24);
}

function sanitizeCategories(input) {
  let values = [];

  if (Array.isArray(input)) {
    values = input;
  } else if (typeof input === "string") {
    values = input.split(/[\n,]+/);
  }

  const seen = new Set();
  const categories = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const clean = value.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!clean) {
      continue;
    }

    const key = clean.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    categories.push(clean);

    if (categories.length >= 8) {
      break;
    }
  }

  if (categories.length === 0) {
    return [...DEFAULT_CATEGORIES];
  }

  return categories;
}

function sanitizeRoundSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  const rounded = Math.round(number);
  if (rounded < 20 || rounded > 180) {
    return null;
  }

  return rounded;
}

function normalizeAnswer(answer) {
  return answer.trim().toLowerCase().replace(/\s+/g, " ");
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  while (true) {
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    if (!rooms.has(code)) {
      return code;
    }
  }
}

function allPlayersSubmitted(room) {
  if (room.status !== "round" || !room.round) {
    return false;
  }

  for (const playerId of room.players.keys()) {
    if (!room.round.submissions.has(playerId)) {
      return false;
    }
  }

  return room.players.size > 0;
}

function clearRoundTimer(roomCode) {
  const timer = roundTimers.get(roomCode);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  roundTimers.delete(roomCode);
}

function scheduleRoundEnd(roomCode, ms, reason) {
  clearRoundTimer(roomCode);
  const timer = setTimeout(() => {
    endRound(roomCode, reason);
  }, Math.max(ms, 0));
  roundTimers.set(roomCode, timer);
}

function serializeRoom(room, meId) {
  const players = Array.from(room.players.values())
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      isHost: player.id === room.hostId
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    code: room.code,
    me: meId,
    hostId: room.hostId,
    status: room.status,
    settings: {
      categories: [...room.settings.categories],
      roundSeconds: room.settings.roundSeconds
    },
    players,
    round: room.round
      ? {
          number: room.round.number,
          letter: room.round.letter,
          endsAt: room.round.endsAt,
          stopRequestedBy: room.round.stopRequestedBy,
          submittedPlayerIds: Array.from(room.round.submissions.keys())
        }
      : null,
    lastResults: room.lastResults
  };
}

function emitRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  for (const player of room.players.values()) {
    io.to(player.id).emit("room_state", serializeRoom(room, player.id));
  }
}

function calculateRoundResults(room, reason) {
  const categories = room.settings.categories;
  const round = room.round;
  const answerFrequency = categories.map(() => new Map());
  const preparedAnswers = new Map();

  for (const player of room.players.values()) {
    const submitted = round.submissions.get(player.id) || {};
    const answers = {};

    categories.forEach((category, index) => {
      const raw = typeof submitted[category] === "string" ? submitted[category].trim() : "";
      const normalized = normalizeAnswer(raw);
      const valid = normalized !== "" && normalized.charAt(0).toUpperCase() === round.letter;

      answers[category] = { raw, normalized, valid };

      if (valid) {
        const freq = answerFrequency[index];
        freq.set(normalized, (freq.get(normalized) || 0) + 1);
      }
    });

    preparedAnswers.set(player.id, answers);
  }

  const players = [];

  for (const player of room.players.values()) {
    const answers = preparedAnswers.get(player.id);
    const categoryScores = {};
    let roundPoints = 0;

    categories.forEach((category, index) => {
      const entry = answers[category];
      let points = 0;

      if (entry.valid) {
        const duplicates = answerFrequency[index].get(entry.normalized) || 0;
        points = duplicates === 1 ? 10 : 5;
      }

      roundPoints += points;
      categoryScores[category] = {
        answer: entry.raw,
        points
      };
    });

    player.score += roundPoints;
    players.push({
      id: player.id,
      name: player.name,
      roundPoints,
      totalScore: player.score,
      categories: categoryScores
    });
  }

  players.sort((a, b) => b.totalScore - a.totalScore || b.roundPoints - a.roundPoints || a.name.localeCompare(b.name));

  return {
    roundNumber: round.number,
    letter: round.letter,
    reason,
    categories,
    players,
    generatedAt: Date.now()
  };
}

function endRound(roomCode, reason) {
  const room = rooms.get(roomCode);
  if (!room || room.status !== "round" || !room.round) {
    return;
  }

  clearRoundTimer(roomCode);

  const results = calculateRoundResults(room, reason);
  room.status = "results";
  room.lastResults = results;
  room.round = null;

  for (const player of room.players.values()) {
    io.to(player.id).emit("round_results", results);
  }

  emitRoomState(roomCode);
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) {
      return room;
    }
  }

  return null;
}

function removePlayerFromRoom(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  room.players.delete(socketId);

  if (room.players.size === 0) {
    clearRoundTimer(roomCode);
    rooms.delete(roomCode);
    return;
  }

  if (room.hostId === socketId) {
    room.hostId = room.players.keys().next().value;
  }

  if (room.status === "round" && allPlayersSubmitted(room)) {
    endRound(roomCode, "all_submitted");
    return;
  }

  emitRoomState(roomCode);
}

function joinRoom(socket, roomCode, name) {
  const room = rooms.get(roomCode);
  if (!room) {
    throw new Error("Room not found");
  }

  const safeName = sanitizeName(name);
  if (!safeName) {
    throw new Error("Enter a player name first");
  }

  if (room.status === "round") {
    throw new Error("Round already in progress. Wait for the next round.");
  }

  room.players.set(socket.id, {
    id: socket.id,
    name: safeName,
    score: 0
  });

  socket.data.roomCode = roomCode;
  socket.join(roomCode);
  emitRoomState(roomCode);
}

io.on("connection", (socket) => {
  socket.on("create_room", (payload = {}, ack) => {
    try {
      const existingRoom = socket.data.roomCode;
      if (existingRoom) {
        removePlayerFromRoom(existingRoom, socket.id);
      }

      const safeName = sanitizeName(payload.name);
      if (!safeName) {
        throw new Error("Enter a player name first");
      }

      const roomCode = generateRoomCode();
      rooms.set(roomCode, {
        code: roomCode,
        hostId: socket.id,
        status: "lobby",
        settings: {
          categories: [...DEFAULT_CATEGORIES],
          roundSeconds: 60
        },
        players: new Map([
          [
            socket.id,
            {
              id: socket.id,
              name: safeName,
              score: 0
            }
          ]
        ]),
        roundNumber: 0,
        round: null,
        lastResults: null
      });

      socket.data.roomCode = roomCode;
      socket.join(roomCode);
      emitRoomState(roomCode);

      if (typeof ack === "function") {
        ack({ ok: true, code: roomCode });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, error: error.message });
      }
    }
  });

  socket.on("join_room", (payload = {}, ack) => {
    try {
      const existingRoom = socket.data.roomCode;
      if (existingRoom) {
        removePlayerFromRoom(existingRoom, socket.id);
      }

      const roomCode = String(payload.code || "")
        .toUpperCase()
        .trim();
      if (!roomCode) {
        throw new Error("Enter a room code");
      }

      joinRoom(socket, roomCode, payload.name);

      if (typeof ack === "function") {
        ack({ ok: true, code: roomCode });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, error: error.message });
      }
    }
  });

  socket.on("update_settings", (payload = {}, ack) => {
    try {
      const room = getRoomBySocket(socket.id);
      if (!room) {
        throw new Error("Join a room first");
      }

      if (room.hostId !== socket.id) {
        throw new Error("Only the host can change settings");
      }

      if (room.status === "round") {
        throw new Error("Wait until the round ends");
      }

      const categories = sanitizeCategories(payload.categories);
      const roundSeconds = sanitizeRoundSeconds(payload.roundSeconds);
      if (!roundSeconds) {
        throw new Error("Round time must be between 20 and 180 seconds");
      }

      room.settings.categories = categories;
      room.settings.roundSeconds = roundSeconds;
      emitRoomState(room.code);

      if (typeof ack === "function") {
        ack({ ok: true });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, error: error.message });
      }
    }
  });

  socket.on("start_round", (_payload, ack) => {
    try {
      const room = getRoomBySocket(socket.id);
      if (!room) {
        throw new Error("Join a room first");
      }

      if (room.hostId !== socket.id) {
        throw new Error("Only the host can start rounds");
      }

      if (room.status === "round") {
        throw new Error("Round already running");
      }

      if (room.players.size < 2) {
        throw new Error("At least 2 players are required");
      }

      room.roundNumber += 1;
      room.status = "round";
      room.lastResults = null;

      const letter = ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      const endsAt = Date.now() + room.settings.roundSeconds * 1000;

      room.round = {
        number: room.roundNumber,
        letter,
        endsAt,
        submissions: new Map(),
        stopRequestedBy: null
      };

      scheduleRoundEnd(room.code, room.settings.roundSeconds * 1000, "time");
      emitRoomState(room.code);

      if (typeof ack === "function") {
        ack({ ok: true });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, error: error.message });
      }
    }
  });

  socket.on("submit_answers", (payload = {}, ack) => {
    try {
      const room = getRoomBySocket(socket.id);
      if (!room || room.status !== "round" || !room.round) {
        throw new Error("No active round");
      }

      const cleanAnswers = {};
      for (const category of room.settings.categories) {
        const value = typeof payload.answers?.[category] === "string" ? payload.answers[category].trim() : "";
        cleanAnswers[category] = value.slice(0, 48);
      }

      room.round.submissions.set(socket.id, cleanAnswers);
      emitRoomState(room.code);

      if (allPlayersSubmitted(room)) {
        endRound(room.code, "all_submitted");
      }

      if (typeof ack === "function") {
        ack({ ok: true });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, error: error.message });
      }
    }
  });

  socket.on("call_stop", (_payload, ack) => {
    try {
      const room = getRoomBySocket(socket.id);
      if (!room || room.status !== "round" || !room.round) {
        throw new Error("No active round");
      }

      if (room.round.stopRequestedBy) {
        throw new Error("STOP already called");
      }

      room.round.stopRequestedBy = socket.id;
      room.round.endsAt = Date.now() + 5000;
      scheduleRoundEnd(room.code, 5000, "stop");
      emitRoomState(room.code);

      if (typeof ack === "function") {
        ack({ ok: true });
      }
    } catch (error) {
      if (typeof ack === "function") {
        ack({ ok: false, error: error.message });
      }
    }
  });

  socket.on("leave_room", (_payload, ack) => {
    const roomCode = socket.data.roomCode;
    if (roomCode) {
      removePlayerFromRoom(roomCode, socket.id);
      socket.leave(roomCode);
      socket.data.roomCode = undefined;
    }

    if (typeof ack === "function") {
      ack({ ok: true });
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return;
    }

    removePlayerFromRoom(roomCode, socket.id);
    socket.data.roomCode = undefined;
  });
});

server.listen(PORT, HOST, () => {
  console.log(`STOP multiplayer server running on http://${HOST}:${PORT}`);
});
