import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../../../src/events/common/event-bus.js';

describe('event bus', () => {
  it('gives the payload to every handler of the event', async () => {
    const bus = createEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.on('user.deleted', first);
    bus.on('user.deleted', second);

    await bus.emit('user.deleted', { userId: 'u1' });

    expect(first).toHaveBeenCalledWith({ userId: 'u1' });
    expect(second).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('only calls the handlers of that event', async () => {
    const bus = createEventBus();
    const other = vi.fn();
    bus.on('declaration.created', other);

    await bus.emit('user.deleted', { userId: 'u1' });

    expect(other).not.toHaveBeenCalled();
  });

  it('resolves when nobody is listening', async () => {
    await expect(createEventBus().emit('user.deleted', {})).resolves.toBeUndefined();
  });

  it('waits for an async handler before it resolves', async () => {
    const bus = createEventBus();
    let done = false;
    bus.on('user.deleted', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      done = true;
    });

    await bus.emit('user.deleted', {});

    expect(done).toBe(true);
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
    ['rejects', () => Promise.reject(new Error('boom'))],
  ])('never rejects when a handler %s, and logs it', async (_label, failing) => {
    const logger = { error: vi.fn() };
    const bus = createEventBus({ logger });
    bus.on('user.deleted', failing);

    await expect(bus.emit('user.deleted', {})).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0].event).toBe('user.deleted');
    expect(logger.error.mock.calls[0][0].err.message).toBe('boom');
  });

  it('still runs the other handlers when one fails', async () => {
    const bus = createEventBus({ logger: { error() {} } });
    const healthy = vi.fn();
    bus.on('user.deleted', () => {
      throw new Error('boom');
    });
    bus.on('user.deleted', healthy);

    await bus.emit('user.deleted', { userId: 'u1' });

    expect(healthy).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('removes a handler with the function that on() returns', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const off = bus.on('user.deleted', handler);

    off();
    await bus.emit('user.deleted', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a handler that is not a function', () => {
    expect(() => createEventBus().on('user.deleted', 'nope')).toThrow(TypeError);
  });
});
