# Integração fiscal — NF-e / SEFAZ

Busca automática dos documentos fiscais eletrônicos emitidos **para o CNPJ da empresa**,
direto no Web Service oficial `NFeDistribuicaoDFe` do Ambiente Nacional da NF-e.

Sem scraping, sem automação de navegador, sem API de terceiro: só o serviço oficial, com o
certificado digital A1 da própria empresa.

## Documentação oficial usada

Tudo que está implementado vem destes documentos (conferidos antes de escrever o código):

| O que | Onde |
| --- | --- |
| Regras do serviço, leiautes, códigos de retorno, regras de uso indevido | **Nota Técnica 2014.002 v1.40** (julho/2026), Portal Nacional da NF-e → Documentos → Notas Técnicas |
| Schemas `distDFeInt_v1.01.xsd`, `retDistDFeInt_v1.01.xsd`, `resNFe_v1.01.xsd`, `resEvento_v1.01.xsd`, `tiposDistDFe_v1.01.xsd` | **Pacote de Liberação Distribuição de DF-e v1.04** (`PL_NFeDistDFe_104`), Portal → Documentos → Esquemas XML |
| Endereços dos Web Services | Portal → Serviços → **Relação de Serviços Web**, seção "Ambiente Nacional - (AN)" (produção) e o mesmo caminho no Portal de Homologação |

Valores confirmados nessas fontes e usados em `functions/src/providers/fiscal/sefazNacional.ts`:

```
Serviço      NFeDistribuicaoDFe          (versão 1.00 na relação de serviços)
Método       nfeDistDFeInteresse         (processo síncrono)
Leiaute      versao="1.01"               (único valor do tipo TVerDistDFe)
Namespace    http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe   (serviço)
             http://www.portalfiscal.inf.br/nfe                            (área de dados)
soapAction   http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse
Produção     https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
Homologação  https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
```

Detalhes que a NT impõe e que o adapter respeita:

- XML **sempre em UTF-8** e **sem prefixo de namespace** na área de dados (regra D02 → rejeição 404);
- área de dados de no máximo **10 KB** (regra B01 → rejeição 214);
- transmissão com **certificado ICP-Brasil** e autenticação de cliente (TLS mútuo);
- o CNPJ consultado precisa ter a **mesma raiz (8 primeiras posições)** do CNPJ do certificado
  (regra H04 → rejeição 593);
- lote de **até 50 documentos**, cada um em `docZip` = base64 de um conteúdo **gzip**;
- documentos ficam disponíveis por **90 dias** após a recepção pelo Ambiente Nacional.

> O envelope SOAP sai na versão 1.2 (que é a do binding do WSDL) e cai automaticamente para
> SOAP 1.1 — o formato do exemplo da própria NT — se o servidor responder HTTP 415.

## Fluxo

```
IMOBILIÁRIA ──▶ CNPJ + certificado A1 ──▶ validação (backend)
                                              │
                            Cloud Scheduler ──┼──▶ Cloud Function (gen2, southamerica-east1)
                                              │         │
                                              │         ▼
                                              │   NFeDistribuicaoDFe (mTLS, SOAP)
                                              │         │
                                              │         ▼
                                              │   Ambiente Nacional NF-e/SEFAZ
                                              │         │
                                              ▼         ▼
                                    Firestore (metadados)  Storage (XML)
                                              │
                                              ▼  onSnapshot
                                         Interface web
```

## Controle de NSU

O NSU é **por CNPJ**, nunca global. Cada empresa guarda o seu em
`/empresas/{id}/configuracoes/fiscal.sincronizacao`.

```
ultimoNsu ──▶ distNSU ──▶ resposta ──▶ grava documentos ──▶ atualiza ultimoNsu
                                              │
                                    ultNSU < maxNSU ? ──sim──▶ repete (até FISCAL_MAX_LOTES)
                                              │
                                             não
                                              │
                                              ▼
                                   proximaPermitidaEm = agora + 1 h
```

Regras de "uso indevido" (NT, item 3.11.4) que o código obedece — desobedecer bloqueia o CNPJ
por uma hora com a rejeição **656**:

