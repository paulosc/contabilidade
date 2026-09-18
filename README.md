# Contabilidade

Sistema para escritório de contabilidade: o mesmo usuário atende várias empresas (os clientes) e
cada uma tem seus dados isolados. Tudo o que fala com o governo usa serviço oficial — sem scraping,
sem automação de navegador, sem API de terceiro.

Projeto Firebase: `contabilidade-a9d35` · Site: https://contabilidade-a9d35.web.app ·
Repositório: https://github.com/paulosc/contabilidade

## O que o sistema faz

| Módulo | O que faz | Onde está o código |
| --- | --- | --- |
| Carteira de clientes | Todas as empresas numa tela, com pendências de cada uma | `functions/src/escritorio/servico.ts` |
| Obrigações | Calendário por perfil fiscal, prazo ajustado para dia útil, checklist auditado | `functions/src/escritorio/calendario.ts` |
| Notas fiscais (NF-e) | Busca de hora em hora as NF-e emitidas para o CNPJ (`NFeDistribuicaoDFe`) | `functions/src/fiscal/sincronizacao.ts` |
| Notas de serviço (NFS-e) | Recebe pelo ADN nacional, importa do município (ABRASF), emite, substitui e cancela no SEFIN; o DANFSe é gerado aqui a partir do XML | `functions/src/fiscal/{sincronizacaoNfse,emissao,dps,danfse}.ts` |
| Simples Nacional | Conferência: RBT12, Fator R, alíquota efetiva, sublimite, ao lado do DAS oficial | `functions/src/escritorio/{simples,simplesTabelas}.ts` |
| Guias a pagar | Lê o PDF oficial de DAS/DARF ou pede a guia à Receita (Integra Contador/Serpro); recibo de honorários com PIX; link de 7 dias com confirmação de leitura | `functions/src/fiscal/{guias,guiasServico,serproServico,pix,reciboHonorarios}.ts` |
| Acompanhamento na Receita | Baixa automática de guias pagas, cabeçalhos da caixa postal do e-CAC, relatório de situação fiscal | `functions/src/fiscal/serproMonitor.ts` |
| Documentos | O escritório pede, o cliente envia, a equipe confere; arquivo por competência | `functions/src/escritorio/documentos.ts` |
| Contabilidade | Extrato OFX, conciliação com regras aprendidas, partidas dobradas, balancete, DRE, encerramento de período | `functions/src/contabil/` |
| Folha | Cálculo de INSS/IRRF/FGTS por vigência, holerite em PDF, 13º salário, lucros distribuídos por sócio (Lei 15.270/2025) | `functions/src/folha/` |
| Sandbox · Split payment | Simulador do recolhimento do IBS e da CBS na liquidação financeira (LC 214/2025, arts. 31 a 36); não grava nem envia nada | `functions/src/sandbox/` |
| Gestão do escritório | Contrato (Resolução CFC 1.590/2020), honorários recorrentes, equipe e acesso do cliente | `functions/src/escritorio/{contrato,gestao,membros}.ts` |

**Não faz, de propósito:** abrir o conteúdo de mensagem da caixa postal do e-CAC (pela API isso dá
ciência da intimação); calcular férias e rescisão; enviar ao eSocial/EFD-Reinf (só pesquisado); consultar FGTS
Digital, CRF, CNDT e DET (não têm API oficial).

## Princípios

- **Multiempresa**: tudo vive em `/empresas/{id}/...`. O `empresaId` que vem do navegador só diz de
  qual empresa se trata; quem autoriza é o backend, conferindo `/empresas/{id}/membros/{uid}`.
- **Papéis**: `admin` (tudo), `contador` e `assistente` (rotina do escritório), `cliente` (só guias,
  notas e documentos da própria empresa). Ver `exigirAdmin`, `exigirEquipe` e `exigirMembro` em
  `functions/src/fiscal/index.ts` e `ehAdmin`/`ehEquipe`/`ehMembro` em `firestore.rules`.
- **Segredos**: certificado A1, senha e chaves do Serpro ficam cifrados em `/empresas/{id}/privado`
  (negado a todo cliente) com a `FISCAL_CRYPTO_KEY` do Secret Manager. Nunca em `.env`, nunca em
  log, nunca no frontend.
- **Storage fechado**: nenhum arquivo é lido ou gravado direto pelo navegador; XML, PDF e documentos
  entram e saem por callable, que confere o vínculo e audita.
- **Regra fiscal só de fonte oficial**: cada tabela ou prazo cita a norma no próprio código, e os
  cálculos são funções puras com teste.
- **Requisição tarifada nunca roda sozinha**: tudo do Serpro é clique de administrador.

## Stack

| Camada   | Tecnologia                                                        |
| -------- | ----------------------------------------------------------------- |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4 (SPA em `web/`), `react-hook-form` + `zod` |
| Auth     | Firebase Authentication (e-mail/senha, Google, Apple)             |
| Banco    | Cloud Firestore, multi-tenant por empresa, região São Paulo       |
| Arquivos | Cloud Storage (XML, PDF e documentos), acessado só pelo backend   |
| Backend  | Cloud Functions gen2, Node 22, TypeScript (`functions/`), `southamerica-east1` |

Documentação da integração de NF-e/NFS-e: [`docs/FISCAL_NFE.md`](docs/FISCAL_NFE.md).

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
npm test                     # compila e roda os testes (node:test), sem emulador
npm run test:regras          # testes de Security Rules no emulador (precisa de Java)
```

## Deploy

No Windows, use o script da raiz — ele faz o build do site, roda os testes e publica:

```powershell
.\publicar.ps1                 # tudo: functions, firestore (regras e índices), storage, hosting
.\publicar.ps1 hosting         # só o site
.\publicar.ps1 "functions:emitirNfse,firestore:rules"
```

O script define `FUNCTIONS_DISCOVERY_TIMEOUT`, porque o Firebase CLI espera só 10 s para o código
das functions carregar e às vezes acusa `User code failed to load... Timeout after 10000` mesmo com
o código carregando em ~1,5 s.

Uma vez por projeto, a chave que cifra os certificados:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
firebase functions:secrets:set FISCAL_CRYPTO_KEY
```

## Estrutura

```
.
├── web/                  # SPA React
│   └── src/
│       ├── auth/         # AuthProvider, guards de rota
│       ├── components/   # UI básica, diálogos, layout
│       ├── lib/          # firebase.ts e helpers por assunto
│       ├── pages/        # escritorio/, contabil/, fiscal/, guias/, folha/, configuracoes/
│       ├── services/     # hooks do Firestore em tempo real
│       └── types/        # tipos do domínio
├── functions/            # Cloud Functions
│   └── src/
│       ├── fiscal/       # certificado, NF-e, NFS-e, guias, Serpro
│       ├── escritorio/   # carteira, obrigações, Simples, documentos, contrato, equipe
│       ├── contabil/     # OFX, plano de contas, razão, demonstrações
│       ├── folha/        # tabelas por vigência, cálculo, holerite, 13º, lucros
│       ├── sandbox/      # estudos isolados: simulador do split payment
│       ├── providers/    # integrações externas atrás de interfaces
│       └── triggers/     # espelho das empresas do usuário
├── docs/
├── publicar.ps1          # deploy no Windows
├── firestore.rules       # segurança multi-tenant
├── firestore.indexes.json
├── storage.rules
└── firebase.json
```
