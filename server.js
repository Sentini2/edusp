const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const KEYS_DB = path.join(__dirname, 'keys.json');
const UPDATE_FILE = path.join(__dirname, 'update.json');

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
server.listen(PORT, () => {
  console.log('✔ Servidor em http://localhost:' + PORT);
});