| Retorno | O que fazemos |
| --- | --- |
| `138` documento(s) localizado(s) | grava o lote, avança para o `ultNSU` devolvido e continua |
| `138` com `ultNSU == maxNSU` | grava o lote e **para**; próxima consulta só depois de 1 h |
| `137` nenhum documento | para; próxima consulta só depois de 1 h |
| `656` consumo indevido | marca `bloqueado`, espera 1 h e reaproveita o `ultNSU` que a rejeição traz (NT v1.14) |
| `589` NSU maior que o da SEFAZ | reposiciona o controle no `maxNSU` devolvido |
| `108` / `109` serviço paralisado | não mexe no NSU e tenta de novo em 30 min |
| demais rejeições | para, guarda código e motivo, mostra na tela |

A consulta usada no botão **Testar conexão** é `consNSU` (pontual), nunca `distNSU` fora de
sequência — justamente para não cair no 656. A consulta pontual tem limite de 20 por hora.

## Idempotência

- o documento da nota usa a **chave de acesso como id**, então o mesmo documento nunca duplica;
- o XML só sobe de novo para o Storage quando o **hash SHA-256** muda;
- um **resumo** que chegue depois da NF-e completa não rebaixa o registro (só anota o `nsuResumo`);
- eventos são deduplicados por `tpEvento_nSeqEvento`;
- o `ultimoNsu` só avança **depois** de gravar o lote: se a execução morrer no meio, o lote se repete.

## Concorrência

Uma sincronização por empresa de cada vez. A trava fica no próprio documento de configuração
(`sincronizacao.status = 'executando'` + `lockEm` + `lockPor`) e é tomada dentro de uma transação.
Trava com mais de 10 minutos é considerada órfã (function morta, timeout, deploy no meio) e pode
ser retomada; a trava é renovada a cada lote numa varredura longa.

## Segurança do certificado

O certificado A1 carrega a chave privada da empresa. O desenho é de *envelope encryption*:

1. a chave mestra (32 bytes) fica no **Secret Manager**, declarada com `defineSecret('FISCAL_CRYPTO_KEY')`
   — o mesmo padrão já usado para `ASAAS_API_KEY`, `SICOOB_CERT_PFX_BASE64` etc.;
2. o `.pfx` **e** a senha são cifrados com AES-256-GCM usando essa chave;
3. o material cifrado vai para `/empresas/{id}/privado/fiscal`, documento que as Rules negam
   para qualquer cliente (`match /privado/{doc=**} { allow read, write: if false }`);
4. a senha nunca volta para o frontend, nunca é gravada em claro e nunca entra em log;
5. só o resumo (titular, validade, emissor, impressão digital) aparece em
   `/empresas/{id}/configuracoes/fiscal`, que é somente leitura para o cliente.

**Por que não um segredo por empresa no Secret Manager:** ele é dimensionado para configuração
do projeto, não para dado de tenant — cada segredo precisaria ser criado/destruído por API, entra
na cota do projeto e teria de ser declarado em `secrets:` no deploy, que é estático. A chave mestra
única + material cifrado por tenant é o equivalente seguro que escala para N empresas.

