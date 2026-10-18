import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';

// Static-only loopback server. No upload, telemetry, accounts, or persistence endpoints.
const base=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const port=Number(process.env.WELFARE_PORT??4178);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2','.wasm':'application/wasm','.gz':'application/octet-stream'};
const csp="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host??'')){res.writeHead(403);res.end('Forbidden');return;}
  if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method not allowed');return;}
  let path;
  try{const pathname=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname);if(pathname.includes('\\')||pathname.includes('\0'))throw new Error();path=resolve(base,`.${pathname==='/'?'/index.html':pathname}`);if(!path.startsWith(base+sep))throw new Error();}
  catch{res.writeHead(400);res.end('Bad request');return;}
  try{const info=await stat(path);if(!info.isFile())throw new Error();res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Content-Length':info.size});if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(path);stream.on('error',()=>res.destroy());stream.pipe(res);}
  catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${port}`;process.stdout.write(`Social welfare workspace: ${url}\nKeep this window open. Close it to stop the local server.\n`);
  if(process.argv.includes('--open')&&process.platform==='win32')execFile('cmd.exe',['/c','start','',url],{windowsHide:true},()=>{});
});
server.on('error',error=>{process.stderr.write(`Local server error: ${error.code??'unknown'}\n`);process.exitCode=1;});
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
