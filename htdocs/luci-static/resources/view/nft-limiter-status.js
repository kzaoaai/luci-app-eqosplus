'use strict';
'require view';
'require fs';
'require uci';
'require poll';

var NFT_ARGS = ['-j', 'list', 'chain', 'inet', 'fw4', 'custom_qos_enforce'];

function fmtBytes(b) {
    b = Number(b) || 0;
    var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], i = 0;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    return (i === 0 ? b : b.toFixed(2)) + ' ' + units[i];
}

// Parse `nft -j list chain` output into a map of comment -> {packets, bytes}.
// Returns null when the chain is not loaded (command failed), {} when loaded
// but carrying no counted rules.
function parseCounters(jsonStr) {
    if (!jsonStr) return null;
    var map = {};
    try {
        var data = JSON.parse(jsonStr);
        (data.nftables || []).forEach(function(item) {
            var r = item.rule;
            if (!r || !r.comment || !Array.isArray(r.expr)) return;
            var c = null;
            r.expr.forEach(function(e) { if (e && e.counter) c = e.counter; });
            if (c) map[r.comment] = { packets: c.packets || 0, bytes: c.bytes || 0 };
        });
        return map;
    } catch (e) {
        return {};
    }
}

function cell(counters, comment) {
    var c = counters[comment];
    if (!c) return '—';
    return fmtBytes(c.bytes) + ' (' + c.packets + ' pkts)';
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('nft-limiter'),
            L.resolveDefault(fs.exec_direct('/usr/sbin/nft', NFT_ARGS), null)
        ]);
    },

    // Build the rows for one rendering pass.
    rows: function(counters) {
        var devices = uci.sections('nft-limiter', 'device');
        var rows = [];

        devices.forEach(function(dev, idx) {
            var target = dev.target || '—';
            var label = dev.comment ? (dev.comment + ' — ' + target) : target;
            var enabled = (dev.enable !== '0');
            rows.push([
                enabled ? label : (label + ' ' + _('(disabled)')),
                cell(counters, 'dev_' + idx + '_dl_pass'),
                cell(counters, 'dev_' + idx + '_dl'),
                cell(counters, 'dev_' + idx + '_ul_pass'),
                cell(counters, 'dev_' + idx + '_ul')
            ]);
        });

        // Global catch-all only counts dropped (over-limit) traffic.
        if (counters['default_dl'] || counters['default_ul']) {
            rows.push([
                E('em', {}, _('Global default limit')),
                '—',
                cell(counters, 'default_dl'),
                '—',
                cell(counters, 'default_ul')
            ]);
        }
        return rows;
    },

    renderTable: function(counters) {
        if (counters === null)
            return E('div', { 'class': 'alert-message warning' }, [
                _('The QoS chain is not loaded. Enable NFT Limiter on the Settings tab and Save & Apply.')
            ]);

        var rows = this.rows(counters);
        if (!rows.length)
            return E('div', { 'class': 'alert-message' }, [
                _('Chain loaded, but no device or global limit rules are active.')
            ]);

        var head = E('tr', { 'class': 'tr table-titles' }, [
            E('th', { 'class': 'th' }, _('Device')),
            E('th', { 'class': 'th' }, _('Down accepted')),
            E('th', { 'class': 'th' }, _('Down dropped')),
            E('th', { 'class': 'th' }, _('Up accepted')),
            E('th', { 'class': 'th' }, _('Up dropped'))
        ]);
        var body = rows.map(function(r) {
            return E('tr', { 'class': 'tr' }, r.map(function(c) {
                return E('td', { 'class': 'td' }, [c]);
            }));
        });
        return E('table', { 'class': 'table' }, [head].concat(body));
    },

    render: function(data) {
        var self = this;
        var container = E('div', {}, this.renderTable(parseCounters(data[1])));

        poll.add(function() {
            return L.resolveDefault(fs.exec_direct('/usr/sbin/nft', NFT_ARGS), null)
                .then(function(out) {
                    var fresh = self.renderTable(parseCounters(out));
                    container.parentNode.replaceChild(fresh, container);
                    container = fresh;
                });
        }, 5);

        return E('div', {}, [
            E('h2', {}, _('NFT Limiter Status')),
            E('p', {}, _('Live traffic accounting per rule. Counters reset whenever the rule set is rebuilt (service restart, or adding/editing a device).')),
            container
        ]);
    }
});
