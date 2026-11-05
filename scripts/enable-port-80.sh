#!/usr/bin/env bash
# ==============================================================================
# Sigmoid Sharing: Enable Persistent Port 80 Redirect
# ==============================================================================
# Allows opening http://<system-name>.local directly in your phone/PC browser
# without typing ':8080'.
# Sets up a permanent systemd service that persists across laptop restarts.
# ==============================================================================

if [ "$EUID" -ne 0 ]; then
  echo "⚠️ Please run with sudo:"
  echo "   sudo ./scripts/enable-port-80.sh"
  exit 1
fi

echo "Setting up persistent port 80 redirect..."

SYSTEMD_UNIT_DIR="$(systemd-path systemd-system-conf)"
IPTABLES_BIN="$(command -v iptables)"
if [ -z "$SYSTEMD_UNIT_DIR" ] || [ -z "$IPTABLES_BIN" ]; then
  echo "Could not locate the systemd service directory or iptables executable."
  exit 1
fi

# 1. Apply iptables rules immediately
"$IPTABLES_BIN" -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 2>/dev/null || \
"$IPTABLES_BIN" -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080

"$IPTABLES_BIN" -t nat -C OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080 2>/dev/null || \
"$IPTABLES_BIN" -t nat -A OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080

# 2. Create a persistent system service to re-apply on boot
cat << 'EOF' > "$SYSTEMD_UNIT_DIR/sigmoid-port80.service"
[Unit]
Description=Sigmoid Sharing Port 80 to 8080 Redirect (Persistent)
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=sh -c 'iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 || iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080'
ExecStart=sh -c 'iptables -t nat -C OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080 || iptables -t nat -A OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080'
ExecStop=-iptables -t nat -D PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
ExecStop=-iptables -t nat -D OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sigmoid-port80.service
systemctl start sigmoid-port80.service

echo ""
echo "✅ SUCCESS! Port 80 redirect is now active and will survive laptop reboots."
echo "Open the system hostname URL from any phone or laptop on the same network."
