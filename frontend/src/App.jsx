import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

function App() {
  const [socket, setSocket] = useState(null);
  const [userId, setUserId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [isInCall, setIsInCall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const targetUserRef = useRef('');

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  };

  // Initialize local media
  useEffect(() => {
    const getLocalMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.error(err);
        showMessage('Could not access camera/microphone', 'error');
      }
    };
    getLocalMedia();
  }, []);

  // Initialize socket
  useEffect(() => {
    const savedUserId = localStorage.getItem('userId');
    const newSocket = io({
      query: savedUserId ? { userId: savedUserId } : {}
    });

    setSocket(newSocket);

    newSocket.on('userId', id => {
      setUserId(id);
      localStorage.setItem('userId', id);
    });

    newSocket.on('newUserId', id => {
      setUserId(id);
      localStorage.setItem('userId', id);
      showMessage('New ID generated successfully!', 'success');
    });

    newSocket.on('testResponse', () => showMessage('Connection test successful!', 'success'));

    newSocket.on('incomingCall', callerId => setIncomingCall(callerId));

    newSocket.on('callAnswered', async answererId => {
      setIsCalling(false);
      setIsInCall(true);

      if (!localStream) return;

      peerConnectionRef.current = createPeerConnection(newSocket, localStream, answererId);
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);

      newSocket.emit('offer', { offer, targetUserId: answererId });
    });

    newSocket.on('callRejected', () => {
      setIsCalling(false);
      showMessage('Call was rejected', 'error');
    });

    newSocket.on('offer', async data => {
      setTargetUserId(data.callerUserId);
      targetUserRef.current = data.callerUserId;

      if (!localStream) return;

      peerConnectionRef.current = createPeerConnection(newSocket, localStream, data.callerUserId);
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);

      newSocket.emit('answer', { answer, targetUserId: data.callerUserId });
    });

    newSocket.on('answer', async data => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    newSocket.on('iceCandidate', async data => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    });

    return () => newSocket.disconnect();
  }, [localStream]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const createPeerConnection = (socketInstance, localStreamParam, targetId) => {
    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;
    targetUserRef.current = targetId;

    if (localStreamParam) {
      localStreamParam.getTracks().forEach(track => pc.addTrack(track, localStreamParam));
    }

    pc.onicecandidate = event => {
      if (event.candidate && targetUserRef.current) {
        socketInstance.emit('iceCandidate', {
          candidate: event.candidate,
          targetUserId: targetUserRef.current
        });
      }
    };

    pc.ontrack = event => {
      setRemoteStream(event.streams[0]);
    };

    return pc;
  };

  const startCall = async () => {
    if (!targetUserId || targetUserId === userId) {
      showMessage('Please enter a valid user ID', 'error');
      return;
    }
    if (!socket) return showMessage('Not connected to server', 'error');

    targetUserRef.current = targetUserId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: isVideoEnabled, audio: isAudioEnabled });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      socket.emit('call', targetUserId);
      setIsCalling(true);
    } catch (err) {
      console.error(err);
      showMessage('Error starting call: ' + err.message, 'error');
    }
  };

  const answerCall = async () => {
    if (!incomingCall || !socket) return;
    targetUserRef.current = incomingCall;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: isVideoEnabled, audio: isAudioEnabled });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      socket.emit('answerCall', incomingCall);
      setIncomingCall(null);
      setIsInCall(true);
    } catch (err) {
      console.error(err);
      showMessage('Error answering call: ' + err.message, 'error');
    }
  };

  const rejectCall = () => {
    if (!incomingCall || !socket) return;
    socket.emit('rejectCall', incomingCall);
    setIncomingCall(null);
  };

  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }

    setRemoteStream(null);
    setIsInCall(false);
    setIsCalling(false);
    setIncomingCall(null);
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const copyUserId = () => {
    navigator.clipboard.writeText(userId);
    setMessage('User ID copied to clipboard!');
    setMessageType('success');
    setTimeout(() => setMessage(''), 3000);
  };

  const showMessage = (text, type = 'info') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  const generateNewId = () => {
    if (socket) {
      socket.emit('requestNewId');
      showMessage('Requesting new ID...', 'info');
    } else showMessage('Not connected to server', 'error');
  };

  const testConnection = () => {
    if (socket) {
      socket.emit('test', 'Hello from frontend!');
      showMessage('Testing connection...', 'info');
    } else showMessage('Not connected to server', 'error');
  };

  // JSX remains unchanged
  return (
    <div className="App">
      <div className="container">
        <h1>WebRTC Video Call</h1>
        <div className="user-id-section">
          <h3>Your ID: <span className="user-id">{userId}</span></h3>
          <button onClick={copyUserId} className="copy-btn">Copy ID</button>
          <button onClick={generateNewId} className="new-id-btn">Generate New ID</button>
          <button onClick={testConnection} className="test-btn">Test Connection</button>
        </div>
        {!isInCall && !isCalling && !incomingCall && (
          <div className="call-input-section">
            <input
              type="text"
              placeholder="Enter user ID to call"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value.toUpperCase())}
              maxLength={4}
              className="call-input"
            />
            <button onClick={startCall} className="call-btn">Call</button>
          </div>
        )}
        {incomingCall && (
          <div className="incoming-call-section">
            <h3>Incoming call from: {incomingCall}</h3>
            <div className="call-buttons">
              <button onClick={answerCall} className="answer-btn">Answer</button>
              <button onClick={rejectCall} className="reject-btn">Reject</button>
            </div>
          </div>
        )}
        <div className="video-section">
          <div className="main-video-container">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="remote-video"
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <div className="no-remote-video">
                <h3>Waiting for call...</h3>
                <p>Enter a user ID above to start a call</p>
              </div>
            )}
            {remoteStream && <div className="video-label">Remote User</div>}
          </div>
          {localStream && (
            <div className="local-video-preview">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="local-preview-video"
                style={{ width: '100%', height: '100%' }}
              />
              <div className="video-label">You</div>
            </div>
          )}
        </div>
        <div className="control-buttons">
          {isInCall && (
            <>
              <button onClick={toggleVideo} className={`control-btn ${!isVideoEnabled ? 'disabled' : ''}`}>
                {isVideoEnabled ? 'Disable Video' : 'Enable Video'}
              </button>
              <button onClick={toggleAudio} className={`control-btn ${!isAudioEnabled ? 'disabled' : ''}`}>
                {isAudioEnabled ? 'Disable Audio' : 'Enable Audio'}
              </button>
              <button onClick={endCall} className="end-btn">End Call</button>
            </>
          )}
          {isCalling && (
            <button onClick={endCall} className="end-btn">Cancel Call</button>
          )}
        </div>
        <div className="status">
          {isCalling && <p>Calling {targetUserId}...</p>}
          {isInCall && <p>In call with {targetUserId}</p>}
          <p>Debug: localStream: {localStream ? 'Yes' : 'No'}, remoteStream: {remoteStream ? 'Yes' : 'No'}</p>
        </div>
        {message && (
          <div className={`message ${messageType}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;