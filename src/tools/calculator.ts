import { z } from 'zod';
import type { ToolDefinition } from './types';

/**
 * Local arithmetic evaluator — shunting-yard over a small token set, no eval,
 * no Function, no dependency. Supports + - * / % ^, unary minus, parentheses,
 * and one-argument functions sqrt/abs/ln/log/round/floor/ceil, plus the
 * constants pi and e.
 */

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; op: string }
  | { kind: 'fn'; fn: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3, 'neg': 4 };
const RIGHT_ASSOC = new Set(['^', 'neg']);

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = expr.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      if (!m) throw new Error(`Invalid number at position ${i}`);
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const m = expr.slice(i).match(/^[a-zA-Z]+/);
      const word = m![0].toLowerCase();
      if (word in CONSTANTS) tokens.push({ kind: 'num', value: CONSTANTS[word] });
      else if (word in FUNCTIONS) tokens.push({ kind: 'fn', fn: word });
      else throw new Error(`Unknown identifier "${word}"`);
      i += word.length;
      continue;
    }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if ('+-*/%^'.includes(ch)) { tokens.push({ kind: 'op', op: ch }); i++; continue; }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return tokens;
}

/** Convert to reverse Polish notation (shunting-yard), treating unary minus as 'neg'. */
function toRpn(tokens: Token[]): (Token | { kind: 'op'; op: 'neg' })[] {
  const out: Token[] = [];
  const stack: Token[] = [];
  let prev: Token | null = null;
  for (const raw of tokens) {
    let t = raw;
    // Unary minus: at the start, after an operator, or after '('.
    if (t.kind === 'op' && t.op === '-' && (!prev || prev.kind === 'op' || prev.kind === 'lparen' || prev.kind === 'fn')) {
      t = { kind: 'op', op: 'neg' };
    }
    if (t.kind === 'num') out.push(t);
    else if (t.kind === 'fn') stack.push(t);
    else if (t.kind === 'op') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.kind === 'fn') { out.push(stack.pop()!); continue; }
        if (top.kind !== 'op') break;
        const higher =
          PRECEDENCE[top.op] > PRECEDENCE[t.op] ||
          (PRECEDENCE[top.op] === PRECEDENCE[t.op] && !RIGHT_ASSOC.has(t.op));
        if (!higher) break;
        out.push(stack.pop()!);
      }
      stack.push(t);
    } else if (t.kind === 'lparen') stack.push(t);
    else {
      // rparen
      let matched = false;
      while (stack.length > 0) {
        const top = stack.pop()!;
        if (top.kind === 'lparen') { matched = true; break; }
        out.push(top);
      }
      if (!matched) throw new Error('Mismatched parentheses');
      if (stack.length > 0 && stack[stack.length - 1].kind === 'fn') out.push(stack.pop()!);
    }
    prev = raw;
  }
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.kind === 'lparen') throw new Error('Mismatched parentheses');
    out.push(top);
  }
  return out;
}

export function evaluateExpression(expr: string): number {
  const rpn = toRpn(tokenize(expr));
  const stack: number[] = [];
  for (const t of rpn) {
    if (t.kind === 'num') stack.push(t.value);
    else if (t.kind === 'fn') {
      if (stack.length < 1) throw new Error('Malformed expression');
      stack.push(FUNCTIONS[t.fn](stack.pop()!));
    } else if (t.kind === 'op') {
      if (t.op === 'neg') {
        if (stack.length < 1) throw new Error('Malformed expression');
        stack.push(-stack.pop()!);
        continue;
      }
      if (stack.length < 2) throw new Error('Malformed expression');
      const b = stack.pop()!;
      const a = stack.pop()!;
      switch (t.op) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/': stack.push(a / b); break;
        case '%': stack.push(a % b); break;
        case '^': stack.push(a ** b); break;
        default: throw new Error(`Unknown operator "${t.op}"`);
      }
    }
  }
  if (stack.length !== 1) throw new Error('Malformed expression');
  const result = stack[0];
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}

const CalculatorInput = z.object({ expression: z.string().min(1) });

export const calculatorTool: ToolDefinition<z.infer<typeof CalculatorInput>> = {
  id: 'calculator',
  name: 'Calculator',
  description: 'Evaluate an arithmetic expression (+ - * / % ^, parentheses, sqrt/abs/ln/log/round, pi, e).',
  inputHint: '{"expression": string}',
  inputSchema: CalculatorInput,
  execute: ({ expression }) => Promise.resolve(`${expression} = ${evaluateExpression(expression)}`),
};
