import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  }
});

// Port configuration
const PORT = process.env.PORT || 5001;

// Enable CORS & JSON parsing
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Set up static files route for uploaded videos (optional, for browser preview)
app.use('/uploads', express.static(uploadDir));

// Multer config for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep clean names, sanitize spaces
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.webm'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'));
    }
  }
});

// Streaming state variables
let activeStreamProcess = null;
let streamStatus = {
  active: false,
  videoName: null,
  startTime: null,
  loop: false,
  key: null
};

// Clean up function for stream
function stopStreamCleanup() {
  if (activeStreamProcess) {
    try {
      activeStreamProcess.kill('SIGINT');
      const proc = activeStreamProcess;
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
      }, 2000);
    } catch (e) {
      console.error('Error stopping FFmpeg process:', e);
    }
    activeStreamProcess = null;
  }
  streamStatus = {
    active: false,
    videoName: null,
    startTime: null,
    loop: false,
    key: null
  };
  io.emit('stream:status', streamStatus);
  io.emit('stream:stats', null);
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Get List of Uploaded Videos
app.get('/api/videos', (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir);
    const videoFiles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.webm'].includes(ext);
      })
      .map(file => {
        const stats = fs.statSync(path.join(uploadDir, file));
        return {
          name: file,
          size: stats.size,
          createdAt: stats.birthtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    res.json(videoFiles);
  } catch (error) {
    console.error('Error listing videos:', error);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// 2. Upload a video file
app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    res.json({
      message: 'Video uploaded successfully',
      video: {
        name: req.file.filename,
        size: req.file.size
      }
    });
  });
});

// 3. Delete a video file
app.delete('/api/videos/:name', (req, res) => {
  const { name } = req.params;
  const filePath = path.join(uploadDir, name);
  
  if (streamStatus.active && streamStatus.videoName === name) {
    return res.status(400).json({ error: 'Cannot delete the video currently being streamed' });
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ message: 'Video deleted successfully' });
    } else {
      return res.status(404).json({ error: 'Video file not found' });
    }
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// 4. Generate a Test Pattern Video via FFmpeg
app.post('/api/videos/generate-test', (req, res) => {
  const testFileName = `test_pattern_${Date.now()}.mp4`;
  const outputPath = path.join(uploadDir, testFileName);
  const ffmpegCmd = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';

  // Spawn FFmpeg to generate 30 seconds of test bars and sine tone audio
  const args = [
    '-f', 'lavfi',
    '-i', 'testsrc=duration=30:size=1280x720:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    outputPath
  ];

  console.log(`Generating test video to: ${outputPath}`);
  const genProcess = spawn(ffmpegCmd, args);

  genProcess.on('close', (code) => {
    if (code === 0) {
      res.json({
        message: 'Test pattern video generated successfully',
        video: {
          name: testFileName,
          size: fs.statSync(outputPath).size
        }
      });
    } else {
      res.status(500).json({ error: `FFmpeg test generator failed with code ${code}` });
    }
  });

  genProcess.on('error', (err) => {
    console.error('Failed to start test pattern generation:', err);
    res.status(500).json({ error: `Failed to start FFmpeg: ${err.message}` });
  });
});

