module("luci.controller.nft-limiter", package.seeall)

function index()
    if not nixio.fs.access("/etc/config/nft-limiter") then return end
    entry({"admin", "network"}, firstchild(), "Network", 44).dependent = false

    entry({"admin", "network", "nft-limiter"}, view("nft-limiter"), _("NFT Limiter"), 65).acl_depends = { "luci-app-nft-limiter" }
end
