# WhoeverWants System Services

This directory contains systemd service definitions for automatically running the development server and Pinggy tunnel.

## Installation

To install these services on your system, run:

```bash
sudo /home/ubuntu/whoeverwants/scripts/setup-services.sh
```

## Manual Installation

If you prefer to install manually:

```bash
# Copy service files
sudo cp whoeverwants-dev.service /etc/systemd/system/
sudo cp whoeverwants-tunnel.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable services to start on boot
sudo systemctl enable whoeverwants-dev
sudo systemctl enable whoeverwants-tunnel

# Start services
sudo systemctl start whoeverwants-dev
sudo systemctl start whoeverwants-tunnel
```

## Service Descriptions

### whoeverwants-dev.service
- Runs the Next.js development server
- Command: `npm run dev`
- Port: 3000
- Auto-restarts on failure

### whoeverwants-tunnel.service
- Creates a Pinggy tunnel to expose the dev server
- URL: http://decisionbot.a.pinggy.link
- Depends on whoeverwants-dev service
- Auto-restarts on failure

## Management

```bash
# Check status
sudo systemctl status whoeverwants-dev
sudo systemctl status whoeverwants-tunnel

# View logs
sudo journalctl -u whoeverwants-dev -f
sudo journalctl -u whoeverwants-tunnel -f

# Restart services
sudo systemctl restart whoeverwants-dev
sudo systemctl restart whoeverwants-tunnel

# Stop services
sudo systemctl stop whoeverwants-dev whoeverwants-tunnel

# Start services
sudo systemctl start whoeverwants-dev whoeverwants-tunnel
```

## Requirements

- Node.js installed and available in PATH
- npm packages installed (`npm install`)
- Port 3000 available
- SSH access for Pinggy tunnel