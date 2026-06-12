import { io } from 'socket.io-client';

const SOCKET_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : 'https://videocaller-backend.onrender.com';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

export const connectSocket = (userId) => {
  socket.auth = { userId };
  socket.connect();

  return new Promise((resolve) => {
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      resolve(socket.id);
    });
  });
};

export const disconnectSocket = () => {
  socket.disconnect();
};

// Socket events
export const joinRoomSocket = (roomId, userId, username) => {
  if (socket.connected) {
    socket.emit('join-room', { roomId, userId, username });
    console.log('Emitted join-room:', roomId, userId, username);
  } else {
    console.log('Socket not connected, waiting...');
    socket.once('connect', () => {
      socket.emit('join-room', { roomId, userId, username });
    });
  }
};

export const leaveRoomSocket = (roomId) => {
  if (socket.connected) {
    socket.emit('leave-room', { roomId });
  }
};

// Host controls
export const kickUserSocket = (roomId, userId) => {
  if (socket.connected) {
    socket.emit('kick-user', { roomId, userId });
  }
};

export const muteUserSocket = (roomId, userId, isMuted) => {
  if (socket.connected) {
    socket.emit('mute-user', { roomId, userId, isMuted });
  }
};

export const disableVideoSocket = (roomId, userId, isDisabled) => {
  if (socket.connected) {
    socket.emit('disable-video', { roomId, userId, isDisabled });
  }
};

export const sendChatMessageSocket = (roomId, message) => {
  if (socket.connected) {
    socket.emit('send-message', { roomId, message });
  }
};

export default socket;