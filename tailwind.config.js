/* Build-time only. Nothing loads this at runtime any more -- the pages link the
   compiled static/kusanagi.css instead of the Tailwind CDN, which is what lets the
   Content-Security-Policy drop 'unsafe-eval' and 'unsafe-inline'.

   Rebuild after touching any HTML class:  python scripts/build_css.py          */
module.exports = {
    content: ['./index.html', './web_apps/*.html', './static/**/*.js', './local_apps/*.html'],
    theme: {
        extend: {
            // Channels live in static/src/input.css (:root and the themes).
            colors: {
                primary: 'rgb(var(--rgb-primary) / <alpha-value>)',
                secondary: 'rgb(var(--rgb-secondary) / <alpha-value>)',
                tertiary: 'rgb(var(--rgb-tertiary) / <alpha-value>)',
                accent: 'rgb(var(--rgb-accent) / <alpha-value>)',
                'accent-hover': 'rgb(var(--rgb-accent-hover) / <alpha-value>)',
                'accent-fg': 'rgb(var(--rgb-accent-fg) / <alpha-value>)',
                'fg-primary': 'rgb(var(--rgb-fg-primary) / <alpha-value>)',
                'fg-secondary': 'rgb(var(--rgb-fg-secondary) / <alpha-value>)',
                success: 'rgb(var(--rgb-success) / <alpha-value>)',
                danger: 'rgb(var(--rgb-danger) / <alpha-value>)',
                border: 'rgb(var(--rgb-border) / <alpha-value>)',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'monospace'],
            },
        },
    },
};
