import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { socket, joinRoomSocket, leaveRoomSocket } from '../services/socket';
import { getRoom, leaveRoom as leaveRoomApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

const VideoCall = () => {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [room, setRoom] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [error, setError] = useState('');

  const localVideoRef = useRef(null);
  const peerConnections = useRef({});
  const localStream = useRef(null);
  const remoteVideoRefs = useRef({});

  const password = location.state?.password;

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

    return () => {
      socket.off('user-connected');
      socket.off('user-disconnected');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
    };
  }, []);

  const initializeRoom = async () => {
    try {
      const response = await getRoom(roomId);
      setRoom(response.room);

      await startLocalStream();
      joinRoomSocket(roomId, user.id);
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

  const handleUserConnected = async ({ userId }) => {
    console.log('User connected:', userId);

    if (peerConnections.current[userId]) {
      return; // Already connected
    }

    const peerConnection = createPeerConnection(userId);
    peerConnections.current[userId] = peerConnection;

    // Add local tracks
    const localTracks = localStream.current?.getTracks();
    localTracks?.forEach((track) => {
      peerConnection.addTrack(track, localStream.current);
    });

    // Create and send offer
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

      // Update video element when stream is received
      setTimeout(() => {
        if (remoteVideoRefs.current[peerId]) {
          remoteVideoRefs.current[peerId].srcObject = remoteStream;
        }
      }, 100);
    };

    return pc;
  };

  const handleOffer = async ({ from, offer }) => {
    console.log('Received offer from:', from);

    const peerConnection = createPeerConnection(from);
    peerConnections.current[from] = peerConnection;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Add local tracks
    const localTracks = localStream.current?.getTracks();
    localTracks?.forEach((track) => {
      peerConnection.addTrack(track, localStream.current);
    });

    // Create and send answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer });
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
    localStream.current?.getTracks().forEach((track) => track.stop());
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
  };

  const remoteUserIds = Object.keys(remoteStreams);

  return (
    <div className="video-call">
      <div className="video-header">
        <h2>{room?.roomName}</h2>
        <button onClick={leaveCall} className="leave-btn">Leave Room</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="video-grid">
        <div className="video-container local">
          <video ref={localVideoRef} autoPlay muted playsInline />
          <p className="participant-name">You</p>
        </div>

        {remoteUserIds.map((peerId) => (
          <div key={peerId} className="video-container">
            <video
              ref={(el) => (remoteVideoRefs.current[peerId] = el)}
              autoPlay
              playsInline
            />
            <p className="participant-name">Participant</p>
          </div>
        ))}
      </div>

      <div className="video-controls">
        <button
          onClick={toggleAudio}
          className={`control-btn ${!isAudioEnabled ? 'disabled' : ''}`}
        >
          {isAudioEnabled ? '🎤 Mute' : '🔇 Unmute'}
        </button>
        <button
          onClick={toggleVideo}
          className={`control-btn ${!isVideoEnabled ? 'disabled' : ''}`}
        >
          {isVideoEnabled ? '📹 Stop Video' : '📹 Start Video'}
        </button>
        <button onClick={leaveCall} className="control-btn leave">
          📞 Leave
        </button>
      </div>
    </div>
  );
};

export default VideoCall;