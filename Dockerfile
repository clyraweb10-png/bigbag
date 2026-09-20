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

# Provide build-time arguments and environment variables for Next.js client bundling
ARG NEXT_PUBLIC_SUPABASE_URL=https://dgtkizrvagvfnbdkdnfs.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_6rAsAZ251qMCTSBToJH0HA_9CglSc8U
ARG NEXT_PUBLIC_APP_URL=https://vibecode-spzy.onrender.com
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Build Next.js application
RUN npm run build

# Set runtime environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    ORCHESTRATOR_MODE=local \
    NEXT_PUBLIC_APP_URL="https://vibecode-spzy.onrender.com"

# Expose ONLY port 3000
EXPOSE 3000

# Start application server
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
