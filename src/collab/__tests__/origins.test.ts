import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { ORIGIN, classifyOrigin, triggersWriteback, isUndoable, TRACKED_ORIGINS } from '../origins';

describe('classifyOrigin', () => {
  it('classifies LOCAL origin', () => {
    expect(classifyOrigin(ORIGIN.LOCAL)).toBe('local');
    expect(classifyOrigin('local')).toBe('local');
  });

  it('classifies SHEETS origin', () => {
    expect(classifyOrigin(ORIGIN.SHEETS)).toBe('sheets');
    expect(classifyOrigin('sheets')).toBe('sheets');
  });

  it('classifies INIT origin', () => {
    expect(classifyOrigin(ORIGIN.INIT)).toBe('init');
    expect(classifyOrigin('init')).toBe('init');
  });

  it('classifies Y.UndoManager instance as undo', () => {
    const doc = new Y.Doc();
    const um = new Y.UndoManager(doc.getMap('test'));
    expect(classifyOrigin(um)).toBe('undo');
    um.destroy();
    doc.destroy();
  });

  it('classifies mock WebSocket provider as remote', () => {
    const fakeProvider = { ws: {} };
    expect(classifyOrigin(fakeProvider)).toBe('remote');
  });

  it('classifies null as unknown', () => {
    expect(classifyOrigin(null)).toBe('unknown');
  });

  it('classifies undefined as unknown', () => {
    expect(classifyOrigin(undefined)).toBe('unknown');
  });

  it('classifies arbitrary string as unknown', () => {
    expect(classifyOrigin('something-else')).toBe('unknown');
  });

  it('classifies object without ws as unknown', () => {
    expect(classifyOrigin({ foo: 'bar' })).toBe('unknown');
  });
});

describe('triggersWriteback', () => {
  it('returns true for local origin', () => {
    expect(triggersWriteback(ORIGIN.LOCAL)).toBe(true);
  });

  it('returns true for UndoManager origin', () => {
    const doc = new Y.Doc();
    const um = new Y.UndoManager(doc.getMap('test'));
    expect(triggersWriteback(um)).toBe(true);
    um.destroy();
    doc.destroy();
  });

  it('returns false for sheets origin', () => {
    expect(triggersWriteback(ORIGIN.SHEETS)).toBe(false);
  });

  it('returns false for init origin', () => {
    expect(triggersWriteback(ORIGIN.INIT)).toBe(false);
  });

  it('returns false for remote (WebSocket provider) origin', () => {
    expect(triggersWriteback({ ws: {} })).toBe(false);
  });

  it('returns false for null', () => {
    expect(triggersWriteback(null)).toBe(false);
  });
});

describe('isUndoable', () => {
  it('returns true only for LOCAL', () => {
    expect(isUndoable(ORIGIN.LOCAL)).toBe(true);
  });

  it('returns false for sheets', () => {
    expect(isUndoable(ORIGIN.SHEETS)).toBe(false);
  });

  it('returns false for init', () => {
    expect(isUndoable(ORIGIN.INIT)).toBe(false);
  });

  it('returns false for UndoManager', () => {
    const doc = new Y.Doc();
    const um = new Y.UndoManager(doc.getMap('test'));
    expect(isUndoable(um)).toBe(false);
    um.destroy();
    doc.destroy();
  });

  it('returns false for null', () => {
    expect(isUndoable(null)).toBe(false);
  });
});

describe('TRACKED_ORIGINS', () => {
  it('contains only LOCAL', () => {
    expect(TRACKED_ORIGINS.size).toBe(1);
    expect(TRACKED_ORIGINS.has(ORIGIN.LOCAL)).toBe(true);
    expect(TRACKED_ORIGINS.has(ORIGIN.SHEETS)).toBe(false);
    expect(TRACKED_ORIGINS.has(ORIGIN.INIT)).toBe(false);
  });
});
