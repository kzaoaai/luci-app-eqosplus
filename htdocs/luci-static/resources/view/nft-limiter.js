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
            network.getNetworks()
        ]);
    },

    render: function(data) {
        var hints = data[0];
        var nftOutput = data[2];
        var networks = data[3];
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

        o = s.option(form.Value, 'download', _('Global Download Limit (Mbit/s)'),
            _('Applies only to devices not covered by a per-device rule. Set to 0 for unlimited.'));
        o.datatype = 'ufloat';
        o.placeholder = '10';

        o = s.option(form.Value, 'upload', _('Global Upload Limit (Mbit/s)'),
            _('Applies only to devices not covered by a per-device rule. Set to 0 for unlimited.'));
        o.datatype = 'ufloat';
        o.placeholder = '5';

        o = s.option(form.MultiValue, 'iface', _('Rate-Limited Interfaces'),
            _('Select WAN / VPN interfaces whose traffic should be rate-limited. ' +
              'Traffic between local interfaces is never affected.'));
        o.default = 'wan';
        networks.forEach(function(net) {
            var name = net.getName();
            if (name !== 'loopback')
                o.value(name, name + ' (' + net.getI18n() + ')');
        });

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
        namedDevices.concat(unnamedDevices).forEach(function(d) { o.value(d.val, d.label); });
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

        // time start
        o = s.option(form.Value, 'timestart', _('Time Start'));
        o.placeholder = '00:00';
        o.editable = true;
        o.validate = function(section_id, value) {
            if (!value) return true;
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
                return _('Must be HH:MM (00:00–23:59)');
            return true;
        };

        // time end
        o = s.option(form.Value, 'timeend', _('Time End'));
        o.placeholder = '00:00';
        o.editable = true;
        o.validate = function(section_id, value) {
            if (!value) return true;
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
                return _('Must be HH:MM (00:00–23:59)');
            return true;
        };

        // weekday selector (none checked = every day)
        o = s.option(form.MultiValue, 'week', _('Days'));
        var weekDesc = _('Leave empty for every day.');
        var origWeekRender = o.render;
        o.render = function(option_index, section_id, in_table) {
            this.description = in_table ? null : weekDesc;
            return origWeekRender.apply(this, arguments);
        };
        o.value('1', _('Mon'));
        o.value('2', _('Tue'));
        o.value('3', _('Wed'));
        o.value('4', _('Thu'));
        o.value('5', _('Fri'));
        o.value('6', _('Sat'));
        o.value('7', _('Sun'));
        o.cfgvalue = function(section_id) {
            var val = uci.get('nft-limiter', section_id, 'week');
            if (!val || val === '0') return '';
            return val.replace(/,/g, ' ');
        };
        o.write = function(section_id, formvalue) {
            var val = Array.isArray(formvalue) ? formvalue.join(',') :
                      (formvalue ? String(formvalue).trim().replace(/\s+/g, ',') : '0');
            if (!val) val = '0';
            uci.set('nft-limiter', section_id, 'week', val);
        };
        o.remove = function(section_id) {
            uci.set('nft-limiter', section_id, 'week', '0');
        };
        o.textvalue = function(section_id) {
            var val = uci.get('nft-limiter', section_id, 'week');
            if (!val || val === '0') return _('Every day');
            var days = val.split(',').sort();
            var names = {'1':'Mon','2':'Tue','3':'Wed','4':'Thu','5':'Fri','6':'Sat','7':'Sun'};
            if (days.length === 7) return _('Every day');
            if (days.join(',') === '1,2,3,4,5') return _('Weekdays');
            if (days.join(',') === '6,7') return _('Weekend');
            return days.map(function(d) { return names[d] || d; }).join(', ');
        };

        // description / comment
        o = s.option(form.Value, 'comment', _('Comment'));
        o.placeholder = _('optional note');
        o.editable = true;

        return m.render();
    }
});
