const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);

// security stuff
app.use(helmet());
app.use(cors());

// setup socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 5e6, // 5mb max
  pingTimeout: 60000,
  pingInterval: 25000
});

// settings
const CONFIG = {
  MAX_CONNECTIONS: 1000,
  RATE_LIMIT_MESSAGES: 15,
  RATE_LIMIT_WINDOW: 10000, // 10 secs
  MAX_MESSAGE_LENGTH: 1000,
  MAX_MEDIA_SIZE: 5 * 1024 * 1024,
  ROOM_CLEANUP_DELAY: 300000, // 5 mins
  MAX_MESSAGES_PER_ROOM: 100
};

// memory storage
const rooms = new Map(); // roomId -> room data
const userRateLimits = new Map(); // userId -> rate limit data
const roomCleanupTimers = new Map();

// make random fun names
function generateUsername() {
  const adjectives = ['Happy', 'Swift', 'Brave', 'Clever', 'Gentle', 'Mighty', 'Noble', 'Quick', 'Wise', 'Cool', 'Chill', 'Epic', 'Funky', 'Groovy', 'Jazzy'];
  const animals = ['Panda', 'Tiger', 'Eagle', 'Dolphin', 'Fox', 'Wolf', 'Bear', 'Hawk', 'Lion', 'Owl', 'Koala', 'Penguin', 'Rabbit', 'Dragon', 'Phoenix'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 999);
  return `${adj}${animal}${num}`;
}

// random avatar colors
function generateAvatarColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// clean url for room id
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase();
  }
}

// check if user is spamming
function checkRateLimit(oderId) {
  const now = Date.now();
  const userLimit = userRateLimits.get(oderId);

  if (!userLimit || now > userLimit.resetTime) {
    userRateLimits.set(oderId, { count: 1, resetTime: now + CONFIG.RATE_LIMIT_WINDOW });
    return true;
  }

  if (userLimit.count >= CONFIG.RATE_LIMIT_MESSAGES) {
    return false;
  }

  userLimit.count++;
  return true;
}

// find or make a room
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      messages: [],
      lastActivity: Date.now()
    });

    // stop cleanup if someone joins
    if (roomCleanupTimers.has(roomId)) {
      clearTimeout(roomCleanupTimers.get(roomId));
      roomCleanupTimers.delete(roomId);
    }
  }
  return rooms.get(roomId);
}

// delete empty rooms after a while
function scheduleRoomCleanup(roomId) {
  if (roomCleanupTimers.has(roomId)) {
    clearTimeout(roomCleanupTimers.get(roomId));
  }

  const timer = setTimeout(() => {
    const room = rooms.get(roomId);
    if (room && room.users.size === 0) {
      rooms.delete(roomId);
      roomCleanupTimers.delete(roomId);
      console.log(`cleaned up: ${roomId}`);
    }
  }, CONFIG.ROOM_CLEANUP_DELAY);

  roomCleanupTimers.set(roomId, timer);
}

// handle socket connections
io.on('connection', (socket) => {
  console.log(`new user connected: ${socket.id}`);

  // check server limit
  if (io.engine.clientsCount > CONFIG.MAX_CONNECTIONS) {
    socket.emit('error', { message: 'server full, try later' });
    socket.disconnect(true);
    return;
  }

  let currentRoom = null;
  let userData = null;

  // user joins a url room
  socket.on('join-room', (data) => {
    try {
      const { url } = data;
      if (!url) {
        socket.emit('error', { message: 'url missing' });
        return;
      }

      const roomId = normalizeUrl(url);
      currentRoom = roomId;

      // setup user profile
      const shortId = Math.random().toString(36).substring(2, 7).toUpperCase();
      userData = {
        oderId: `SHA${shortId}`,
        username: generateUsername(),
        avatarColor: generateAvatarColor(),
        joinedAt: Date.now()
      };

      socket.join(roomId);

      const room = getOrCreateRoom(roomId);
      room.users.set(socket.id, userData);
      room.lastActivity = Date.now();

      // send room history
      socket.emit('room-joined', {
        roomId,
        userData,
        userCount: room.users.size,
        recentMessages: room.messages.slice(-50)
      });

      socket.to(roomId).emit('user-joined', {
        userData,
        userCount: room.users.size
      });

      console.log(`${userData.username} joined: ${roomId}`);

    } catch (error) {
      console.error('join error:', error);
      socket.emit('error', { message: 'failed to join' });
    }
  });

  // handle message send
  socket.on('send-message', (data) => {
    try {
      if (!currentRoom || !userData) {
        socket.emit('error', { message: 'not in a room' });
        return;
      }

      if (!checkRateLimit(socket.id)) {
        socket.emit('rate-limited', { message: 'too fast! wait a bit.' });
        return;
      }

      const { content, type = 'text' } = data;

      if (type === 'text' && (!content || content.length > CONFIG.MAX_MESSAGE_LENGTH)) {
        socket.emit('error', { message: 'bad message' });
        return;
      }

      const message = {
        id: `${Date.now()}-${socket.id}`,
        oderId: userData.oderId,
        username: userData.username,
        avatarColor: userData.avatarColor,
        content: content || '',
        type,
        timestamp: Date.now()
      };

      const room = rooms.get(currentRoom);
      if (room) {
        room.messages.push(message);
        room.lastActivity = Date.now();

        if (room.messages.length > CONFIG.MAX_MESSAGES_PER_ROOM) {
          room.messages = room.messages.slice(-CONFIG.MAX_MESSAGES_PER_ROOM);
        }
      }

      io.to(currentRoom).emit('new-message', message);

    } catch (error) {
      console.error('send error:', error);
      socket.emit('error', { message: 'failed to send' });
    }
  });

  // handle typing
  socket.on('typing', (isTyping) => {
    if (currentRoom && userData) {
      socket.to(currentRoom).emit('user-typing', {
        username: userData.username,
        isTyping
      });
    }
  });

  // user leaves
  socket.on('disconnect', () => {
    console.log(`user disconnected: ${socket.id}`);

    if (currentRoom && userData) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(socket.id);

        socket.to(currentRoom).emit('user-left', {
          username: userData.username,
          userCount: room.users.size
        });

        if (room.users.size === 0) {
          scheduleRoomCleanup(currentRoom);
        }

        console.log(`${userData.username} left: ${currentRoom}`);
      }
    }
    userRateLimits.delete(socket.id);
  });
});

// self-ping to keep render awake (free tier)
const SELF_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}.onrender.com/health`;
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
  setInterval(() => {
    http.get(SELF_URL, (res) => {
      console.log(`keep-alive ping: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('ping error:', err.message);
    });
  }, 600000); // every 10 mins
}

// basic routes
app.get('/', (req, res) => {
  res.json({
    name: 'tik talk server',
    status: 'running'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    users: io.engine.clientsCount,
    rooms: rooms.size
  });
});

// start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`tik talk server live on port ${PORT}`);
});

// shutdown gracefully
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

// check memory usage
setInterval(() => {
  const heapUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  if (heapUsedMB > 400) {
    console.warn(`high memory: ${heapUsedMB}mb`);
  }
}, 60000);
