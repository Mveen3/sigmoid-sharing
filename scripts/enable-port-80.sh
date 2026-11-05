#!/usr/bin/env bash
# ==============================================================================
# Mveen File Share: Enable Persistent Port 80 Redirect
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

# 1. Apply iptables rules immediately
iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 2>/dev/null || \
iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080

iptables -t nat -C OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080 2>/dev/null || \
iptables -t nat -A OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080

# 2. Create a persistent system service to re-apply on boot
cat << 'EOF' > /etc/systemd/system/alpha-port80.service
[Unit]
Description=Mveen File Share Port 80 to 8080 Redirect (Persistent)
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
ExecStart=/sbin/iptables -t nat -A OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080
ExecStop=/sbin/iptables -t nat -D PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
ExecStop=/sbin/iptables -t nat -D OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 8080

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable alpha-port80.service
systemctl start alpha-port80.service

echo ""
echo "✅ SUCCESS! Port 80 redirect is now active and will survive laptop reboots."
echo "Open the system hostname URL from any phone or laptop on the same network."
