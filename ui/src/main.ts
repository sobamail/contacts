import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { follow_color_scheme } from './lib/theme';

// the dark theme (the design system's [data-theme="dark"] tokens) while prefers-color-scheme
// answers dark: inside Sobamail that is Sobamail's theme, which the host emulates for its views
follow_color_scheme();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
