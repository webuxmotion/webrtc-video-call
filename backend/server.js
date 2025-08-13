const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const UserStore = require('./store');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const userStore = new UserStore();

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist")));

  app.get(/.*?/s, (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"));
  });
}

// STUN servers для WebRTC
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// Socket.IO
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let existingUserId = socket.handshake.query.userId;
  let userId;

  if (existingUserId && userStore.userExists(existingUserId)) {
    userId = userStore.addUser(socket.id, existingUserId);
  } else {
    userId = userStore.addUser(socket.id);
  }

  socket.emit('userId', userId);

  // Тест
  socket.on('test', (data) => {
    console.log('🧪 TEST EVENT RECEIVED:', data);
    socket.emit('testResponse', 'Backend received test event!');
  });

  // Call events
  socket.on('call', (targetUserId) => {
    const targetSocketId = userStore.getSocketById(targetUserId);
    if (targetSocketId) {
      socket.to(targetSocketId).emit('incomingCall', userId);
      socket.emit('callStatus', 'calling');
    } else {
      socket.emit('callStatus', 'userNotFound');
    }
  });

  socket.on('answerCall', (callerUserId) => {
    const callerSocketId = userStore.getSocketById(callerUserId);
    if (callerSocketId) socket.to(callerSocketId).emit('callAnswered', userId);
  });

  socket.on('rejectCall', (callerUserId) => {
    const callerSocketId = userStore.getSocketById(callerUserId);
    if (callerSocketId) socket.to(callerSocketId).emit('callRejected', userId);
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    const targetSocketId = userStore.getSocketById(data.targetUserId);
    if (targetSocketId) socket.to(targetSocketId).emit('offer', { offer: data.offer, callerUserId: userId });
  });

  socket.on('answer', (data) => {
    const targetSocketId = userStore.getSocketById(data.targetUserId);
    if (targetSocketId) socket.to(targetSocketId).emit('answer', { answer: data.answer, answererUserId: userId });
  });

  socket.on('iceCandidate', (data) => {
    const targetSocketId = userStore.getSocketById(data.targetUserId);
    if (targetSocketId) socket.to(targetSocketId).emit('iceCandidate', { candidate: data.candidate, fromUserId: userId });
  });

  // Генерація нового ID
  socket.on('requestNewId', () => {
    userStore.removeUserId(userId);
    const newUserId = userStore.addUser(socket.id);
    userId = newUserId;
    socket.emit('newUserId', newUserId);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    userStore.removeUser(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});