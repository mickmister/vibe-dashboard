export const KANBAN_RULE_AST_VERSION = 1;
export const KANBAN_RULE_MAX_DEPTH = 4;
export const KANBAN_RULE_MAX_NODES = 50;

export type KanbanRuleField = 'status' | 'label' | 'metadata' | 'assignee' | 'priority' | 'type';
export type KanbanRuleOperator = 'eq' | 'neq' | 'has' | 'in' | 'exists' | 'missing';

export interface KanbanRuleSubject {
  status?: string | null;
  labels?: string[];
  metadata?: Record<string, unknown>;
  assignee?: string | null;
  priority?: string | number | null;
  type?: string | null;
}

export type KanbanRule =
  | { kind: 'condition'; field: KanbanRuleField; operator: KanbanRuleOperator; value?: string | number | boolean | Array<string | number | boolean>; metadataKey?: string }
  | { kind: 'all'; rules: KanbanRule[] }
  | { kind: 'any'; rules: KanbanRule[] }
  | { kind: 'not'; rule: KanbanRule };

export type KanbanRuleValidationResult =
  | { ok: true; rule: KanbanRule; nodeCount: number }
  | { ok: false; error: { code: string; message: string; path: string } };

const allowedFields = new Set<KanbanRuleField>(['status', 'label', 'metadata', 'assignee', 'priority', 'type']);
const allowedOperators = new Set<KanbanRuleOperator>(['eq', 'neq', 'has', 'in', 'exists', 'missing']);
const metadataKeyPattern = /^[A-Za-z0-9_.-]{1,64}$/;

export function validateKanbanRuleAst(value: unknown): KanbanRuleValidationResult {
  const nodeCount = { count: 0 };
  const result = validateRuleNode(value, 1, '$', nodeCount);
  if (!result.ok) return result;
  return { ok: true, rule: result.rule, nodeCount: nodeCount.count };
}

export function matchesKanbanRule(rule: KanbanRule, subject: KanbanRuleSubject): boolean {
  switch (rule.kind) {
    case 'all':
      return rule.rules.every((child) => matchesKanbanRule(child, subject));
    case 'any':
      return rule.rules.some((child) => matchesKanbanRule(child, subject));
    case 'not':
      return !matchesKanbanRule(rule.rule, subject);
    case 'condition':
      return matchesCondition(rule, subject);
  }
}

export function filterByKanbanRule<T>(items: T[], rule: KanbanRule | null | undefined, subjectForItem: (item: T) => KanbanRuleSubject): T[] {
  if (!rule) return items;
  return items.filter((item) => matchesKanbanRule(rule, subjectForItem(item)));
}

export function firstMatchingKanbanRule<T>(
  items: T[],
  subject: KanbanRuleSubject,
  ruleForItem: (item: T) => KanbanRule | null | undefined,
): T | undefined {
  return items.find((item) => {
    const rule = ruleForItem(item);
    return rule ? matchesKanbanRule(rule, subject) : false;
  });
}

