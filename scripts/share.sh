#!/usr/bin/env bash
# ========================================================
# Sigmoid Sharing Management Script
# ========================================================

SERVICE_NAME="sigmoid-share.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SERVICE_SOURCE="$PROJECT_DIR/deploy/$SERVICE_NAME"
USER_SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

escape_unit_value() {
    node -e 'process.stdout.write(process.argv[1]
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\x22")
        .replace(/\s/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .replace(/%/g, "%%"))' "$1"
}

install_service() {
    mkdir -p "$USER_SERVICE_DIR"
    local node_binary project_dir_value node_binary_value temp_unit
    node_binary="$(command -v node)"
    if [ -z "$node_binary" ]; then
        echo "Node.js was not found in PATH. Install Node.js before starting Sigmoid Sharing."
        return 1
    fi

    project_dir_value="$(escape_unit_value "$PROJECT_DIR")"
    node_binary_value="$(escape_unit_value "$node_binary")"
    temp_unit="$USER_SERVICE_DIR/$SERVICE_NAME.tmp"
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line//@PROJECT_DIR@/$project_dir_value}"
        line="${line//@NODE_BINARY@/$node_binary_value}"
        printf '%s\n' "$line"
    done < "$SERVICE_SOURCE" > "$temp_unit"
    chmod 644 "$temp_unit"
    mv "$temp_unit" "$USER_SERVICE_DIR/$SERVICE_NAME"
    systemctl --user daemon-reload
}

case "$1" in
    start)
        install_service || exit 1
        echo "Starting Sigmoid Sharing..."
        systemctl --user start "$SERVICE_NAME"
        systemctl --user status "$SERVICE_NAME" --no-pager
        ;;
    stop)
        echo "Stopping Sigmoid Sharing..."
        systemctl --user stop "$SERVICE_NAME"
        ;;
    restart)
        install_service || exit 1
        echo "Restarting Sigmoid Sharing..."
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
        install_service || exit 1
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
