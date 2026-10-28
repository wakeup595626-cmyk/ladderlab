import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { downloadText, serializeProgram } from '../lib/io'
import { parseProgramDraft, readRawSavedProgram } from '../lib/storage'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 渲染层兜底：避免一个组件异常把整页变成空白，并让用户先把本机工程导出来。 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LadderLab 渲染失败', error, info.componentStack)
  }

  private downloadRaw = () => {
    try {
      const raw = readRawSavedProgram()
      if (!raw) return
      const draft = parseProgramDraft(raw)
      downloadText(
        '梯形实验室-本机工程备份.json',
        draft ? serializeProgram(draft.program) : raw,
      )
    } catch {
      // 隐私模式下读不到也保持页面可操作。
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash-screen">
        <section className="crash-card" role="alert" aria-labelledby="crash-title">
          <h1 id="crash-title">界面遇到了意外错误</h1>
          <p>本机工程仍保存在浏览器里。先导出原始数据，再重新加载即可继续。</p>
          <pre>{error.message}</pre>
          <div className="crash-actions">
            <button type="button" onClick={this.downloadRaw}>导出本机工程</button>
            <button type="button" className="is-primary" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        </section>
      </div>
    )
  }
}