Gerando a chave:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
firebase functions:secrets:set FISCAL_CRYPTO_KEY
```

> Trocar a `FISCAL_CRYPTO_KEY` invalida os certificados já guardados: cada empresa precisa
> enviar o `.pfx` de novo. A tela mostra o erro certo quando isso acontece.

## Parâmetros

`functions/.env` (veja `functions/.env.example`):

| Parâmetro | Padrão | Para quê |
| --- | --- | --- |
| `SEFAZ_AMBIENTE` | `homologacao` | ambiente sugerido ao cadastrar o certificado (cada empresa pode escolher o seu) |
| `FISCAL_MAX_EMPRESAS` | `10` | quantas empresas uma execução do worker processa |
| `FISCAL_MAX_LOTES` | `20` | quantos lotes de 50 documentos uma sincronização busca antes de parar e retomar depois |

## Functions

| Nome | Tipo | Quem pode |
| --- | --- | --- |
| `salvarCertificadoFiscal` | callable | admin da empresa |
| `removerCertificadoFiscal` | callable | admin |
| `ativarIntegracaoFiscal` | callable | admin |
| `testarConexaoFiscal` | callable | admin |
| `sincronizarFiscalAgora` | callable | qualquer membro |
| `statusFiscal` | callable | qualquer membro |
| `xmlNotaFiscal` | callable | qualquer membro (registra quem baixou) |
| `sincronizarFiscalPeriodico` | agendada, de hora em hora | Cloud Scheduler |

Nenhuma delas aceita `empresaId` do cliente: o tenant sai sempre do uid autenticado
(`/usuarios/{uid}.empresaId` + `/empresas/{id}/membros/{uid}`).

## Telas

- **Configurações → Integração fiscal (NF-e)**: cadastro do certificado, ambiente, CNPJ, UF,
  painel com situação, validade, última sincronização, último NSU, notas encontradas/processadas
  e erros, e os botões *Testar conexão*, *Sincronizar agora*, *Ativar/Desativar*, *Remover certificado*.
- **Notas fiscais** (`/notas-fiscais`): listagem com filtros de período, fornecedor, CNPJ, número,
  chave e status; detalhe com itens (código, descrição, NCM, CFOP, unidade, quantidade, valores),
  eventos e download do XML.

As duas acompanham o Firestore por `useDocumento`/`useColecao` (`onSnapshot`): quando a Cloud
Function grava, a tela atualiza sozinha. Não há polling.

## Testes

```bash
cd functions && npm test          # unitários, sem emulador
cd functions && npm run test:regras   # Security Rules, no emulador do Firestore
```

Os unitários rodam no `node:test` (embutido no Node 22). Cobrem:

- **certificado**: válido, expirado, senha incorreta, arquivo inválido, cifragem/decifragem,
  chave errada, pacote adulterado;
- **SEFAZ**: resposta válida, sem documentos, vários documentos, rejeição, erro temporário,
  timeout, erro de autenticação (403), indisponibilidade (5xx), falha SOAP, fallback SOAP 1.2→1.1,
  formato exato da requisição (namespaces, `tpAmb`, `cUFAutor`, `distNSU`/`consNSU`/`consChNFe`);
- **NSU**: primeira consulta, consulta incremental, vários lotes, parada em `ultNSU == maxNSU`,
  retomada após erro, reposicionamento no 589 e no 656;
- **multi-tenancy**: caminho de XML de outra empresa é negado, caminho arbitrário do cliente
  é negado, raiz de CNPJ diferente da do certificado é recusada.

`npm run test:regras` levanta o emulador do Firestore (precisa de Java) e roda as Security
Rules de verdade, provando que:

- a empresa A não lê nem escreve notas, sincronizações ou configuração fiscal da empresa B;
- visitante sem login não lê nada;
- `/privado/fiscal` (o certificado) é inacessível para qualquer cliente, inclusive o administrador
  da própria empresa;
- notas, sincronizações e auditoria são só leitura — quem grava é o backend;
- `configuracoes/fiscal` é só leitura para o cliente, enquanto os demais documentos de
  configuração continuam editáveis pelo administrador;
- a auditoria fiscal só o administrador enxerga.

## Limites conhecidos

- A SEFAZ só distribui documentos dos **últimos 90 dias**; nota mais antiga não é recuperável.
- Para o **destinatário**, a NF-e completa só é liberada **depois da manifestação do destinatário**
  (Ciência da Operação, Confirmação ou Operação não Realizada). Antes disso chega só o resumo —
  por isso a tela mostra "Aguardando XML". O envio de manifestação usa outro Web Service
  (`RecepcaoEvento`) e não faz parte deste módulo.
- Empresa que não usa o `distNSU` por mais de 60 dias tem a geração de NSU interrompida; o primeiro
  acesso depois disso volta `137` e só as consultas seguintes (respeitando a hora) trazem documentos.
