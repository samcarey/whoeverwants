#!/bin/bash

echo "🔄 Restarting WhoeverWants services..."

# Kill any existing processes on port 3000
echo "🔪 Killing existing processes on port 3000..."
sudo lsof -ti :3000 | xargs -r kill -9

# Kill any running tunnel processes  
echo "🔪 Killing existing tunnel processes..."
pkill -f "ssh.*pinggy" || true

# Kill any npm/node processes that might be hanging
pkill -f "npm run dev" || true
pkill -f "next dev" || true

echo "⏳ Waiting for cleanup..."
sleep 2

# Change to project directory
cd /home/ubuntu/whoeverwants

# Start dev server on port 3000 in background
echo "🚀 Starting development server on port 3000..."
npm run dev &
DEV_PID=$!

# Wait for dev server to start
echo "⏳ Waiting for dev server to initialize..."
sleep 5

# Test dev server
echo "🧪 Testing dev server..."
if curl -s -I http://localhost:3000 | head -1 | grep -q "200 OK"; then
    echo "✅ Dev server is running at http://localhost:3000"
else
    echo "❌ Dev server failed to start"
    exit 1
fi

# Start tunnel to expose port 3000
echo "🌐 Starting Pinggy tunnel..."
ssh -p 80 -R0:localhost:3000 -o StrictHostKeyChecking=no -o ConnectTimeout=10 a.pinggy.link &
TUNNEL_PID=$!

# Wait for tunnel to establish
echo "⏳ Waiting for tunnel to establish..."
sleep 8

# Test tunnel
echo "🧪 Testing tunnel..."
if timeout 10 curl -s -I https://decisionbot.a.pinggy.link | head -1 | grep -q "200 OK"; then
    echo "✅ Tunnel is running at https://decisionbot.a.pinggy.link"
else
    echo "⚠️  Tunnel may not be accessible (network/DNS issues)"
fi

echo "🎉 Services restart complete!"
echo "📋 Status:"
echo "   Dev Server: http://localhost:3000 (PID: $DEV_PID)"
echo "   Tunnel: https://decisionbot.a.pinggy.link (PID: $TUNNEL_PID)"
echo ""
echo "💡 Use 'ps aux | grep -E \"(npm|ssh.*pinggy)\"' to check process status"