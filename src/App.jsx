import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Tv, Play, Square, UploadCloud, Trash2, Eye, EyeOff, 
  Activity, FileVideo, Terminal, Sparkles, Clock, Cpu, BarChart2
} from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_URL || '';

function App() {
  // Input and settings state
  const [streamKey, setStreamKey] = useState(() => {
    return localStorage.getItem('youtube_stream_key') || '';
  });
  const [selectedVideo, setSelectedVideo] = useState('');
  const [loop, setLoop] = useState(true);
  const [showKey, setShowKey] = useState(false);

  // Lists & data state
  const [videoFiles, setVideoFiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState({
    active: false,
    videoName: null,
    startTime: null,
    loop: false,
    key: null
  });

  // UI operation states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generatingTest, setGeneratingTest] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uptime, setUptime] = useState('00:00:00');

  const fileInputRef = useRef(null);
  const terminalEndRef = useRef(null);
  const socketRef = useRef(null);
  const timerRef = useRef(null);

  // 1. WebSocket Setup
  useEffect(() => {
    // Connect socket
    const socket = io(BACKEND_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to socket server');
      setLogs(prev => [...prev, { type: 'system', text: '[SYSTEM] Connected to server socket.' }]);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from socket server');
      setLogs(prev => [...prev, { type: 'error', text: '[SYSTEM] Disconnected from server socket.' }]);
    });

    socket.on('stream:status', (newStatus) => {
      setStatus(newStatus);
      if (!newStatus.active) {
        setStats(null);
      }
    });

    socket.on('stream:log', (logLine) => {
      let type = 'raw';
      if (logLine.startsWith('[SYSTEM]')) type = 'system';
      else if (logLine.startsWith('[ERROR]')) type = 'error';
      else if (logLine.includes('frame=')) type = 'stats';

      setLogs(prev => {
        // Keep logs capped at 1000 lines to avoid crashes
        const nextLogs = [...prev, { type, text: logLine }];
        if (nextLogs.length > 1000) {
          nextLogs.shift();
        }
        return nextLogs;
      });
    });

    socket.on('stream:stats', (newStats) => {
      setStats(newStats);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // 2. Fetch Video Files
  const fetchVideos = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/videos`);
      if (res.ok) {
        const data = await res.json();
        setVideoFiles(data);
        // Default select first video if none is selected
        if (data.length > 0 && !selectedVideo) {
          setSelectedVideo(data[0].name);
        }
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  // Save stream key locally
  useEffect(() => {
    localStorage.setItem('youtube_stream_key', streamKey);
  }, [streamKey]);

  // 3. Uptime Counter Effect
  useEffect(() => {
    if (status.active && status.startTime) {
      const updateUptime = () => {
        const elapsedMs = Date.now() - status.startTime;
        const totalSecs = Math.floor(elapsedMs / 1000);
        const hrs = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
        const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
        const secs = String(totalSecs % 60).padStart(2, '0');
        setUptime(`${hrs}:${mins}:${secs}`);
      };

      updateUptime(); // initial run
      timerRef.current = setInterval(updateUptime, 1000);
    } else {
      setUptime('00:00:00');
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [status.active, status.startTime]);

  // 4. Auto scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // 5. API Operations
  const handleStartStream = async () => {
    if (!selectedVideo) {
      alert('Please upload/select a video to stream.');
      return;
    }
    if (!streamKey.trim()) {
      alert('Please enter your YouTube Stream Key.');
      return;
    }

    setLogs(prev => [...prev, { type: 'system', text: '[SYSTEM] Initializing broadcast request...' }]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/stream/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoName: selectedVideo,
          streamKey: streamKey.trim(),
          loop
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to start stream');
        setLogs(prev => [...prev, { type: 'error', text: `[SYSTEM] Start stream failed: ${data.error}` }]);
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      alert('Network error starting stream.');
    }
  };

  const handleStopStream = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/stream/stop`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to stop stream');
      }
    } catch (error) {
      console.error('Error stopping stream:', error);
    }
  };

  const handleDeleteVideo = async (videoName) => {
    if (status.active && status.videoName === videoName) {
      alert('Cannot delete the video currently being streamed.');
      return;
    }
    if (!confirm(`Are you sure you want to delete "${videoName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/videos/${encodeURIComponent(videoName)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchVideos();
        if (selectedVideo === videoName) {
          setSelectedVideo('');
        }
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete video');
      }
    } catch (error) {
      console.error('Error deleting video:', error);
    }
  };

  const handleGenerateTestVideo = async () => {
    setGeneratingTest(true);
    setLogs(prev => [...prev, { type: 'system', text: '[SYSTEM] Starting test pattern generator...' }]);
    try {
      const res = await fetch(`${BACKEND_URL}/api/videos/generate-test`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setLogs(prev => [...prev, { type: 'system', text: `[SYSTEM] Generated video: ${data.video.name}` }]);
        fetchVideos();
        setSelectedVideo(data.video.name);
      } else {
        alert(data.error || 'Failed to generate test video');
      }
    } catch (error) {
      console.error('Error generating test video:', error);
    } finally {
      setGeneratingTest(false);
    }
  };

  // 6. Upload Handlers
  const uploadFile = (file) => {
    if (!file) return;
    
    // Check if video file
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm'];
    if (!allowed.includes(ext)) {
      alert('Only video files are allowed!');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND_URL}/api/upload`, true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        setLogs(prev => [...prev, { type: 'system', text: `[SYSTEM] Uploaded: ${response.video.name}` }]);
        fetchVideos();
        setSelectedVideo(response.video.name);
      } else {
        const response = JSON.parse(xhr.responseText || '{}');
        alert(response.error || 'Upload failed');
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      alert('Upload failed due to connection error.');
    };

    xhr.send(formData);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      uploadFile(e.target.files[0]);
    }
  };

  // Helper formats
  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <>
      <header>
        <div className="logo-container">
          <Tv className="logo-icon" size={28} />
          <h1>StreamCraft Live</h1>
        </div>
        <div className={`status-badge ${status.active ? 'live' : 'offline'}`}>
          <span className="dot"></span>
          <span>{status.active ? 'Live' : 'Offline'}</span>
        </div>
      </header>

      <main className="dashboard-container">
        {/* Left Column: Stream Settings & Status Stats */}
        <div className="dashboard-column">
          {/* Stream Settings Control Card */}
          <div className="card">
            <div className="card-title">
              <Tv size={20} />
              <h2>Stream Setup</h2>
            </div>
            
            <div className="info-alert">
              To broadcast, grab your stream key from the <a href="https://studio.youtube.com/live" target="_blank" rel="noopener noreferrer" style={{textDecoration: 'underline', color: '#38bdf8', fontWeight: 'bold'}}>YouTube Live Dashboard</a>.
            </div>

            <div className="form-group">
              <label>YouTube Stream Key</label>
              <div className="input-container">
                <input 
                  type={showKey ? 'text' : 'password'} 
                  placeholder="paste rtmp stream key here..."
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  disabled={status.active}
                />
                <button 
                  type="button" 
                  className="input-icon-btn"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Video File to Broadcast</label>
              <select 
                value={selectedVideo} 
                onChange={(e) => setSelectedVideo(e.target.value)}
                disabled={status.active}
              >
                {videoFiles.length === 0 ? (
                  <option value="">-- No videos available --</option>
                ) : (
                  videoFiles.map(video => (
                    <option key={video.name} value={video.name}>
                      {video.name.substring(video.name.indexOf('_') + 1)} ({formatSize(video.size)})
                    </option>
                  ))
                )}
              </select>
            </div>

            <label className="checkbox-group">
              <input 
                type="checkbox" 
                checked={loop} 
                onChange={(e) => setLoop(e.target.checked)}
                disabled={status.active}
              />
              <div className="checkbox-custom">
                ✓
              </div>
              <span className="checkbox-label">Loop video infinitely</span>
            </label>

            {status.active ? (
              <button className="btn btn-danger" onClick={handleStopStream}>
                <Square size={18} fill="#fff" /> Stop Broadcast
              </button>
            ) : (
              <button 
                className="btn btn-primary" 
                onClick={handleStartStream}
                disabled={videoFiles.length === 0 || !streamKey.trim()}
              >
                <Play size={18} fill="#fff" /> Start Broadcast
              </button>
            )}
          </div>

          {/* Status Metrics Card */}
          <div className="card">
            <div className="card-title">
              <BarChart2 size={20} />
              <h2>Broadcast Metrics</h2>
            </div>
            
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">Uptime</span>
                <span className={`stat-value ${status.active ? 'active' : ''}`}>{uptime}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Speed</span>
                <span className="stat-value">{stats ? stats.speed : '0.00x'}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Framerate</span>
                <span className="stat-value">{stats ? `${stats.fps} fps` : '0 fps'}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Bitrate</span>
                <span className="stat-value">{stats ? stats.bitrate : '0 kb/s'}</span>
              </div>
            </div>
            
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                <span style={{ fontWeight: 600, color: status.active ? 'var(--success)' : 'var(--text-muted)' }}>
                  {status.active ? 'Streaming' : 'Idle'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Source Video:</span>
                <span style={{ fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status.videoName}>
                  {status.videoName ? status.videoName.substring(status.videoName.indexOf('_') + 1) : 'None'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Frames Sent:</span>
                <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                  {stats ? stats.frames : '0'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Console Log Terminal & Video Manager */}
        <div className="dashboard-column">
          {/* Terminal Console Card */}
          <div className="card terminal-card">
            <div className="terminal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Terminal size={18} />
                <h2>Live Terminal logs</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button 
                  className="btn-icon" 
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} 
                  onClick={() => setLogs([])}
                >
                  Clear Console
                </button>
                <div className="terminal-controls">
                  <span className="terminal-dot red"></span>
                  <span className="terminal-dot yellow"></span>
                  <span className="terminal-dot green"></span>
                </div>
              </div>
            </div>

            <div className="terminal-console">
              {logs.length === 0 ? (
                <div className="terminal-line system">[SYSTEM] Console clear. Launch a broadcast to see streaming details.</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`terminal-line ${log.type}`}>
                    {log.text}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>

          {/* Video Library Manager Card */}
          <div className="card">
            <div className="card-title">
              <FileVideo size={20} />
              <h2>Video Library</h2>
            </div>

            <button 
              className="btn btn-outline btn-generate" 
              onClick={handleGenerateTestVideo}
              disabled={generatingTest || status.active}
            >
              <Sparkles size={16} /> {generatingTest ? 'Generating Test Video...' : 'Generate 720p Test Video'}
            </button>

            {/* Upload Zone */}
            <div 
              className={`upload-zone ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !status.active && !uploading && fileInputRef.current.click()}
              style={{ opacity: status.active ? 0.5 : 1, cursor: status.active ? 'not-allowed' : 'pointer' }}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                accept="video/*" 
                style={{ display: 'none' }}
                disabled={status.active || uploading}
              />
              <UploadCloud className="upload-icon" size={32} />
              <div className="upload-text">
                {uploading ? (
                  <span>Uploading file...</span>
                ) : (
                  <>Drag & drop video here or <span>browse files</span></>
                )}
              </div>
              <div className="helper-text">Supports MP4, MKV, MOV, WEBM</div>
              
              {uploading && (
                <div className="upload-progress-container" onClick={(e) => e.stopPropagation()}>
                  <div className="upload-progress-bar">
                    <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                  </div>
                  <div className="upload-progress-text">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Video List */}
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Available Videos ({videoFiles.length})
              </div>
              
              {videoFiles.length === 0 ? (
                <div className="empty-state">
                  No video files in library. Upload a file or generate a test pattern to get started.
                </div>
              ) : (
                <div className="video-list">
                  {videoFiles.map(video => {
                    const cleanName = video.name.substring(video.name.indexOf('_') + 1);
                    const isCurrent = selectedVideo === video.name;
                    return (
                      <div 
                        key={video.name} 
                        className="video-item"
                        style={{ borderColor: isCurrent ? 'var(--primary)' : 'var(--border-color)' }}
                        onClick={() => !status.active && setSelectedVideo(video.name)}
                      >
                        <div className="video-info">
                          <FileVideo size={16} className="video-icon" style={{ color: isCurrent ? 'var(--primary)' : 'var(--text-secondary)' }} />
                          <div className="video-meta">
                            <div className="video-name" title={cleanName} style={{ fontWeight: isCurrent ? 600 : 500 }}>
                              {cleanName}
                            </div>
                            <div className="video-size">{formatSize(video.size)}</div>
                          </div>
                        </div>
                        <div className="video-actions">
                          <button 
                            className="btn-icon btn-icon-danger"
                            title="Delete video"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteVideo(video.name);
                            }}
                            disabled={status.active}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

export default App;
