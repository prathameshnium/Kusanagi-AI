/* Kusanagi AI -- theme switch (black by default, or the blue theme).
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
        try { return window.localStorage.getItem(KEY) !== 'default'; } catch (e) { return true; }
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

    function icon(cls, d) {
        var svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'theme-toggle-icon ' + cls);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
        return svg;
    }

    var SUN = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z';
    var MOON = 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z';

    function mount() {
        // A small flip switch: sun on the left, moon on the right, the knob
        // sits over whichever theme is active.
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'switch');
        button.setAttribute('aria-label', 'Black mode');
        button.className = 'theme-toggle' + (document.querySelector('.home-button') ? '' : ' is-first');
        var knob = document.createElement('span');
        knob.className = 'theme-toggle-knob';
        button.appendChild(icon('is-sun', SUN));
        button.appendChild(icon('is-moon', MOON));
        button.appendChild(knob);
        function sync() {
            var on = isBlack();
            button.setAttribute('aria-checked', String(on));
            button.title = on ? 'Switch to the blue theme' : 'Switch to black mode';
        }
        button.addEventListener('click', function () { set(!isBlack()); sync(); });
        sync();
        // A page with a crowded top-left gives the toggle a place in its own
        // header; everywhere else it floats beside the home button.
        var slot = document.getElementById('theme-slot');
        if (slot) {
            button.classList.add('is-inline');
            slot.appendChild(button);
        } else {
            document.body.appendChild(button);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();

    window.Kusanagi.theme = { isBlack: isBlack, set: set };
})();
