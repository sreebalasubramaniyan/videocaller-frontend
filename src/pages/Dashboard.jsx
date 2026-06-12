import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRooms, createRoom, joinRoom, deleteRoom } from '../services/api';
import { socket } from '../services/socket';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showNewMeetingDropdown, setShowNewMeetingDropdown] = useState(false);
  
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [error, setError] = useState('');
  const [dateTimeStr, setDateTimeStr] = useState('');
  const [carouselIndex, setCarouselIndex] = useState(0);

  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Clock tick
  useEffect(() => {
    const updateDateTime = () => {
      const options = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      };
      const now = new Date();
      setDateTimeStr(now.toLocaleDateString('en-US', options).replace(',', '  • '));
    };

    updateDateTime();
    const interval = setInterval(updateDateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch rooms
  useEffect(() => {
    fetchRooms();
  }, []);

  // Listen for real-time room updates via Socket.io
  useEffect(() => {
    const handleRoomCreated = (newRoom) => {
      setRooms((prev) => {
        if (prev.some((r) => r.roomId === newRoom.roomId)) return prev;
        return [newRoom, ...prev];
      });
    };

    const handleRoomEnded = ({ roomId }) => {
      setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
    };

    const handleRoomUpdated = ({ roomId, participantCount }) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.roomId === roomId ? { ...r, participantCount } : r
        )
      );
    };

    socket.on('room-created', handleRoomCreated);
    socket.on('room-ended', handleRoomEnded);
    socket.on('room-updated', handleRoomUpdated);

    return () => {
      socket.off('room-created', handleRoomCreated);
      socket.off('room-ended', handleRoomEnded);
      socket.off('room-updated', handleRoomUpdated);
    };
  }, []);

  // Click outside dropdown to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNewMeetingDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Carousel auto-slide
  useEffect(() => {
    const slideInterval = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % 3);
    }, 6000);
    return () => clearInterval(slideInterval);
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
    setError('');
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

  const handleStartInstantMeeting = async () => {
    setError('');
    const randomId = Math.random().toString(36).substring(2, 11); // random room code
    const generatedName = `Instant Room ${user.username}`;
    const generatedPassword = '123'; // Simple default password for instant rooms
    
    try {
      const response = await createRoom({ 
        roomName: generatedName, 
        password: generatedPassword,
        roomId: randomId 
      });
      navigate(`/room/${response.room.roomId}`, {
        state: { password: generatedPassword }
      });
    } catch (err) {
      console.error('Failed to create instant meeting:', err);
      // Fallback: try standard random name creation
      try {
        const fallbackResponse = await createRoom({ 
          roomName: `Meeting ${Math.floor(Math.random() * 1000)}`, 
          password: '123' 
        });
        navigate(`/room/${fallbackResponse.room.roomId}`, {
          state: { password: '123' }
        });
      } catch (fallbackErr) {
        alert('Failed to start instant meeting. Please try creating a room manually.');
      }
    }
  };

  const handleJoinClick = (room) => {
    setSelectedRoom(room);
    setShowJoinModal(true);
    setJoinPassword('');
    setError('');
  };

  const handleJoinByCode = () => {
    if (!joinCodeInput.trim()) return;
    
    // Check if code matches an active room ID in the list
    const foundRoom = rooms.find(r => r.roomId === joinCodeInput.trim());
    if (foundRoom) {
      handleJoinClick(foundRoom);
    } else {
      // Direct room join page
      setSelectedRoom({ roomId: joinCodeInput.trim(), roomName: `Room ${joinCodeInput.trim()}` });
      setShowJoinModal(true);
      setJoinPassword('');
      setError('');
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await joinRoom({ roomId: selectedRoom.roomId, password: joinPassword });
      setShowJoinModal(false);
      setJoinPassword('');
      navigate(`/room/${selectedRoom.roomId}`, {
        state: { password: joinPassword }
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to join room. Incorrect password.');
    }
  };

  const handleEndRoom = async (e, roomId) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to end this room?')) {
      try {
        await deleteRoom(roomId);
        setRooms(rooms.filter((room) => room.roomId !== roomId));
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to end room');
      }
    }
  };

  const isRoomCreator = (createdBy) => {
    return user?.username === createdBy;
  };

  // Carousel content data
  const carouselSlides = [
    {
      title: "Get a link you can share",
      desc: "Click New meeting to get a code you can send to people you want to meet with.",
      svg: (
        <svg viewBox="0 0 200 200" width="160" height="160">
          <circle cx="100" cy="100" r="80" fill="#E8F0FE" />
          <path d="M60 110 h80 a10 10 0 0 0 10 -10 v-20 a10 10 0 0 0 -10 -10 h-80 a10 10 0 0 0 -10 10 v 20 a10 10 0 0 0 10 10 z" fill="#1A73E8" opacity="0.8" />
          <line x1="75" y1="90" x2="125" y2="90" stroke="#FFF" strokeWidth="6" strokeLinecap="round" />
          <line x1="75" y1="100" x2="105" y2="100" stroke="#FFF" strokeWidth="6" strokeLinecap="round" />
          <circle cx="145" cy="80" r="25" fill="#34A853" opacity="0.9" />
          <path d="M137 80 l5 5 l10 -10" fill="none" stroke="#FFF" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    },
    {
      title: "Plan ahead",
      desc: "Click Create a room for later to set up passwords and share link details in advance.",
      svg: (
        <svg viewBox="0 0 200 200" width="160" height="160">
          <circle cx="100" cy="100" r="80" fill="#E6F4EA" />
          <rect x="60" y="60" width="80" height="80" rx="10" fill="#137333" opacity="0.8" />
          <rect x="70" y="50" width="15" height="20" rx="4" fill="#34A853" />
          <rect x="115" y="50" width="15" height="20" rx="4" fill="#34A853" />
          <circle cx="100" cy="110" r="20" fill="#FFF" opacity="0.3" />
          <path d="M100 98 v12 h10" fill="none" stroke="#FFF" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    },
    {
      title: "Your meeting is safe",
      desc: "No one can join a meeting unless they have the password or are admitted by the host.",
      svg: (
        <svg viewBox="0 0 200 200" width="160" height="160">
          <circle cx="100" cy="100" r="80" fill="#FEF7E0" />
          <path d="M100 55 l45 20 v40 c0 30 -20 50 -45 60 c-25 -10 -45 -30 -45 -60 v-40 z" fill="#FBBC04" opacity="0.8" />
          <circle cx="100" cy="105" r="14" fill="#FFF" />
          <path d="M100 100 v12" fill="none" stroke="#FBBC04" strokeWidth="4" strokeLinecap="round" />
          <circle cx="100" cy="116" r="2" fill="#FBBC04" />
        </svg>
      )
    }
  ];

  return (
    <div className="dashboard">
      {/* Header */}
      <nav className="navbar">
        <div className="navbar-left">
          <div className="navbar-logo">
            <span className="material-icons-outlined meet-icon-colored">videocam</span>
            <span>Google <span>Meet</span></span>
          </div>
        </div>
        <div className="navbar-right">
          <div className="navbar-time">{dateTimeStr}</div>
          <span className="material-icons-outlined" style={{ cursor: 'pointer' }}>help_outline</span>
          <span className="material-icons-outlined" style={{ cursor: 'pointer' }}>feedback</span>
          <span className="material-icons-outlined" style={{ cursor: 'pointer' }}>settings</span>
          <div className="user-profile">
            <div className="user-avatar" title={user?.username}>
              {user?.username ? user.username[0] : 'U'}
            </div>
            <button onClick={logout} className="logout-icon-btn" title="Logout">
              <span className="material-icons-outlined">logout</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Grid */}
      <div className="dashboard-content">
        {/* Left column */}
        <div className="dashboard-left">
          <div className="hero-text">
            <h1>Premium video meetings.<br />Now free for everyone.</h1>
            <p>We re-engineered the service we built for secure business meetings, Google Meet, to make it free and available on any device.</p>
          </div>

          <div className="meet-actions">
            {/* New Meeting Dropdown */}
            <div className="new-meeting-container" ref={dropdownRef}>
              <button 
                onClick={() => setShowNewMeetingDropdown(!showNewMeetingDropdown)}
                className="btn-new-meeting"
              >
                <span className="material-icons-outlined">video_call</span>
                New meeting
              </button>

              {showNewMeetingDropdown && (
                <div className="dropdown-menu">
                  <button onClick={() => { setShowCreateModal(true); setShowNewMeetingDropdown(false); }} className="dropdown-item">
                    <span className="material-icons-outlined">add_box</span>
                    Create a room for later
                  </button>
                  <button onClick={() => { handleStartInstantMeeting(); setShowNewMeetingDropdown(false); }} className="dropdown-item">
                    <span className="material-icons-outlined">bolt</span>
                    Start an instant meeting
                  </button>
                </div>
              )}
            </div>

            {/* Join meeting code */}
            <div className="join-meeting-input-container">
              <div className="input-code-wrapper">
                <span className="material-icons-outlined">keyboard</span>
                <input 
                  type="text" 
                  placeholder="Enter a room code or ID"
                  className="input-code"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
                />
              </div>
              <button 
                onClick={handleJoinByCode} 
                className="btn-join"
                disabled={!joinCodeInput.trim()}
              >
                Join
              </button>
            </div>
          </div>

          <div className="dashboard-separator"></div>

          <div className="dashboard-info-link">
            <a href="https://support.google.com/meet" target="_blank" rel="noreferrer">Learn more</a> about Google Meet
          </div>
        </div>

        {/* Right column */}
        <div className="dashboard-right">
          <div className="carousel-container">
            <div className="carousel-image-wrapper">
              {carouselSlides[carouselIndex].svg}
            </div>
            <div className="carousel-slide">
              <h3>{carouselSlides[carouselIndex].title}</h3>
              <p>{carouselSlides[carouselIndex].desc}</p>
            </div>
            <div className="carousel-dots">
              {carouselSlides.map((_, index) => (
                <div 
                  key={index} 
                  className={`dot ${index === carouselIndex ? 'active' : ''}`}
                  onClick={() => setCarouselIndex(index)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Rooms Listing Section */}
        <div className="active-rooms-section">
          <h2>Active Video Rooms</h2>
          
          {loading ? (
            <p style={{ color: 'var(--text-secondary)' }}>Loading active meetings...</p>
          ) : rooms.length === 0 ? (
            <div className="no-rooms">
              <span className="material-icons-outlined" style={{ fontSize: '3rem', marginBottom: '10px', display: 'block' }}>groups</span>
              No active meetings right now. Start an instant meeting or create one to invite others!
            </div>
          ) : (
            <div className="rooms-grid">
              {rooms.map((room) => (
                <div key={room.roomId} className="room-card">
                  <div>
                    <h3>{room.roomName}</h3>
                    <div className="room-details">
                      <div className="room-detail-item">
                        <span className="material-icons-outlined">fingerprint</span>
                        Code: <strong>{room.roomId}</strong>
                      </div>
                      <div className="room-detail-item">
                        <span className="material-icons-outlined">person</span>
                        Host: {room.createdBy}
                      </div>
                      <div className="room-detail-item">
                        <span className="material-icons-outlined">people_outline</span>
                        Participants: {room.participantCount}
                      </div>
                    </div>
                  </div>

                  <div className="room-actions">
                    <button onClick={() => handleJoinClick(room)} className="join-btn">
                      Join Room
                    </button>
                    {isRoomCreator(room.createdBy) && (
                      <button
                        onClick={(e) => handleEndRoom(e, room.roomId)}
                        className="end-btn"
                        title="Close Room"
                      >
                        <span className="material-icons-outlined">delete_outline</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Create a Room</h3>
              <button onClick={() => setShowCreateModal(false)} className="modal-close-btn">
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            {error && (
              <div className="error-message" style={{ margin: '12px 24px 0' }}>
                <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>error_outline</span>
                {error}
              </div>
            )}
            <form onSubmit={handleCreateRoom}>
              <div className="input-group">
                <input
                  type="text"
                  placeholder=" "
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  required
                  id="modal-room-name"
                />
                <label htmlFor="modal-room-name">Room Name</label>
              </div>
              <div className="input-group">
                <input
                  type="password"
                  placeholder=" "
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  required
                  id="modal-room-pass"
                />
                <label htmlFor="modal-room-pass">Password</label>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Room Modal */}
      {showJoinModal && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Join {selectedRoom?.roomName}</h3>
              <button onClick={() => setShowJoinModal(false)} className="modal-close-btn">
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            {error && (
              <div className="error-message" style={{ margin: '12px 24px 0' }}>
                <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>error_outline</span>
                {error}
              </div>
            )}
            <form onSubmit={handleJoinRoom}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                This room is password-protected. Enter the meeting password to join.
              </p>
              <div className="input-group">
                <input
                  type="password"
                  placeholder=" "
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  required
                  id="modal-join-pass"
                />
                <label htmlFor="modal-join-pass">Room Password</label>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowJoinModal(false)}>Cancel</button>
                <button type="submit">Join</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;