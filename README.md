# AutomateFlow - Power Automate JSON Editor

Extensao para navegador (Chrome/Edge, Manifest V3) que detecta flows do Power Automate na aba ativa, captura a definicao JSON do flow e abre um editor alternativo completo com Monaco Editor (o mesmo editor do VS Code).

## O que faz

O AutomateFlow intercepta passivamente as chamadas de API feitas pelo portal do Power Automate (`make.powerautomate.com` / `flow.microsoft.com`) para capturar a definicao completa do flow. Quando a interceptacao passiva falha, ele tambem suporta busca ativa via API usando o token de autenticacao da sessao.

Com o JSON do flow capturado, voce pode:

- **Editar** o JSON completo com syntax highlighting, autocomplete e validacao em tempo real
- **Visualizar** a arvore de acoes do flow
- **Comparar** alteracoes com diff side-by-side (original vs. editado)
- **Importar/Exportar** definicoes de flow como arquivos `.json`
- **Salvar** as alteracoes de volta no Power Automate (com dialogo de confirmacao)

## Funcionalidades

| Funcionalidade | Descricao |
|---|---|
| Monaco Editor | Editor JSON completo com tema escuro, minimap, busca, substituicao e formatacao |
| Arvore (Tree View) | Visualizacao hierarquica das propriedades do JSON com filtro |
| Explorador de Acoes | Lista todas as acoes, triggers, condicoes, loops e scopes do flow com filtro e busca |
| Diff View | Comparacao lado-a-lado entre o JSON original e o editado usando Monaco Diff Editor |
| Visualizacao do Flow | Diagrama SVG do fluxo de acoes |
| Painel de Conexoes | Lista todos os conectores e conexoes referenciados no flow |
| Validacao JSON | Validacao em tempo real com indicadores na barra de status |
| Auto-Save | Salvamento automatico a cada 30 segundos no storage local do navegador |
| Importar/Exportar | Importacao e exportacao de arquivos JSON |
| Salvar no Power Automate | Envio das alteracoes de volta ao Power Automate via API com confirmacao |
| Interceptacao Inteligente | Captura passiva via patch de `fetch()`/`XHR` + busca ativa como fallback |
| Extracao de Token | Extrai tokens MSAL do sessionStorage/localStorage com validacao de JWT (expiracao, audience) |

## Pre-requisitos

- Google Chrome ou Microsoft Edge (versao 88+, com suporte a Manifest V3)
- Acesso ao Power Automate (`make.powerautomate.com` ou `flow.microsoft.com`)

## Como instalar

### Metodo 1 - Carregar extensao descompactada (Modo Desenvolvedor)

1. Baixe ou clone este repositorio:
   ```bash
   git clone https://github.com/gabriel1vale/AutomateFlow.git
   ```

2. Abra o navegador e acesse a pagina de extensoes:
   - **Chrome:** `chrome://extensions/`
   - **Edge:** `edge://extensions/`

3. Ative o **Modo do desenvolvedor** (toggle no canto superior direito)

4. Clique em **"Carregar sem compactacao"** (ou "Load unpacked")

5. Selecione a pasta `AutomateFlow` (a pasta que contem o `manifest.json`)

6. A extensao aparecera na barra de extensoes com o icone do AutomateFlow

> **Nota:** No modo desenvolvedor, o Chrome mostra um aviso na inicializacao sobre extensoes nao verificadas. Isso e normal e pode ser ignorado.

### Metodo 2 - Arquivo ZIP

1. Baixe o arquivo ZIP do repositorio
2. Extraia o conteudo em uma pasta
3. Siga os passos 2-6 do Metodo 1

## Como usar

### 1. Acessar um flow no Power Automate

Abra o Power Automate (`make.powerautomate.com`) e navegue ate a pagina de edicao de um flow. A URL deve conter o padrao:
```
/environments/{environmentId}/flows/{flowId}
```

### 2. Abrir o popup da extensao

Clique no icone do AutomateFlow na barra de extensoes. O popup vai mostrar um dos seguintes estados:

- **Flow detectado!** (verde) - O flow foi capturado automaticamente via interceptacao passiva
- **Flow identificado na URL** (amarelo) - O flow foi encontrado na URL, mas precisa ser capturado ativamente
- **Nenhum flow detectado** (amarelo) - Voce esta no Power Automate mas nao em uma pagina de flow
- **Extensao inativa** (vermelho) - Voce nao esta em uma pagina do Power Automate

