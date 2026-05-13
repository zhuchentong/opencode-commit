export class CommitError extends Error {
  constructor(message: string, public suggestions: string[] = []) {
    super(message)
  }
}
