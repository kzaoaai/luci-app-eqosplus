#
# Copyright (C) 2006-2017 OpenWrt.org
# Copyright (C) 2025 kzaoaai (based on work by sirpdboy)
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nft-limiter

PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=LuCI app for NFT Limiter (nftables/fw4 per-device bandwidth control)
LUCI_DESCRIPTION:=Per-device download/upload rate limiting via nftables. Supports IP, CIDR, and IP ranges. Requires OpenWrt 25.12+ with firewall4.
LUCI_DEPENDS:=+ip-full +nftables +bc +firewall4
LUCI_PKGARCH:=all

PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_MAINTAINER:=kzaoaai

define Build/Compile
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
rm -f /tmp/luci-*
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/nft-limiter
endef

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,$(PKG_NAME)))
