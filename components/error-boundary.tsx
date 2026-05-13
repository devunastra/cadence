'use client'

import { Component } from 'react'
import { useToast } from '@/components/ui/toast-provider'

interface Props {
  children: React.ReactNode
  showError: (msg: string) => void
}

class ErrorBoundaryInner extends Component<Props> {
  componentDidCatch() {
    this.props.showError('System error — please refresh the page.')
  }

  render() {
    return this.props.children
  }
}

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const { showError } = useToast()
  return <ErrorBoundaryInner showError={showError}>{children}</ErrorBoundaryInner>
}
