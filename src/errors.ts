/**
 * 提交错误类
 *
 * 用于封装提交信息验证过程中的错误，附带可操作的建议列表，
 * 帮助调用方快速定位并修正问题。
 */
export class CommitError extends Error {
  /** 错误修正建议列表 */
  public suggestions: string[]

  /**
   * @param message - 错误描述信息
   * @param suggestions - 可选的修正建议
   */
  constructor(message: string, suggestions: string[] = []) {
    super(message)
    this.suggestions = suggestions
  }
}
