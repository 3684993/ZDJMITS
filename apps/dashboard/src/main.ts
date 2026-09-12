import { createApp } from 'vue';import { createPinia } from 'pinia';import App from './App.vue';import router from './router';import './styles.css';
document.documentElement.dataset.theme=localStorage.getItem('zdj-theme')??'BURGUNDY_EDITORIAL';
import './theme-tokens.css';
import './position-console.css';
import './financial-semantics.css';
import { RELEASE_LABEL } from '@zdj/contracts';
document.title=RELEASE_LABEL;
createApp(App).use(createPinia()).use(router).mount('#app');