### 3. Capturar o flow

- Se o status for verde, clique em **"Abrir Editor JSON"**
- Se o status for amarelo, clique em **"Capturar Flow"** para buscar via API, depois abra o editor

### 4. Usar o editor

O editor abre em uma janela popup separada com as seguintes abas:

| Aba | Funcao |
|---|---|
| **Editor** | Editor Monaco com o JSON completo do flow |
| **Arvore** | Visualizacao em arvore das propriedades (com filtro) |
| **Acoes** | Explorador de acoes com filtro por tipo (triggers, actions, conditions, loops, scopes) |
| **Diff** | Comparacao lado-a-lado entre original e editado |
| **Visualizar** | Diagrama SVG do fluxo de acoes (com zoom) |
| **Conexoes** | Lista de conectores e conexoes do flow |

### Barra de ferramentas

- **Formatar** - Formata o JSON com indentacao
- **Minificar** - Remove espacos e quebras de linha
- **Validar** - Verifica se o JSON e valido
- **Importar** - Carrega um arquivo `.json` do disco
- **Exportar** - Salva o JSON como arquivo `.json`
- **Copiar** - Copia o JSON para a area de transferencia
- **Salvar** (`Ctrl+S`) - Salva as alteracoes de volta no Power Automate (com confirmacao)

## Arquitetura

```
AutomateFlow/
├── manifest.json          # Manifesto V3 da extensao
├── background.js          # Service worker - gerencia estado e janela do editor
├── interceptor.js         # Content script (MAIN world) - intercepta fetch/XHR e tokens MSAL
├── content.js             # Content script (ISOLATED world) - ponte entre MAIN e extensao
├── popup.html / popup.js  # Interface do popup da extensao
├── editor.html            # Pagina do editor (abre em janela separada)
├── editor-loader.js       # Bootstrap do Monaco Editor (carregamento AMD)
├── editor.js              # Logica principal do editor (1800+ linhas)
├── editor.css             # Estilos Fluent UI dark theme
├── icons/                 # Icones da extensao (16, 48, 128px)
└── lib/monaco/vs/         # Monaco Editor (distribuicao AMD completa)
```

### Fluxo de dados

```
[Power Automate]
       |
       v
[interceptor.js] ---(window.postMessage)---> [content.js] ---(chrome.runtime)---> [background.js]
  (MAIN world)                                (ISOLATED world)                     (Service Worker)
  - Patch fetch/XHR                           - Ponte de mensagens                 - Armazena estado
  - Extrai tokens MSAL                        - Fetch ativo (fallback)             - Abre editor
       |                                                                                  |
       v                                                                                  v
[popup.js]                                                                    [editor.html + editor.js]
  - Mostra status                                                               - Monaco Editor
  - Inicia captura                                                              - Todas as abas/funcoes
  - Abre editor                                                                 - Salva de volta via API
```

## Tecnologias

- **Manifest V3** - Formato moderno de extensoes Chrome/Edge
- **Monaco Editor** - Editor de codigo do VS Code (distribuicao AMD)
- **Fluent UI** - Design system da Microsoft (tema escuro personalizado)
- **Chrome Extensions API** - Storage, Tabs, Scripting, Runtime messaging

## Seguranca

- A extensao **nao** armazena tokens de forma persistente - eles sao mantidos apenas em memoria durante a sessao
- Tokens JWT sao validados (expiracao, audience) antes do uso
- Em caso de 401/403, a extensao tenta renovar o token automaticamente
- O salvamento no Power Automate requer confirmacao explicita do usuario
- Content Security Policy: `script-src 'self'` - nenhum script inline e executado

## Solucao de problemas

| Problema | Solucao |
|---|---|
| Editor nao carrega (tela "Carregando...") | Verifique se a pasta `lib/monaco/vs/` existe e contem os arquivos do Monaco |
| Flow nao detectado | Recarregue a pagina do Power Automate e interaja com o designer antes de abrir o popup |
| Erro de token | Faca logout e login novamente no Power Automate, depois recarregue a pagina |
| Erro ao salvar | Verifique se o token nao expirou e se voce tem permissao para editar o flow |

## Licenca

MIT

## Autor

Gabriel Vale
