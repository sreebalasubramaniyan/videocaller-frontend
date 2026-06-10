import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRooms, createRoom, joinRoom, deleteRoom } from '../services/api';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const response = await getRooms();
      setRooms(response.rooms);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    }
    setLoading(false);
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    try {
      const response = await createRoom({ roomName, password: roomPassword });
      setShowCreateModal(false);
      setRoomName('');
      setRoomPassword('');
      navigate(`/room/${response.room.roomId}`, {
        state: { password: roomPassword }
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create room');
    }
  };

  const handleJoinClick = (room) => {
    setSelectedRoom(room);
    setShowJoinModal(true);
    setJoinPassword('');
    setError('');
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    try {
      await joinRoom({ roomId: selectedRoom.roomId, password: joinPassword });
      setShowJoinModal(false);
      setJoinPassword('');
      navigate(`/room/${selectedRoom.roomId}`, {
        state: { password: joinPassword }
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to join room');
    }
  };

  const handleEndRoom = async (e, roomId) => {
    e.stopPropagation();
    try {
      await deleteRoom(roomId);
      // Remove the room from the list
      setRooms(rooms.filter((room) => room.roomId !== roomId));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to end room');
    }
  };

  // Check if current user is the creator
  const isRoomCreator = (createdBy) => {
    return user?.username === createdBy;
  };

  return (
    <div className="dashboard">
      <nav className="navbar">
        <h1>Video Call App</h1>
        <div className="nav-right">
          <span>Welcome, {user?.username}</span>
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </nav>

      <div className="dashboard-content">
        <div className="rooms-header">
          <h2>Available Rooms</h2>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Create Room
          </button>
        </div>

        {loading ? (
          <p>Loading rooms...</p>
        ) : rooms.length === 0 ? (
          <div className="no-rooms">
            <p>No active rooms. Create one to get started!</p>
          </div>
        ) : (
          <div className="rooms-grid">
            {rooms.map((room) => (
              <div key={room.roomId} className="room-card">
                <h3>{room.roomName}</h3>
                <p>Created by: {room.createdBy}</p>
                <p>Participants: {room.participantCount}</p>
                <div className="room-actions">
                  <button onClick={() => handleJoinClick(room)} className="join-btn">
                    Join Room
                  </button>
                  {isRoomCreator(room.createdBy) && (
                    <button
                      onClick={(e) => handleEndRoom(e, room.roomId)}
                      className="end-btn"
                    >
                      End Room
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Create Room</h3>
            {error && <p className="error-message">{error}</p>}
            <form onSubmit={handleCreateRoom}>
              <input
                type="text"
                placeholder="Room Name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Room Password"
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                required
              />
              <div className="modal-buttons">
                <button type="submit">Create</button>
                <button type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Room Modal */}
      {showJoinModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Join {selectedRoom?.roomName}</h3>
            {error && <p className="error-message">{error}</p>}
            <form onSubmit={handleJoinRoom}>
              <input
                type="password"
                placeholder="Enter Room Password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                required
              />
              <div className="modal-buttons">
                <button type="submit">Join</button>
                <button type="button" onClick={() => setShowJoinModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;