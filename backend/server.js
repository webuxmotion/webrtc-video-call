const { createServer } = require('http');
const { Server } = require('socket.io');
const next = require('next');
const UserStore = require('./store');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// STUN and TURN servers for better connectivity
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Add TURN servers here if you have them
    // { urls: 'turn:your-turn-server.com:3478', username: 'username', credential: 'password' }
  ]
};

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const userStore = new UserStore();

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Check if user already has an ID in the request
    const existingUserId = socket.handshake.query.userId;
    console.log('Query params:', socket.handshake.query);
    console.log('Existing userId from query:', existingUserId);
    
    let userId;
    
    if (existingUserId && userStore.userExists(existingUserId)) {
      // Reuse existing user ID
      userId = userStore.addUser(socket.id, existingUserId);
      console.log('Reused existing userId:', userId);
    } else {
      // Generate new user ID
      userId = userStore.addUser(socket.id);
      console.log('Generated new userId:', userId);
    }
    
    // Send userId to client
    socket.emit('userId', userId);

    // Debug: Test if events are being received
    socket.on('test', (data) => {
      console.log('🧪 TEST EVENT RECEIVED:', data);
      socket.emit('testResponse', 'Backend received test event!');
    });

    // Handle incoming call
    socket.on('call', (targetUserId) => {
      console.log('Call request from', userId, 'to', targetUserId);
      
      const targetSocketId = userStore.getSocketById(targetUserId);
      if (targetSocketId) {
        socket.to(targetSocketId).emit('incomingCall', userId);
        socket.emit('callStatus', 'calling');
      } else {
        socket.emit('callStatus', 'userNotFound');
      }
    });

    // Handle call answer
    socket.on('answerCall', (callerUserId) => {
      console.log('=== SERVER: answerCall received ===');
      console.log('Answerer socket ID:', socket.id);
      console.log('Answerer user ID:', userId);
      console.log('Caller user ID:', callerUserId);
      
      const callerSocketId = userStore.getSocketById(callerUserId);
      console.log('Caller socket ID found:', callerSocketId);
      
      if (callerSocketId) {
        console.log('Emitting callAnswered to caller...');
        socket.to(callerSocketId).emit('callAnswered', userId);
        console.log('callAnswered event sent successfully');
      } else {
        console.log('Caller not found, cannot send callAnswered');
      }
    });

    // Handle call rejection
    socket.on('rejectCall', (callerUserId) => {
      console.log('Call rejected by', userId, 'for', callerUserId);
      
      const callerSocketId = userStore.getSocketById(callerUserId);
      if (callerSocketId) {
        socket.to(callerSocketId).emit('callRejected', userId);
      }
    });

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
      const targetSocketId = userStore.getSocketById(data.targetUserId);
      if (targetSocketId) {
        socket.to(targetSocketId).emit('offer', {
          offer: data.offer,
          callerUserId: userId
        });
      }
    });

    socket.on('answer', (data) => {
      const targetSocketId = userStore.getSocketById(data.targetUserId);
      if (targetSocketId) {
        socket.to(targetSocketId).emit('answer', {
          answer: data.answer,
          answererUserId: userId
        });
      }
    });

    socket.on('iceCandidate', (data) => {
      const targetSocketId = userStore.getSocketById(data.targetUserId);
      if (targetSocketId) {
        socket.to(targetSocketId).emit('iceCandidate', {
          candidate: data.candidate,
          fromUserId: userId
        });
      }
    });

    // Handle new ID request
    socket.on('requestNewId', () => {
      console.log('🎯 REQUEST NEW ID EVENT RECEIVED!');
      console.log('=== NEW ID REQUEST ===');
      console.log('Socket ID:', socket.id);
      console.log('Current userId:', userId);
      
      // Store the old ID for cleanup
      const oldUserId = userId;
      console.log('Old userId to remove:', oldUserId);
      
      // Remove old ID from userStore
      userStore.removeUserId(oldUserId);
      console.log('Removed old userId from store:', oldUserId);
      
      // Generate new ID and update the mapping
      const newUserId = userStore.addUser(socket.id);
      console.log('Generated new userId:', newUserId);
      
      // Update the local userId variable
      userId = newUserId;
      console.log('Updated local userId variable:', userId);
      
      // Send new ID to client
      console.log('Emitting newUserId event to client with:', newUserId);
      socket.emit('newUserId', newUserId);
      
      console.log('=== END NEW ID REQUEST ===');
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      userStore.removeUser(socket.id);
    });
  });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log('WebSocket server running on port', PORT);
  });
});
