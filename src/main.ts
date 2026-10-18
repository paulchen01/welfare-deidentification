import { mountWelfareApp } from './welfare/app';
import './welfare/app.css';
const host = document.getElementById('app');
if (host) mountWelfareApp(host);
