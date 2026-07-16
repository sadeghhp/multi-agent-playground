import { describe, expect, it } from 'vitest';
import { calculatorTool, evaluateExpression } from '../calculator';

describe('evaluateExpression', () => {
  it('handles precedence and parentheses', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
    expect(evaluateExpression('10 / 4')).toBe(2.5);
    expect(evaluateExpression('10 % 3')).toBe(1);
  });

  it('handles right-associative exponentiation', () => {
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512);
  });

  it('handles unary minus', () => {
    expect(evaluateExpression('-3 + 5')).toBe(2);
    expect(evaluateExpression('2 * -3')).toBe(-6);
    expect(evaluateExpression('-(2 + 3)')).toBe(-5);
  });

  it('handles functions and constants', () => {
    expect(evaluateExpression('sqrt(16)')).toBe(4);
    expect(evaluateExpression('abs(-7)')).toBe(7);
    expect(evaluateExpression('log(1000)')).toBe(3);
    expect(evaluateExpression('round(2.6)')).toBe(3);
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI);
  });

  it('rejects malformed expressions', () => {
    expect(() => evaluateExpression('2 +')).toThrow();
    expect(() => evaluateExpression('(2 + 3')).toThrow();
    expect(() => evaluateExpression('2 + 3)')).toThrow();
    expect(() => evaluateExpression('foo(2)')).toThrow(/Unknown identifier/);
    expect(() => evaluateExpression('2; alert(1)')).toThrow();
  });

  it('rejects non-finite results', () => {
    expect(() => evaluateExpression('1 / 0')).toThrow(/finite/);
  });
});

describe('calculatorTool', () => {
  it('returns expression = result text', async () => {
    const out = await calculatorTool.execute({ expression: '6 * 7' }, new AbortController().signal);
    expect(out).toBe('6 * 7 = 42');
  });
});
