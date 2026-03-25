import { describe, it, expect } from 'vitest';
import { fakeTasks } from '../../../data/fakeData';
import { findWorkstreamAncestor } from '../../../utils/hierarchyUtils';

describe('OKR seed data', () => {
  it('workstream summary tasks have OKRs populated', () => {
    const taskMap = new Map(fakeTasks.map((t) => [t.id, t]));

    const pe = taskMap.get('pe')!;
    expect(pe.okrs).toEqual([
      'KR: API p99 latency < 200ms',
      'KR: Zero-downtime migration',
      'KR: 99.9% uptime SLA',
    ]);

    const ux = taskMap.get('ux')!;
    expect(ux.okrs).toEqual([
      'KR: User satisfaction > 4.5/5',
      'KR: Ship design system v2',
      'KR: WCAG 2.1 AA compliance',
    ]);

    const gtm = taskMap.get('gtm')!;
    expect(gtm.okrs).toEqual([
      'KR: 20% market share increase',
      'KR: 3x website conversion rate',
      'KR: 50 published content pieces',
    ]);
  });

  it('leaf tasks can find their workstream ancestor OKRs', () => {
    const taskMap = new Map(fakeTasks.map((t) => [t.id, t]));

    // PE leaf task should find PE workstream
    const pe1 = taskMap.get('pe-1')!;
    const peWorkstream = findWorkstreamAncestor(pe1, taskMap);
    expect(peWorkstream).toBeDefined();
    expect(peWorkstream!.id).toBe('pe');
    expect(peWorkstream!.okrs.length).toBeGreaterThan(0);

    // UX leaf task should find UX workstream
    const ux1 = taskMap.get('ux-1')!;
    const uxWorkstream = findWorkstreamAncestor(ux1, taskMap);
    expect(uxWorkstream).toBeDefined();
    expect(uxWorkstream!.id).toBe('ux');

    // GTM leaf task should find GTM workstream
    const gtm1 = taskMap.get('gtm-1')!;
    const gtmWorkstream = findWorkstreamAncestor(gtm1, taskMap);
    expect(gtmWorkstream).toBeDefined();
    expect(gtmWorkstream!.id).toBe('gtm');
  });
});
