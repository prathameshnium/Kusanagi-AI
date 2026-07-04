// Shared Tailwind config for all Kusanagi AI pages. Load after the Tailwind CDN script.
tailwind.config = {
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
