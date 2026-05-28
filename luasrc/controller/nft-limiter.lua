module("luci.controller.nft-limiter", package.seeall)

function index()
    if not nixio.fs.access("/etc/config/nft-limiter") then return end
    entry({"admin", "network"}, firstchild(), "Network", 44).dependent = false

    local e = entry({"admin", "network", "nft-limiter"}, view("nft-limiter"), _("NFT Limiter"), 65)
    e.dependent = false
    e.acl_depends = { "luci-app-nft-limiter" }

    entry({"admin", "network", "nft-limiter", "status"}, call("act_status")).leaf = true
end

function act_status()
    local sys = require "luci.sys"
    local e = {}
    e.status = sys.call("nft list chain inet fw4 custom_qos_enforce >/dev/null 2>&1") == 0
    luci.http.prepare_content("application/json")
    luci.http.write_json(e)
end
