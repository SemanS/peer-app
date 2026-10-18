/**
 * `try { run } finally { done }` as a function. React Compiler cannot compile a `finalizer`
 * inside a component or hook; this keeps the same ordering outside them.
 */
export async function withFinally<T>(run: () => Promise<T> | T, done: () => void): Promise<T> {
  try {
    return await run();
  } finally {
    done();
  }
}
