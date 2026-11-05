#!/usr/bin/env python3
"""Dynamically publish this system's hostname on active network interfaces."""

import sys
import time
import socket
import logging
import fcntl
import struct
import dbus
import dbus.mainloop.glib
from gi.repository import GLib

HOSTNAME = (sys.argv[1] if len(sys.argv) > 1 else socket.gethostname())
HOSTNAME = HOSTNAME.lower().removesuffix(".local")
HOSTNAME = "".join(char if char.isalnum() or char == "-" else "-" for char in HOSTNAME).strip("-") or "mveen"
MDNS_NAME = f"{HOSTNAME}.local"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [mDNS] %(message)s",
    datefmt="%H:%M:%S"
)

AVAHI_IF_UNSPEC = -1
AVAHI_PROTO_INET = 0  # IPv4
AVAHI_PUBLISH_NO_REVERSE = 16

current_group = None
last_known_ips = {}
bus = None
server = None

def get_active_ipv4_interfaces():
    """Detect all active non-loopback network interfaces and their IPv4 addresses."""
    interfaces = []
    try:
        with open("/proc/net/dev", "r") as f:
            lines = f.readlines()[2:]
        for line in lines:
            iface_name = line.split(":")[0].strip()
            if iface_name == "lo" or iface_name.startswith("docker"):
                continue
            try:
                iface_idx = socket.if_nametoindex(iface_name)
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                ip = socket.inet_ntoa(fcntl.ioctl(
                    s.fileno(),
                    0x8915,  # SIOCGIFADDR
                    struct.pack('256s', iface_name.encode('utf-8')[:15])
                )[20:24])
                s.close()
                if ip and not ip.startswith("127."):
                    interfaces.append((iface_name, iface_idx, ip))
            except Exception:
                pass
    except Exception as e:
        logging.warning("Error reading interfaces: %s", e)

    # Fallback to default route socket if proc net dev failed
    if not interfaces:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            s.close()
            if ip and not ip.startswith("127."):
                interfaces.append(("default", AVAHI_IF_UNSPEC, ip))
        except Exception:
            pass

    return interfaces

def get_avahi_server():
    global bus, server
    try:
        if not bus:
            bus = dbus.SystemBus()
        server = dbus.Interface(
            bus.get_object("org.freedesktop.Avahi", "/"),
            "org.freedesktop.Avahi.Server"
        )
        return server
    except Exception as e:
        logging.error("Could not connect to Avahi daemon via DBus: %s", e)
        bus = None
        server = None
        return None

def update_registration():
    global current_group, last_known_ips
    interfaces = get_active_ipv4_interfaces()
    
    current_ips = {name: ip for name, idx, ip in interfaces}
    
    # If no changes and already registered, do nothing
    if current_group is not None and current_ips == last_known_ips:
        return True

    if not current_ips:
        # Still waiting for network connection
        if last_known_ips:
            logging.info("Network disconnected. Waiting for connection...")
            last_known_ips = {}
            if current_group:
                try: current_group.Reset()
                except Exception: pass
                current_group = None
        return True

    srv = get_avahi_server()
    if not srv:
        return True

    # Reset existing group before re-registering
    if current_group:
        try:
            current_group.Reset()
        except Exception:
            pass
        current_group = None

    try:
        entry_group_path = srv.EntryGroupNew()
        group = dbus.Interface(
            bus.get_object("org.freedesktop.Avahi", entry_group_path),
            "org.freedesktop.Avahi.EntryGroup"
        )

        reg_count = 0
        for name, idx, ip in interfaces:
            try:
                # Register the machine's hostname for the local network.
                group.AddAddress(
                    idx,
                    AVAHI_PROTO_INET,
                    dbus.UInt32(AVAHI_PUBLISH_NO_REVERSE),
                    MDNS_NAME,
                    ip
                )
                logging.info("Registered %s -> %s on %s", MDNS_NAME, ip, name)
                reg_count += 1
            except Exception as e:
                logging.warning("Failed to register %s on %s (%s): %s", MDNS_NAME, name, ip, e)

        if reg_count > 0:
            group.Commit()
            current_group = group
            last_known_ips = current_ips
            logging.info("✅ mDNS broadcast active for '%s'", MDNS_NAME)
        else:
            current_group = None
    except Exception as e:
        logging.error("Failed to commit entry group: %s", e)
        current_group = None

    return True

def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    
    # Initial registration attempt
    update_registration()

    # Poll every 2 seconds for any IP address change or network connect
    GLib.timeout_add_seconds(2, update_registration)
    
    loop = GLib.MainLoop()
    try:
        loop.run()
    except KeyboardInterrupt:
        if current_group:
            try: current_group.Reset()
            except Exception: pass
        logging.info("mDNS publisher stopped.")

if __name__ == "__main__":
    main()
