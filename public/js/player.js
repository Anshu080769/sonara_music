// Dual-engine streaming player: HTML5 Audio (+ Web Audio FFT) and YouTube IFrame Player API

export class MusicPlayer {
  constructor({ onTrackChange, onStateChange, onNeedSimilar, onError }) {
    this.audio = new Audio();
    this.audio.preload = 'metadata';

    this.onTrackChange = onTrackChange;
    this.onStateChange = onStateChange;
    this.onNeedSimilar = onNeedSimilar;
    this.onError = onError;

    this.mode = 'audio'; // 'audio' | 'youtube'
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.history = [];

    this.isPlaying = false;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.autoplaySimilar = true;
    this.volume = 0.82;
    this.muted = false;
    this.audio.volume = this.volume;

    this.audioCtx = null;
    this.analyser = null;
    this.freqData = null;
    this.sourceConnected = false;
    this.vizFrame = null;
    this.extraCanvas = null;

    // YouTube IFrame Player state
    this.ytPlayer = null;
    this.ytReadyPromise = null;
    this.ytTimer = null;
    this.ytDuration = 0;
    this.ytCurrentTime = 0;

    this.bindAudioEvents();
  }

  bindAudioEvents() {
    this.audio.addEventListener('play', () => {
      if (this.mode !== 'audio') return;
      this.isPlaying = true;
      this.startVisualizer();
      this.onStateChange?.();
    });

    this.audio.addEventListener('pause', () => {
      if (this.mode !== 'audio') return;
      this.isPlaying = false;
      this.onStateChange?.();
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this.mode !== 'audio') return;
      this.onStateChange?.('time');
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.mode !== 'audio') return;
      this.onStateChange?.('meta');
    });

    this.audio.addEventListener('ended', async () => {
      if (this.mode !== 'audio') return;
      await this.handleTrackEnded();
    });

    this.audio.addEventListener('error', () => {
      if (this.mode !== 'audio') return;
      this.isPlaying = false;
      this.onStateChange?.('error');
    });
  }

  async handleTrackEnded() {
    if (this.repeat === 'one') {
      if (this.mode === 'youtube' && this.ytPlayer) {
        this.ytPlayer.seekTo(0, true);
        this.ytPlayer.playVideo();
      } else {
        this.audio.currentTime = 0;
        this.audio.play().catch(() => {});
      }
      return;
    }
    await this.next(true);
  }

  ensureYouTubeApi() {
    if (this.ytReadyPromise) return this.ytReadyPromise;

    this.ytReadyPromise = new Promise((resolve, reject) => {
      const mountPlayer = () => {
        if (this.ytPlayer) return resolve(this.ytPlayer);
        try {
          this.ytPlayer = new window.YT.Player('ytPlayerMount', {
            height: '100%',
            width: '100%',
            playerVars: {
              autoplay: 1,
              controls: 1,
              modestbranding: 1,
              rel: 0,
              playsinline: 1
            },
            events: {
              onReady: () => {
                this.syncYouTubeVolume();
                resolve(this.ytPlayer);
              },
              onStateChange: (ev) => {
                if (this.mode !== 'youtube') return;
                const YTS = window.YT.PlayerState;
                if (ev.data === YTS.PLAYING) {
                  this.isPlaying = true;
                  this.ytDuration = this.ytPlayer.getDuration() || this.currentTrack?.duration || 0;
                  this.startYouTubeTimer();
                  this.startVisualizer();
                  this.onStateChange?.();
                } else if (ev.data === YTS.PAUSED) {
                  this.isPlaying = false;
                  this.stopYouTubeTimer();
                  this.onStateChange?.();
                } else if (ev.data === YTS.ENDED) {
                  this.isPlaying = false;
                  this.stopYouTubeTimer();
                  this.handleTrackEnded();
                }
              },
              onError: (ev) => {
                if (this.mode !== 'youtube') return;
                this.isPlaying = false;
                this.stopYouTubeTimer();
                const msg =
                  ev.data === 101 || ev.data === 150
                    ? 'Video owner disabled embedded playback on this track.'
                    : 'YouTube video unavailable or could not be played.';
                this.onError?.(msg);
                this.onStateChange?.('error');
              }
            }
          });
        } catch (err) {
          this.ytReadyPromise = null;
          reject(err);
        }
      };

      if (window.YT && window.YT.Player) {
        mountPlayer();
        return;
      }

      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevReady?.();
        mountPlayer();
      };

      if (!document.querySelector('script[data-yt-iframe-api]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.dataset.ytIframeApi = '1';
        script.onerror = () => {
          this.ytReadyPromise = null;
          reject(new Error('Failed to load YouTube IFrame Player API (offline or blocked).'));
        };
        document.head.appendChild(script);
      }

      setTimeout(() => {
        if (!this.ytPlayer) {
          this.ytReadyPromise = null;
          reject(new Error('Timed out loading YouTube IFrame Player API.'));
        }
      }, 10000);
    });

    return this.ytReadyPromise;
  }

  startYouTubeTimer() {
    this.stopYouTubeTimer();
    this.ytTimer = setInterval(() => {
      if (this.mode === 'youtube' && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
        this.ytCurrentTime = this.ytPlayer.getCurrentTime() || 0;
        const d = this.ytPlayer.getDuration?.();
        if (d > 0) this.ytDuration = d;
        this.onStateChange?.('time');
      }
    }, 250);
  }

  stopYouTubeTimer() {
    if (this.ytTimer) {
      clearInterval(this.ytTimer);
      this.ytTimer = null;
    }
  }

  syncYouTubeVolume() {
    if (!this.ytPlayer || typeof this.ytPlayer.setVolume !== 'function') return;
    if (this.muted) {
      this.ytPlayer.mute();
    } else {
      this.ytPlayer.unMute();
      this.ytPlayer.setVolume(Math.round(this.volume * 100));
    }
  }

  setYouTubeDockVisible(visible) {
    const dock = document.getElementById('ytPlayerDock');
    if (dock) dock.classList.toggle('hidden', !visible);
  }

  ensureAudioGraph() {
    if (this.sourceConnected) {
      if (this.audioCtx?.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.78;
      const source = this.audioCtx.createMediaElementSource(this.audio);
      source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.sourceConnected = true;
    } catch {
      // Fallback: visualizer renders procedural bars
    }
  }

  setExtraCanvas(canvas) {
    this.extraCanvas = canvas;
  }

  startVisualizer() {
    if (this.vizFrame) return;
    const render = () => {
      this.drawCanvas(document.getElementById('miniVisualizer'), 20);
      if (this.extraCanvas) {
        this.drawCanvas(this.extraCanvas, 44);
      }
      if (this.isPlaying) {
        this.vizFrame = requestAnimationFrame(render);
      } else {
        this.vizFrame = null;
      }
    };
    this.vizFrame = requestAnimationFrame(render);
  }

  drawCanvas(canvas, barCount) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this.mode === 'audio' && this.analyser && this.freqData && this.isPlaying) {
      this.analyser.getByteFrequencyData(this.freqData);
    }

    const gap = 2;
    const barW = Math.max(2, (w - gap * (barCount - 1)) / barCount);
    const now = performance.now() * 0.004;

    for (let i = 0; i < barCount; i++) {
      let norm = 0.08;
      if (this.isPlaying) {
        if (this.mode === 'audio' && this.freqData && this.freqData.length) {
          const bin = Math.min(this.freqData.length - 1, Math.floor((i / barCount) * (this.freqData.length * 0.85)));
          norm = Math.max(0.08, this.freqData[bin] / 255);
        } else {
          norm = 0.25 + 0.55 * Math.abs(Math.sin(now + i * 0.45) * Math.cos(now * 0.6 + i * 0.2));
        }
      }
      const barH = Math.max(3, norm * (h - 2));
      const x = i * (barW + gap);
      const y = h - barH;
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      if (this.mode === 'youtube') {
        grad.addColorStop(0, '#ff4444');
        grad.addColorStop(0.55, '#ff3d8b');
        grad.addColorStop(1, '#f59e0b');
      } else {
        grad.addColorStop(0, '#7c5cff');
        grad.addColorStop(0.55, '#ff3d8b');
        grad.addColorStop(1, '#22d3ee');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    }
  }

  async playTrack(track, queueList = null) {
    if (!track) return;

    if (Array.isArray(queueList) && queueList.length > 0) {
      this.queue = [...queueList];
      this.queueIndex = this.queue.findIndex((t) => t.id === track.id);
      if (this.queueIndex === -1) {
        this.queue.unshift(track);
        this.queueIndex = 0;
      }
    } else if (!this.queue.some((t) => t.id === track.id)) {
      this.queue.splice(this.queueIndex + 1, 0, track);
      this.queueIndex = this.queue.findIndex((t) => t.id === track.id);
    } else {
      this.queueIndex = this.queue.findIndex((t) => t.id === track.id);
    }

    if (this.currentTrack && this.currentTrack.id !== track.id) {
      this.history.unshift(this.currentTrack);
      if (this.history.length > 30) this.history.pop();
    }

    this.currentTrack = track;
    this.onTrackChange?.(track);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle
      });
    }

    if (track.isYouTube && track.videoId) {
      // Stop HTML5 audio engine cleanly
      this.audio.pause();
      this.mode = 'youtube';
      this.ytCurrentTime = 0;
      this.ytDuration = track.duration || 0;
      this.setYouTubeDockVisible(true);

      try {
        const ytp = await this.ensureYouTubeApi();
        this.syncYouTubeVolume();
        ytp.loadVideoById(track.videoId);
        this.isPlaying = true;
        this.startYouTubeTimer();
        this.startVisualizer();
        this.onStateChange?.();
      } catch (err) {
        this.isPlaying = false;
        this.onError?.(err.message || 'Unable to initialize YouTube player.');
        this.onStateChange?.('error');
      }
      return;
    }

    // Switch back to HTML5 audio engine
    this.mode = 'audio';
    this.stopYouTubeTimer();
    this.setYouTubeDockVisible(false);
    if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
      try {
        this.ytPlayer.pauseVideo();
      } catch {}
    }

    this.ensureAudioGraph();
    this.audio.src = track.streamUrl;
    try {
      await this.audio.play();
    } catch {
      this.isPlaying = false;
      this.onStateChange?.();
    }
  }

  stopYouTube() {
    this.stopYouTubeTimer();
    if (this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {
      try {
        this.ytPlayer.stopVideo();
      } catch {}
    }
    this.setYouTubeDockVisible(false);
    if (this.mode === 'youtube') {
      this.isPlaying = false;
      this.onStateChange?.();
    }
  }

  togglePlay() {
    if (!this.currentTrack) return;
    if (this.mode === 'youtube' && this.ytPlayer) {
      if (this.isPlaying) {
        this.ytPlayer.pauseVideo();
      } else {
        this.ytPlayer.playVideo();
      }
      return;
    }
    this.ensureAudioGraph();
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  }

  async next(fromEnded = false) {
    if (!this.queue.length && !this.currentTrack) return;

    if (this.shuffle && this.queue.length > 1) {
      let nextIdx = this.queueIndex;
      while (nextIdx === this.queueIndex) {
        nextIdx = Math.floor(Math.random() * this.queue.length);
      }
      await this.playTrack(this.queue[nextIdx]);
      return;
    }

    if (this.queueIndex + 1 < this.queue.length) {
      await this.playTrack(this.queue[this.queueIndex + 1]);
      return;
    }

    if (this.repeat === 'all' && this.queue.length > 0) {
      await this.playTrack(this.queue[0]);
      return;
    }

    if (this.autoplaySimilar && this.currentTrack && this.onNeedSimilar) {
      const nextSimilar = await this.onNeedSimilar(this.currentTrack, this.queue.map((t) => t.id));
      if (nextSimilar) {
        this.queue.push(nextSimilar);
        await this.playTrack(nextSimilar);
        return;
      }
    }

    if (fromEnded) {
      this.isPlaying = false;
      this.onStateChange?.();
    }
  }

  async prev() {
    if (!this.currentTrack) return;
    if (this.getCurrentTime() > 3) {
      if (this.mode === 'youtube' && this.ytPlayer) {
        this.ytPlayer.seekTo(0, true);
      } else {
        this.audio.currentTime = 0;
      }
      return;
    }
    if (this.queueIndex > 0) {
      await this.playTrack(this.queue[this.queueIndex - 1]);
    } else if (this.history.length > 0) {
      const prevTrack = this.history.shift();
      await this.playTrack(prevTrack);
    } else if (this.mode === 'youtube' && this.ytPlayer) {
      this.ytPlayer.seekTo(0, true);
    } else {
      this.audio.currentTime = 0;
    }
  }

  seekToPercent(pct) {
    const dur = this.getDuration();
    if (!dur) return;
    const target = Math.max(0, Math.min(dur, (pct / 100) * dur));
    if (this.mode === 'youtube' && this.ytPlayer) {
      this.ytCurrentTime = target;
      this.ytPlayer.seekTo(target, true);
    } else {
      this.audio.currentTime = target;
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.muted = this.volume === 0;
    this.audio.volume = this.muted ? 0 : this.volume;
    this.syncYouTubeVolume();
    this.onStateChange?.('volume');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.volume = this.muted ? 0 : this.volume;
    this.syncYouTubeVolume();
    this.onStateChange?.('volume');
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.onStateChange?.();
    return this.shuffle;
  }

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    this.repeat = order[(order.indexOf(this.repeat) + 1) % order.length];
    this.onStateChange?.();
    return this.repeat;
  }

  addToQueue(track) {
    if (!track) return;
    if (!this.currentTrack) {
      this.playTrack(track, [track]);
      return;
    }
    this.queue.push(track);
    this.onStateChange?.('queue');
  }

  playNext(track) {
    if (!track) return;
    if (!this.currentTrack) {
      this.playTrack(track, [track]);
      return;
    }
    this.queue.splice(this.queueIndex + 1, 0, track);
    this.onStateChange?.('queue');
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.queueIndex) return;
    this.queue.splice(index, 1);
    if (index < this.queueIndex) this.queueIndex -= 1;
    this.onStateChange?.('queue');
  }

  clearQueue() {
    if (!this.currentTrack) {
      this.queue = [];
      this.queueIndex = -1;
    } else {
      this.queue = [this.currentTrack];
      this.queueIndex = 0;
    }
    this.onStateChange?.('queue');
  }

  getDuration() {
    if (this.mode === 'youtube') {
      return this.ytDuration || this.currentTrack?.duration || 0;
    }
    if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      return this.audio.duration;
    }
    return this.currentTrack?.duration || 0;
  }

  getCurrentTime() {
    if (this.mode === 'youtube') {
      return this.ytCurrentTime || 0;
    }
    return this.audio.currentTime || 0;
  }
}
