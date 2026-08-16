import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return <div className={`card${className ? ' ' + className : ''}`}>{children}</div>
}

interface CardHeaderProps {
  children?: ReactNode
  title?: string
  collapsed?: boolean
  onToggleCollapse?: () => void
  onRemove?: () => void
  variant?: 'default' | 'code'
  noBorder?: boolean
  dragHandle?: ReactNode
}

export function CardHeader({
  children,
  title,
  collapsed,
  onToggleCollapse,
  onRemove,
  variant = 'default',
  noBorder = false,
  dragHandle,
}: CardHeaderProps) {
  const classes = ['card-header', variant === 'code' && 'card-header--code', noBorder && 'card-header--no-border']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {onToggleCollapse !== undefined && (
        <button
          className={`collapse-btn${collapsed ? ' collapse-btn--collapsed' : ' collapse-btn--expanded'}`}
          onClick={onToggleCollapse}
        />
      )}
      {dragHandle}
      {title && <span className="card-title">{title}</span>}
      {children}
      {onRemove && (
        <button className="remove-btn ml-auto" onClick={onRemove}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}

interface CardBodyProps {
  children: ReactNode
  className?: string
}

export function CardBody({ children, className = '' }: CardBodyProps) {
  return <div className={`card-body${className ? ' ' + className : ''}`}>{children}</div>
}
