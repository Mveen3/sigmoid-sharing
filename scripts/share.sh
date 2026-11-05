#!/usr/bin/env bash
# ========================================================
# Mveen File Share Management Script
# ========================================================

SERVICE_NAME="alpha-share.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SERVICE_SOURCE="$PROJECT_DIR/deploy/$SERVICE_NAME"
USER_SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

install_service() {
    mkdir -p "$USER_SERVICE_DIR"
    install -m 644 "$SERVICE_SOURCE" "$USER_SERVICE_DIR/$SERVICE_NAME"
    systemctl --user daemon-reload
}

case "$1" in
    start)
        install_service
        echo "Starting Mveen File Share..."
        systemctl --user start "$SERVICE_NAME"
        systemctl --user status "$SERVICE_NAME" --no-pager
        ;;
    stop)
        echo "Stopping Mveen File Share..."
        systemctl --user stop "$SERVICE_NAME"
        ;;
    restart)
        install_service
        echo "Restarting Mveen File Share..."
        systemctl --user restart "$SERVICE_NAME"
        systemctl --user status "$SERVICE_NAME" --no-pager
        ;;
    status)
        systemctl --user status "$SERVICE_NAME" --no-pager
        ;;
    logs)
        journalctl --user -u "$SERVICE_NAME" -f -n 50
        ;;
    enable)
        echo "Enabling service to start automatically on system startup..."
        install_service
        systemctl --user enable "$SERVICE_NAME"
        loginctl enable-linger "$USER"
        echo "Service enabled for startup!"
        ;;
    disable)
        echo "Disabling automatic startup..."
        systemctl --user disable "$SERVICE_NAME"
        ;;
    test)
        echo "Testing local HTTP endpoint..."
        curl -sI http://127.0.0.1:8080/login.html | head -n 5
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|enable|disable|test}"
        exit 1
        ;;
esac
