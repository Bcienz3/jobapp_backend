# JobApp - Back-end

API REST (Node.js, Express, SQLite) per l'app Flutter bacheca annunci di lavoro.

## Requisiti
- Node.js

## Avvio

```bash
npm install
node server.js
```

Il server ascolta sulla porta 3000. Il database (`jobboard.db`) e la cartella `uploads/` vengono creati automaticamente al primo avvio.

## Endpoint principali
- `POST /register`, `POST /login`: registrazione e login azienda
- `GET /jobs`, `GET /jobs/:id`: bacheca pubblica
- `POST /jobs`, `GET /my-jobs`, `GET /jobs/:id/applications`: area azienda (richiedono token)
- `POST /jobs/:id/apply`: candidatura con upload del curriculum

## Front-end
L'app Flutter che usa queste API è nel repository: https://github.com/Bcienz3/jobboard_app
