import assert from 'node:assert/strict'
import test from 'node:test'

import { createSerialTaskQueue } from './serial-task-queue.js'

test('runs endpoint mutations in issue order', async () => {
  const queue = createSerialTaskQueue()
  const events = []
  let releaseFirst
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve })

  const first = queue.run(async () => {
    events.push('first:start')
    await firstBlocked
    events.push('first:end')
  })
  const second = queue.run(async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await Promise.resolve()
  assert.deepEqual(events, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('continues after a failed mutation', async () => {
  const queue = createSerialTaskQueue()
  await assert.rejects(queue.run(async () => { throw new Error('nope') }), /nope/)
  assert.equal(await queue.run(async () => 'recovered'), 'recovered')
})
