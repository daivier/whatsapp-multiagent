# Checklist de Testes Manuais — Sistema WhatsApp Multi-Atendente

> **Versão:** 1.0  
> **Data:** 2026-05-25  
> **Stack:** Express + SQLite (better-sqlite3) · React + Vite · Baileys (multi-linha) · Socket.io · PM2  
> **Convenções:**  
> - `[ ]` = não testado  `[x]` = passou  `[F]` = falhou  
> - **RE:** = Resultado Esperado  
> - Todos os testes assumem ambiente local/staging com dados de teste limpos  

---

## Índice

1. [Autenticação](#1-autenticação)
2. [Gestão de Utilizadores](#2-gestão-de-utilizadores)
3. [Departamentos](#3-departamentos)
4. [Linhas WhatsApp](#4-linhas-whatsapp)
5. [Contactos](#5-contactos)
6. [Lista de Conversas](#6-lista-de-conversas)
7. [Chat — Funcionalidades Gerais](#7-chat--funcionalidades-gerais)
8. [Chat — Ficheiros e Mídia](#8-chat--ficheiros-e-mídia)
9. [Chat — Ações sobre a Conversa](#9-chat--ações-sobre-a-conversa)
10. [Funcionalidades em Tempo Real (Socket.io)](#10-funcionalidades-em-tempo-real-socketio)
11. [Bot Automático](#11-bot-automático)
12. [Avaliação (Rating)](#12-avaliação-rating)
13. [Mensagens Agendadas](#13-mensagens-agendadas)
14. [Operações em Massa (Bulk)](#14-operações-em-massa-bulk)
15. [Administração (Owner)](#15-administração-owner)
16. [Segurança e Permissões](#16-segurança-e-permissões)
17. [WhatsApp — Tipos de Mensagem](#17-whatsapp--tipos-de-mensagem)
18. [Routing Linha → Departamento](#18-routing-linha--departamento)
19. [Nova Conversa Outbound](#19-nova-conversa-outbound)

---

## 1. Autenticação

### 1.1 Login

- [ ] **TC-AUTH-001** — Login com credenciais válidas (owner)
  - Passos: Aceder `/login`, inserir e-mail e senha corretos do owner, clicar "Entrar"
  - RE: Redireciona para `/` (dashboard), token JWT armazenado em localStorage/cookie, nome do utilizador visível no header

- [ ] **TC-AUTH-002** — Login com credenciais válidas (atendente)
  - Passos: Fazer login com conta de atendente ativo
  - RE: Redireciona para lista de conversas, painel admin NÃO visível no menu

- [ ] **TC-AUTH-003** — Login com senha incorreta
  - Passos: Inserir e-mail correto e senha errada
  - RE: Mensagem de erro "Credenciais inválidas" ou equivalente; não redireciona; token NÃO gerado

- [ ] **TC-AUTH-004** — Login com e-mail inexistente
  - Passos: Inserir e-mail que não existe no sistema
  - RE: Mensagem de erro genérica (não revelando se o e-mail existe ou não); não redireciona

- [ ] **TC-AUTH-005** — Login com campos em branco
  - Passos: Submeter formulário com e-mail e/ou senha vazios
  - RE: Validação de formulário impede submissão, mensagem de campo obrigatório visível

- [ ] **TC-AUTH-006** — Login com conta de atendente desativada
  - Passos: Tentar login com atendente cujo `is_active = false`
  - RE: Mensagem "Conta desativada" ou equivalente; acesso negado

- [ ] **TC-AUTH-007** — Token JWT expirado
  - Passos: Autenticar, manipular o token para expirar (ou aguardar expiração), fazer request autenticado
  - RE: API retorna 401; frontend redireciona para `/login`

- [ ] **TC-AUTH-008** — Token JWT inválido/corrompido
  - Passos: Substituir manualmente o token no localStorage por string aleatória, navegar para rota protegida
  - RE: API retorna 401; frontend redireciona para `/login`

- [ ] **TC-AUTH-009** — Request sem token
  - Passos: Chamar endpoint protegido (ex.: `GET /api/conversations`) sem cabeçalho Authorization
  - RE: API retorna 401 com mensagem adequada

### 1.2 Logout

- [ ] **TC-AUTH-010** — Logout normal
  - Passos: Estar autenticado, clicar no botão "Sair" / "Logout"
  - RE: Token removido do storage, redireciona para `/login`, acesso às rotas protegidas bloqueado

- [ ] **TC-AUTH-011** — Acesso a rota protegida após logout
  - Passos: Fazer logout, tentar aceder manualmente a `/conversations` pela barra de endereços
  - RE: Redireciona para `/login`

### 1.3 Papéis (Roles)

- [ ] **TC-AUTH-012** — Owner acede ao painel de administração
  - Passos: Autenticar como owner, navegar para `/admin`
  - RE: Painel carrega normalmente com todas as opções de admin

- [ ] **TC-AUTH-013** — Atendente tenta aceder ao painel admin via URL direta
  - Passos: Autenticar como atendente, navegar para `/admin` na barra de endereços
  - RE: Redireciona para página de "sem permissão" ou para a lista de conversas; conteúdo admin não renderizado

- [ ] **TC-AUTH-014** — Endpoint admin chamado com token de atendente
  - Passos: Pegar token de atendente, chamar `GET /api/admin/users` com esse token
  - RE: API retorna 403 Forbidden

---

## 2. Gestão de Utilizadores

### 2.1 Criar Atendente

- [ ] **TC-USR-001** — Owner cria novo atendente com dados válidos
  - Passos: Admin > Utilizadores > "Novo Atendente", preencher nome, e-mail, senha, papel "attendant", clicar Salvar
  - RE: Atendente aparece na lista, pode fazer login com as credenciais criadas

- [ ] **TC-USR-002** — Criar atendente com e-mail duplicado
  - Passos: Tentar criar atendente com e-mail já cadastrado
  - RE: Erro "E-mail já em uso" ou equivalente; atendente NÃO criado

- [ ] **TC-USR-003** — Criar atendente com campos obrigatórios em branco
  - Passos: Submeter formulário sem nome ou sem e-mail
  - RE: Validação bloqueia submissão com mensagem de campo obrigatório

- [ ] **TC-USR-004** — Criar atendente com senha fraca (se houver validação)
  - Passos: Inserir senha com menos caracteres do que o mínimo definido
  - RE: Erro de validação de senha visível

### 2.2 Editar Atendente

- [ ] **TC-USR-005** — Editar nome do atendente
  - Passos: Admin > Utilizadores > Editar, alterar nome, salvar
  - RE: Nome atualizado na lista e no header do atendente ao relogar

- [ ] **TC-USR-006** — Editar e-mail do atendente para e-mail já existente
  - Passos: Editar e-mail de um atendente para o e-mail de outro já cadastrado
  - RE: Erro de e-mail duplicado; e-mail NÃO atualizado

- [ ] **TC-USR-007** — Alterar senha do atendente pelo owner
  - Passos: Admin > Utilizadores > Editar > campo de nova senha, salvar
  - RE: Atendente consegue fazer login com a nova senha; senha antiga rejeitada

### 2.3 Status do Atendente

- [ ] **TC-USR-008** — Atendente muda o próprio status para "online"
  - Passos: Autenticar como atendente, clicar no seletor de status no header, escolher "Online"
  - RE: Status atualizado na API; ícone muda para verde

- [ ] **TC-USR-009** — Atendente muda status para "busy"
  - Passos: Selecionar "Ocupado" no seletor de status
  - RE: Status `busy` gravado; ícone muda para cor correspondente

- [ ] **TC-USR-010** — Atendente muda status para "away"
  - Passos: Selecionar "Ausente" no seletor de status
  - RE: Status `away` gravado

- [ ] **TC-USR-011** — Atendente muda status para "offline"
  - Passos: Selecionar "Offline" no seletor de status
  - RE: Status `offline` gravado; atendente não recebe novas atribuições automáticas

- [ ] **TC-USR-012** — Owner altera status de atendente via painel admin
  - Passos: Admin > Utilizadores > editar atendente, alterar campo status, salvar
  - RE: Status atualizado

### 2.4 Turno (on_shift)

- [ ] **TC-USR-013** — Owner ativa `on_shift` de um atendente
  - Passos: Admin > Utilizadores > toggle `on_shift` = true
  - RE: Campo `on_shift` gravado; atendente elegível para atribuição automática

- [ ] **TC-USR-014** — Owner desativa `on_shift` de atendente
  - Passos: Toggle `on_shift` = false
  - RE: Atendente não recebe novas conversas por atribuição automática

### 2.5 Desativar Atendente

- [ ] **TC-USR-015** — Owner desativa conta de atendente
  - Passos: Admin > Utilizadores > Desativar/Arquivar atendente
  - RE: `is_active = false`; atendente não consegue fazer login; conversas existentes permanecem

- [ ] **TC-USR-016** — Owner reativa conta de atendente desativada
  - Passos: Admin > Utilizadores > reativar atendente previamente desativado
  - RE: `is_active = true`; atendente consegue fazer login novamente

### 2.6 Permissões de Visibilidade

- [ ] **TC-USR-017** — Atendente NÃO vê outros atendentes
  - Passos: Autenticar como atendente, chamar `GET /api/users` ou verificar painel
  - RE: Lista de utilizadores não retorna outros atendentes (apenas owner vê todos)

---

## 3. Departamentos

### 3.1 Criar Departamento

- [ ] **TC-DEPT-001** — Owner cria departamento com nome e cor válidos
  - Passos: Admin > Departamentos > "Novo Departamento", inserir nome "Suporte", escolher cor #FF5733, salvar
  - RE: Departamento aparece na lista com a cor correta

- [ ] **TC-DEPT-002** — Criar departamento com nome duplicado
  - Passos: Tentar criar departamento com mesmo nome de um já existente
  - RE: Erro "Nome já existe" ou equivalente; departamento NÃO criado

- [ ] **TC-DEPT-003** — Criar departamento sem nome
  - Passos: Submeter formulário sem preencher o nome
  - RE: Validação impede submissão com mensagem de campo obrigatório

### 3.2 Editar Departamento

- [ ] **TC-DEPT-004** — Editar nome do departamento
  - Passos: Admin > Departamentos > Editar, alterar nome, salvar
  - RE: Nome atualizado em todos os locais onde aparece (conversas, filtros, etc.)

- [ ] **TC-DEPT-005** — Editar cor do departamento
  - Passos: Admin > Departamentos > Editar, alterar cor para #00FF00, salvar
  - RE: Cor atualizada nos chips/badges do departamento na UI

### 3.3 Membros (user_departments)

- [ ] **TC-DEPT-006** — Owner adiciona atendente a departamento
  - Passos: Admin > Departamentos > Editar > aba Membros, adicionar atendente "João", salvar
  - RE: João aparece na lista de membros do departamento; é elegível para atribuição automática do dept

- [ ] **TC-DEPT-007** — Owner remove atendente de departamento
  - Passos: Admin > Departamentos > Editar > aba Membros, remover atendente
  - RE: Atendente removido da lista; não recebe mais conversas automáticas desse departamento

- [ ] **TC-DEPT-008** — Atendente pertence a múltiplos departamentos
  - Passos: Adicionar mesmo atendente a dois departamentos distintos
  - RE: Atendente aparece nos membros de ambos os departamentos

### 3.4 Excluir Departamento

- [ ] **TC-DEPT-009** — Excluir departamento sem conversas ativas
  - Passos: Admin > Departamentos > Excluir departamento vazio
  - RE: Departamento removido da lista

- [ ] **TC-DEPT-010** — Excluir departamento com conversas ativas (comportamento esperado)
  - Passos: Tentar excluir departamento que possui conversas abertas
  - RE: Sistema impede exclusão com mensagem de aviso, OU realoca conversas conforme configuração definida

---

## 4. Linhas WhatsApp

### 4.1 Criar Linha

- [ ] **TC-LINE-001** — Owner cria nova linha com nome e cor
  - Passos: Admin > Linhas > "Nova Linha", inserir nome "Suporte Principal", cor #0000FF, salvar
  - RE: Linha criada, aparece na lista sem conexão WhatsApp ainda

- [ ] **TC-LINE-002** — Definir linha como padrão (`is_default = true`)
  - Passos: Ao criar ou editar linha, marcar checkbox "Linha padrão", salvar
  - RE: Linha marcada como padrão; apenas uma linha pode ser padrão simultaneamente

- [ ] **TC-LINE-003** — Definir segunda linha como padrão
  - Passos: Com linha A já como padrão, marcar linha B como padrão, salvar
  - RE: Linha B passa a ser padrão; linha A perde a marcação `is_default`

- [ ] **TC-LINE-004** — Associar linha a departamento (`department_id`)
  - Passos: Editar linha, selecionar departamento "HelpDesk" no campo de associação, salvar
  - RE: Linha associada ao departamento; conversas recebidas por essa linha vão para "HelpDesk"

### 4.2 Conexão WhatsApp (QR Code)

- [ ] **TC-LINE-005** — Conectar linha ao WhatsApp via QR Code
  - Passos: Admin > Linhas > selecionar linha > "Conectar", aguardar geração do QR code, escanear com dispositivo WhatsApp
  - RE: QR code exibido em menos de 10 segundos; após scan, status muda para "Conectado" sem necessidade de F5

- [ ] **TC-LINE-006** — Reconectar linha desconectada
  - Passos: Desconectar linha manualmente, depois clicar "Reconectar"
  - RE: Novo QR code gerado; após scan, linha volta ao estado "Conectado"

- [ ] **TC-LINE-007** — Status de linha desconectada é exibido claramente
  - Passos: Desligar o dispositivo WhatsApp conectado a uma linha
  - RE: Status da linha muda para "Desconectado" na UI (em tempo real ou ao recarregar)

- [ ] **TC-LINE-008** — Mensagens recebidas em linha desconectada
  - Passos: Enviar mensagem WhatsApp para número de linha desconectada
  - RE: Sistema não recebe a mensagem enquanto desconectado; mensagens recebidas após reconexão (depende do comportamento do Baileys)

### 4.3 Editar e Excluir Linha

- [ ] **TC-LINE-009** — Editar nome da linha
  - Passos: Admin > Linhas > Editar, alterar nome, salvar
  - RE: Nome atualizado em toda a plataforma

- [ ] **TC-LINE-010** — Excluir linha sem conversas ativas
  - Passos: Admin > Linhas > Excluir linha sem histórico
  - RE: Linha removida da lista

- [ ] **TC-LINE-011** — Excluir linha com conversas associadas
  - Passos: Tentar excluir linha que possui conversas históricas
  - RE: Sistema impede exclusão ou exibe confirmação de risco com aviso de impacto

---

## 5. Contactos

### 5.1 Criar Contacto

- [ ] **TC-CONT-001** — Criar contacto com número de telefone válido e nome
  - Passos: Contactos > "Novo Contacto", inserir nome "Maria Silva", telefone "+55 11 99999-0001", salvar
  - RE: Contacto criado, aparece na lista de contactos

- [ ] **TC-CONT-002** — Criar contacto com e-mail
  - Passos: Preencher campo de e-mail ao criar contacto
  - RE: E-mail gravado e visível no perfil do contacto

- [ ] **TC-CONT-003** — Criar contacto com notas
  - Passos: Preencher campo "Notas" com texto livre ao criar contacto
  - RE: Notas gravadas e visíveis no painel lateral do contacto

- [ ] **TC-CONT-004** — Criar contacto com número duplicado
  - Passos: Tentar criar contacto com número de telefone já cadastrado
  - RE: Erro "Número já cadastrado" ou equivalente; contacto NÃO criado

- [ ] **TC-CONT-005** — Criar contacto sem número de telefone
  - Passos: Submeter formulário sem preencher número
  - RE: Validação impede submissão

### 5.2 Editar Contacto

- [ ] **TC-CONT-006** — Editar nome do contacto
  - Passos: Contactos > selecionar contacto > Editar, alterar nome, salvar
  - RE: Nome atualizado na lista de contactos e em conversas abertas com esse contacto (em tempo real)

- [ ] **TC-CONT-007** — Editar e-mail do contacto
  - Passos: Editar campo e-mail, salvar
  - RE: E-mail atualizado no perfil

- [ ] **TC-CONT-008** — Editar notas do contacto
  - Passos: Editar campo notas, salvar
  - RE: Notas atualizadas no painel lateral

- [ ] **TC-CONT-009** — Editar nome inline no painel lateral da conversa
  - Passos: Abrir conversa, no painel lateral clicar no nome do contacto, editar inline, confirmar
  - RE: Nome atualizado sem abrir nova página; reflecte em tempo real na conversa e na lista

- [ ] **TC-CONT-010** — Editar e-mail inline no painel lateral da conversa
  - Passos: No painel lateral da conversa, editar campo e-mail inline
  - RE: E-mail gravado e reflecte no perfil completo do contacto

- [ ] **TC-CONT-011** — Editar notas inline no painel lateral da conversa
  - Passos: No painel lateral, editar notas do contacto inline
  - RE: Notas atualizadas

### 5.3 Pesquisa de Contactos

- [ ] **TC-CONT-012** — Pesquisar contacto por nome
  - Passos: Campo de pesquisa em Contactos, digitar parte do nome "Mari"
  - RE: Lista filtra para contactos cujo nome contém "Mari"

- [ ] **TC-CONT-013** — Pesquisar contacto por número de telefone
  - Passos: Digitar parte do número "99999" na pesquisa
  - RE: Contactos com esse número no telefone aparecem na lista

- [ ] **TC-CONT-014** — Pesquisa sem resultados
  - Passos: Pesquisar por texto que não existe em nenhum contacto
  - RE: Mensagem "Nenhum contacto encontrado" ou lista vazia com estado vazio

### 5.4 Histórico 360

- [ ] **TC-CONT-015** — Visualizar stats do contacto no histórico 360
  - Passos: Contactos > selecionar contacto > aba/secção "Histórico 360"
  - RE: Exibe número total de conversas, mensagens, tempo médio de resposta, ou outras estatísticas relevantes

- [ ] **TC-CONT-016** — Visualizar conversas anteriores no histórico 360
  - Passos: Histórico 360 do contacto com conversas fechadas
  - RE: Lista de conversas anteriores com data, atendente, status e prévia da última mensagem

- [ ] **TC-CONT-017** — Aceder a conversa anterior a partir do histórico 360
  - Passos: Clicar em conversa listada no histórico 360
  - RE: Abre/navega para o transcript dessa conversa

- [ ] **TC-CONT-018** — Etiquetas usadas visíveis no histórico 360
  - Passos: Histórico 360 de contacto que já teve conversas com etiquetas aplicadas
  - RE: Etiquetas utilizadas listadas com frequência ou agrupamento

### 5.5 Excluir Contacto

- [ ] **TC-CONT-019** — Excluir contacto com confirmação
  - Passos: Contactos > selecionar contacto > Excluir, confirmar no modal
  - RE: Contacto removido da lista

- [ ] **TC-CONT-020** — Exclusão em cascata: conversas do contacto excluídas
  - Passos: Excluir contacto que possui conversas históricas
  - RE: Conversas associadas também removidas do banco de dados; não aparecem mais em pesquisas

- [ ] **TC-CONT-021** — Exclusão em cascata: mensagens do contacto excluídas
  - Passos: Após excluir contacto, verificar na base de dados ou via API se mensagens foram removidas
  - RE: Registos de mensagens também ausentes

---

## 6. Lista de Conversas

### 6.1 Exibição Básica

- [ ] **TC-CONV-001** — Lista de conversas carrega ao fazer login
  - Passos: Fazer login como atendente
  - RE: Lista de conversas visível, com conversas atribuídas ao atendente

- [ ] **TC-CONV-002** — Conversa exibe nome do contacto
  - Passos: Visualizar item da lista de conversas
  - RE: Nome do contacto (ou número se sem nome) visível no item da lista

- [ ] **TC-CONV-003** — Conversa exibe prévia da última mensagem
  - Passos: Verificar item de conversa com mensagens
  - RE: Texto truncado da última mensagem visível abaixo do nome

- [ ] **TC-CONV-004** — Conversa exibe timestamp da última mensagem
  - Passos: Verificar item de conversa
  - RE: Data/hora relativa (ex: "há 5 min", "ontem") visível no item

### 6.2 Filtros

- [ ] **TC-CONV-005** — Filtrar conversas por status "waiting"
  - Passos: Aplicar filtro de status = "Aguardando"
  - RE: Apenas conversas com `status = waiting` listadas

- [ ] **TC-CONV-006** — Filtrar conversas por status "open"
  - Passos: Aplicar filtro de status = "Aberta"
  - RE: Apenas conversas com `status = open` listadas

- [ ] **TC-CONV-007** — Filtrar conversas por status "closed"
  - Passos: Aplicar filtro de status = "Fechada"
  - RE: Apenas conversas com `status = closed` listadas

- [ ] **TC-CONV-008** — Filtrar conversas por status "snoozed"
  - Passos: Aplicar filtro de status = "Adiada"
  - RE: Apenas conversas com `status = snoozed` listadas

- [ ] **TC-CONV-009** — Filtrar conversas por prioridade "urgent"
  - Passos: Aplicar filtro prioridade = "Urgente"
  - RE: Apenas conversas com `priority = urgent` listadas

- [ ] **TC-CONV-010** — Filtrar conversas por prioridade "normal"
  - Passos: Aplicar filtro prioridade = "Normal"
  - RE: Apenas conversas com `priority = normal` listadas

- [ ] **TC-CONV-011** — Filtrar conversas por prioridade "low"
  - Passos: Aplicar filtro prioridade = "Baixa"
  - RE: Apenas conversas com `priority = low` listadas

- [ ] **TC-CONV-012** — Filtrar por atendente específico (owner)
  - Passos: Owner aplica filtro de atendente, seleciona "João"
  - RE: Apenas conversas atribuídas a João listadas

- [ ] **TC-CONV-013** — Filtrar por etiqueta
  - Passos: Selecionar etiqueta "VIP" no filtro de etiquetas
  - RE: Apenas conversas com a etiqueta "VIP" listadas

- [ ] **TC-CONV-014** — Filtrar por departamento
  - Passos: Selecionar departamento "Marketing" no filtro
  - RE: Apenas conversas do departamento "Marketing" listadas

- [ ] **TC-CONV-015** — Filtrar por linha WhatsApp
  - Passos: Selecionar linha "Linha Principal" no filtro
  - RE: Apenas conversas recebidas por essa linha listadas

- [ ] **TC-CONV-016** — Combinar múltiplos filtros
  - Passos: Aplicar filtro status = "open" E prioridade = "urgent" simultaneamente
  - RE: Lista mostra apenas conversas que atendem ambos os critérios

- [ ] **TC-CONV-017** — Limpar filtros
  - Passos: Após aplicar filtros, clicar em "Limpar filtros" ou equivalente
  - RE: Lista volta a exibir todas as conversas sem filtro

### 6.3 Pesquisa Global

- [ ] **TC-CONV-018** — Pesquisar por texto em mensagens
  - Passos: Campo de pesquisa global, digitar "orçamento"
  - RE: Conversas que contêm mensagens com a palavra "orçamento" aparecem nos resultados

- [ ] **TC-CONV-019** — Pesquisar por nome de contacto
  - Passos: Pesquisar "Ana Paula" na pesquisa global
  - RE: Conversas com contacto cujo nome contém "Ana Paula" aparecem

- [ ] **TC-CONV-020** — Pesquisa sem resultados
  - Passos: Pesquisar por texto que não existe
  - RE: Estado vazio com mensagem "Nenhum resultado encontrado"

- [ ] **TC-CONV-021** — Limpar pesquisa
  - Passos: Após pesquisa com resultados, apagar o texto do campo
  - RE: Lista volta ao estado normal com todas as conversas

### 6.4 Badge de Não Lidas

- [ ] **TC-CONV-022** — Badge aparece em conversa com mensagem não lida
  - Passos: Receber nova mensagem WhatsApp em conversa existente
  - RE: Badge numérico visível no item da conversa na lista

- [ ] **TC-CONV-023** — Badge desaparece ao abrir conversa
  - Passos: Clicar na conversa com badge
  - RE: Badge removido; contador de não lidas vai a zero

- [ ] **TC-CONV-024** — Badge no ícone de menu/notificação geral
  - Passos: Ter múltiplas conversas com mensagens não lidas
  - RE: Contador total de não lidas visível no header ou ícone do browser

### 6.5 Chip de Tempo de Espera

- [ ] **TC-CONV-025** — Chip ⏱ aparece em conversas "waiting"
  - Passos: Ver lista de conversas com status "waiting"
  - RE: Chip "⏱ Xh Ymin" visível no item, indicando quanto tempo o cliente aguarda

- [ ] **TC-CONV-026** — Tempo de espera atualiza progressivamente
  - Passos: Manter lista aberta por alguns minutos com conversa em "waiting"
  - RE: Valor do chip incrementa conforme o tempo passa (pode ser necessário F5 ou atualização automática)

### 6.6 SLA Alert

- [ ] **TC-CONV-027** — Alerta SLA aparece quando tempo de espera excede o limite configurado
  - Passos: Configurar SLA como 30 minutos; deixar conversa em "waiting" por mais de 30 minutos
  - RE: Indicador visual de alerta SLA (cor vermelha, ícone, badge) visível na conversa

- [ ] **TC-CONV-028** — Alerta SLA desaparece ao atender a conversa
  - Passos: Assumir/abrir conversa em alerta SLA
  - RE: Indicador SLA removido

### 6.7 Prioridade

- [ ] **TC-CONV-029** — Conversa urgente aparece destacada na lista
  - Passos: Criar/ter conversa com `priority = urgent`
  - RE: Indicador visual de urgência visível (cor, ícone, posição no topo)

---

## 7. Chat — Funcionalidades Gerais

### 7.1 Enviar Mensagem de Texto

- [ ] **TC-CHAT-001** — Enviar mensagem de texto simples
  - Passos: Abrir conversa aberta, digitar "Olá, como posso ajudar?", pressionar Enter ou clicar Enviar
  - RE: Mensagem aparece no chat com timestamp, status "enviado"; mensagem entregue ao contacto WhatsApp

- [ ] **TC-CHAT-002** — Enviar mensagem com texto longo (> 500 caracteres)
  - Passos: Colar texto longo no campo de mensagem e enviar
  - RE: Mensagem enviada integralmente; exibida corretamente no chat sem truncamento

- [ ] **TC-CHAT-003** — Enviar mensagem com emojis
  - Passos: Inserir emojis no texto e enviar
  - RE: Emojis exibidos corretamente no chat e recebidos no WhatsApp do cliente

- [ ] **TC-CHAT-004** — Enviar mensagem vazia (campo em branco)
  - Passos: Tentar clicar Enviar com campo de texto vazio
  - RE: Botão Enviar desabilitado ou mensagem NÃO enviada; sem erro visual desnecessário

- [ ] **TC-CHAT-005** — Campo de texto aceita Enter para nova linha (Shift+Enter)
  - Passos: Digitar texto, pressionar Shift+Enter, continuar digitando
  - RE: Nova linha inserida no campo; Enter simples envia a mensagem

### 7.2 Reply (Responder a Mensagem Específica)

- [ ] **TC-CHAT-006** — Fazer reply a mensagem específica
  - Passos: Passar o cursor sobre uma mensagem, clicar em "Responder", digitar resposta, enviar
  - RE: Mensagem enviada com citação da mensagem original; no WhatsApp do cliente aparece como reply

- [ ] **TC-CHAT-007** — Cancelar reply
  - Passos: Clicar em "Responder" em uma mensagem, depois clicar em "×" para cancelar
  - RE: Citação removida do campo de texto; próxima mensagem enviada sem reply

- [ ] **TC-CHAT-008** — Reply a mensagem com imagem
  - Passos: Fazer reply a uma mensagem que contém imagem
  - RE: Preview da imagem original exibido na citação

### 7.3 Nota Interna

- [ ] **TC-CHAT-009** — Criar nota interna em conversa aberta
  - Passos: Clicar no toggle/botão "Nota Interna", digitar texto da nota, enviar
  - RE: Mensagem aparece com fundo diferenciado (amarelo/cinza) indicando que é nota interna; NÃO aparece no WhatsApp do cliente

- [ ] **TC-CHAT-010** — Nota interna visível para owner e atendente
  - Passos: Criar nota, fazer logout, login com outro utilizador com acesso à conversa
  - RE: Nota visível para todos os utilizadores da plataforma com acesso à conversa

- [ ] **TC-CHAT-011** — Nota interna em conversa FECHADA é rejeitada
  - Passos: Fechar conversa, tentar enviar nota interna nessa conversa
  - RE: Sistema rejeita com mensagem "Conversa fechada" ou equivalente; nota NÃO criada

- [ ] **TC-CHAT-012** — Nota interna NÃO aparece no histórico do WhatsApp do cliente
  - Passos: Criar nota interna em conversa ativa
  - RE: Verificar no dispositivo WhatsApp do cliente que a nota não foi recebida

### 7.4 Respostas Rápidas

- [ ] **TC-CHAT-013** — Ativar respostas rápidas com "/"
  - Passos: No campo de texto, digitar "/"
  - RE: Popup/dropdown de respostas rápidas aparece com lista de atalhos disponíveis

- [ ] **TC-CHAT-014** — Filtrar respostas rápidas por atalho
  - Passos: Digitar "/sauda" (parte do atalho "saudação")
  - RE: Lista filtrada para respostas cujo atalho contém "sauda"

- [ ] **TC-CHAT-015** — Selecionar resposta rápida do menu
  - Passos: Clicar em resposta rápida no dropdown
  - RE: Texto completo da resposta inserido no campo de mensagem; pode editar antes de enviar

- [ ] **TC-CHAT-016** — Fechar dropdown de respostas rápidas
  - Passos: Pressionar Escape após abrir o dropdown
  - RE: Dropdown fechado; campo retorna ao estado normal

- [ ] **TC-CHAT-017** — Resposta rápida sem correspondência
  - Passos: Digitar "/atalhoquenonexiste"
  - RE: Dropdown mostra "Nenhuma resposta encontrada" ou fecha automaticamente

---

## 8. Chat — Ficheiros e Mídia

### 8.1 Envio de Ficheiros

- [ ] **TC-FILE-001** — Enviar imagem JPG/PNG
  - Passos: Clicar em ícone de anexo, selecionar imagem, confirmar envio
  - RE: Preview da imagem exibido no chat; imagem recebida no WhatsApp do cliente com qualidade original

- [ ] **TC-FILE-002** — Enviar vídeo MP4
  - Passos: Anexar ficheiro de vídeo MP4 (< 50MB)
  - RE: Vídeo enviado; exibido como player de vídeo no chat; recebido no WhatsApp

- [ ] **TC-FILE-003** — Enviar áudio MP3/OGG
  - Passos: Anexar ficheiro de áudio
  - RE: Player de áudio exibido no chat; recebido como áudio no WhatsApp

- [ ] **TC-FILE-004** — Enviar documento PDF
  - Passos: Anexar ficheiro PDF
  - RE: Documento exibido com ícone e nome do ficheiro no chat; recebido como documento no WhatsApp

- [ ] **TC-FILE-005** — Enviar documento DOCX/XLSX
  - Passos: Anexar ficheiro .docx ou .xlsx
  - RE: Ficheiro enviado com nome original preservado

- [ ] **TC-FILE-006** — Enviar ficheiro com exatamente 50MB
  - Passos: Preparar ficheiro de exatamente 50MB, tentar enviar
  - RE: Ficheiro enviado com sucesso (limite inclusivo)

- [ ] **TC-FILE-007** — Enviar ficheiro acima de 50MB
  - Passos: Tentar enviar ficheiro de 51MB ou mais
  - RE: Erro "Ficheiro excede o limite de 50MB" antes do upload; ficheiro NÃO enviado

- [ ] **TC-FILE-008** — Enviar múltiplos ficheiros de uma vez (se suportado)
  - Passos: Selecionar múltiplos ficheiros no diálogo de upload
  - RE: Ficheiros enviados em sequência ou em lote; todos aparecem no chat

### 8.2 Recepção de Ficheiros do Cliente

- [ ] **TC-FILE-009** — Receber imagem do cliente
  - Passos: Cliente envia imagem pelo WhatsApp
  - RE: Imagem exibida no chat com preview; clicável para ampliar

- [ ] **TC-FILE-010** — Receber vídeo do cliente
  - Passos: Cliente envia vídeo
  - RE: Player de vídeo exibido no chat

- [ ] **TC-FILE-011** — Receber documento do cliente com nome original preservado
  - Passos: Cliente envia documento PDF com nome "Proposta_2026.pdf"
  - RE: Documento exibido com nome "Proposta_2026.pdf" (não renomeado)

- [ ] **TC-FILE-012** — Receber áudio do cliente
  - Passos: Cliente envia mensagem de voz/áudio
  - RE: Player de áudio exibido no chat

- [ ] **TC-FILE-013** — Download de ficheiro recebido
  - Passos: Clicar em ficheiro recebido para download
  - RE: Ficheiro baixado com nome original preservado

---

## 9. Chat — Ações sobre a Conversa

### 9.1 Fechar Conversa

- [ ] **TC-ACTION-001** — Fechar conversa com mensagem de avaliação automática
  - Passos: Abrir conversa, clicar "Fechar conversa"
  - RE: Conversa muda para `status = closed`; mensagem de avaliação enviada automaticamente ao cliente; modal de confirmação se configurado

- [ ] **TC-ACTION-002** — Conversa fechada desaparece da lista de "abertas"
  - Passos: Fechar conversa que está no filtro "open"
  - RE: Conversa desaparece da lista sem F5

- [ ] **TC-ACTION-003** — Fechar conversa sem mensagem de avaliação (se avaliação desativada)
  - Passos: Desativar mensagem de avaliação nas configurações, fechar conversa
  - RE: Conversa fechada sem enviar mensagem ao cliente

### 9.2 Reabrir Conversa

- [ ] **TC-ACTION-004** — Reabrir conversa fechada
  - Passos: Filtrar por status "closed", selecionar conversa, clicar "Reabrir"
  - RE: Conversa volta para `status = open`; aparece na lista de abertas

- [ ] **TC-ACTION-005** — Reabrir conversa dentro da janela de reabertura
  - Passos: Configurar janela de reabertura como 24h; fechar conversa; cliente envia mensagem dentro de 24h
  - RE: Conversa reabre automaticamente; não cria nova conversa

- [ ] **TC-ACTION-006** — Mensagem do cliente fora da janela de reabertura cria nova conversa
  - Passos: Fechar conversa; aguardar expirar janela de reabertura; cliente envia mensagem
  - RE: Nova conversa criada para o cliente; conversa antiga permanece fechada

### 9.3 Transferir Conversa

- [ ] **TC-ACTION-007** — Transferir conversa para outro atendente
  - Passos: Abrir conversa, clicar "Transferir", selecionar atendente "Pedro", confirmar
  - RE: Conversa atribuída a Pedro; desaparece da lista do atendente original; aparece na lista de Pedro em tempo real

- [ ] **TC-ACTION-008** — Transferir conversa atualiza departamento e linha
  - Passos: Transferir conversa para atendente de departamento diferente
  - RE: Campo `department_id` e `line_id` da conversa atualizados para os do novo atendente/departamento

- [ ] **TC-ACTION-009** — Transferir para atendente offline
  - Passos: Tentar transferir para atendente com status "offline"
  - RE: Sistema alerta que atendente está offline; pode impedir ou pedir confirmação

- [ ] **TC-ACTION-010** — Status do atendente no painel de transferência é em tempo real
  - Passos: Abrir modal de transferência; em outra aba, alterar status de um atendente
  - RE: Status do atendente atualiza no modal de transferência sem precisar fechar e reabrir

### 9.4 Assumir Conversa (Takeover)

- [ ] **TC-ACTION-011** — Atendente A assume conversa atribuída ao atendente B
  - Passos: Autenticar como atendente A; navegar para conversa atribuída a B; clicar "Assumir"
  - RE: Conversa reatribuída para A; desaparece da lista de B em tempo real; A passa a ser o responsável

- [ ] **TC-ACTION-012** — Owner assume qualquer conversa
  - Passos: Como owner, assumir conversa de qualquer atendente
  - RE: Conversa reatribuída ao owner; atendente anterior perde acesso ao item na lista

### 9.5 Snooze / Adiar

- [ ] **TC-ACTION-013** — Adiar conversa para data/hora futura
  - Passos: Clicar "Adiar (Snooze)", selecionar data/hora futura (ex: amanhã às 09:00), confirmar
  - RE: Conversa muda para `status = snoozed`; desaparece da lista de "abertas"; aparece na lista "snoozed"

- [ ] **TC-ACTION-014** — Conversa snoozed reabre automaticamente na hora marcada
  - Passos: Adiar para daqui a 2 minutos; aguardar
  - RE: Às 2 minutos, conversa volta para `status = open`; aparece na lista sem F5

- [ ] **TC-ACTION-015** — Cancelar snooze manualmente
  - Passos: Abrir conversa snoozed, clicar "Cancelar Snooze"
  - RE: Conversa volta para `status = open` imediatamente

### 9.6 Mudar Prioridade

- [ ] **TC-ACTION-016** — Mudar prioridade para "urgent"
  - Passos: Abrir conversa, clicar em seletor de prioridade, selecionar "Urgente"
  - RE: Prioridade atualizada; indicador visual muda para urgente; conversa posicionada no topo da lista

- [ ] **TC-ACTION-017** — Mudar prioridade para "low"
  - Passos: Selecionar "Baixa" no seletor de prioridade
  - RE: Prioridade atualizada para "low"

### 9.7 Etiquetas

- [ ] **TC-ACTION-018** — Adicionar etiqueta à conversa
  - Passos: Clicar em "Etiquetas" na conversa, selecionar etiqueta "VIP"
  - RE: Etiqueta "VIP" aparece no header da conversa e no item da lista

- [ ] **TC-ACTION-019** — Remover etiqueta da conversa
  - Passos: Clicar em etiqueta já aplicada, confirmar remoção
  - RE: Etiqueta removida da conversa

- [ ] **TC-ACTION-020** — Adicionar múltiplas etiquetas à mesma conversa
  - Passos: Adicionar etiquetas "VIP" e "Urgente" à mesma conversa
  - RE: Ambas as etiquetas visíveis na conversa

### 9.8 Mudar Departamento

- [ ] **TC-ACTION-021** — Mudar departamento da conversa
  - Passos: Abrir conversa, clicar "Mudar Departamento", selecionar "Marketing", confirmar
  - RE: `department_id` da conversa atualizado; conversa aparece no filtro de "Marketing"

### 9.9 Atribuição Automática

- [ ] **TC-ACTION-022** — Nova conversa atribuída automaticamente ao atendente menos ocupado do departamento
  - Passos: Configurar linha com departamento "Suporte"; ter atendentes A (2 conversas abertas) e B (0 conversas abertas) ambos online e no turno; receber nova mensagem
  - RE: Nova conversa atribuída ao atendente B (menos ocupado)

- [ ] **TC-ACTION-023** — Atribuição automática só considera atendentes `on_shift = true` e `status = online`
  - Passos: Ter atendente C no turno mas offline; atendente D no turno e online; receber nova mensagem
  - RE: Conversa atribuída a D; C ignorado

- [ ] **TC-ACTION-024** — Assinatura automática ao atribuir
  - Passos: Configurar assinatura do atendente; receber conversa e ser atribuído automaticamente
  - RE: Mensagem com a assinatura enviada automaticamente ao cliente quando a conversa é atribuída

### 9.10 Export da Conversa

- [ ] **TC-ACTION-025** — Exportar conversa individual como CSV
  - Passos: Abrir conversa, clicar "Exportar (CSV)"
  - RE: Ficheiro CSV descarregado com todas as mensagens da conversa (timestamp, remetente, conteúdo, tipo)

- [ ] **TC-ACTION-026** — CSV exportado contém notas internas identificadas
  - Passos: Exportar conversa que contém notas internas
  - RE: Notas internas no CSV identificadas com campo/coluna distinto (ex: `type = internal_note`)

### 9.11 Mensagens Agendadas no Chat

- [ ] **TC-ACTION-027** — Agendar mensagem a partir da conversa
  - Passos: Na conversa, clicar em "Agendar Mensagem", selecionar data futura, digitar texto, confirmar
  - RE: Agendamento criado; badge/ícone de mensagem agendada visível na conversa

---

## 10. Funcionalidades em Tempo Real (Socket.io)

### 10.1 Nova Mensagem

- [ ] **TC-RT-001** — Nova mensagem aparece no chat sem F5
  - Passos: Abrir conversa no browser; cliente envia mensagem pelo WhatsApp
  - RE: Mensagem aparece no chat em menos de 3 segundos, sem necessidade de recarregar a página

- [ ] **TC-RT-002** — Nova mensagem incrementa badge de não lidas na lista sem F5
  - Passos: Ter lista de conversas visível; cliente envia mensagem em conversa não aberta
  - RE: Badge de não lidas incrementa na lista em tempo real

### 10.2 Conversa Transferida

- [ ] **TC-RT-003** — Conversa transferida desaparece da lista do atendente original em tempo real
  - Passos: Atendente A e B abertos em browsers diferentes; owner transfere conversa de A para B
  - RE: Conversa some da lista do atendente A sem F5; aparece na lista do atendente B sem F5

### 10.3 Conversa Assumida

- [ ] **TC-RT-004** — Conversa assumida desaparece da lista do atendente original em tempo real
  - Passos: Atendente A tem conversa; atendente B (ou owner) assume a conversa
  - RE: Conversa desaparece da lista de A imediatamente sem F5

### 10.4 Atualização de Nome do Contacto

- [ ] **TC-RT-005** — Nome do contacto atualiza em todas as conversas abertas sem F5
  - Passos: Ter múltiplas conversas do mesmo contacto abertas; editar o nome do contacto
  - RE: Nome do contacto atualizado em todos os itens da lista e no header das conversas abertas em tempo real

### 10.5 Status do Atendente

- [ ] **TC-RT-006** — Status do atendente atualiza no painel de transferência em tempo real
  - Passos: Owner tem modal de transferência aberto; atendente muda status para "busy"
  - RE: Indicador de status do atendente atualiza no modal de transferência sem fechar e reabrir

### 10.6 Conversa Atribuída

- [ ] **TC-RT-007** — Conversa atribuída aparece na lista do novo atendente sem F5
  - Passos: Owner atribui conversa nova ao atendente; atendente tem a lista aberta
  - RE: Conversa aparece na lista do atendente em menos de 3 segundos sem F5

### 10.7 Resiliência do Socket

- [ ] **TC-RT-008** — Reconexão após queda de rede
  - Passos: Simular queda de rede (desativar Wi-Fi); reativar rede
  - RE: Socket.io reconecta automaticamente; mensagens recebidas durante a queda aparecem ao reconectar

- [ ] **TC-RT-009** — Múltiplas abas do mesmo utilizador
  - Passos: Abrir a aplicação em duas abas diferentes com o mesmo login
  - RE: Eventos de tempo real propagados para ambas as abas simultaneamente

---

## 11. Bot Automático

### 11.1 Resposta Automática

- [ ] **TC-BOT-001** — Bot responde à 1ª mensagem fora do horário de funcionamento
  - Passos: Configurar bot ativo; configurar horário de funcionamento excluindo a hora atual; enviar mensagem pelo WhatsApp
  - RE: Mensagem automática de boas-vindas enviada ao cliente

- [ ] **TC-BOT-002** — Bot NÃO responde se conversa já tem mensagens anteriores
  - Passos: Ter conversa com histórico; fechar; cliente envia nova mensagem fora do horário
  - RE: Bot NÃO envia resposta automática; conversa reabre sem mensagem do bot

- [ ] **TC-BOT-003** — Bot NÃO responde dentro do horário de funcionamento
  - Passos: Configurar horário incluindo a hora atual; ter bot ativo; cliente envia mensagem
  - RE: Bot não responde; conversa criada normalmente sem mensagem automática

- [ ] **TC-BOT-004** — Bot desativado não envia respostas automáticas
  - Passos: Desativar bot nas configurações; cliente envia mensagem fora do horário
  - RE: Nenhuma resposta automática enviada

### 11.2 Configuração de Horário

- [ ] **TC-BOT-005** — Configurar horário por dia da semana
  - Passos: Admin > Configurações > Horário, definir horário diferente para cada dia (ex: seg-sex 08:00-18:00, sáb 09:00-13:00, dom fechado)
  - RE: Configuração salva; bot respeita horário distinto por dia

- [ ] **TC-BOT-006** — Dia marcado como fechado
  - Passos: Marcar domingo como "Fechado" no configurador de horário
  - RE: Qualquer mensagem recebida no domingo é tratada como fora do horário (bot ativa se configurado)

- [ ] **TC-BOT-007** — Horário de funcionamento exibido corretamente na UI
  - Passos: Após configurar horário, reabrir a tela de configurações
  - RE: Horários salvos exibidos corretamente, sem perda de dados

---

## 12. Avaliação (Rating)

### 12.1 Envio da Avaliação

- [ ] **TC-RATING-001** — Mensagem de avaliação enviada automaticamente ao fechar conversa
  - Passos: Fechar conversa ativa; verificar WhatsApp do cliente
  - RE: Mensagem de avaliação recebida no WhatsApp do cliente (ex: "Como foi o nosso atendimento? Responda de 1 a 5")

- [ ] **TC-RATING-002** — Mensagem de avaliação configurável
  - Passos: Admin > Configurações, alterar texto da mensagem de avaliação, salvar; fechar outra conversa
  - RE: Nova mensagem de avaliação com o texto personalizado enviada ao cliente

### 12.2 Recepção da Nota

- [ ] **TC-RATING-003** — Cliente responde com nota 1
  - Passos: Cliente responde à mensagem de avaliação com "1"
  - RE: Nota 1 gravada na conversa; conversa NÃO reabre

- [ ] **TC-RATING-004** — Cliente responde com nota 5
  - Passos: Cliente responde com "5"
  - RE: Nota 5 gravada; conversa permanece fechada

- [ ] **TC-RATING-005** — Nota visível na UI da conversa
  - Passos: Após cliente avaliar, abrir a conversa fechada
  - RE: Indicador de avaliação visível (ex: "⭐ 4/5") no header ou painel da conversa

- [ ] **TC-RATING-006** — Cliente responde com nota inválida (ex: "6", "abc")
  - Passos: Cliente responde à avaliação com "6" ou "ótimo"
  - RE: Nota inválida ignorada ou tratada graciosamente; conversa NÃO reabre

### 12.3 Conversa Não Reabre

- [ ] **TC-RATING-007** — Resposta à avaliação NÃO reabre a conversa
  - Passos: Conversa fechada com avaliação enviada; cliente responde com nota
  - RE: `status` da conversa permanece `closed`; não aparece como "aberta" ou "waiting" na lista

- [ ] **TC-RATING-008** — Resposta pós-avaliação NÃO cria nova conversa
  - Passos: Após avaliar (nota válida), cliente envia outra mensagem
  - RE: Comportamento controlado pela janela de reabertura; depende da configuração do sistema

---

## 13. Mensagens Agendadas

### 13.1 Criar Agendamento

- [ ] **TC-SCHED-001** — Criar agendamento para data futura válida
  - Passos: Chat > Agendar Mensagem > selecionar amanhã às 10:00 > digitar "Olá, lembrando do nosso compromisso!" > confirmar
  - RE: Agendamento criado com status "pendente"; visível no painel de agendamentos

- [ ] **TC-SCHED-002** — Criar agendamento para data no limite máximo (1 ano)
  - Passos: Selecionar data exatamente 1 ano no futuro
  - RE: Agendamento criado com sucesso

- [ ] **TC-SCHED-003** — Rejeitar agendamento para data passada
  - Passos: Tentar selecionar data ontem ou hora passada de hoje
  - RE: Seletor de data bloqueia ou sistema rejeita com erro "Data deve ser futura"

- [ ] **TC-SCHED-004** — Rejeitar agendamento para data inválida
  - Passos: Inserir manualmente data inválida (ex: 30/02/2026)
  - RE: Validação rejeita com mensagem de data inválida

- [ ] **TC-SCHED-005** — Rejeitar agendamento com ano absurdo
  - Passos: Inserir ano 2099 ou 9999 (além do limite de 1 ano)
  - RE: Sistema rejeita com mensagem "Data máxima é 1 ano a partir de hoje"

- [ ] **TC-SCHED-006** — Rejeitar agendamento sem texto de mensagem
  - Passos: Selecionar data válida sem digitar texto
  - RE: Validação impede criação; mensagem de campo obrigatório

### 13.2 Editar Agendamento

- [ ] **TC-SCHED-007** — Editar agendamento pendente
  - Passos: Painel de agendamentos > selecionar agendamento pendente > Editar > alterar texto ou data > salvar
  - RE: Agendamento atualizado com novos valores

- [ ] **TC-SCHED-008** — Tentar editar agendamento já enviado
  - Passos: Tentar editar agendamento com status "enviado"
  - RE: Botão de editar desabilitado ou sistema rejeita com mensagem "Mensagem já enviada"

### 13.3 Cancelar Agendamento

- [ ] **TC-SCHED-009** — Cancelar agendamento pendente
  - Passos: Painel de agendamentos > selecionar pendente > Cancelar > confirmar
  - RE: Agendamento removido ou marcado como "cancelado"; mensagem NÃO enviada na hora marcada

### 13.4 Envio Automático

- [ ] **TC-SCHED-010** — Mensagem enviada automaticamente na hora marcada
  - Passos: Criar agendamento para daqui a 2 minutos; aguardar
  - RE: Às 2 minutos, mensagem enviada ao cliente; agendamento muda para status "enviado"

- [ ] **TC-SCHED-011** — Mensagem enviada aparece no chat após envio automático
  - Passos: Após envio automático do agendamento, abrir a conversa
  - RE: Mensagem agendada visível no histórico da conversa com indicador de que foi agendada

### 13.5 Painel de Agendamentos

- [ ] **TC-SCHED-012** — Painel mostra apenas agendamentos pendentes por padrão
  - Passos: Abrir painel de mensagens agendadas
  - RE: Apenas agendamentos com status "pendente" listados

- [ ] **TC-SCHED-013** — Filtro "mostrar enviadas" exibe agendamentos enviados
  - Passos: Ativar toggle/checkbox "Mostrar enviadas"
  - RE: Agendamentos com status "enviado" aparecem na lista

---

## 14. Operações em Massa (Bulk)

### 14.1 Seleção

- [ ] **TC-BULK-001** — Selecionar uma conversa via checkbox
  - Passos: Na lista de conversas, clicar no checkbox do item
  - RE: Conversa selecionada (checkbox marcado); barra de ações bulk visível

- [ ] **TC-BULK-002** — Selecionar múltiplas conversas
  - Passos: Marcar checkbox de 3 conversas distintas
  - RE: 3 conversas selecionadas; barra mostra contador "3 selecionadas"

- [ ] **TC-BULK-003** — Selecionar todas as conversas visíveis
  - Passos: Clicar em checkbox "Selecionar todos" no header da lista
  - RE: Todas as conversas visíveis marcadas

- [ ] **TC-BULK-004** — Desmarcar todas as conversas
  - Passos: Após selecionar todas, clicar novamente em "Selecionar todos"
  - RE: Todas as conversas desmarcadas; barra de ações bulk desaparece

### 14.2 Fechar em Massa

- [ ] **TC-BULK-005** — Fechar múltiplas conversas em massa
  - Passos: Selecionar 3 conversas abertas, clicar "Fechar selecionadas"
  - RE: As 3 conversas mudam para `status = closed`; desaparecem da lista de "abertas"; mensagens de avaliação enviadas (se configurado)

### 14.3 Transferir em Massa

- [ ] **TC-BULK-006** — Transferir múltiplas conversas para outro atendente
  - Passos: Selecionar 3 conversas, clicar "Transferir selecionadas", escolher atendente "Carlos", confirmar
  - RE: As 3 conversas atribuídas a Carlos; Carlos recebe as conversas na lista em tempo real

### 14.4 Aplicar Etiqueta em Massa

- [ ] **TC-BULK-007** — Aplicar etiqueta a múltiplas conversas
  - Passos: Selecionar 4 conversas, clicar "Aplicar Etiqueta", selecionar "VIP", confirmar
  - RE: Etiqueta "VIP" adicionada às 4 conversas

### 14.5 Mudar Departamento em Massa

- [ ] **TC-BULK-008** — Mudar departamento de múltiplas conversas
  - Passos: Selecionar 2 conversas, clicar "Mudar Departamento", selecionar "Marketing", confirmar
  - RE: As 2 conversas transferidas para o departamento "Marketing"

### 14.6 Eliminar em Massa

- [ ] **TC-BULK-009** — Eliminar múltiplas conversas com confirmação
  - Passos: Selecionar 2 conversas, clicar "Eliminar selecionadas"
  - RE: Modal de confirmação exibido com aviso de irreversibilidade

- [ ] **TC-BULK-010** — Confirmar eliminação em massa
  - Passos: No modal, confirmar eliminação
  - RE: As 2 conversas removidas permanentemente; não aparecem em pesquisas futuras

- [ ] **TC-BULK-011** — Cancelar eliminação em massa
  - Passos: No modal de confirmação, clicar "Cancelar"
  - RE: Modal fechado; conversas NÃO eliminadas; permanecem na lista

---

## 15. Administração (Owner)

### 15.1 Etiquetas

- [ ] **TC-ADMIN-001** — Criar etiqueta com nome e cor
  - Passos: Admin > Etiquetas > "Nova Etiqueta", nome "VIP", cor #FFD700, salvar
  - RE: Etiqueta criada; disponível para aplicar em conversas

- [ ] **TC-ADMIN-002** — Editar nome e cor da etiqueta
  - Passos: Admin > Etiquetas > Editar etiqueta, alterar nome para "Cliente VIP", cor para #FFA500, salvar
  - RE: Nome e cor atualizados em todas as conversas que têm a etiqueta

- [ ] **TC-ADMIN-003** — Excluir etiqueta
  - Passos: Admin > Etiquetas > Excluir etiqueta "Teste"
  - RE: Etiqueta removida; removida automaticamente de conversas que a tinham

- [ ] **TC-ADMIN-004** — Criar etiqueta com nome duplicado
  - Passos: Tentar criar etiqueta com nome já existente
  - RE: Erro "Nome já em uso"

### 15.2 Respostas Rápidas

- [ ] **TC-ADMIN-005** — Criar resposta rápida com atalho e texto
  - Passos: Admin > Respostas Rápidas > "Nova Resposta", atalho "/boas", texto "Olá! Seja bem-vindo...", salvar
  - RE: Resposta criada; disponível ao digitar "/" no chat

- [ ] **TC-ADMIN-006** — Editar resposta rápida
  - Passos: Admin > Respostas Rápidas > Editar, alterar texto, salvar
  - RE: Novo texto disponível ao usar o atalho

- [ ] **TC-ADMIN-007** — Excluir resposta rápida
  - Passos: Admin > Respostas Rápidas > Excluir resposta
  - RE: Resposta removida; atalho não aparece mais no dropdown

- [ ] **TC-ADMIN-008** — Criar resposta com atalho duplicado
  - Passos: Tentar criar resposta com atalho "/boas" já existente
  - RE: Erro "Atalho já em uso"

### 15.3 Blacklist

- [ ] **TC-ADMIN-009** — Adicionar número à blacklist
  - Passos: Admin > Blacklist > "Adicionar", inserir número "+55 11 99999-0099", salvar
  - RE: Número adicionado à lista; mensagens desse número ignoradas pelo sistema

- [ ] **TC-ADMIN-010** — Mensagem de número na blacklist é ignorada
  - Passos: Número na blacklist envia mensagem pelo WhatsApp
  - RE: Mensagem NÃO cria conversa; NÃO aparece na lista de conversas

- [ ] **TC-ADMIN-011** — Remover número da blacklist
  - Passos: Admin > Blacklist > selecionar número > Remover
  - RE: Número removido; próximas mensagens desse número processadas normalmente

### 15.4 Configurações

- [ ] **TC-ADMIN-012** — Configurar mensagem de boas-vindas
  - Passos: Admin > Configurações > campo "Mensagem de Boas-Vindas", inserir texto, salvar
  - RE: Configuração salva; nova mensagem de boas-vindas usada pelo bot

- [ ] **TC-ADMIN-013** — Configurar assinatura automática
  - Passos: Admin > Configurações > campo "Assinatura", inserir texto, salvar
  - RE: Assinatura enviada automaticamente ao atribuir conversa ao atendente

- [ ] **TC-ADMIN-014** — Configurar janela de reabertura
  - Passos: Admin > Configurações > "Janela de Reabertura" = 48h, salvar
  - RE: Configuração salva; conversas fechadas reabrem se cliente responder dentro de 48h

- [ ] **TC-ADMIN-015** — Configurar SLA
  - Passos: Admin > Configurações > "Tempo SLA" = 30 minutos, salvar
  - RE: Conversas em "waiting" por mais de 30min exibem alerta SLA

- [ ] **TC-ADMIN-016** — Ativar/desativar bot
  - Passos: Admin > Configurações > toggle "Bot Ativo", salvar
  - RE: Bot ativado/desativado conforme toggle; comportamento reflete no envio de respostas automáticas

### 15.5 Logs de Transferência

- [ ] **TC-ADMIN-017** — Visualizar logs de transferência
  - Passos: Admin > Logs de Transferência
  - RE: Lista de transferências com data/hora, conversa, atendente de origem, atendente de destino

- [ ] **TC-ADMIN-018** — Filtrar logs por data
  - Passos: Aplicar filtro de data nos logs
  - RE: Logs filtrados pelo período selecionado

### 15.6 Export CSV de Conversas

- [ ] **TC-ADMIN-019** — Exportar todas as conversas como CSV sem filtros
  - Passos: Admin > Export CSV > sem filtros > "Exportar"
  - RE: CSV descarregado com todas as conversas e campos relevantes

- [ ] **TC-ADMIN-020** — Exportar conversas com filtro de data
  - Passos: Admin > Export CSV > filtro data início = 01/01/2026, data fim = 31/01/2026 > Exportar
  - RE: CSV contém apenas conversas do período especificado

- [ ] **TC-ADMIN-021** — Exportar conversas com filtro de departamento
  - Passos: Admin > Export CSV > filtro departamento = "Suporte" > Exportar
  - RE: CSV contém apenas conversas do departamento "Suporte"

- [ ] **TC-ADMIN-022** — Exportar conversas com filtro de atendente
  - Passos: Admin > Export CSV > filtro atendente = "João" > Exportar
  - RE: CSV contém apenas conversas atribuídas a João

---

## 16. Segurança e Permissões

### 16.1 Visibilidade de Conversas

- [ ] **TC-SEC-001** — Atendente só vê as suas próprias conversas
  - Passos: Autenticar como atendente "João"; verificar lista de conversas
  - RE: Apenas conversas com `assigned_to = João.id` visíveis; conversas de outros atendentes não listadas

- [ ] **TC-SEC-002** — Atendente tenta chamar API com ID de conversa de outro atendente
  - Passos: Pegar token de João; chamar `GET /api/conversations/{id_conversa_de_pedro}`
  - RE: API retorna 403 Forbidden ou 404 Not Found; dados da conversa alheia não expostos

- [ ] **TC-SEC-003** — Owner vê todas as conversas
  - Passos: Autenticar como owner; verificar lista de conversas
  - RE: Todas as conversas do sistema listadas, independente do atendente atribuído

### 16.2 Restrição de Linha ao Criar Conversa

- [ ] **TC-SEC-004** — Atendente só pode usar linha do seu departamento ao criar nova conversa
  - Passos: Atendente do departamento "Suporte" tenta criar conversa usando linha do departamento "Marketing"
  - RE: Sistema impede; apenas linhas do departamento "Suporte" disponíveis no seletor

- [ ] **TC-SEC-005** — Owner pode criar conversa com qualquer linha
  - Passos: Owner cria nova conversa e verifica seletor de linhas
  - RE: Todas as linhas disponíveis no seletor

### 16.3 Acesso ao Painel Admin

- [ ] **TC-SEC-006** — Atendente não acede ao painel admin via frontend
  - Passos: Autenticar como atendente; tentar navegar para `/admin/*`
  - RE: Redireciona para página sem permissão ou para lista de conversas

- [ ] **TC-SEC-007** — Atendente não acede a endpoints admin via API
  - Passos: Token de atendente; chamar `GET /api/admin/settings`
  - RE: 403 Forbidden

- [ ] **TC-SEC-008** — Atendente não vê lista de utilizadores
  - Passos: Autenticar como atendente; chamar `GET /api/users`
  - RE: 403 Forbidden ou lista vazia (sem dados de outros utilizadores)

### 16.4 Nota Interna em Conversa Fechada

- [ ] **TC-SEC-009** — Nota interna rejeitada em conversa fechada (via UI)
  - Passos: Abrir conversa fechada; tentar criar nota interna
  - RE: Botão/campo de nota interna desabilitado ou ação rejeitada com mensagem

- [ ] **TC-SEC-010** — Nota interna rejeitada em conversa fechada (via API)
  - Passos: Chamar `POST /api/conversations/{id}/messages` com `type = internal_note` em conversa fechada
  - RE: API retorna 400 ou 422 com mensagem de erro

### 16.5 Agendamento para o Passado

- [ ] **TC-SEC-011** — Agendamento para data passada rejeitado via UI
  - Passos: Tentar selecionar data passada no modal de agendamento
  - RE: Seletor bloqueia ou sistema rejeita ao submeter

- [ ] **TC-SEC-012** — Agendamento para data passada rejeitado via API
  - Passos: Chamar `POST /api/scheduled-messages` com `scheduled_at` = ontem
  - RE: API retorna 400/422 com mensagem "Data deve ser futura"

---

## 17. WhatsApp — Tipos de Mensagem

### 17.1 Mensagem de Visualização Única

- [ ] **TC-WA-001** — Mensagem de visualização única exibida como placeholder
  - Passos: Cliente envia foto/vídeo de visualização única; verificar no chat da plataforma
  - RE: Exibido como "🔒 Mensagem de visualização única" ou equivalente; NÃO como imagem/vídeo normal; NÃO confunde com mensagem de texto comum

- [ ] **TC-WA-002** — Mensagem de visualização única não permite download
  - Passos: Ver mensagem de visualização única no chat
  - RE: Sem botão de download; sem preview de imagem; apenas indicação textual do tipo

### 17.2 vCard / Contacto

- [ ] **TC-WA-003** — Receber vCard do cliente
  - Passos: Cliente envia contacto pelo WhatsApp
  - RE: Mensagem exibida com ícone de contacto, nome e número do vCard; identificada como tipo "contacto"

### 17.3 Sticker

- [ ] **TC-WA-004** — Receber sticker do cliente
  - Passos: Cliente envia sticker pelo WhatsApp
  - RE: Sticker exibido como imagem/animação no chat; não confundido com mensagem de texto

### 17.4 Áudio com Transcrição

- [ ] **TC-WA-005** — Receber áudio com transcrição configurada
  - Passos: Configurar serviço de transcrição; cliente envia áudio
  - RE: Player de áudio exibido; transcrição do texto abaixo do player

- [ ] **TC-WA-006** — Receber áudio sem transcrição configurada
  - Passos: Transcrição não configurada; cliente envia áudio
  - RE: Apenas player de áudio exibido, sem campo de transcrição

### 17.5 Mensagem Apagada pelo Cliente

- [ ] **TC-WA-007** — Mensagem apagada pelo cliente exibida corretamente
  - Passos: Cliente apaga mensagem enviada anteriormente
  - RE: Mensagem exibida como "🚫 Mensagem apagada" ou equivalente; conteúdo original não visível

### 17.6 Outros Tipos

- [ ] **TC-WA-008** — Receber vídeo do cliente
  - Passos: Cliente envia vídeo MP4 pelo WhatsApp
  - RE: Player de vídeo integrado no chat; download disponível

- [ ] **TC-WA-009** — Receber imagem do cliente
  - Passos: Cliente envia foto pelo WhatsApp
  - RE: Imagem exibida em miniatura; clicável para ampliar

- [ ] **TC-WA-010** — Receber localização do cliente
  - Passos: Cliente envia localização pelo WhatsApp
  - RE: Mapa estático ou link do Google Maps exibido no chat

---

## 18. Routing Linha → Departamento

### 18.1 Roteamento de Novas Conversas

- [ ] **TC-ROUTE-001** — Mensagem na Linha 1 vai para departamento HelpDesk
  - Passos: Linha 1 configurada com `department_id = HelpDesk`; cliente envia mensagem para o número da Linha 1
  - RE: Nova conversa criada com `department_id = HelpDesk`

- [ ] **TC-ROUTE-002** — Mensagem na Linha 2 vai para departamento Marketing Digital
  - Passos: Linha 2 configurada com `department_id = Marketing Digital`; cliente envia mensagem para o número da Linha 2
  - RE: Nova conversa criada com `department_id = Marketing Digital`

- [ ] **TC-ROUTE-003** — Atendente sorteado pertence ao departamento da linha
  - Passos: Linha 1 → dept HelpDesk; atendentes do HelpDesk: Alice e Bob (ambos online e on_shift); cliente envia mensagem
  - RE: Conversa atribuída automaticamente a Alice OU Bob (nenhum de fora do HelpDesk)

- [ ] **TC-ROUTE-004** — Nenhum atendente disponível no departamento
  - Passos: Linha 1 → dept HelpDesk; todos os atendentes do HelpDesk offline; mensagem recebida
  - RE: Conversa criada com `assigned_to = null` (ou comportamento configurado); painel mostra como "aguardando"

### 18.2 Transferência entre Departamentos

- [ ] **TC-ROUTE-005** — Transferir conversa para atendente de departamento diferente atualiza linha e departamento
  - Passos: Conversa no dept HelpDesk (Linha 1); transferir para atendente do dept Marketing (Linha 2)
  - RE: `department_id` e `line_id` da conversa atualizados para Marketing/Linha 2

---

## 19. Nova Conversa Outbound

### 19.1 Criar Conversa para Número Novo

- [ ] **TC-OUT-001** — Criar nova conversa para número não cadastrado
  - Passos: Botão "Nova Conversa", inserir número "+55 11 98888-0001" (não cadastrado), selecionar linha, digitar mensagem inicial, confirmar
  - RE: Novo contacto criado automaticamente com o número; conversa criada; mensagem inicial enviada

- [ ] **TC-OUT-002** — Criar nova conversa para contacto existente sem conversa aberta
  - Passos: Pesquisar número de contacto existente no modal de nova conversa; selecionar; criar
  - RE: Conversa criada para o contacto; sem modal de conflito pois não há conversa aberta

### 19.2 Conflito: Conversa Aberta Existente

- [ ] **TC-OUT-003** — Modal de confirmação ao criar conversa para contacto com conversa aberta
  - Passos: Tentar criar nova conversa para número que já possui conversa com `status = open`
  - RE: Modal de confirmação exibido com aviso "Este contacto já possui uma conversa aberta" e opções de abrir a existente ou criar nova

- [ ] **TC-OUT-004** — Selecionar "Abrir existente" no modal de conflito
  - Passos: No modal de conflito, clicar "Ir para conversa existente"
  - RE: Navega para a conversa aberta existente; nova conversa NÃO criada

- [ ] **TC-OUT-005** — Selecionar "Criar nova" no modal de conflito
  - Passos: No modal de conflito, clicar "Criar nova conversa"
  - RE: Nova conversa criada em paralelo com a existente

### 19.3 Restrição de Linha para Atendente

- [ ] **TC-OUT-006** — Atendente do dept Suporte só vê linhas do dept Suporte ao criar conversa
  - Passos: Autenticar como atendente do Suporte; abrir modal de nova conversa; verificar seletor de linhas
  - RE: Apenas linhas do departamento Suporte disponíveis no seletor

- [ ] **TC-OUT-007** — Owner vê todas as linhas ao criar conversa
  - Passos: Autenticar como owner; abrir modal de nova conversa; verificar seletor de linhas
  - RE: Todas as linhas ativas disponíveis no seletor

---

## Resultado Global

| # | Área | Total Testes | ✅ Passou | ❌ Falhou | ⏭️ Ignorado | % Passou |
|---|------|:---:|:---:|:---:|:---:|:---:|
| 1 | Autenticação | 14 | | | | |
| 2 | Gestão de Utilizadores | 17 | | | | |
| 3 | Departamentos | 10 | | | | |
| 4 | Linhas WhatsApp | 11 | | | | |
| 5 | Contactos | 21 | | | | |
| 6 | Lista de Conversas | 29 | | | | |
| 7 | Chat — Funcionalidades Gerais | 17 | | | | |
| 8 | Chat — Ficheiros e Mídia | 13 | | | | |
| 9 | Chat — Ações sobre a Conversa | 27 | | | | |
| 10 | Tempo Real (Socket.io) | 9 | | | | |
| 11 | Bot Automático | 7 | | | | |
| 12 | Avaliação (Rating) | 8 | | | | |
| 13 | Mensagens Agendadas | 13 | | | | |
| 14 | Operações em Massa (Bulk) | 11 | | | | |
| 15 | Administração (Owner) | 22 | | | | |
| 16 | Segurança e Permissões | 12 | | | | |
| 17 | WhatsApp — Tipos de Mensagem | 10 | | | | |
| 18 | Routing Linha → Departamento | 5 | | | | |
| 19 | Nova Conversa Outbound | 7 | | | | |
| | **TOTAL** | **272** | | | | |

### Legenda de Status

| Símbolo | Significado |
|:---:|---|
| `[ ]` | Não testado |
| `[x]` | Passou — comportamento correto confirmado |
| `[F]` | Falhou — comportamento incorreto ou erro |
| `[N/A]` | Não aplicável nesta versão/configuração |
| `[B]` | Bloqueado — dependência não disponível para testar |

### Critérios de Aprovação

- **Go/No-Go:** Todos os testes das secções **Segurança (16)**, **Autenticação (1)** e **Chat básico (7.1–7.3)** devem passar sem falhas.
- **Aceitável com ressalvas:** Máximo 5% de falhas nas restantes áreas, desde que nenhuma seja crítica (perda de dados, envio indevido de mensagens).
- **Reprovado:** Qualquer falha nos testes `TC-SEC-*` ou `TC-AUTH-*`, ou mais de 10% de falhas globais.

---

*Checklist gerado em 2026-05-25 — Sistema WhatsApp Multi-Atendente v1.x*