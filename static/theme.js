/* Kusanagi AI -- theme switch (default blue, or black mode).
 *
 * Loaded without `defer`, straight after the stylesheet, so the saved theme is
 * on <html> before the first paint and the page never flashes blue. The choice
 * is a preference, not a secret, and lives in localStorage beside the others.
 */
window.Kusanagi = window.Kusanagi || {};

(function () {
    'use strict';

    var KEY = 'k_theme';
    var root = document.documentElement;

    function saved() {
        try { return window.localStorage.getItem(KEY) === 'black'; } catch (e) { return false; }
    }

    function isBlack() { return root.getAttribute('data-theme') === 'black'; }

    function apply(black) {
        if (black) root.setAttribute('data-theme', 'black');
        else root.removeAttribute('data-theme');
    }

    function set(black) {
        apply(black);
        try { window.localStorage.setItem(KEY, black ? 'black' : 'default'); } catch (e) { /* private mode */ }
    }

    apply(saved());

    var SVG = 'http://www.w3.org/2000/svg';

    function moon() {
        var svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS(SVG, 'path');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z');
        svg.appendChild(path);
        return svg;
    }

    function mount() {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'theme-toggle' + (document.querySelector('.home-button') ? '' : ' is-first');
        button.appendChild(moon());
        function sync() {
            var on = isBlack();
            button.setAttribute('aria-pressed', String(on));
            button.setAttribute('aria-label', on ? 'Black mode on. Switch to blue' : 'Switch to black mode');
            button.title = on ? 'Black mode: on' : 'Black mode: off';
        }
        button.addEventListener('click', function () { set(!isBlack()); sync(); });
        sync();
        document.body.appendChild(button);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();

    window.Kusanagi.theme = { isBlack: isBlack, set: set };
})();
