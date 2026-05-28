# luci-app-nft-limiter

<p>
<a href="https://github.com/kzaoaai/luci-app-nft-limiter/actions/workflows/build.yml"><img alt="Build" src="https://github.com/kzaoaai/luci-app-nft-limiter/actions/workflows/build.yml/badge.svg"></a>
<a href="https://github.com/kzaoaai/luci-app-nft-limiter/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/kzaoaai/luci-app-nft-limiter"></a>
<a href="https://github.com/kzaoaai/luci-app-nft-limiter/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/kzaoaai/luci-app-nft-limiter/total"></a>
<a href="https://openwrt.org"><img alt="OpenWrt" src="https://img.shields.io/badge/OpenWrt-%E2%89%A525.12-ff0000?logo=openwrt&logoColor=white"></a>
</p>

Per-device bandwidth control for OpenWrt 25.12+ using native **nftables / fw4** rate limiting. Fast, minimal-CPU policing without outdated tc/HTB logic.

## Features

- **Native nftables rules** — `limit rate over … drop` policing, near-zero CPU overhead
- **LAN bypass** — RFC 1918 private ranges are always whitelisted; only internet traffic is shaped
- **Flexible targets** — single IP, CIDR subnet, or arbitrary IP range (`192.168.1.10-192.168.1.50`)
- **Time scheduling** — per-rule active hours (`meta hour`) and weekday selection (`meta day`)
- **Self-healing** — hooks into `firewall4` include so rules survive interface reloads
- **Modern UI** — sortable GridSection with live device picker (hostname + IP from DHCP/ARP)
- **APK + IPK** — CI builds packages for OpenWrt 25.12+ (apk) and 24.10 (ipk)

## Installation

Run via SSH on your router:

```sh
wget -qO- https://raw.githubusercontent.com/kzaoaai/luci-app-nft-limiter/main/install.sh | sh
```

Then open **LuCI → Network → NFT Limiter**.

## UCI config reference

```
config nftlimiter
    option enabled  1
    option download 100   # MB/s global default
    option upload   20

config device
    option enable    1
    option target    192.168.1.10          # IP, CIDR, or IP range
    option download  5
    option upload    2
    option timestart 08:00
    option timeend   22:00
    option week      1,2,3,4,5             # Mon-Fri (0 = every day)
    option comment   'laptop'
```
