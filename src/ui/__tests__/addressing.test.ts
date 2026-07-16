import { describe, expect, it } from 'vitest';
import { createAgent } from '../../domain/factories';
import { addressableAgents, mentionSuggestions, parseMention } from '../addressing';

const base = createAgent();
const agents = [
  createAgent({ name: 'Alice' }),
  createAgent({ name: 'Alice Smith' }),
  createAgent({ name: 'Bob' }),
  createAgent({ name: 'Sum', kind: 'summarizer' }),
  createAgent({ name: 'Off', runtime: { ...base.runtime, enabled: false } }),
];
const addressable = addressableAgents(agents);

describe('addressableAgents', () => {
  it('excludes terminal kinds and disabled agents', () => {
    expect(addressable.map((a) => a.name)).toEqual(['Alice', 'Alice Smith', 'Bob']);
  });
});

describe('parseMention', () => {
  it('parses a leading @Name and returns the remaining message', () => {
    const m = parseMention('@Bob what do you think?', addressable);
    expect(m?.target.name).toBe('Bob');
    expect(m?.message).toBe('what do you think?');
  });

  it('is case-insensitive and prefers the longest matching name', () => {
    expect(parseMention('@bob hi', addressable)?.target.name).toBe('Bob');
    const m = parseMention('@Alice Smith your view?', addressable);
    expect(m?.target.name).toBe('Alice Smith');
    expect(m?.message).toBe('your view?');
  });

  it('strips a separator after the name', () => {
    expect(parseMention('@Bob, your view?', addressable)?.message).toBe('your view?');
  });

  it('returns null without a leading @ or for an unknown name', () => {
    expect(parseMention('Bob what do you think?', addressable)).toBeNull();
    expect(parseMention('@Nobody hi', addressable)).toBeNull();
  });

  it('parses a bare mention with an empty message (caller decides to block send)', () => {
    const m = parseMention('@Bob', addressable);
    expect(m?.target.name).toBe('Bob');
    expect(m?.message).toBe('');
  });
});

describe('mentionSuggestions', () => {
  it('suggests names matching the partial token', () => {
    expect(mentionSuggestions('@Al', addressable).map((a) => a.name)).toEqual(['Alice', 'Alice Smith']);
  });

  it('offers nothing once a mention fully parses or without an @', () => {
    expect(mentionSuggestions('@Bob hi', addressable)).toEqual([]);
    expect(mentionSuggestions('plain text', addressable)).toEqual([]);
  });
});
