import './style.css'
import '@xterm/xterm/css/xterm.css'
import { mount } from 'svelte'
import App from './App.svelte'

export default mount(App, { target: document.getElementById('app')! })
