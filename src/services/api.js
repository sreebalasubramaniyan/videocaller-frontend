import axios from 'axios';

const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : 'https://videocaller-backend.onrender.com/api';

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth APIs
export const register = async (userData) => {
  const response = await api.post('/auth/register', userData);
  return response.data;
};

export const login = async (userData) => {
  const response = await api.post('/auth/login', userData);
  return response.data;
};

export const getMe = async () => {
  const response = await api.get('/auth/me');
  return response.data;
};

// Room APIs
export const createRoom = async (roomData) => {
  const response = await api.post('/rooms', roomData);
  return response.data;
};

export const getRooms = async () => {
  const response = await api.get('/rooms');
  return response.data;
};

export const joinRoom = async (roomData) => {
  const response = await api.post('/rooms/join', roomData);
  return response.data;
};

export const getRoom = async (roomId) => {
  const response = await api.get(`/rooms/${roomId}`);
  return response.data;
};

export const leaveRoom = async (roomId) => {
  const response = await api.post(`/rooms/leave/${roomId}`);
  return response.data;
};

export const deleteRoom = async (roomId) => {
  const response = await api.delete(`/rooms/${roomId}`);
  return response.data;
};

export const kickUser = async (roomId, userId) => {
  const response = await api.post(`/rooms/kick/${roomId}`, { userId });
  return response.data;
};

export default api;