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
  const [messageType, setMessageType] = useState(''); // 'success', 'error', 'info'
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);

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

  useEffect(() => {
    // Load userId from localStorage
    const savedUserId = localStorage.getItem('userId');
    if (savedUserId) {
      setUserId(savedUserId);

    } else {

    }

    // Get user media for local preview
    const getLocalMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          console.log('Setting srcObject on local video element (useEffect)');
          localVideoRef.current.srcObject = stream;
          console.log('Local video srcObject set successfully (useEffect)');
        } else {
          console.log('Local video ref is null (useEffect)');
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        showMessage('Could not access camera/microphone', 'error');
      }
    };

    getLocalMedia();

    // Connect to WebSocket server with existing userId if available
    const newSocket = io('http://localhost:3001', {
      query: savedUserId ? { userId: savedUserId } : {}
    });
    setSocket(newSocket);

    // Handle userId from server
    newSocket.on('userId', (serverUserId) => {
      console.log('Received userId from server:', serverUserId);
      setUserId(serverUserId);
      localStorage.setItem('userId', serverUserId);
    });

    // Handle new userId from server
    newSocket.on('newUserId', (newUserId) => {
      console.log('=== FRONTEND: Received newUserId event ===');
      console.log('newUserId data:', newUserId);
      console.log('Current userId state:', userId);
      console.log('Setting new userId to:', newUserId);
      setUserId(newUserId);
      localStorage.setItem('userId', newUserId);
      showMessage('New ID generated successfully!', 'success');
      console.log('=== FRONTEND: newUserId event handled ===');
    });

    // Handle test response from server
    newSocket.on('testResponse', (response) => {
      console.log('🧪 TEST RESPONSE RECEIVED:', response);
      showMessage('Connection test successful!', 'success');
    });

    // Handle incoming calls
    newSocket.on('incomingCall', (callerUserId) => {
      setIncomingCall(callerUserId);
    });

    // Handle call answered
    newSocket.on('callAnswered', async (answererUserId) => {
      console.log('=== CALLER: callAnswered received ===');
      console.log('Answerer user ID:', answererUserId);
      console.log('Current state - isCalling:', isCalling, 'isInCall:', isInCall);
      
      setIsCalling(false);
      setIsInCall(true);
      
      console.log('Creating peer connection...');
      const pc = createPeerConnection(newSocket);
      if (!pc) {
        console.error('Failed to create peer connection');
        return;
      }
      
      console.log('Peer connection created, now sending offer...');
      
      try {
        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        newSocket.emit('offer', {
          offer: offer,
          targetUserId: answererUserId
        });
        
        console.log('Offer sent successfully to answerer');
      } catch (error) {
        console.error('Error creating/sending offer:', error);
        showMessage('Error establishing call connection', 'error');
      }
    });

    // Handle call rejected
    newSocket.on('callRejected', (rejecterUserId) => {
      setIsCalling(false);
      showMessage('Call was rejected', 'error');
    });

    // Handle WebRTC offer
    newSocket.on('offer', async (data) => {
      console.log('Received offer from:', data.callerUserId);
      
      // Store the caller's user ID for ICE candidate exchange
      setTargetUserId(data.callerUserId);
      
      // Create peer connection if it doesn't exist (for incoming calls)
      if (!peerConnectionRef.current) {
        console.log('Creating peer connection for incoming call');
        createPeerConnection(newSocket);
      }
      
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          
          newSocket.emit('answer', {
            answer: answer,
            targetUserId: data.callerUserId
          });
          
          console.log('Sent answer to caller');
        } catch (error) {
          console.error('Error handling offer:', error);
          showMessage('Error establishing call connection', 'error');
        }
      }
    });

    // Handle WebRTC answer
    newSocket.on('answer', async (data) => {
      console.log('=== CALLER: Received answer ===');
      console.log('Answer data:', data);
      console.log('Peer connection exists:', !!peerConnectionRef.current);
      console.log('Peer connection state:', peerConnectionRef.current?.connectionState);
      
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log('Remote description set successfully');
          console.log('Connection state after setting remote description:', peerConnectionRef.current.connectionState);
        } catch (error) {
          console.error('Error setting remote description:', error);
          showMessage('Error establishing call connection', 'error');
        }
      } else {
        console.error('No peer connection available for answer');
      }
    });

    // Handle ICE candidates
    newSocket.on('iceCandidate', async (data) => {
      console.log('=== ICE CANDIDATE RECEIVED ===');
      console.log('ICE data:', data);
      console.log('Peer connection exists:', !!peerConnectionRef.current);
      
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('ICE candidate added successfully');
          console.log('Connection state:', peerConnectionRef.current.connectionState);
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      } else {
        console.error('No peer connection available for ICE candidate');
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (remoteStream) {
      console.log('=== REMOTE STREAM UPDATED ===');
      console.log('Remote stream:', remoteStream);
      console.log('Remote video ref:', remoteVideoRef.current);
      if (remoteVideoRef.current) {
        console.log('Setting srcObject on remote video element');
        remoteVideoRef.current.srcObject = remoteStream;
        console.log('srcObject set successfully');
        
        // Check if the video element has the stream
        setTimeout(() => {
          console.log('Remote video srcObject after setting:', remoteVideoRef.current.srcObject);
          console.log('Remote video readyState:', remoteVideoRef.current.readyState);
          console.log('Remote video videoWidth:', remoteVideoRef.current.videoWidth);
          console.log('Remote video videoHeight:', remoteVideoRef.current.videoHeight);
        }, 100);
      } else {
        console.log('Remote video ref is null');
      }
    }
  }, [remoteStream]);

  const createPeerConnection = (socketInstance) => {
    if (!socketInstance) {
      console.error('Socket not available for peer connection');
      return null;
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;

    // Log connection state changes
    pc.onconnectionstatechange = () => {
      console.log('=== CONNECTION STATE CHANGED ===');
      console.log('New state:', pc.connectionState);
      console.log('Ice connection state:', pc.iceConnectionState);
      console.log('Ice gathering state:', pc.iceGatheringState);
    };

    // Add local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // For incoming calls, we might not have targetUserId yet
        // We'll need to get it from the offer data
        if (targetUserId) {
          socketInstance.emit('iceCandidate', {
            candidate: event.candidate,
            targetUserId: targetUserId
          });
        }
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log('=== ONTRACK EVENT FIRED ===');
      console.log('Event:', event);
      console.log('Streams:', event.streams);
      console.log('Tracks:', event.track);
      console.log('Setting remote stream to:', event.streams[0]);
      setRemoteStream(event.streams[0]);

      console.log(event.streams[0]);
    };

    return pc;
  };

  const startCall = async () => {
    if (!targetUserId || targetUserId === userId) {
      showMessage('Please enter a valid user ID', 'error');
      return;
    }

    if (!socket) {
      showMessage('Not connected to server', 'error');
      return;
    }

    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoEnabled,
        audio: isAudioEnabled
      });
      
      setLocalStream(stream);
      if (localVideoRef.current) {
        console.log('Setting srcObject on local video element (startCall)');
        localVideoRef.current.srcObject = stream;
        console.log('Local video srcObject set successfully (startCall)');
      } else {
        console.log('Local video ref is null (startCall)');
      }

      // Send call request first
      socket.emit('call', targetUserId);
      setIsCalling(true);
      
      console.log('Call request sent, waiting for answer...');
      // Note: Offer will be sent when we receive callAnswered event
    } catch (error) {
      console.error('Error starting call:', error);
      showMessage('Error starting call: ' + error.message, 'error');
    }
  };

  const answerCall = async () => {
    console.log('=== ANSWER CALL CLICKED ===');
    console.log('incomingCall:', incomingCall);
    
    if (!incomingCall) {
      console.log('No incoming call to answer');
      return;
    }

    if (!socket) {
      console.log('Socket not available');
      showMessage('Not connected to server', 'error');
      return;
    }

    console.log('Starting to answer call...');

    try {
      // Get user media
      console.log('Getting user media...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoEnabled,
        audio: isAudioEnabled
      });
      
      console.log('User media obtained:', stream);
      setLocalStream(stream);
      if (localVideoRef.current) {
        console.log('Setting srcObject on local video element (answerCall)');
        localVideoRef.current.srcObject = stream;
        console.log('Local video srcObject set successfully (answerCall)');
      } else {
        console.log('Local video ref is null (answerCall)');
      }

      // Answer the call first (this will trigger the caller to send offer)
      console.log('Emitting answerCall event to server...');
      socket.emit('answerCall', incomingCall);
      setIncomingCall(null);
      setIsInCall(true);
      
      console.log('Call answered successfully, waiting for offer...');
      // Note: Peer connection will be created when we receive the offer
      // Don't create it here - wait for the offer event
    } catch (error) {
      console.error('Error answering call:', error);
      showMessage('Error answering call: ' + error.message, 'error');
    }
  };

  const rejectCall = () => {
    if (!incomingCall) return;
    
    if (!socket) {
      showMessage('Not connected to server', 'error');
      return;
    }
    
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
      console.log('Requesting new ID...');
      socket.emit('requestNewId');
      showMessage('Requesting new ID...', 'info');
    } else {
      console.log('Socket not connected');
      showMessage('Not connected to server', 'error');
    }
  };

  const testConnection = () => {
    if (socket) {
      console.log('Testing connection...');
      socket.emit('test', 'Hello from frontend!');
      showMessage('Testing connection...', 'info');
    } else {
      console.log('Socket not connected');
      showMessage('Not connected to server', 'error');
    }
  };

  return (
    <div className="App">
      <div className="container">
        <h1>WebRTC Video Call</h1>
        
        {/* User ID Section */}
        <div className="user-id-section">
          <h3>Your ID: <span className="user-id">{userId}</span></h3>
          <button onClick={copyUserId} className="copy-btn">Copy ID</button>
          <button onClick={generateNewId} className="new-id-btn">Generate New ID</button>
          <button onClick={testConnection} className="test-btn">Test Connection</button>
        </div>

        {/* Call Input Section */}
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

        {/* Incoming Call Section */}
        {incomingCall && (
          <div className="incoming-call-section">
            <h3>Incoming call from: {incomingCall}</h3>
            <div className="call-buttons">
              <button onClick={answerCall} className="answer-btn">Answer</button>
              <button onClick={rejectCall} className="reject-btn">Reject</button>
            </div>
          </div>
        )}

        {/* Video Section */}
        <div className="video-section">
          {/* Main video area for remote user */}
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
          
          {/* Small local video preview */}
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

        {/* Control Buttons */}
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

        {/* Status */}
        <div className="status">
          {isCalling && <p>Calling {targetUserId}...</p>}
          {isInCall && <p>In call with {targetUserId}</p>}
          <p>Debug: localStream: {localStream ? 'Yes' : 'No'}, remoteStream: {remoteStream ? 'Yes' : 'No'}</p>
        </div>

        {/* Messages */}
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
