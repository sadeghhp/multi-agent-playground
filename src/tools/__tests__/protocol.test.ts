import { describe, expect, it } from 'vitest';
import { calculatorTool } from '../calculator';
import {
  buildToolProtocolSection,
  detectToolCall,
  stripToolFences,
  toolResultMessage,
} from '../protocol';
import { wikipediaSearchTool } from '../wikipedia';

const TOOLS = [wikipediaSearchTool, calculatorTool];

const fence = (body: string) => '```tool\n' + body + '\n```';

describe('detectToolCall', () => {
  it('returns null when there is no tool fence', () => {
    expect(detectToolCall('Just a normal answer with a fact.', TOOLS)).toBeNull();
    expect(detectToolCall('```json\n{"tool": "x"}\n```', TOOLS)).toBeNull();
  });

  it('detects a valid call with prose around it', () => {
    const text = 'Let me check that.\n\n' + fence('{"tool": "wikipedia_search", "input": {"query": "graphene"}}');
    const call = detectToolCall(text, TOOLS);
    expect(call?.kind).toBe('call');
    if (call?.kind === 'call') {
      expect(call.def.id).toBe('wikipedia_search');
      expect(call.input).toEqual({ query: 'graphene' });
    }
  });

  it('uses only the first fence when several are present', () => {
    const text =
      fence('{"tool": "calculator", "input": {"expression": "1+1"}}') +
      '\n' +
      fence('{"tool": "wikipedia_search", "input": {"query": "x"}}');
    const call = detectToolCall(text, TOOLS);
    expect(call?.kind).toBe('call');
    if (call?.kind === 'call') expect(call.def.id).toBe('calculator');
  });

  it('ignores fences inside <think> blocks', () => {
    const text =
      '<think>maybe I should call ' +
      fence('{"tool": "calculator", "input": {"expression": "1+1"}}') +
      '</think>The answer is 2.';
    expect(detectToolCall(text, TOOLS)).toBeNull();
  });

  it('returns an error result for invalid JSON (consumes a round, never fails the turn)', () => {
    const call = detectToolCall(fence('not json at all'), TOOLS);
    expect(call?.kind).toBe('error');
    if (call?.kind === 'error') expect(call.error).toMatch(/^ERROR: /);
  });

  it('returns an error result for an unknown tool listing available ones', () => {
    const call = detectToolCall(fence('{"tool": "rm_rf", "input": {}}'), TOOLS);
    expect(call?.kind).toBe('error');
    if (call?.kind === 'error') {
      expect(call.error).toContain('unknown tool "rm_rf"');
      expect(call.error).toContain('wikipedia_search');
    }
  });

  it('returns an error result for input that fails the tool schema', () => {
    const call = detectToolCall(fence('{"tool": "wikipedia_search", "input": {"q": "oops"}}'), TOOLS);
    expect(call?.kind).toBe('error');
    if (call?.kind === 'error') {
      expect(call.error).toContain('invalid input for wikipedia_search');
      expect(call.error).toContain('{"query": string}');
    }
  });

  it('tolerates prose inside the fence around the JSON object', () => {
    const call = detectToolCall(fence('I will call: {"tool": "calculator", "input": {"expression": "2*3"}}'), TOOLS);
    expect(call?.kind).toBe('call');
  });
});

describe('stripToolFences', () => {
  it('removes all tool fences and trims', () => {
    const text = 'Answer so far.\n' + fence('{"tool": "calculator", "input": {"expression": "1"}}');
    expect(stripToolFences(text)).toBe('Answer so far.');
  });

  it('leaves normal fences alone', () => {
    const text = '```json\n{"a": 1}\n```';
    expect(stripToolFences(text)).toBe(text);
  });
});

describe('toolResultMessage', () => {
  it('labels the result and states remaining budget', () => {
    const msg = toolResultMessage('wikipedia_search', 'result text', 2);
    expect(msg).toContain('[tool_result: wikipedia_search]');
    expect(msg).toContain('result text');
    expect(msg).toContain('2 tool calls remaining');
  });

  it('demands a final answer when the budget is exhausted', () => {
    const msg = toolResultMessage('calculator', 'x = 1', 0);
    expect(msg).toContain('no tool calls left');
    expect(msg).toContain('do not emit another tool block');
  });
});

describe('buildToolProtocolSection', () => {
  it('lists tools with input hints and the exact fence format', () => {
    const section = buildToolProtocolSection(TOOLS);
    expect(section).toContain('wikipedia_search — ');
    expect(section).toContain('Input: {"query": string}');
    expect(section).toContain('```tool');
    expect(section).toContain('"tool": "wikipedia_search"');
    expect(section).toContain('at most 3 tool calls per turn');
    expect(section).toContain('Never invent tool results or citations');
  });
});
