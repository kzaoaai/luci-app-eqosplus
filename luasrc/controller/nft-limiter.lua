module("luci.controller.nft-limiter", package.seeall)

function index()
    if not nixio.fs.access("/etc/config/nft-limiter") then return end
    entry({"admin", "network"}, firstchild(), "Network", 44).dependent = false

    local e = entry({"admin", "network", "nft-limiter"}, firstchild(), _("NFT Limiter"), 65)
    e.dependent = false
    e.acl_depends = { "luci-app-nft-limiter" }

    entry({"admin", "network", "nft-limiter", "settings"}, view("nft-limiter"), _("Settings"), 1).acl_depends = { "luci-app-nft-limiter" }
    entry({"admin", "network", "nft-limiter", "status"}, view("nft-limiter-status"), _("Status"), 2).acl_depends = { "luci-app-nft-limiter" }
end
