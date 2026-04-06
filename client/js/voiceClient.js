/**
 * VoiceClient – manages WebRTC peer connections for Squatch-Bunker
 */
class VoiceClient {
  constructor() {
    /** @type {Map<string, RTCPeerConnection>} */
    this.peers = new Map();
    /** @type {Map<string, HTMLAudioElement>} */
    this.remoteAudios = new Map();
    /** @type {MediaStream|null} */
    this.localStream = null;
    /** @type {string|null} */
    this.currentRoomId = null;
    /** @type {string|null} */
    this.userId = null;
    /** @type {any} socket.io socket */
    this.socket = null;
    /** @type {boolean} */
    this.muted = false;
    /** @type {boolean} */
    this.deafened = false;

    // Voice activity detection
    /** @type {AudioContext|null} */
    this.audioCtx = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {number|null} */
    this.vadIntervalId = null;
    /** @type {boolean} */
    this.currentlySpeaking = false;

    /** Called with (speaking: boolean) when speaking state changes */
    this.onSpeakingChange = null;

    this._iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  /**
   * Join a room: acquire mic, set up VAD, initiate connections to existing peers.
   * @param {string} roomId
   * @param {string} userId
   * @param {any} socket
   * @param {string[]} existingMemberIds - userIds already in the room
   */
  async joinRoom(roomId, userId, socket, existingMemberIds = []) {
    this.currentRoomId = roomId;
    this.userId = userId;
    this.socket = socket;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      console.warn('[VoiceClient] Microphone access denied or unavailable:', err);
      this.localStream = null;
    }

    this._setupVAD();

    // Initiate peer connections to everyone already in the room
    for (const peerId of existingMemberIds) {
      if (peerId !== userId) {
        await this.connectToPeer(peerId);
      }
    }
  }

  /**
   * Leave the current room: close all connections, stop tracks.
   */
  leaveRoom() {
    this._stopVAD();

    for (const [peerId, pc] of this.peers.entries()) {
      pc.close();
      this.peers.delete(peerId);
    }

    for (const [, audioEl] of this.remoteAudios.entries()) {
      audioEl.srcObject = null;
      audioEl.remove();
    }
    this.remoteAudios.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
      this.analyser = null;
    }

    this.currentRoomId = null;
    this.currentlySpeaking = false;
  }

  /**
   * Enable or disable the local audio track.
   * @param {boolean} muted
   */
  setMuted(muted) {
    this.muted = muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => {
        t.enabled = !muted;
      });
    }
  }

  /**
   * Deafen/undeafen all remote audio elements.
   * @param {boolean} deafened
   */
  setDeafened(deafened) {
    this.deafened = deafened;
    for (const audioEl of this.remoteAudios.values()) {
      audioEl.muted = deafened;
    }
  }

  /**
   * Initiate a peer connection to another user (we are the offerer).
   * @param {string} targetUserId
   */
  async connectToPeer(targetUserId) {
    if (this.peers.has(targetUserId)) return;

    const pc = this._createPeerConnection(targetUserId);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('signal:offer', {
        targetUserId,
        sdp: pc.localDescription,
        roomId: this.currentRoomId,
      });
    } catch (err) {
      console.error('[VoiceClient] Error creating offer:', err);
    }
  }

  /**
   * Handle an incoming offer from another peer (we are the answerer).
   * @param {string} fromUserId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleOffer(fromUserId, sdp) {
    let pc = this.peers.get(fromUserId);
    if (!pc) {
      pc = this._createPeerConnection(fromUserId);
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream);
        });
      }
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('signal:answer', {
        targetUserId: fromUserId,
        sdp: pc.localDescription,
        roomId: this.currentRoomId,
      });
    } catch (err) {
      console.error('[VoiceClient] Error handling offer:', err);
    }
  }

  /**
   * Handle an incoming answer from the peer we sent an offer to.
   * @param {string} fromUserId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleAnswer(fromUserId, sdp) {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    } catch (err) {
      console.error('[VoiceClient] Error handling answer:', err);
    }
  }

  /**
   * Handle an ICE candidate from a peer.
   * @param {string} fromUserId
   * @param {RTCIceCandidateInit} candidate
   */
  async handleIceCandidate(fromUserId, candidate) {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // Benign: can happen if peer disconnected
      console.warn('[VoiceClient] ICE candidate error:', err);
    }
  }

  /**
   * Called when a new member joins the room after us — we initiate the connection.
   * @param {string} userId
   */
  async onNewMember(userId) {
    await this.connectToPeer(userId);
  }

  /**
   * Called when a member leaves — clean up their peer connection.
   * @param {string} userId
   */
  onMemberLeft(userId) {
    const pc = this.peers.get(userId);
    if (pc) {
      pc.close();
      this.peers.delete(userId);
    }
    const audioEl = this.remoteAudios.get(userId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.remoteAudios.delete(userId);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Create an RTCPeerConnection for a given peer, wiring up all event handlers.
   * @param {string} peerId
   * @returns {RTCPeerConnection}
   */
  _createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    this.peers.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('signal:ice-candidate', {
          targetUserId: peerId,
          candidate: event.candidate.toJSON(),
          roomId: this.currentRoomId,
        });
      }
    };

    pc.ontrack = (event) => {
      let audioEl = this.remoteAudios.get(peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.style.display = 'none';
        audioEl.dataset.peerId = peerId;
        document.body.appendChild(audioEl);
        this.remoteAudios.set(peerId, audioEl);
      }
      if (event.streams && event.streams[0]) {
        audioEl.srcObject = event.streams[0];
      } else {
        const stream = new MediaStream([event.track]);
        audioEl.srcObject = stream;
      }
      audioEl.muted = this.deafened;
    };

    pc.onconnectionstatechange = () => {
      console.log(`[VoiceClient] Peer ${peerId} state: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.peers.delete(peerId);
      }
    };

    return pc;
  }

  /**
   * Set up Voice Activity Detection using the Web Audio API.
   */
  _setupVAD() {
    if (!this.localStream) return;

    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.4;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      const SPEAKING_THRESHOLD = 20; // 0–255 scale

      this.vadIntervalId = setInterval(() => {
        if (!this.analyser || this.muted) {
          if (this.currentlySpeaking) {
            this.currentlySpeaking = false;
            if (this.onSpeakingChange) this.onSpeakingChange(false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const speaking = avg > SPEAKING_THRESHOLD;

        if (speaking !== this.currentlySpeaking) {
          this.currentlySpeaking = speaking;
          if (this.onSpeakingChange) this.onSpeakingChange(speaking);
        }
      }, 100);
    } catch (err) {
      console.warn('[VoiceClient] VAD setup failed:', err);
    }
  }

  /**
   * Stop the VAD interval.
   */
  _stopVAD() {
    if (this.vadIntervalId !== null) {
      clearInterval(this.vadIntervalId);
      this.vadIntervalId = null;
    }
    this.currentlySpeaking = false;
  }
}

// Expose globally
window.VoiceClient = VoiceClient;
