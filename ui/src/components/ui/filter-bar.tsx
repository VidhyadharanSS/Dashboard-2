import React from 'react'
import { cn } from '@/lib/utils'

interface FilterBarProps {
  children: React.ReactNode
  className?: string
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div className={cn(
      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border',
      'bg-muted/20 backdrop-blur-sm shadow-sm transition-all duration-200',
      'border-border/60',
      'hover:border-border hover:shadow-md',
      'min-h-[38px]',
      className,
    )}>
      {children}
    </div>
  )
}

interface FilterGroupProps {
  children: React.ReactNode
  label?: string
  className?: string
}

export function FilterGroup({ children, label, className }: FilterGroupProps) {
  return (
    <div className={cn('flex items-center gap-1.5 shrink-0', className)}>
      {label && (
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0 select-none">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

