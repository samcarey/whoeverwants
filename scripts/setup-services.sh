#!/bin/bash

# Setup script for WhoeverWants systemd services
# This script installs and enables the dev server and tunnel services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_DIR="$PROJECT_DIR/services"

echo "🚀 Setting up WhoeverWants services..."

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run with sudo: sudo $0"
    exit 1
fi

# Copy service files to systemd directory
echo "📋 Installing service files..."
cp "$SERVICE_DIR/whoeverwants-dev.service" /etc/systemd/system/
cp "$SERVICE_DIR/whoeverwants-tunnel.service" /etc/systemd/system/

# Reload systemd daemon
echo "🔄 Reloading systemd daemon..."
systemctl daemon-reload

# Enable services to start on boot
echo "⚙️ Enabling services..."
systemctl enable whoeverwants-dev.service
systemctl enable whoeverwants-tunnel.service

# Start services
echo "▶️ Starting services..."
systemctl start whoeverwants-dev.service
sleep 5  # Wait for dev server to start
systemctl start whoeverwants-tunnel.service

# Check status
echo ""
echo "✅ Services installed successfully!"
echo ""
echo "📊 Service Status:"
systemctl status whoeverwants-dev.service --no-pager | head -10
echo ""
systemctl status whoeverwants-tunnel.service --no-pager | head -10

echo ""
echo "🔧 Useful commands:"
echo "  View dev server logs:    sudo journalctl -u whoeverwants-dev -f"
echo "  View tunnel logs:        sudo journalctl -u whoeverwants-tunnel -f"
echo "  Restart dev server:      sudo systemctl restart whoeverwants-dev"
echo "  Restart tunnel:          sudo systemctl restart whoeverwants-tunnel"
echo "  Stop services:           sudo systemctl stop whoeverwants-dev whoeverwants-tunnel"
echo "  Start services:          sudo systemctl start whoeverwants-dev whoeverwants-tunnel"
echo "  Check status:            sudo systemctl status whoeverwants-dev whoeverwants-tunnel"
echo ""
echo "🌐 The dev server should be accessible at: http://decisionbot.a.pinggy.link"