/* Build-time only. Nothing loads this at runtime any more -- the pages link the
   compiled static/kusanagi.css instead of the Tailwind CDN, which is what lets the
   Content-Security-Policy drop 'unsafe-eval' and 'unsafe-inline'.

   Rebuild after touching any HTML class:  python scripts/build_css.py          */
module.exports = {
    content: ['./index.html', './web_apps/*.html', './static/**/*.js', './local_apps/*.html'],
    theme: {
        extend: {
            colors: {
                primary: '#193549',
                secondary: '#002240',
                tertiary: '#25435A',
                accent: '#ffab40',
                'accent-hover': '#ffc371',
                'accent-fg': '#002240',
                'fg-primary': '#FFFFFF',
                'fg-secondary': '#97B1C2',
                success: '#3AD900',
                danger: '#ff8a8a',
                border: '#334155',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'monospace'],
            },
        },
    },
};