function validateRuleNode(value: unknown, depth: number, path: string, nodeCount: { count: number }): KanbanRuleValidationResult {
  if (depth > KANBAN_RULE_MAX_DEPTH) {
    return invalid('kanban_rule_too_deep', `Rules may be nested at most ${KANBAN_RULE_MAX_DEPTH} levels deep.`, path);
  }
  nodeCount.count += 1;
  if (nodeCount.count > KANBAN_RULE_MAX_NODES) {
    return invalid('kanban_rule_too_large', `Rules may contain at most ${KANBAN_RULE_MAX_NODES} nodes.`, path);
  }
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    return invalid('invalid_kanban_rule', 'Rule node must be an object with a kind.', path);
  }

  if (value.kind === 'all' || value.kind === 'any') {
    if (!Array.isArray(value.rules) || value.rules.length === 0) {
      return invalid('invalid_kanban_rule', `${value.kind} rules must contain at least one child rule.`, `${path}.rules`);
    }
    const rules: KanbanRule[] = [];
    for (let index = 0; index < value.rules.length; index += 1) {
      const child = validateRuleNode(value.rules[index], depth + 1, `${path}.rules[${index}]`, nodeCount);
      if (!child.ok) return child;
      rules.push(child.rule);
    }
    return { ok: true, rule: { kind: value.kind, rules }, nodeCount: nodeCount.count };
  }

  if (value.kind === 'not') {
    const child = validateRuleNode(value.rule, depth + 1, `${path}.rule`, nodeCount);
    if (!child.ok) return child;
    return { ok: true, rule: { kind: 'not', rule: child.rule }, nodeCount: nodeCount.count };
  }

  if (value.kind !== 'condition') {
    return invalid('invalid_kanban_rule_kind', `Unsupported rule kind '${value.kind}'.`, `${path}.kind`);
  }

  if (typeof value.field !== 'string' || !allowedFields.has(value.field as KanbanRuleField)) {
    return invalid('invalid_kanban_rule_field', 'Rule field is not supported.', `${path}.field`);
  }
  if (typeof value.operator !== 'string' || !allowedOperators.has(value.operator as KanbanRuleOperator)) {
    return invalid('invalid_kanban_rule_operator', 'Rule operator is not supported.', `${path}.operator`);
  }

  const field = value.field as KanbanRuleField;
  const operator = value.operator as KanbanRuleOperator;
  if (field === 'metadata') {
    if (typeof value.metadataKey !== 'string' || !metadataKeyPattern.test(value.metadataKey)) {
      return invalid('invalid_kanban_metadata_key', 'Metadata rules require a flat metadata key containing letters, numbers, dot, underscore, or dash.', `${path}.metadataKey`);
    }
  } else if ('metadataKey' in value && value.metadataKey !== undefined) {
    return invalid('invalid_kanban_metadata_key', 'Only metadata rules may include metadataKey.', `${path}.metadataKey`);
  }

  if ((operator === 'eq' || operator === 'neq' || operator === 'has') && !isScalarRuleValue(value.value)) {
    return invalid('invalid_kanban_rule_value', `${operator} rules require a scalar value.`, `${path}.value`);
  }
  if (operator === 'in' && !isRuleValueArray(value.value)) {
    return invalid('invalid_kanban_rule_value', 'in rules require a non-empty array of scalar values.', `${path}.value`);
  }

  return {
    ok: true,
    rule: {
      kind: 'condition',
      field,
      operator,
      value: value.value as Extract<KanbanRule, { kind: 'condition' }>['value'],
      metadataKey: typeof value.metadataKey === 'string' ? value.metadataKey : undefined,
    },
    nodeCount: nodeCount.count,
  };
}

function matchesCondition(rule: Extract<KanbanRule, { kind: 'condition' }>, subject: KanbanRuleSubject): boolean {
  const value = valueForField(rule, subject);
  switch (rule.operator) {
    case 'exists':
      return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
    case 'missing':
      return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
    case 'eq':
      return scalarEquals(value, rule.value);
    case 'neq':
      return !scalarEquals(value, rule.value);
    case 'has':
      return Array.isArray(value) ? value.some((item) => scalarEquals(item, rule.value)) : scalarEquals(value, rule.value);
    case 'in':
      return Array.isArray(rule.value) ? rule.value.some((candidate) => scalarEquals(value, candidate)) : false;
  }
}

function valueForField(rule: Extract<KanbanRule, { kind: 'condition' }>, subject: KanbanRuleSubject): unknown {
  switch (rule.field) {
    case 'status':
      return subject.status;
    case 'label':
      return subject.labels ?? [];
    case 'metadata':
      return rule.metadataKey ? subject.metadata?.[rule.metadataKey] : undefined;
    case 'assignee':
      return subject.assignee;
    case 'priority':
      return subject.priority;
    case 'type':
      return subject.type;
  }
}

function scalarEquals(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || right === undefined || right === null) return left === right;
  return String(left).toLocaleLowerCase() === String(right).toLocaleLowerCase();
}

function invalid(code: string, message: string, path: string): KanbanRuleValidationResult {
  return { ok: false, error: { code, message, path } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isScalarRuleValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRuleValueArray(value: unknown): value is Array<string | number | boolean> {
  return Array.isArray(value) && value.length > 0 && value.every(isScalarRuleValue);
}
