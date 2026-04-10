import { describe, it, expect } from 'vitest';
import { generateId } from './config';

describe('generateId', () => {
  it('includes parent and base directory', () => {
    expect(generateId('/home/user/projects/dist')).toBe('projects-dist');
  });

  it('differentiates paths with same basename', () => {
    const idA = generateId('/home/user/a/dist');
    const idB = generateId('/home/user/b/dist');
    expect(idA).not.toBe(idB);
    expect(idA).toBe('a-dist');
    expect(idB).toBe('b-dist');
  });

  it('lowercases and strips non-alphanumeric chars', () => {
    expect(generateId('/mnt/c/My Project/Output')).toBe('my-project-output');
  });

  it('strips leading and trailing hyphens', () => {
    expect(generateId('/-foo-/bar')).toBe('foo-bar');
  });
});
