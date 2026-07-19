export function createSerialTaskQueue() {
  let tail = Promise.resolve()

  return {
    run(task) {
      const result = tail.then(task, task)
      tail = result.catch(() => {})
      return result
    },
  }
}
