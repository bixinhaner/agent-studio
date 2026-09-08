import { createServer } from 'node:http';
import { execute } from './bridge.js';
import type { BridgeRequest } from './protocol.js';
const token=process.env.AGENT_STUDIO_BRIDGE_TOKEN; if(!token) throw new Error('AGENT_STUDIO_BRIDGE_TOKEN is required');
const port=Number(process.env.AGENT_STUDIO_BRIDGE_PORT||8789);
const server=createServer(async(req,res)=>{if(req.method!=='POST'||req.url!=='/execute'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(404);res.end();return;} let body=''; req.on('data',c=>body+=c); req.on('end',async()=>{try{const result=await execute(JSON.parse(body) as BridgeRequest);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,result}));}catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:e instanceof Error?e.message:'BRIDGE_ERROR'}));}})});
server.listen(port,'127.0.0.1',()=>console.log(`Agent Studio Local Bridge listening on 127.0.0.1:${port}`));
