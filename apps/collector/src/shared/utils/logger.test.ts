import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const methods = ['debug', 'log', 'info', 'warn', 'error'] as const;
const originalConsole = { ...console };
const levelCases = [
  { level: 'debug', expected: [1, 1, 1, 1, 1] },
  { level: 'info', expected: [0, 1, 1, 1, 1] },
  { level: 'warn', expected: [0, 0, 0, 1, 1] },
  { level: 'error', expected: [0, 0, 0, 0, 1] },
];

describe('applyLogLevel', () => {
  let spies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('LOG_LEVEL', undefined);
    spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const method of methods) console[method] = originalConsole[method];
    vi.unstubAllEnvs();
  });

  function expectForwarding(expected: number[]): void {
    const detail = { context: 'logger test' };
    methods.forEach((method, index) => {
      console[method]('message', detail);
      expect(spies[index]).toHaveBeenCalledTimes(expected[index]);
      if (expected[index]) expect(spies[index]).toHaveBeenLastCalledWith('message', detail);
    });
    expect(console.error).toBe(spies[4]);
  }

  it.each(levelCases)('forwards the expected methods at $level', async ({ level, expected }) => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel(level);
    expectForwarding(expected);
  });

  it.each(levelCases)('accepts uppercase $level', async ({ level, expected }) => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel(level.toUpperCase());
    expectForwarding(expected);
  });

  it('accepts mixed case', async () => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel('WaRn');
    expectForwarding([0, 0, 0, 1, 1]);
  });

  it('defaults to info when LOG_LEVEL is unset', async () => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel();
    expectForwarding([0, 1, 1, 1, 1]);
  });

  it('reads LOG_LEVEL when no argument is provided', async () => {
    const { applyLogLevel } = await import('./logger.js');
    vi.stubEnv('LOG_LEVEL', 'ERROR');
    applyLogLevel();
    expectForwarding([0, 0, 0, 0, 1]);
  });

  it.each(['', '  '])('treats an empty LOG_LEVEL ("%s") as unset', async (level) => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel(level);
    expect(spies[3]).not.toHaveBeenCalled();
    expectForwarding([0, 1, 1, 1, 1]);
  });

  it.each(['verbose'])('warns once and falls back to info for "%s"', async (level) => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel(level);
    expect(spies[3]).toHaveBeenCalledExactlyOnceWith(
      `[Logger] Unknown LOG_LEVEL=${level}, falling back to info`,
    );
    vi.clearAllMocks();
    expectForwarding([0, 1, 1, 1, 1]);
  });

  it('restores methods when verbosity increases', async () => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel('error');
    applyLogLevel('debug');
    expectForwarding([1, 1, 1, 1, 1]);
  });

  it('still warns once for an invalid level after error', async () => {
    const { applyLogLevel } = await import('./logger.js');
    applyLogLevel('error');
    applyLogLevel('invalid');
    expect(spies[3]).toHaveBeenCalledExactlyOnceWith(
      '[Logger] Unknown LOG_LEVEL=invalid, falling back to info',
    );
    vi.clearAllMocks();
    expectForwarding([0, 1, 1, 1, 1]);
  });
});
