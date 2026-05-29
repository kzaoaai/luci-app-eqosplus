'use strict';
'require view';
'require form';
'require fs';
'require network';
'require uci';

return view.extend({
    load: function() {
        return Promise.all([
            network.getHostHints(),
            uci.load('nft-limiter'),
            L.resolveDefault(fs.exec_direct('/usr/sbin/nft', ['list', 'chain', 'inet', 'fw4', 'custom_qos_enforce']), null),
            network.getNetworks(),
            L.resolveDefault(fs.exec_direct('/sbin/ip', ['-j', 'neigh', 'show']), null)
        ]);
    },

    render: function(data) {
        var hints = data[0];
        var nftOutput = data[2];
        var networks = data[3];

        // Map of IP address -> kernel neighbour (ARP/NDP) state for a
        // simple online/offline dot next to each device in the dropdown.
        var neighState = {};
        if (data[4]) {
            try {
                JSON.parse(data[4]).forEach(function(n) {
                    if (n.dst && Array.isArray(n.state) && n.state.length)
                        neighState[n.dst] = n.state[0];
                });
            } catch (e) {}
        }
        var deviceLabel = function(text, ip) {
            var state = neighState[ip];
            var online = state && /^(REACHABLE|STALE|DELAY|PROBE|PERMANENT|NOARP)$/.test(state);
            return E('span', { 'title': state || _('not in neighbour table') }, [
                E('span', {
                    'style': 'display:inline-block;width:8px;height:8px;border-radius:50%;' +
                             'margin-right:6px;vertical-align:middle;background:' +
                             (online ? '#4CAF50' : '#bbb')
                }),
                text
            ]);
        };

        var activeDevices = 0;
        if (nftOutput) {
            var seen = {};
            var re = /comment "dev_(\d+)_/g;
            var match;
            while ((match = re.exec(nftOutput)) !== null)
                seen[match[1]] = true;
            activeDevices = Object.keys(seen).length;
        }
        var m, s, o;

        // HH:MM time field, shared by the global and per-device sections.
        var addTimeOption = function(section, name, label) {
            var opt = section.option(form.Value, name, label);
            opt.placeholder = '00:00';
            opt.editable = true;
            opt.validate = function(section_id, value) {
                if (!value) return true;
                if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
                    return _('Must be HH:MM (00:00–23:59)');
                return true;
            };
            return opt;
        };

        // Weekday selector (none checked = every day), shared by both sections.
        // UCI stores week as comma-separated day numbers, '0' meaning every day.
        var addWeekOption = function(section, label, desc) {
            var opt = section.option(form.MultiValue, 'week', label);
            opt.placeholder = _('Every day');
            var weekDesc = desc || _('Leave empty for every day.');
            var origWeekRender = opt.render;
            opt.render = function(option_index, section_id, in_table) {
                this.description = in_table ? null : weekDesc;
                return origWeekRender.apply(this, arguments);
            };
            opt.value('1', _('Mon'));
            opt.value('2', _('Tue'));
            opt.value('3', _('Wed'));
            opt.value('4', _('Thu'));
            opt.value('5', _('Fri'));
            opt.value('6', _('Sat'));
            opt.value('7', _('Sun'));
            opt.cfgvalue = function(section_id) {
                var val = uci.get('nft-limiter', section_id, 'week');
                if (!val || val === '0') return '';
                return val.replace(/,/g, ' ');
            };
            opt.write = function(section_id, formvalue) {
                var val = Array.isArray(formvalue) ? formvalue.join(',') :
                          (formvalue ? String(formvalue).trim().replace(/\s+/g, ',') : '0');
                if (!val) val = '0';
                uci.set('nft-limiter', section_id, 'week', val);
            };
            opt.remove = function(section_id) {
                uci.set('nft-limiter', section_id, 'week', '0');
            };
            opt.textvalue = function(section_id) {
                var val = uci.get('nft-limiter', section_id, 'week');
                if (!val || val === '0') return _('Every day');
                var days = val.split(',').sort();
                var names = {'1':'Mon','2':'Tue','3':'Wed','4':'Thu','5':'Fri','6':'Sat','7':'Sun'};
                if (days.length === 7) return _('Every day');
                if (days.join(',') === '1,2,3,4,5') return _('Weekdays');
                if (days.join(',') === '6,7') return _('Weekend');
                return days.map(function(d) { return names[d] || d; }).join(', ');
            };
            return opt;
        };

        m = new form.Map('nft-limiter', _('NFT Limiter'), _(
            'Per-device bandwidth control via nftables rate limiting. ' +
            'Requires OpenWrt 25.12+ with firewall4 / nftables.'
        ));

        // ------------------------------------------------------------------
        // Global settings section
        // ------------------------------------------------------------------
        s = m.section(form.TypedSection, 'nft-limiter', _('Global Settings'));
        s.anonymous = true;
        s.addremove = false;

        o = s.option(form.Flag, 'enabled', _('Enable NFT Limiter'));
        o.default = '0';
        o.rmempty = false;

        o = s.option(form.DummyValue, '_status', _('Service Status'));
        o.rawhtml = true;
        o.cfgvalue = function() {
            if (!nftOutput)
                return '<em style="color:#f44336">Inactive</em> — chain not loaded';
            var hasDefault = /comment "default_(dl|ul)"/.test(nftOutput);
            var parts = [];
            if (activeDevices > 0)
                parts.push(activeDevices + ' device rule(s)');
            if (hasDefault)
                parts.push('default limit active');
            return '<em style="color:#4CAF50">Active</em> — ' +
                (parts.length ? parts.join(', ') : 'chain loaded, no rules');
        };

        // Which interfaces are rate-limited (applies to per-device AND global rules).
        o = s.option(form.MultiValue, 'iface', _('Rate-Limited Interfaces'),
            _('Select WAN / VPN interfaces whose traffic should be rate-limited. ' +
              'Traffic between local interfaces is never affected.'));
        o.default = 'wan';
        networks.forEach(function(net) {
            var name = net.getName();
            if (name !== 'loopback')
                o.value(name, name + ' (' + net.getI18n() + ')');
        });

        // Toggle for the global default (catch-all) limit, backed by a real UCI
        // flag the engine honours. Initial state is inferred from existing limit
        // values so upgrades don't silently drop a configured global limit.
        o = s.option(form.Flag, 'glimit', _('Enable Global Default Limit'),
            _('Apply a fallback rate limit to all traffic not covered by a ' +
              'per-device rule. When off, only per-device rules apply.'));
        o.rmempty = false;
        o.default = '0';
        o.cfgvalue = function(section_id) {
            var v = uci.get('nft-limiter', section_id, 'glimit');
            if (v === '0' || v === '1') return v;
            var dl = parseFloat(uci.get('nft-limiter', section_id, 'download'));
            var ul = parseFloat(uci.get('nft-limiter', section_id, 'upload'));
            return ((dl > 0) || (ul > 0)) ? '1' : '0';
        };

        // Keep a gated field's stored value when it is merely collapsed by the
        // glimit toggle, so re-enabling restores the previous numbers. The
        // backend ignores these while glimit=0, so a remembered value is inert.
        // A genuine clear (field visible but emptied) still removes normally.
        var keepWhenCollapsed = function(opt) {
            var origRemove = opt.remove;
            opt.remove = function(section_id) {
                if (!this.isActive(section_id)) return;
                return origRemove.apply(this, arguments);
            };
            return opt;
        };

        o = s.option(form.Value, 'download', _('Global Download Limit (Mbit/s)'),
            _('Applies only to devices not covered by a per-device rule. Set to 0 for unlimited.'));
        o.datatype = 'ufloat';
        o.placeholder = '10';
        o.depends('glimit', '1');
        keepWhenCollapsed(o);

        o = s.option(form.Value, 'upload', _('Global Upload Limit (Mbit/s)'),
            _('Applies only to devices not covered by a per-device rule. Set to 0 for unlimited.'));
        o.datatype = 'ufloat';
        o.placeholder = '5';
        o.depends('glimit', '1');
        keepWhenCollapsed(o);

        // Schedule sub-toggle: reveals the time/day fields and is honoured by the
        // engine (off => global limit applies whenever enabled, all hours/days).
        // Initial state is inferred from an existing window so upgrades don't hide
        // a configured schedule.
        o = s.option(form.Flag, 'gschedule', _('Limit Only During Certain Times'),
            _('Restrict the global limit to a time window and/or specific days. ' +
              'When off, the global limit applies whenever it is enabled.'));
        o.rmempty = false;
        o.default = '0';
        o.depends('glimit', '1');
        o.cfgvalue = function(section_id) {
            var v = uci.get('nft-limiter', section_id, 'gschedule');
            if (v === '0' || v === '1') return v;
            var ts = uci.get('nft-limiter', section_id, 'timestart');
            var te = uci.get('nft-limiter', section_id, 'timeend');
            var wk = uci.get('nft-limiter', section_id, 'week');
            var hasWindow = (ts && ts !== '00:00') || (te && te !== '00:00');
            var hasDays = wk && wk !== '0';
            return (hasWindow || hasDays) ? '1' : '0';
        };

        keepWhenCollapsed(addTimeOption(s, 'timestart', _('Global Time Start'))).depends({ glimit: '1', gschedule: '1' });
        keepWhenCollapsed(addTimeOption(s, 'timeend', _('Global Time End'))).depends({ glimit: '1', gschedule: '1' });
        keepWhenCollapsed(addWeekOption(s, _('Global Days'),
            _('The global limit applies only inside this window/days; outside it, ' +
              'un-matched traffic is unrestricted. Leave times at 00:00 and days ' +
              'empty to always apply.'))).depends({ glimit: '1', gschedule: '1' });

        // ------------------------------------------------------------------
        // Per-device rules section
        // ------------------------------------------------------------------
        s = m.section(form.GridSection, 'device', _('Per-Device Rules'));
        s.anonymous = true;
        s.addremove = true;
        s.sortable  = true;
        s.nodescription = true;

        // enable toggle
        o = s.option(form.Flag, 'enable', _('On'));
        o.default = '1';
        o.rmempty = false;
        o.editable = true;

        o = s.option(form.Value, 'target', _('Device (IP / Range)'));
        o.rmempty   = false;
        o.editable  = true;
        o.datatype  = 'or(ipmask4, ipmask6, ip4addr, "")';
        o.placeholder = _('IP, CIDR, or IP range (a.b.c.d-e.f.g.h)');
        var namedDevices = [], unnamedDevices = [];
        hints.getMACHints().forEach(function(entry) {
            var mac  = entry[0];
            var name = hints.getHostnameByMACAddr(mac) || '';
            var ip   = hints.getIPAddrByMACAddr(mac);
            var ip6  = hints.getIP6AddrByMACAddr(mac);
            var addr = ip || ip6;
            if (!addr) return;
            var list = name ? namedDevices : unnamedDevices;
            list.push({ val: addr, label: name ? (name + ' \u2014 ' + addr) : addr, named: !!name, ip: addr });
        });
        namedDevices.sort(function(a, b) {
            return a.label.toLowerCase() < b.label.toLowerCase() ? -1
                 : a.label.toLowerCase() > b.label.toLowerCase() ? 1 : 0;
        });
        unnamedDevices.sort(function(a, b) {
            var aParts = (a.ip || a.val).split('.').map(Number);
            var bParts = (b.ip || b.val).split('.').map(Number);
            for (var i = 0; i < 4; i++) {
                if ((aParts[i] || 0) !== (bParts[i] || 0))
                    return (aParts[i] || 0) - (bParts[i] || 0);
            }
            return a.val < b.val ? -1 : a.val > b.val ? 1 : 0;
        });
        namedDevices.concat(unnamedDevices).forEach(function(d) { o.value(d.val, deviceLabel(d.label, d.ip)); });
        o.textvalue = function(section_id) {
            var val = this.cfgvalue(section_id);
            if (!val) return '';
            var name = hints.getHostnameByIPAddr(val)
                    || hints.getHostnameByIP6Addr(val);
            if (name) return name + ' \u2014 ' + val;
            return val;
        };

        // download limit
        o = s.option(form.Value, 'download', _('Down (Mbit/s)'));
        o.datatype = 'ufloat';
        o.placeholder = '0';
        o.editable = true;

        // upload limit
        o = s.option(form.Value, 'upload', _('Up (Mbit/s)'));
        o.datatype = 'ufloat';
        o.placeholder = '0';
        o.editable = true;

        // time start / end
        addTimeOption(s, 'timestart', _('Time Start')).width = '8%';
        addTimeOption(s, 'timeend', _('Time End')).width = '8%';

        // weekday selector (none checked = every day), editable inline in the grid
        o = addWeekOption(s, _('Days'));
        o.editable = true;

        // description / comment
        o = s.option(form.Value, 'comment', _('Comment'));
        o.placeholder = _('optional note');
        o.editable = true;
        o.width = '20%';

        return m.render();
    }
});
