import { FORMULA_VARIABLES, FORMULA_COMPARISONS } from './formula-registry';
// Allowlisted arithmetic and MIN/MAX only; no properties, strings or executable code.
export type FormulaNode =
  | {
      kind: 'if';
      condition: FormulaNode;
      then: FormulaNode;
      otherwise: FormulaNode;
    }
  | { kind: 'compare'; op: string; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: 'MIN' | 'MAX'; args: FormulaNode[] }
  | { kind: 'number'; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode };
export const formulaVariables: Record<string, string | null> =
  Object.fromEntries(
    FORMULA_VARIABLES.map((v) => [v.id, v.componentCode ?? null]),
  );
const friendlyVariables: Record<string, string> = Object.fromEntries(
  FORMULA_VARIABLES.flatMap((v) =>
    [v.label, ...(v.aliases ?? [])].map((label) => [label, v.id]),
  ),
);
const labels = Object.keys(friendlyVariables).sort(
  (a, b) => b.length - a.length,
);
export function parseFormula(expression: unknown): {
  root: FormulaNode;
  variables: string[];
} {
  if (
    typeof expression !== 'string' ||
    !expression.trim() ||
    expression.length > 1024
  )
    throw new Error('Formula must contain 1 to 1024 characters.');
  const tokens: string[] = [];
  let offset = 0;
  while (offset < expression.length) {
    if (/\s/.test(expression[offset])) {
      offset++;
      continue;
    }
    const label = labels.find((label) =>
      new RegExp(
        '^' + label.replaceAll(' ', '\\s+') + '(?![A-Za-z0-9_])',
        'i',
      ).test(expression.slice(offset)),
    );
    if (label) {
      const match = new RegExp('^' + label.replaceAll(' ', '\\s+'), 'i').exec(
        expression.slice(offset),
      )!;
      tokens.push(friendlyVariables[label]);
      offset += match[0].length;
      continue;
    }
    const match =
      /^(?:\d+(?:\.\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|<=|>=|!=|[=<>(),%+*/-])/.exec(
        expression.slice(offset),
      );
    if (!match)
      throw new Error(
        'Unsupported formula character at position ' + (offset + 1) + '.',
      );
    tokens.push(match[0]);
    offset += match[0].length;
    if (tokens.length > 256)
      throw new Error('Formula is too complex (maximum 256 tokens).');
  }
  if (tokens.length > 256)
    throw new Error('Formula is too complex (maximum 256 tokens).');
  let index = 0,
    depth = 0;
  const variables = new Set<string>();
  const atom = (): FormulaNode => {
    if (++depth > 48) throw new Error('Formula nesting exceeds 48 levels.');
    let token = tokens[index++];
    if (token)
      token =
        Object.keys(formulaVariables).find(
          (name) => name.toLowerCase() === token.toLowerCase(),
        ) ??
        (/^component_[a-f0-9]{24}$/i.test(token) ? token.toLowerCase() : token);
    let node: FormulaNode;
    if (token === '+' || token === '-') {
      const right = atom();
      node =
        token === '+'
          ? right
          : {
              kind: 'binary',
              op: '-',
              left: { kind: 'number', value: '0' },
              right,
            };
    } else if (token?.toUpperCase() === 'IF') {
      if (tokens[index++] !== '(') throw new Error('IF requires parentheses.');
      const condition = comparison();
      if (condition.kind !== 'compare')
        throw new Error('IF requires a comparison condition.');
      if (tokens[index++] !== ',')
        throw new Error('IF requires a THEN expression after a comma.');
      const then = comparison();
      if (tokens[index++] !== ',')
        throw new Error('IF requires an ELSE expression after a comma.');
      const otherwise = comparison();
      if (tokens[index++] !== ')')
        throw new Error(
          'IF requires exactly three arguments and a closing parenthesis.',
        );
      node = { kind: 'if', condition, then, otherwise };
    } else if (token && ['MIN', 'MAX'].includes(token.toUpperCase())) {
      if (tokens[index++] !== '(')
        throw new Error('MIN/MAX requires parentheses.');
      const args: FormulaNode[] = [];
      if (tokens[index] !== ')') {
        args.push(comparison());
        while (tokens[index] === ',') {
          index++;
          args.push(comparison());
        }
      }
      if (tokens[index++] !== ')')
        throw new Error('MIN/MAX requires a closing parenthesis.');
      if (args.length < 2 || args.length > 8)
        throw new Error('MIN/MAX requires 2 to 8 arguments.');
      node = { kind: 'call', name: token.toUpperCase() as 'MIN' | 'MAX', args };
    } else if (token === '(') {
      node = comparison();
      if (tokens[index++] !== ')')
        throw new Error('Formula requires a closing parenthesis.');
    } else if (token && /^(?:\d|\.)/.test(token)) {
      node = { kind: 'number', value: token };
      if (tokens[index] === '%') {
        index++;
        node = {
          kind: 'binary',
          op: '/',
          left: node,
          right: { kind: 'number', value: '100' },
        };
      }
    } else if (
      token &&
      (/^component_[a-f0-9]{24}$/.test(token) ||
        Object.hasOwn(formulaVariables, token))
    ) {
      variables.add(token);
      node = { kind: 'variable', name: token };
    } else
      throw new Error(
        'Unsupported or missing formula variable: ' +
          (token ?? 'end of expression') +
          '.',
      );
    depth--;
    return node;
  };
  const multiply = (): FormulaNode => {
    let left = atom();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++];
      left = { kind: 'binary', op, left, right: atom() };
    }
    return left;
  };
  const add = (): FormulaNode => {
    let left = multiply();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++];
      left = { kind: 'binary', op, left, right: multiply() };
    }
    return left;
  };
  const comparison = (): FormulaNode => {
    const left = add();
    if ((FORMULA_COMPARISONS as readonly string[]).includes(tokens[index])) {
      const op = tokens[index++];
      return { kind: 'compare', op, left, right: add() };
    }
    return left;
  };
  const root = comparison();
  const validateType = (node: FormulaNode, boolean = false): void => {
    if ((node.kind === 'compare') !== boolean)
      throw new Error(
        boolean
          ? 'IF requires a comparison condition.'
          : 'A comparison can only be used as an IF condition.',
      );
    if (node.kind === 'if') {
      validateType(node.condition, true);
      validateType(node.then);
      validateType(node.otherwise);
    } else if (node.kind === 'binary' || node.kind === 'compare') {
      validateType(node.left);
      validateType(node.right);
    } else if (node.kind === 'call')
      node.args.forEach((arg) => validateType(arg));
  };
  validateType(root);
  if (index !== tokens.length)
    throw new Error('Unexpected formula token: ' + tokens[index] + '.');
  return { root, variables: [...variables] };
}