// 5. Start Streaming
app.post('/api/stream/start', (req, res) => {
  const { videoName, streamKey, loop } = req.body;

  if (!videoName || !streamKey) {
    return res.status(400).json({ error: 'Video file name and YouTube Stream Key are required' });
  }

  if (activeStreamProcess) {
    return res.status(400).json({ error: 'A stream is already active' });
  }

  const videoPath = path.join(uploadDir, videoName);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const ffmpegCmd = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';

  // Construct FFmpeg arguments for RTMP Streaming to YouTube
  const args = [];
  
  if (loop) {
    // Loop input video infinitely
    args.push('-stream_loop', '-1');
  }
  
  // Real-time speed reading
  args.push('-re');
  args.push('-i', videoPath);
  
  // Video Encoding
  args.push('-c:v', 'libx264');
  args.push('-preset', 'veryfast');
  args.push('-b:v', '3000k');
  args.push('-maxrate', '3000k');
  args.push('-bufsize', '6000k');
  args.push('-pix_fmt', 'yuv420p');
  args.push('-g', '60'); // 2-second GOP size (for 30fps)
  
  // Audio Encoding
  args.push('-c:a', 'aac');
  args.push('-b:a', '128k');
  args.push('-ar', '44100');
  
  // Output format
  args.push('-f', 'flv');
  
  // YouTube Live Ingest URL
  args.push(`rtmp://a.rtmp.youtube.com/live2/${streamKey}`);

  console.log(`Starting stream for ${videoName}. Loop=${loop}`);
  
  try {
    activeStreamProcess = spawn(ffmpegCmd, args);

    // Save status
    streamStatus = {
      active: true,
      videoName,
      startTime: Date.now(),
      loop,
      // Mask key for safety in dashboard status
      key: streamKey.length > 8 ? `${streamKey.substring(0, 4)}...${streamKey.substring(streamKey.length - 4)}` : '****'
    };

    io.emit('stream:status', streamStatus);
    io.emit('stream:log', `[SYSTEM] Starting FFmpeg broadcast to YouTube Live...`);
    io.emit('stream:log', `[SYSTEM] Command: ${ffmpegCmd} ${args.map(a => a.includes('live2') ? 'rtmp://...[KEY]' : a).join(' ')}`);

    let buffer = '';
    activeStreamProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      buffer += chunk;
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop(); // save incomplete line

      for (const line of lines) {
        if (line.trim()) {
          // Log to dashboard console
          io.emit('stream:log', line);

          // Parse stats line:
          // frame=  105 fps= 25 q=28.0 size=     674kB time=00:00:04.22 bitrate=1308.2kbits/s speed=1.01x
          const match = line.match(/frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+.*?time=\s*([\d:.]+)\s+bitrate=\s*([\d.]+k?bits\/s|[\d.]+k?bps).*?speed=\s*([\d.]+x)/i);
          if (match) {
            const stats = {
              frames: parseInt(match[1]),
              fps: parseFloat(match[2]),
              time: match[3],
              bitrate: match[4],
              speed: match[5]
            };
            io.emit('stream:stats', stats);
          }
        }
      }
    });

    activeStreamProcess.on('close', (code) => {
      console.log(`FFmpeg process exited with code ${code}`);
      io.emit('stream:log', `[SYSTEM] FFmpeg broadcast finished. Exit code: ${code}`);
      stopStreamCleanup();
    });

    activeStreamProcess.on('error', (err) => {
      console.error('FFmpeg process error:', err);
      io.emit('stream:log', `[ERROR] FFmpeg process encountered an error: ${err.message}`);
      stopStreamCleanup();
    });

    return res.json({ message: 'Stream started successfully', status: streamStatus });
  } catch (error) {
    console.error('Error starting stream process:', error);
    stopStreamCleanup();
    return res.status(500).json({ error: `Failed to spawn stream process: ${error.message}` });
  }
});

// 6. Stop Streaming
app.post('/api/stream/stop', (req, res) => {
  if (!activeStreamProcess) {
    return res.status(400).json({ error: 'No stream is currently active' });
  }
  io.emit('stream:log', `[SYSTEM] Stopping stream manually by user request...`);
  stopStreamCleanup();
  res.json({ message: 'Stream stopped successfully' });
});

// 7. Get Status
app.get('/api/stream/status', (req, res) => {
  res.json(streamStatus);
});

// -------------------------------------------------------------
// WebSocket client connection handling
// -------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('Client connected to socket:', socket.id);
  // Send current status immediately
  socket.emit('stream:status', streamStatus);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Serve static assets in production (React build)
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start the Server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Video storage path: ${uploadDir}`);
});
