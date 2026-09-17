# Contabilidade

Busca automática das notas fiscais eletrônicas emitidas **para o CNPJ da empresa**, direto no
Web Service oficial `NFeDistribuicaoDFe` do Ambiente Nacional da NF-e. Sem scraping, sem
automação de navegador, sem API de terceiro.

Projeto Firebase: `contabilidade-a9d35` · Repositório: https://github.com/paulosc/contabilidade

## Stack

| Camada   | Tecnologia                                                        |
| -------- | ----------------------------------------------------------------- |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4 (SPA em `web/`)     |
| Auth     | Firebase Authentication (e-mail/senha, Google, Apple)             |
| Banco    | Cloud Firestore, multi-tenant por empresa, região São Paulo       |
| Arquivos | Cloud Storage (XML das notas)                                     |
| Backend  | Cloud Functions gen2, Node 22, TypeScript (`functions/`)          |
| NF-e     | NFeDistribuicaoDFe / SEFAZ (adapter em `functions/src/providers/fiscal`) |

Documentação da integração: [`docs/FISCAL_NFE.md`](docs/FISCAL_NFE.md).

## Rodando localmente

Pré-requisitos: Node 22+, `npm i -g firebase-tools`, acesso ao projeto Firebase.

```bash
# frontend
cd web
cp .env.example .env.local   # preencha VITE_FIREBASE_API_KEY
npm install
npm run dev                  # http://localhost:5173

# backend
cd functions
cp .env.example .env
npm install
npm run build
npm test                     # 80 testes (node:test), sem emulador
npm run test:regras          # 17 testes de Security Rules no emulador (precisa de Java)
```

## Deploy

```bash
# uma vez: a chave que cifra os certificados A1
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
firebase functions:secrets:set FISCAL_CRYPTO_KEY

# regras e índices
firebase deploy --only firestore,storage

# frontend
cd web && npm run build && cd .. && firebase deploy --only hosting

# backend (exige plano Blaze)
firebase deploy --only functions
```

## Estrutura

```
.
├── web/                  # SPA React
│   └── src/
│       ├── auth/         # AuthProvider, guards de rota
│       ├── components/   # UI básica, diálogos, layout
│       ├── lib/          # firebase.ts, utils, helpers fiscais
│       ├── pages/        # login, onboarding, painel, notas fiscais, configurações
│       ├── services/     # hooks do Firestore em tempo real
│       └── types/        # tipos do domínio
├── functions/            # Cloud Functions
│   └── src/
│       ├── fiscal/       # certificado A1, NSU, sincronização, testes
│       ├── providers/    # integrações atrás de interfaces
│       └── triggers/     # claims de membro
├── docs/
├── firestore.rules       # segurança multi-tenant
├── storage.rules
└── firebase.json
```

## Como funciona, em uma linha

A empresa cadastra o certificado digital A1; de hora em hora uma Cloud Function consulta a
SEFAZ com esse certificado, respeitando as regras de NSU e a janela obrigatória de 1 hora, e
grava as notas no Firestore (metadados) e no Storage (XML). A tela acompanha por `onSnapshot`.
