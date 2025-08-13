// Store for managing unique user IDs
class UserStore {
  constructor() {
    this.users = new Map();
    this.usedIds = new Set();
    this.socketToUserId = new Map(); // Track socket ID to user ID mapping
  }

  // Generate a unique 4-character ID
  generateUniqueId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id;
    
    do {
      id = '';
      for (let i = 0; i < 4; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.usedIds.has(id));
    
    this.usedIds.add(id);
    return id;
  }

  // Add a new user or get existing user ID
  addUser(socketId, existingUserId = null) {
    let userId;
    
    if (existingUserId && this.userExists(existingUserId)) {
      // Reuse existing user ID
      userId = existingUserId;
    } else {
      // Generate new user ID
      userId = this.generateUniqueId();
    }
    
    // If socket already has a user, remove the old mapping first
    if (this.users.has(socketId)) {
      const oldUserId = this.users.get(socketId);
      this.users.delete(socketId);
      this.socketToUserId.delete(socketId);
      // Don't remove from usedIds yet, will be handled by removeUserId if needed
    }
    
    this.users.set(socketId, userId);
    this.socketToUserId.set(socketId, userId);
    return userId;
  }

  // Get user ID by socket ID
  getUserById(socketId) {
    return this.users.get(socketId);
  }

  // Get socket ID by user ID
  getSocketById(userId) {
    for (const [socketId, id] of this.users.entries()) {
      if (id === userId) {
        return socketId;
      }
    }
    return null;
  }

  // Remove user
  removeUser(socketId) {
    const userId = this.users.get(socketId);
    if (userId) {
      // Don't remove userId from usedIds so it can be reused
      // this.usedIds.delete(userId);
      this.users.delete(socketId);
      this.socketToUserId.delete(socketId);
    }
  }

  // Remove specific user ID (for ID regeneration)
  removeUserId(userId) {
    if (this.usedIds.has(userId)) {
      this.usedIds.delete(userId);
      // Remove from users map if it exists
      for (const [socketId, id] of this.users.entries()) {
        if (id === userId) {
          this.users.delete(socketId);
          this.socketToUserId.delete(socketId);
          break;
        }
      }
    }
  }

  // Check if user ID exists
  userExists(userId) {
    return this.usedIds.has(userId);
  }

  // Check if socket ID has a user ID
  hasUser(socketId) {
    return this.users.has(socketId);
  }
}

module.exports = UserStore;
