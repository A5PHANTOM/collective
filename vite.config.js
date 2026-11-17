import {defineConfig} from 'vite';
export default defineConfig({publicDir:false,server:{proxy:Object.fromEntries(['/api','/sw.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'].map(path=>[path,'http://127.0.0.1:8000']))},build:{target:'safari15',sourcemap:false}});
