import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { socket, joinRoomSocket, leaveRoomSocket, kickUserSocket, muteUserSocket, disableVideoSocket } from '../services/socket';
import { getRoom, leaveRoom as leaveRoomApi, kickUser } from '../services/api';
import { useAuth } from '../context/AuthContext';

const VideoCall = () => {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [room, setRoom] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [remoteUsers, setRemoteUsers] = useState({});
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isMutedByHost, setIsMutedByHost] = useState(false);
  const [isVideoDisabledByHost, setIsVideoDisabledByHost] = useState(false);
  const [meetingStartTime, setMeetingStartTime] = useState(null);
  const [error, setError] = useState('');

  const localVideoRef = useRef(null);
  const peerConnections = useRef({});
  const localStream = useRef(null);
  const remoteVideoRefs = useRef({});

  const password = location.state?.password;

  // Check if current user is host
  const isHost = room?.createdBy?._id === user?.id || room?.createdBy === user?.id;

  useEffect(() => {
    if (!password) {
      navigate('/dashboard');
      return;
    }

    initializeRoom();

    return () => {
      cleanup();
    };
  }, [roomId]);

  useEffect(() => {
    socket.on('user-connected', handleUserConnected);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('kicked', handleKicked);
    socket.on('remote-mute', handleRemoteMute);
    socket.on('remote-disable-video', handleRemoteDisableVideo);
    socket.on('user-kicked', handleUserKicked);

    return () => {
      socket.off('user-connected');
      socket.off('user-disconnected');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('kicked');
      socket.off('remote-mute');
      socket.off('remote-disable-video');
      socket.off('user-kicked');
    };
  }, []);

  // Apply host mute/video controls
  useEffect(() => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled && !isMutedByHost;
      });
      localStream.current.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled && !isVideoDisabledByHost;
      });
    }
  }, [isMutedByHost, isVideoDisabledByHost, isAudioEnabled, isVideoEnabled]);

  const initializeRoom = async () => {
    try {
      const response = await getRoom(roomId);
      setRoom(response.room);
      setMeetingStartTime(new Date(response.room.meetingStartTime));

      await startLocalStream();
      joinRoomSocket(roomId, user.id, user.username);
    } catch (err) {
      setError('Failed to join room. Wrong password or room not found.');
      setTimeout(() => navigate('/dashboard'), 2000);
    }
  };

  const startLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStream.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setError('Could not access camera/microphone');
    }
  };

  const handleUserConnected = async ({ userId, username }) => {
    console.log('User connected:', userId, username);

    // Store username
    setRemoteUsers(prev => ({
      ...prev,
      [userId]: { username }
    }));

    if (peerConnections.current[userId]) {
      return;
    }

    const peerConnection = createPeerConnection(userId);
    peerConnections.current[userId] = peerConnection;

    const localTracks = localStream.current?.getTracks();
    localTracks?.forEach((track) => {
      peerConnection.addTrack(track, localStream.current);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { to: userId, offer });
  };

  const handleUserDisconnected = ({ userId }) => {
    console.log('User disconnected:', userId);

    if (peerConnections.current[userId]) {
      peerConnections.current[userId].close();
      delete peerConnections.current[userId];
    }

    setRemoteStreams((prev) => {
      const newStreams = { ...prev };
      delete newStreams[userId];
      return newStreams;
    });

    setRemoteUsers(prev => {
      const newUsers = { ...prev };
      delete newUsers[userId];
      return newUsers;
    });
  };

  const handleKicked = ({ roomId }) => {
    cleanup();
    navigate('/dashboard');
    alert('You have been removed from the room');
  };

  const handleUserKicked = ({ userId }) => {
    setRemoteStreams((prev) => {
      const newStreams = { ...prev };
      delete newStreams[userId];
      return newStreams;
    });
    setRemoteUsers(prev => {
      const newUsers = { ...prev };
      delete newUsers[userId];
      return newUsers;
    });
  };

  const handleRemoteMute = ({ isMuted }) => {
    setIsMutedByHost(isMuted);
  };

  const handleRemoteDisableVideo = ({ isDisabled }) => {
    setIsVideoDisabledByHost(isDisabled);
  };

  const createPeerConnection = (peerId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track from:', peerId);
      const remoteStream = event.streams[0];

      setRemoteStreams((prev) => ({
        ...prev,
        [peerId]: remoteStream,
      }));

      setTimeout(() => {
        if (remoteVideoRefs.current[peerId]) {
          remoteVideoRefs.current[peerId].srcObject = remoteStream;
        }
      }, 100);
    };

    return pc;
  };

  const handleOffer = async ({ from, offer, username }) => {
    console.log('Received offer from:', from);

    const peerConnection = createPeerConnection(from);
    peerConnections.current[from] = peerConnection;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const localTracks = localStream.current?.getTracks();
    localTracks?.forEach((track) => {
      peerConnection.addTrack(track, localStream.current);
    });

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer, username: user.username });
  };

  const handleAnswer = async ({ from, answer }) => {
    console.log('Received answer from:', from);
    const pc = peerConnections.current[from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleIceCandidate = async ({ from, candidate }) => {
    const pc = peerConnections.current[from];
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  const toggleAudio = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  // Host functions
  const handleKickUser = async (socketId) => {
    try {
      const userId = remoteUsers[socketId]?._id;
      if (userId) {
        await kickUser(roomId, userId);
      }
      kickUserSocket(roomId, socketId);
    } catch (err) {
      console.error('Failed to kick user:', err);
    }
  };

  const handleMuteUser = (socketId, isMuted) => {
    muteUserSocket(roomId, socketId, isMuted);
  };

  const handleDisableVideo = (socketId, isDisabled) => {
    disableVideoSocket(roomId, socketId, isDisabled);
  };

  const leaveCall = async () => {
    try {
      await leaveRoomApi(roomId);
    } catch (err) {
      console.error('Error leaving room:', err);
    }
    cleanup();
    navigate('/dashboard');
  };

  const cleanup = () => {
    leaveRoomSocket(roomId);
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
    }
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
  };

  const remoteUserIds = Object.keys(remoteStreams);

  // Meeting timer component
  const MeetingTimer = ({ startTime }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
      if (!startTime) return;

      const calculateElapsed = () => {
        const now = new Date();
        const start = new Date(startTime);
        return Math.floor((now - start) / 1000);
      };

      setElapsed(calculateElapsed());
      const interval = setInterval(() => {
        setElapsed(calculateElapsed());
      }, 1000);

      return () => clearInterval(interval);
    }, [startTime]);

    const formatTime = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return <span className="timer-display">{formatTime(elapsed)}</span>;
  };

  return (
    <div className="video-call">
      <div className="video-header">
        <h2>{room?.roomName}</h2>
        <div className="meeting-timer">
          <span className="timer-label">Meeting Time: </span>
          <MeetingTimer startTime={meetingStartTime} />
        </div>
        <button onClick={leaveCall} className="leave-btn">Leave Room</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="video-grid">
        <div className="video-container local">
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="participant-info">
            <p className="participant-name">
              {user?.username} {isHost && <span className="host-badge">Host</span>}
            </p>
            <div className="status-badges">
              {isMutedByHost && <span className="muted-badge">🔇 Muted</span>}
              {isVideoDisabledByHost && <span className="video-badge">📹 Off</span>}
              {!isAudioEnabled && !isMutedByHost && <span className="self-muted-badge">🔇</span>}
              {!isVideoEnabled && !isVideoDisabledByHost && <span className="self-video-badge">📹</span>}
            </div>
          </div>
        </div>

        {remoteUserIds.map((socketId) => (
          <div key={socketId} className="video-container">
            <video
              ref={(el) => (remoteVideoRefs.current[socketId] = el)}
              autoPlay
              playsInline
            />
            <div className="participant-info">
              <p className="participant-name">
                {remoteUsers[socketId]?.username || `User ${socketId.slice(0, 6)}`}
              </p>
              {isHost && (
                <div className="host-controls">
                  <button
                    onClick={() => handleKickUser(socketId)}
                    className="kick-btn"
                    title="Kick user"
                  >
                    🚫
                  </button>
                  <button
                    onClick={() => handleMuteUser(socketId, true)}
                    className="mute-btn"
                    title="Mute user"
                  >
                    🔇
                  </button>
                  <button
                    onClick={() => handleDisableVideo(socketId, true)}
                    className="video-off-btn"
                    title="Turn off camera"
                  >
                    📹
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="video-controls">
        <button
          onClick={toggleAudio}
          className={`control-btn toggle-btn ${isAudioEnabled && !isMutedByHost ? 'active' : 'inactive'}`}
          disabled={isMutedByHost}
        >
          <span className="toggle-icon">{isAudioEnabled && !isMutedByHost ? '🎤' : '🔇'}</span>
          <span className="toggle-label">{isAudioEnabled && !isMutedByHost ? 'Mic On' : 'Mic Off'}</span>
        </button>
        <button
          onClick={toggleVideo}
          className={`control-btn toggle-btn ${isVideoEnabled && !isVideoDisabledByHost ? 'active' : 'inactive'}`}
          disabled={isVideoDisabledByHost}
        >
          <span className="toggle-icon">{isVideoEnabled && !isVideoDisabledByHost ? '📹' : '📷'}</span>
          <span className="toggle-label">{isVideoEnabled && !isVideoDisabledByHost ? 'Video On' : 'Video Off'}</span>
        </button>
        <button onClick={leaveCall} className="control-btn leave">
          📞 Leave
        </button>
      </div>
    </div>
  );
};

export default VideoCall;