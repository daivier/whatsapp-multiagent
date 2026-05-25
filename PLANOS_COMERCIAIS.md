# Planos Comerciais — WhatsApp Multi-Atendente

> Documento interno de estratégia comercial.  
> Última atualização: 2026-05-25

---

## Planos

### Básico — R$ 197/mês
**Para negócios pequenos começando no WhatsApp**

- 1 linha WhatsApp
- Até 3 atendentes
- 1 departamento
- Mensagens de texto e ficheiros
- Bot de boas-vindas
- Histórico de conversas
- ❌ Sem agendamento de mensagens
- ❌ Sem relatórios/export
- ❌ Sem operações em massa

---

### Profissional — R$ 397/mês
**Para equipes que precisam de organização**

- Até 2 linhas WhatsApp
- Até 10 atendentes
- Até 3 departamentos
- Tudo do Básico, mais:
- Agendamento de mensagens
- Etiquetas e prioridades
- Transferência entre atendentes e departamentos
- Avaliação de atendimento (rating 1–5)
- Respostas rápidas (atalho `/`)
- Export CSV de conversas
- SLA alerts

---

### Empresarial — R$ 797/mês
**Para operações maiores com múltiplos canais**

- Linhas ilimitadas
- Atendentes ilimitados
- Departamentos ilimitados
- Tudo do Profissional, mais:
- Operações em massa (fechar, transferir, etiquetar, apagar)
- Logs de transferência
- Snooze / Agendamento avançado
- API de integração *(roadmap)*
- Suporte prioritário

---

## Add-ons (cobranças adicionais)

| Item | Preço |
|---|---|
| Linha WhatsApp adicional | R$ 79/mês |
| Atendente adicional (acima do limite do plano) | R$ 29/mês |
| Setup e onboarding | R$ 297 (único) |
| Personalização de bot e fluxos | R$ 497 (único) |

---

## Desconto Anual

Oferecer **2 meses grátis** no pagamento anual (equivale a ~16% de desconto):

| Plano | Mensal | Anual (10x) |
|---|---|---|
| Básico | R$ 197/mês | R$ 1.970/ano |
| Profissional | R$ 397/mês | R$ 3.970/ano |
| Empresarial | R$ 797/mês | R$ 7.970/ano |

---

## Projeção de Receita

| Clientes | Plano | MRR |
|---|---|---|
| 3 | Profissional | R$ 1.191/mês |
| 10 | Profissional | R$ 3.970/mês |
| 5 Profissional + 2 Empresarial | Mix | R$ 3.579/mês |
| 20 | Mix (média R$ 450) | R$ 9.000/mês |

> A infra atual (1 VPS) aguenta ~15 clientes sem upgrade de servidor.

---

## Notas Estratégicas

- **Âncora no Profissional** — é o plano que a maioria vai querer. O Básico existe para converter, o Empresarial para não deixar dinheiro na mesa.
- **Cobrar por linha, não por conversa** — mais simples de vender; o cliente não fica com medo de usar.
- **Setup obrigatório** — garante que o cliente começa bem, reduz suporte e já cobre parte do custo inicial.
- **Contrato com disclaimer Baileys** — deixar claro no contrato que o serviço usa conexão não oficial do WhatsApp e que banimentos de número, embora raros, são de responsabilidade do cliente.

---

## Risco Principal

O sistema usa **Baileys** (API não oficial do WhatsApp). Riscos:
- WhatsApp pode banir números detectados como automação não oficial
- Meta pode alterar o protocolo e quebrar a integração sem aviso

**Mitigação a médio prazo:** preparar suporte à **WhatsApp Business API oficial** (via Twilio, 360dialog ou Meta diretamente) para clientes maiores e mais exigentes.
