import { describe, expect, it } from 'vitest';
import {
  filterByKanbanRule,
  firstMatchingKanbanRule,
  KANBAN_RULE_MAX_NODES,
  matchesKanbanRule,
  validateKanbanRuleAst,
  type KanbanRule,
} from './ruleAst';

describe('Kanban rule AST', () => {
  it('allows bounded all/any/not compound rules at depth 4', () => {
    const result = validateKanbanRuleAst({
      kind: 'all',
      rules: [
        { kind: 'condition', field: 'status', operator: 'eq', value: 'open' },
        {
          kind: 'any',
          rules: [
            { kind: 'condition', field: 'label', operator: 'has', value: 'spike' },
            {
              kind: 'not',
              rule: { kind: 'condition', field: 'metadata', metadataKey: 'agent-role', operator: 'eq', value: 'review' },
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(matchesKanbanRule(result.rule, {
      status: 'open',
      labels: ['spike'],
      metadata: { 'agent-role': 'impl' },
    })).toBe(true);
  });

  it('rejects rules deeper than depth 4 and larger than 50 nodes', () => {
    expect(validateKanbanRuleAst({
      kind: 'not',
      rule: {
        kind: 'not',
        rule: {
          kind: 'not',
          rule: {
            kind: 'not',
            rule: { kind: 'condition', field: 'status', operator: 'eq', value: 'open' },
          },
        },
      },
    })).toMatchObject({ ok: false, error: { code: 'kanban_rule_too_deep' } });

    const tooManyRules = Array.from({ length: KANBAN_RULE_MAX_NODES }, () => ({ kind: 'condition', field: 'status', operator: 'exists' }));
    expect(validateKanbanRuleAst({ kind: 'all', rules: tooManyRules })).toMatchObject({ ok: false, error: { code: 'kanban_rule_too_large' } });
  });

  it('rejects invalid fields, operators, and metadata keys', () => {
    expect(validateKanbanRuleAst({ kind: 'condition', field: 'workspace', operator: 'eq', value: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_kanban_rule_field' },
    });
    expect(validateKanbanRuleAst({ kind: 'condition', field: 'status', operator: 'regex', value: 'open' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_kanban_rule_operator' },
    });
    expect(validateKanbanRuleAst({ kind: 'condition', field: 'metadata', metadataKey: '../secret', operator: 'exists' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_kanban_metadata_key' },
    });
  });

  it('handles label arrays and missing fields predictably', () => {
    const hasSpike: KanbanRule = { kind: 'condition', field: 'label', operator: 'has', value: 'spike' };
    const assigneeMissing: KanbanRule = { kind: 'condition', field: 'assignee', operator: 'missing' };
    expect(matchesKanbanRule(hasSpike, { labels: ['bug', 'spike'] })).toBe(true);
    expect(matchesKanbanRule(hasSpike, { labels: ['bug'] })).toBe(false);
    expect(matchesKanbanRule(assigneeMissing, { labels: [] })).toBe(true);
    expect(matchesKanbanRule(assigneeMissing, { assignee: 'Ada' })).toBe(false);
  });

  it('filters cards and uses first matching placement rule with caller fallbacks', () => {
    const cards = [
      { id: 'one', status: 'open', labels: ['impl'] },
      { id: 'two', status: 'closed', labels: ['review'] },
    ];
    const visible = filterByKanbanRule(
      cards,
      { kind: 'condition', field: 'status', operator: 'neq', value: 'closed' },
      (card) => ({ status: card.status, labels: card.labels }),
    );
    expect(visible.map((card) => card.id)).toEqual(['one']);

    const columns = [
      { id: 'review', rule: { kind: 'condition', field: 'label', operator: 'has', value: 'review' } as KanbanRule },
      { id: 'implementation', rule: { kind: 'condition', field: 'label', operator: 'has', value: 'impl' } as KanbanRule },
    ];
    const matched = firstMatchingKanbanRule(columns, { status: 'open', labels: ['impl'] }, (column) => column.rule);
    expect(matched?.id).toBe('implementation');
  });
});
