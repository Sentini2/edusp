/* Sukita DL · backend v3.3  (isolamento por chave/lab) */
const express = require('express');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const { v4: uuid } = require('uuid');
const { Server }   = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors:{origin:'*'} });

const PORT         = process.env.PORT || 3000;
const KEYS_DB      = path.join(__dirname, 'keys.json');
const UPDATE_FILE  = path.join(__dirname, 'update.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function loadKeys() {
  if (!fs.existsSync(KEYS_DB)) fs.writeFileSync(KEYS_DB, '{}');
  return JSON.parse(fs.readFileSync(KEYS_DB));
}

function saveKeys(data) {
  fs.writeFileSync(KEYS_DB, JSON.stringify(data, null, 2));
}

function gerarKey() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = () => Array.from({ length: 16 }, () => letras[Math.floor(Math.random() * letras.length)]).join('');
  return rnd().match(/.{1,4}/g).join('-');
}

function loadUpdate() {
  if (!fs.existsSync(UPDATE_FILE)) fs.writeFileSync(UPDATE_FILE, '{}');
  return JSON.parse(fs.readFileSync(UPDATE_FILE));
}

function saveUpdate(data) {
  fs.writeFileSync(UPDATE_FILE, JSON.stringify(data, null, 2));
}

app.get('/painel', (req, res) => {
  const keys = loadKeys();
  const upd = loadUpdate();

  res.send(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>Painel RV</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>body {padding: 30px;}</style>
  </head><body>
  <div class="container">
    <h3 class="mb-4">Painel de Licenças</h3>
    <form class="row g-2 mb-4" onsubmit="return salvarUpdate(event)">
      <div class="col"><input id="ver" required class="form-control" placeholder="Versão ex: 1.2" value="${upd.version || ''}"></div>
      <div class="col"><input id="url" required class="form-control" placeholder="URL do .exe" value="${upd.url || ''}"></div>
      <div class="col-auto"><button class="btn btn-primary">Salvar Atualização</button></div>
    </form>
    <div class="mb-4">
      <button class="btn btn-success me-2" onclick="gerar('semanal')">Gerar Semanal</button>
      <button class="btn btn-primary me-2" onclick="gerar('mensal')">Gerar Mensal</button>
      <button class="btn btn-warning me-2" onclick="gerar('anual')">Gerar Anual</button>
      <button class="btn btn-outline-danger" onclick="excluirTodas()">🗑️ Excluir TODAS</button>
    </div>
    <table class="table table-bordered table-sm align-middle shadow bg-white">
      <thead class="table-light"><tr>
        <th>Chave</th><th>Expira</th><th>HWID</th><th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>
        ${Object.entries(keys).map(([k,v])=>`
          <tr class="${v.status==='banned'?'table-danger':''}">
            <td class="font-monospace">${k}</td>
            <td>${v.expires ? new Date(v.expires).toLocaleDateString() : '<span class="text-success">Vitalícia</span>'}</td>
            <td class="font-monospace">
              ${v.hwid || '-'}<br>
              <small class="text-muted">${(v.hwids?.length || 0)} PC(s)</small>
            </td>
            <td>${v.status}</td>
            <td>
              <button class="btn btn-sm btn-outline-${v.status==='banned'?'secondary':'warning'} me-1" onclick="toggleBan('${k}')">${v.status==='banned'?'Desbanir':'Banir'}</button>
              <button class="btn btn-sm btn-outline-danger" onclick="excluir('${k}')">Excluir</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div id="saida" class="mt-3 text-success font-monospace"></div>
  </div>
  <script>
    async function gerar(tipo){
      const res = await fetch('/api/genkey', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({tipo})
      });
      const json = await res.json();
      document.getElementById('saida').innerText = 'Nova chave: ' + json.key;
      setTimeout(()=>location.reload(), 1000);
    }
    async function excluir(chave){
      if (!confirm('Excluir chave ' + chave + '?')) return;
      await fetch('/api/del/' + chave, { method:'DELETE' });
      location.reload();
    }
    async function excluirTodas(){
      if (!confirm('EXCLUIR TODAS as chaves?')) return;
      await fetch('/api/del_all', { method:'DELETE' });
      location.reload();
    }
    async function toggleBan(chave){
      await fetch('/api/toggle/' + chave, { method:'POST' });
      location.reload();
    }
    async function salvarUpdate(e){
      e.preventDefault();
      const version = document.getElementById('ver').value;
      const url     = document.getElementById('url').value;
      await fetch('/api/set_update', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({version, url})
      });
      alert('Atualização salva!');
    }
  </script>
  </body></html>`);
});

/* ──────────── API ───────────── */
app.post('/api/genkey', (req, res) => {
  const { tipo } = req.body;
  const dias = tipo === 'semanal' ? 7 : tipo === 'anual' ? 365 : 30;
  const expira = Date.now() + dias * 86400 * 1000;
  const key = gerarKey();
  const keys = loadKeys();
  keys[key] = { hwid: null, expires: expira, status: 'active', type: 'multi', hwids: [] };
  saveKeys(keys);
  res.json({ success: true, key, expires: expira });
});

app.post('/api/validate', (req, res) => {
  const { key, hwid } = req.body;
  const k = (key || '').toUpperCase();
  const db = loadKeys();
  const data = db[k];
  if (!data || data.status !== 'active') return res.status(403).json({ ok: false, reason: 'INVALID' });
  if (data.expires && Date.now() > data.expires) return res.status(403).json({ ok: false, reason: 'EXPIRED' });
  if (!Array.isArray(data.hwids)) data.hwids = [];
  if (hwid && !data.hwids.includes(hwid)) data.hwids.push(hwid);
  if (hwid) data.hwid = hwid;
  saveKeys(db);
  res.json({ ok: true, expires: data.expires, hwids: data.hwids.length });
});

app.delete('/api/del/:key', (req, res) => {
  const db = loadKeys();
  delete db[req.params.key.toUpperCase()];
  saveKeys(db);
  res.json({ ok: true });
});

app.delete('/api/del_all', (req, res) => {
  saveKeys({});
  res.json({ ok: true });
});

app.post('/api/toggle/:key', (req, res) => {
  const db = loadKeys();
  const k = req.params.key.toUpperCase();
  if (!db[k]) return res.status(404).json({ ok: false });
  db[k].status = db[k].status === 'banned' ? 'active' : 'banned';
  saveKeys(db);
  res.json({ ok: true });
});

app.post('/api/set_update', (req, res) => {
  const { version, url } = req.body;
  saveUpdate({ version, url });
  res.json({ ok: true });
});

/* ──────────── SOCKET.IO ───────────── */
const clients = new Map();

function summary(lab){
  return Array.from(clients.values())
              .filter(c => c.lab === lab)
              .map(c => ({
                uuid:c.uuid, ip:c.ip, ua:c.ua,
                connected_at:c.connected_at,
                location:c.location, hwinfo:c.hwinfo
              }));
}

function broadcastClients(){
  for(const s of io.sockets.sockets.values()){
    if(s.handshake.query.role === 'admin'){
      s.emit('clients', summary(s.data.lab));
    }
  }
}

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

/* ─── conexões socket.io ─── */
io.on('connection', socket=>{
  const role = socket.handshake.query.role;
  const lab  = (socket.handshake.query.lab || 'DEFAULT').toUpperCase();

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

/* ─── iniciar servidor ─── */
server.listen(PORT, ()=> console.log(`✔  http://localhost:${PORT}`));
