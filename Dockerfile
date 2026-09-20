FROM node:22-bookworm-slim

# Install system utilities: git, procps, ca-certificates, curl, python3, build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    procps \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package descriptors
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies like next and typescript)
RUN npm install --include=dev

# Copy application code
COPY . .

# Create persistent directories
RUN mkdir -p /app/data /app/workspaces

# Build Next.js application
RUN npm run build

# Set runtime environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    ORCHESTRATOR_MODE=local \
    NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Expose ONLY port 3000
EXPOSE 3000

# Start application server
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
