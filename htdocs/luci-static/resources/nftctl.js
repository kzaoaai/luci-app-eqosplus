'use strict';
'require baseclass';
'require dom';
'require fs';
'require ui';
'require poll';

// Shared "NFT Limiter Status" block: service state line + Enable / Disable /
// Restart controls. Rendered at the top of every subpage (Settings, Stats) so
// it is always visible, PBR-style. Self-loads and polls the nft chain.

// Stamped from the git tag at CI build time (see .github/workflows/build.yml).
var pkgVersion = '1.6.0';
var INIT = '/etc/init.d/nft-limiter';
var NFT_ARGS = ['-j', 'list', 'chain', 'inet', 'fw4', 'custom_qos_enforce'];

return baseclass.extend({
    pkgVersion: pkgVersion,
    NFT_ARGS: NFT_ARGS,

    // Resolve to the raw `nft -j list chain` output, or null if not loaded.
    probe: function() {
        return L.resolveDefault(fs.exec_direct('/usr/sbin/nft', NFT_ARGS), null);
    },

    // Run an init verb (on/off/reapply) then refresh the block.
    runAction: function(box, cmd) {
        var self = this;
        return fs.exec(INIT, [cmd]).then(function(res) {
            if (res && res.code !== 0)
                ui.addNotification(null, E('p', {}, [
                    _('Service command failed (exit %d): %s').format(res.code, (res.stderr || res.stdout || '').trim())
                ]), 'danger');
            return self.refresh(box);
        }).catch(function(e) {
            ui.addNotification(null, E('p', {}, [ _('Service command failed: ') + e ]), 'danger');
        });
    },

    refresh: function(box) {
        var self = this;
        return this.probe().then(function(out) { self.fill(box, out); });
    },

    // (Re)render the inner content of the status box for one pass. `out` is the
    // raw nft chain output (null when the chain is not loaded).
    fill: function(box, out) {
        var self = this;
        var loaded   = (out !== null);
        var stateTxt = loaded ? _('Running') : _('Stopped');
        var color    = loaded ? '#4CAF50' : '#f44336';

        // Summarise active rules from the chain comments (dev_<n>_*, default_*).
        var detail = null;
        if (loaded) {
            var seen = {}, m, re = /"comment":\s*"dev_(\d+)_/g;
            while ((m = re.exec(out)) !== null) seen[m[1]] = true;
            var n = Object.keys(seen).length;
            var parts = [];
            if (n > 0)
                parts.push(n + ' ' + _('device rule(s)'));
            if (/"comment":\s*"default_(dl|ul)"/.test(out))
                parts.push(_('global default limit active'));
            detail = parts.length ? parts.join(', ') : _('no rules loaded');
        }

        var btn = function(label, cls, cmd) {
            return E('button', {
                'class': 'cbi-button ' + cls,
                'click': ui.createHandlerFn(self, 'runAction', box, cmd)
            }, label);
        };

        dom.content(box, [
            E('div', {}, [
                E('strong', {}, 'nft-limiter v' + pkgVersion + ' — '),
                E('span', { 'style': 'color:' + color + ';font-weight:bold' }, stateTxt),
                ' (' + _('fw4 nft mode') + ')'
            ]),
            detail ? E('div', { 'style': 'color:#666;margin-top:.2em' }, detail) : '',
            E('div', { 'style': 'margin-top:.6em' }, [
                btn(_('Enable'),  'cbi-button-apply',    'on'),     ' ',
                btn(_('Disable'), 'cbi-button-negative', 'off'),    ' ',
                btn(_('Restart'), 'cbi-button-action',   'reapply')
            ])
        ]);
    },

    // Build the always-visible status section. Self-loads the real state and
    // polls every 5s.
    render: function() {
        var self = this;
        var box = E('div', { 'style': 'margin:.25em 0 1em' });
        self.fill(box, null);
        self.refresh(box);
        poll.add(function() { return self.refresh(box); }, 5);
        return E('div', { 'class': 'cbi-section' }, [
            E('h3', {}, _('NFT Limiter Status')),
            box
        ]);
    }
});
