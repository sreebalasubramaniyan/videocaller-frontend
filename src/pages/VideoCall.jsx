import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  socket, 
  joinRoomSocket, 
  leaveRoomSocket, 
  kickUserSocket, 
  muteUserSocket, 
  disableVideoSocket,
  sendChatMessageSocket
} from '../services/socket';
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
  
  // Immersive layout state
  const [activePanel, setActivePanel] = useState(''); // 'chat' or 'people' or ''
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  // Speaker indicator states
  const [speakingUsers, setSpeakingUsers] = useState({}); // { [userId]: boolean }
  const audioAnalysers = useRef({}); // { [userId]: AnalyserNode }
  const animationFrameId = useRef(null);

  const localVideoRef = useRef(null);
  const peerConnections = useRef({});
  const localStream = useRef(null);
  const screenStreamRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const chatEndRef = useRef(null);

  const password = location.state?.password;

  // Check if current user is host
  const isHost = room?.createdBy?._id === user?.id || room?.createdBy === user?.id || room?.createdBy === user?.username;

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
    socket.on('participants-list', handleParticipantsList);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('kicked', handleKicked);
    socket.on('remote-mute', handleRemoteMute);
    socket.on('remote-disable-video', handleRemoteDisableVideo);
    socket.on('user-kicked', handleUserKicked);
    
    // New chat socket event
    socket.on('chat-message', handleChatMessage);

    return () => {
      socket.off('user-connected');
      socket.off('user-disconnected');
      socket.off('participants-list');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('kicked');
      socket.off('remote-mute');
      socket.off('remote-disable-video');
      socket.off('user-kicked');
      socket.off('chat-message');
    };
  }, [activePanel]);

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

  // Scroll chat to bottom when message arrives
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activePanel]);

  // Clock tick in controls
  const [currentTimeStr, setCurrentTimeStr] = useState('');
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Set up local speaker check
  useEffect(() => {
    if (localStream.current && isAudioEnabled && !isMutedByHost) {
      setupAudioAnalyser('local', localStream.current);
    } else {
      removeAudioAnalyser('local');
    }
  }, [isAudioEnabled, isMutedByHost, localStream.current]);

  const initializeRoom = async () => {
    try {
      const response = await getRoom(roomId);
      setRoom(response.room);
      setMeetingStartTime(new Date(response.room.meetingStartTime));

      await startLocalStream();
      joinRoomSocket(roomId, user.id, user.username);
      
      // Start audio analysis loop
      startSpeakingDetection();
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

  // Audio Analyser for speaking indicator
  const setupAudioAnalyser = (id, stream) => {
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      audioAnalysers.current[id] = analyser;
    } catch (err) {
      console.error('Failed to setup audio analyser:', err);
    }
  };

  const removeAudioAnalyser = (id) => {
    delete audioAnalysers.current[id];
    setSpeakingUsers(prev => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  const startSpeakingDetection = () => {
    const checkSpeaking = () => {
      const speaking = {};
      Object.keys(audioAnalysers.current).forEach(id => {
        const analyser = audioAnalysers.current[id];
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Compute average volume
        let total = 0;
        for (let i = 0; i < bufferLength; i++) {
          total += dataArray[i];
        }
        const average = total / bufferLength;
        // Threshold: typical vocal activity on byte frequency is above 15-20
        speaking[id] = average > 18;
      });

      setSpeakingUsers(speaking);
      animationFrameId.current = requestAnimationFrame(checkSpeaking);
    };
    animationFrameId.current = requestAnimationFrame(checkSpeaking);
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

    removeAudioAnalyser(userId);
  };

  const handleKicked = ({ roomId, reason }) => {
    cleanup();
    navigate('/dashboard');
    if (reason === 'ended') {
      alert('meeting is ended by the host');
    } else {
      alert('you have been kicked by the host');
    }
  };

  const handleParticipantsList = ({ participants }) => {
    console.log('Received participants list:', participants);
    setRemoteUsers(prev => {
      const updated = { ...prev };
      participants.forEach(p => {
        if (p.socketId !== socket.id) {
          updated[p.socketId] = { username: p.username, _id: p.userId };
        }
      });
      return updated;
    });
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
    removeAudioAnalyser(userId);
  };

  const handleRemoteMute = ({ isMuted }) => {
    setIsMutedByHost(isMuted);
    if (isMuted) {
      setIsAudioEnabled(false);
    } else {
      setIsAudioEnabled(true);
    }
  };

  const handleRemoteDisableVideo = ({ isDisabled }) => {
    setIsVideoDisabledByHost(isDisabled);
    if (isDisabled) {
      setIsVideoEnabled(false);
    } else {
      setIsVideoEnabled(true);
    }
  };

  const handleMuteAll = (isMuted) => {
    muteUserSocket(roomId, 'all', isMuted);
  };

  const handleDisableVideoAll = (isDisabled) => {
    disableVideoSocket(roomId, 'all', isDisabled);
  };

  const handleEndMeeting = async () => {
    if (window.confirm('Are you sure you want to end this meeting for everyone?')) {
      try {
        await deleteRoom(roomId);
        socket.emit('end-meeting', { roomId });
        cleanup();
        navigate('/dashboard');
      } catch (err) {
        console.error('Failed to end meeting:', err);
        alert('Failed to end meeting.');
      }
    }
  };

  const handleChatMessage = (msg) => {
    setChatMessages(prev => [...prev, msg]);
    if (activePanel !== 'chat') {
      setUnreadChatCount(prev => prev + 1);
    }
  };

  const handleSendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    sendChatMessageSocket(roomId, chatInput.trim());
    setChatMessages(prev => [...prev, {
      sender: user.username,
      senderId: 'self',
      message: chatInput.trim(),
      timestamp: new Date()
    }]);
    setChatInput('');
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

      // Bind remote analyzer
      setupAudioAnalyser(peerId, remoteStream);

      setTimeout(() => {
        if (remoteVideoRefs.current[peerId]) {
          remoteVideoRefs.current[peerId].srcObject = remoteStream;
        }
      }, 100);
    };

    return pc;
  };

  const handleOffer = async ({ from, offer, username }) => {
    console.log('Received offer from:', from, username);
    if (username) {
      setRemoteUsers(prev => ({
        ...prev,
        [from]: { ...prev[from], username }
      }));
    }

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

  const handleAnswer = async ({ from, answer, username }) => {
    console.log('Received answer from:', from, username);
    if (username) {
      setRemoteUsers(prev => ({
        ...prev,
        [from]: { ...prev[from], username }
      }));
    }
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
      const nextState = !isAudioEnabled;
      localStream.current.getAudioTracks().forEach((track) => {
        track.enabled = nextState;
      });
      setIsAudioEnabled(nextState);
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      const nextState = !isVideoEnabled;
      localStream.current.getVideoTracks().forEach((track) => {
        track.enabled = nextState;
      });
      setIsVideoEnabled(nextState);
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        const screenTrack = stream.getVideoTracks()[0];
        
        // Show local preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Replace track in peer connections
        Object.values(peerConnections.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });

        screenTrack.onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
      } catch (err) {
        console.error("Failed to share screen:", err);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    
    // Put back local video
    if (localVideoRef.current && localStream.current) {
      localVideoRef.current.srcObject = localStream.current;
    }

    const cameraTrack = localStream.current?.getVideoTracks()[0];
    if (cameraTrack) {
      Object.values(peerConnections.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(cameraTrack);
        }
      });
    }
    setIsScreenSharing(false);
  };

  // Host controls
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
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
  };

  const remoteUserIds = Object.keys(remoteStreams);
  const totalTiles = 1 + remoteUserIds.length;

  // Grid layout helper calculation
  const getGridLayout = (tileCount) => {
    if (tileCount === 1) return { gridTemplateColumns: '1fr', maxWidth: '850px' };
    if (tileCount === 2) return { gridTemplateColumns: '1fr 1fr' };
    if (tileCount <= 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    return { gridTemplateColumns: '1fr 1fr 1fr' };
  };

  // Meeting timer component
  const MeetingTimer = ({ startTime }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
      if (!startTime) return;

      const calculateElapsed = () => {
        const now = new Date();
        const start = new Date(startTime);
        return Math.max(0, Math.floor((now - start) / 1000));
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

    return <span>{formatTime(elapsed)}</span>;
  };

  return (
    <div className="video-call">
      {/* Absolute top left overlay with room details */}
      <div className="video-call-overlay-header">
        <h2>{room?.roomName || 'Video Call'}</h2>
      </div>

      {error && <div className="error-message" style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 100 }}>{error}</div>}

      <div className="video-call-main">
        {/* Immersive Grid */}
        <div className="video-grid-container">
          <div className={`video-grid ${totalTiles > 2 ? 'more-than-two' : ''}`} style={getGridLayout(totalTiles)}>
            
            {/* Local participant card */}
            <div className={`video-container local ${speakingUsers['local'] ? 'active-speaker' : ''}`}>
              <video ref={localVideoRef} autoPlay muted playsInline />
              
              {(!isVideoEnabled || isVideoDisabledByHost) && (
                <div className="video-avatar-view">
                  <div className="big-avatar">{user?.username ? user.username[0] : 'U'}</div>
                </div>
              )}

              <div className="participant-overlay-info">
                <p className="participant-overlay-name">
                  {user?.username} (You) {isHost && <span className="host-tag">Host</span>}
                </p>
                <div className="participant-overlay-status">
                  {(!isAudioEnabled || isMutedByHost) && (
                    <div className="status-badge-circle alert" title="Microphone muted">
                      <span className="material-icons-outlined">mic_off</span>
                    </div>
                  )}
                  {(!isVideoEnabled || isVideoDisabledByHost) && (
                    <div className="status-badge-circle alert" title="Camera off">
                      <span className="material-icons-outlined">videocam_off</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Remote participants cards */}
            {remoteUserIds.map((socketId) => (
              <div 
                key={socketId} 
                className={`video-container ${speakingUsers[socketId] ? 'active-speaker' : ''}`}
              >
                <video
                  ref={(el) => (remoteVideoRefs.current[socketId] = el)}
                  autoPlay
                  playsInline
                />
                
                {/* Visual Avatar fallback when remote video track is off */}
                {(!remoteStreams[socketId] || remoteStreams[socketId].getVideoTracks().length === 0 || !remoteStreams[socketId].getVideoTracks()[0].enabled) && (
                  <div className="video-avatar-view">
                    <div className="big-avatar">
                      {remoteUsers[socketId]?.username ? remoteUsers[socketId].username[0] : 'U'}
                    </div>
                  </div>
                )}

                {/* Host specific quick buttons on hover of tile */}
                {isHost && (
                  <div className="tile-hover-controls">
                    {(() => {
                      const isMuted = !remoteStreams[socketId] || remoteStreams[socketId].getAudioTracks().length === 0 || !remoteStreams[socketId].getAudioTracks()[0].enabled;
                      const isVideoOff = !remoteStreams[socketId] || remoteStreams[socketId].getVideoTracks().length === 0 || !remoteStreams[socketId].getVideoTracks()[0].enabled;
                      
                      return (
                        <>
                          <button
                            onClick={() => handleMuteUser(socketId, !isMuted)}
                            className={`tile-control-btn ${isMuted ? 'off' : ''}`}
                            title={isMuted ? 'Unmute participant' : 'Mute participant'}
                          >
                            <span className="material-icons-outlined">
                              {isMuted ? 'mic_off' : 'mic'}
                            </span>
                          </button>
                          <button
                            onClick={() => handleDisableVideo(socketId, !isVideoOff)}
                            className={`tile-control-btn ${isVideoOff ? 'off' : ''}`}
                            title={isVideoOff ? 'Turn on participant camera' : 'Turn off participant camera'}
                          >
                            <span className="material-icons-outlined">
                              {isVideoOff ? 'videocam_off' : 'videocam'}
                            </span>
                          </button>
                        </>
                      );
                    })()}
                    <button
                      onClick={() => handleKickUser(socketId)}
                      className="tile-control-btn kick"
                      title="Kick user from room"
                    >
                      <span className="material-icons-outlined">person_remove</span>
                    </button>
                  </div>
                )}

                <div className="participant-overlay-info">
                  <p className="participant-overlay-name">
                    {remoteUsers[socketId]?.username || `User ${socketId.slice(0, 5)}`}
                  </p>
                  <div className="participant-overlay-status">
                    {/* Remote audio tracks check */}
                    {(!remoteStreams[socketId] || remoteStreams[socketId].getAudioTracks().length === 0 || !remoteStreams[socketId].getAudioTracks()[0].enabled) && (
                      <div className="status-badge-circle alert" title="Participant muted">
                        <span className="material-icons-outlined">mic_off</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

          </div>
        </div>

        {/* Sliding Sidebar Drawer */}
        {activePanel !== '' && (
          <div className="side-drawer">
            <div className="drawer-header">
              <div className="drawer-tabs">
                <button 
                  onClick={() => setActivePanel('people')}
                  className={`drawer-tab ${activePanel === 'people' ? 'active' : ''}`}
                >
                  People ({totalTiles})
                </button>
                <button 
                  onClick={() => {
                    setActivePanel('chat');
                    setUnreadChatCount(0); // clear count
                  }}
                  className={`drawer-tab ${activePanel === 'chat' ? 'active' : ''}`}
                >
                  In-call messages
                </button>
              </div>
              <button onClick={() => setActivePanel('')} className="modal-close-btn" style={{ color: 'var(--text-dark-secondary)' }}>
                <span className="material-icons-outlined">close</span>
              </button>
            </div>

            {/* People tab panel */}
            {activePanel === 'people' && (
              <div className="drawer-content">
                {isHost && (
                  <div className="host-global-controls">
                    <div className="host-global-group">
                      <button onClick={() => handleMuteAll(true)} className="host-global-btn alert" title="Mute all participants">
                        <span className="material-icons-outlined">mic_off</span> Mute All
                      </button>
                      <button onClick={() => handleMuteAll(false)} className="host-global-btn success" title="Unmute all participants">
                        <span className="material-icons-outlined">mic</span> Unmute All
                      </button>
                    </div>
                    <div className="host-global-group" style={{ marginTop: '8px' }}>
                      <button onClick={() => handleDisableVideoAll(true)} className="host-global-btn alert" title="Turn off all cameras">
                        <span className="material-icons-outlined">videocam_off</span> Disable All Video
                      </button>
                      <button onClick={() => handleDisableVideoAll(false)} className="host-global-btn success" title="Turn on all cameras">
                        <span className="material-icons-outlined">videocam</span> Enable All Video
                      </button>
                    </div>
                  </div>
                )}
                <div className="participant-list">
                  
                  {/* Self list item */}
                  <div className="participant-item">
                    <div className="participant-item-avatar">
                      {user?.username ? user.username[0] : 'U'}
                    </div>
                    <div className="participant-item-info">
                      <span className="participant-item-name">{user?.username} (You)</span>
                      <span className="participant-item-role">{isHost ? 'Meeting Host' : 'Participant'}</span>
                    </div>
                    <div className="participant-item-controls">
                      <span className="material-icons-outlined" style={{ color: isAudioEnabled && !isMutedByHost ? '#8ab4f8' : 'var(--color-google-red)' }}>
                        {isAudioEnabled && !isMutedByHost ? 'mic' : 'mic_off'}
                      </span>
                    </div>
                  </div>

                  {/* Remote attendees items */}
                  {remoteUserIds.map((socketId) => {
                    const isMuted = !remoteStreams[socketId] || remoteStreams[socketId].getAudioTracks().length === 0 || !remoteStreams[socketId].getAudioTracks()[0].enabled;
                    const isVideoOff = !remoteStreams[socketId] || remoteStreams[socketId].getVideoTracks().length === 0 || !remoteStreams[socketId].getVideoTracks()[0].enabled;

                    return (
                      <div key={socketId} className="participant-item">
                        <div className="participant-item-avatar">
                          {remoteUsers[socketId]?.username ? remoteUsers[socketId].username[0] : 'U'}
                        </div>
                        <div className="participant-item-info">
                          <span className="participant-item-name">{remoteUsers[socketId]?.username || `User ${socketId.slice(0, 5)}`}</span>
                          <span className="participant-item-role">Participant</span>
                        </div>
                        <div className="participant-item-controls">
                          
                          {/* Host actions display directly in sidebar */}
                          {isHost ? (
                            <>
                              <button 
                                onClick={() => handleMuteUser(socketId, !isMuted)}
                                className={`drawer-control-btn ${isMuted ? 'off' : ''}`}
                                title={isMuted ? 'Unmute user' : 'Mute user'}
                              >
                                <span className="material-icons-outlined">{isMuted ? 'mic_off' : 'mic'}</span>
                              </button>
                              <button 
                                onClick={() => handleDisableVideo(socketId, !isVideoOff)}
                                className={`drawer-control-btn ${isVideoOff ? 'off' : ''}`}
                                title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
                              >
                                <span className="material-icons-outlined">{isVideoOff ? 'videocam_off' : 'videocam'}</span>
                              </button>
                              <button 
                                onClick={() => handleKickUser(socketId)}
                                className="drawer-control-btn alert"
                                title="Remove user"
                              >
                                <span className="material-icons-outlined">person_remove</span>
                              </button>
                            </>
                          ) : (
                            <span className="material-icons-outlined" style={{ color: isMuted ? 'var(--color-google-red)' : 'var(--text-dark-secondary)' }}>
                              {isMuted ? 'mic_off' : 'mic'}
                            </span>
                          )}

                        </div>
                      </div>
                    );
                  })}

                </div>
              </div>
            )}

            {/* Chat tab panel */}
            {activePanel === 'chat' && (
              <div className="chat-tab-panel">
                <div className="chat-messages-container">
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dark-secondary)', textAlign: 'center', marginBottom: '8px' }}>
                    Messages can only be seen by people in the call and are deleted when the call ends.
                  </div>
                  
                  {chatMessages.map((msg, index) => {
                    const isSelf = msg.senderId === 'self';
                    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    return (
                      <div key={index} className={`chat-bubble ${isSelf ? 'self' : ''}`}>
                        <div className="chat-bubble-header">
                          <span className="chat-sender-name">{msg.sender}</span>
                          <span className="chat-sender-time">{time}</span>
                        </div>
                        <div className="chat-message-text">
                          {msg.message}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                <div className="chat-input-wrapper">
                  <form onSubmit={handleSendChatMessage} className="chat-input-form">
                    <input
                      type="text"
                      placeholder="Send a message to everyone"
                      className="chat-input-field"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                    />
                    <button 
                      type="submit" 
                      className="chat-send-btn"
                      disabled={!chatInput.trim()}
                    >
                      <span className="material-icons-outlined">send</span>
                    </button>
                  </form>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Control Toolbar */}
      <div className="video-control-bar">
        {/* Left: Meeting Name & Time details */}
        <div className="control-bar-left">
          <div className="control-bar-time">{currentTimeStr}</div>
          <div className="control-bar-code">{roomId}</div>
        </div>

        {/* Center: Device and meeting controls */}
        <div className="control-bar-center">
          <button 
            onClick={toggleAudio} 
            className={`circle-media-btn ${(!isAudioEnabled || isMutedByHost) ? 'off' : ''}`}
            disabled={isMutedByHost}
            title={isMutedByHost ? 'Muted by Host' : (isAudioEnabled ? 'Mute Microphone' : 'Unmute Microphone')}
          >
            <span className="material-icons-outlined">
              {(!isAudioEnabled || isMutedByHost) ? 'mic_off' : 'mic'}
            </span>
          </button>

          <button 
            onClick={toggleVideo} 
            className={`circle-media-btn ${(!isVideoEnabled || isVideoDisabledByHost) ? 'off' : ''}`}
            disabled={isVideoDisabledByHost}
            title={isVideoDisabledByHost ? 'Video disabled by Host' : (isVideoEnabled ? 'Turn off camera' : 'Turn on camera')}
          >
            <span className="material-icons-outlined">
              {(!isVideoEnabled || isVideoDisabledByHost) ? 'videocam_off' : 'videocam'}
            </span>
          </button>

          <button
            onClick={toggleScreenShare}
            className={`circle-media-btn ${isScreenSharing ? 'off' : ''}`}
            title={isScreenSharing ? 'Stop presenting' : 'Present now (Share screen)'}
          >
            <span className="material-icons-outlined">
              {isScreenSharing ? 'cancel_presentation' : 'present_to_all'}
            </span>
          </button>

          {isHost ? (
            <button onClick={handleEndMeeting} className="hangup-pill-btn host-end-btn" title="End Meeting for everyone">
              <span className="material-icons-outlined">call_end</span>
              End Meeting
            </button>
          ) : (
            <button onClick={leaveCall} className="hangup-pill-btn" title="Leave call">
              <span className="material-icons-outlined">call_end</span>
              Leave
            </button>
          )}
        </div>

        {/* Right: Drawer toggle actions */}
        <div className="control-bar-right">
          <button 
            onClick={() => setActivePanel(activePanel === 'people' ? '' : 'people')}
            className={`panel-toggle-btn ${activePanel === 'people' ? 'active' : ''}`}
            title="Show participants list"
          >
            <span className="material-icons-outlined">people_outline</span>
            <span className="badge-count" style={{ backgroundColor: 'var(--border-dark-color)', color: '#fff' }}>
              {totalTiles}
            </span>
          </button>

          <button 
            onClick={() => {
              setActivePanel(activePanel === 'chat' ? '' : 'chat');
              setUnreadChatCount(0); // clear count
            }}
            className={`panel-toggle-btn ${activePanel === 'chat' ? 'active' : ''}`}
            title="In-call chat"
          >
            <span className="material-icons-outlined">chat_bubble_outline</span>
            {unreadChatCount > 0 && (
              <span className="badge-count">
                {unreadChatCount}
              </span>
            )}
          </button>

          <div className="control-bar-timer-wrapper" style={{ color: 'var(--text-dark-secondary)', fontSize: '0.85rem', marginLeft: '12px', borderLeft: '1px solid var(--border-dark-color)', paddingLeft: '16px' }}>
            <MeetingTimer startTime={meetingStartTime} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;