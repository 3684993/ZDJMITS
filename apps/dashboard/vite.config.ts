import { defineConfig } from 'vitest/config';import vue from '@vitejs/plugin-vue';
export default defineConfig({plugins:[vue()],server:{port:5173,proxy:{'/api':{target:'http://127.0.0.1:8080'},'/ws':{target:'ws://127.0.0.1:8080',ws:true}}},build:{target:'es2022'},test:{maxWorkers:4}});
