# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ==========================================
# Stage 2: Build Node Server & Bundle App
# ==========================================
FROM node:20-slim
WORKDIR /app

# Install FFmpeg (required for streaming RTMP)
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy backend package setup and install production dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copy backend codebase
COPY backend/ ./backend/

# Copy compiled frontend build from Stage 1
COPY --from=frontend-builder /app/dist ./dist

# Expose port and declare environmental variables
EXPOSE 5001
ENV NODE_ENV=production
ENV PORT=5001

# Run the unified Express backend server
CMD ["node", "backend/server.js"]
